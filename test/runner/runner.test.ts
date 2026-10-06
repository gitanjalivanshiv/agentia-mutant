import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {beforeEach, describe, expect, it} from 'vitest'

import type {Copado} from '../../src/lib/agentia/index.js'
import type {MutantConfig} from '../../src/lib/config.js'
import type {LabContext} from '../../src/lib/lab.js'
import {listComponents, matchesBaseline} from '../../src/lib/metadata.js'
import {generateMutants} from '../../src/lib/mutants.js'
import {buildPlan} from '../../src/lib/planner.js'
import {RunStore} from '../../src/lib/runner/run-store.js'
import {isTransient, Runner, type RunnerIO, unsafePromotion} from '../../src/lib/runner/runner.js'
import type {RunState} from '../../src/lib/runner/types.js'
import {buildUnits, initialResults} from '../../src/lib/runner/units.js'
import {OPERATORS} from '../../src/operators/index.js'

const demo = path.resolve(__dirname, '../../examples/demo/force-app')
const xunitDir = path.resolve(__dirname, '../samples/xunit')
const GREEN = fs.readFileSync(path.join(xunitDir, 'green.xml'), 'utf8')
const RED = fs.readFileSync(path.join(xunitDir, 'discount-field-missing.xml'), 'utf8')
const components = listComponents(demo)
const fileOf = (key: string) => components.find((c) => `${c.type}:${c.apiName}` === key)!.file

const lab: LabContext = {
  pipeline: {id: 'PIPE', name: 'Demo Pipeline'},
  lab: {id: 'ENV_LAB', name: 'MutationLab'},
  source: {id: 'ENV_SRC', name: 'Dev2', credentials: [{id: 'CRED_SRC'}]},
  labOrg: {pipelineId: 'PIPE', orgId: 'ORG', credentialId: 'CRED_LAB'},
  connection: {},
}

/**
 * A simulated Copado + Salesforce lab. It tracks the lab org's metadata (starting at the baseline),
 * records what each published story contains, plays the user who creates promotions, applies a
 * promotion's files on deploy, and "runs the tests" with a predicate over the lab's metadata.
 */
class SimCopado {
  org = new Map<string, string>() // package-relative file → content in the lab org
  stories: {id: string; name: string; title: string}[] = []
  storyFiles = new Map<string, Record<string, string>>()
  promotionsCreated: {id: string; name: string; story: string}[] = []
  deployed: string[] = []
  current?: string
  calls: string[] = []
  /** The "user" creates promotions after this many polls. */
  createPromotionsAfterPolls = 1
  polls = 0
  failDeployOf = new Set<string>() // story names whose deploy fails
  ignoreDeployOf = new Set<string>() // story names whose deploy "succeeds" but changes nothing
  baselineRed = false
  overridePromotion?: (id: string) => Record<string, unknown> | undefined

  constructor(private readonly labRepo: string) {
    for (const c of components) this.org.set(c.file, fs.readFileSync(path.join(demo, c.file), 'utf8'))
  }

  /** The suite: the happy path fails when Discount Percent is not on the layout or not editable. */
  suiteFails(): boolean {
    const layout = this.org.get(fileOf('Layout:Opportunity-Opportunity Layout'))!
    const permset = this.org.get(fileOf('PermissionSet:Sales_Discounts'))!
    return (
      !layout.includes('<field>Discount_Percent__c</field>') ||
      /<editable>false<\/editable>\s*<field>Opportunity.Discount_Percent__c/.test(permset)
    )
  }

  async workCreate(input: {title: string}) {
    this.calls.push('workCreate')
    const n = this.stories.length + 100
    const story = {id: `US_ID_${n}`, name: `US-0000${n}`, title: input.title}
    this.stories.push(story)
    return {...story, sourceEnvironmentName: 'Dev2'}
  }

  async workSet(story: string, repo: string) {
    this.calls.push(`workSet ${story}`)
    this.current = story
    // Like `agentia cicd work set`: a fresh feature branch from the base branch (which lacks the demo app).
    await execa('git', ['checkout', '-q', '-B', `feature/${story}`, 'base'], {cwd: repo})
    return {git: {branch: `feature/${story}`}}
  }

  async workSetNone() {
    this.current = undefined
    return {}
  }

  async workPublish(repo: string, fullMetadata: string[]) {
    this.calls.push(`publish ${this.current} ${fullMetadata.join(',')}`)
    const show = await execa('git', ['show', '--name-only', '--format=', 'HEAD'], {cwd: repo})
    const files: Record<string, string> = {}
    for (const f of show.stdout.split('\n').filter(Boolean)) {
      files[f.replace(/^force-app\//, '')] = fs.readFileSync(path.join(repo, f), 'utf8')
    }
    this.storyFiles.set(this.current!, files)
    return {push: {jobId: `JOB_${this.current}`}}
  }

  async job() {
    return {id: 'J', status: 'Successful'}
  }

  async promotions() {
    this.polls += 1
    if (this.polls > this.createPromotionsAfterPolls && this.promotionsCreated.length === 0) {
      // The user creates one promotion per story, in a random-ish order.
      for (const s of [...this.stories].reverse()) {
        this.promotionsCreated.push({id: `PROMO_${s.name}`, name: `P-${s.name}`, story: s.name})
      }
      // Plus someone else's unrelated promotion that must be ignored.
      this.promotionsCreated.push({id: 'PROMO_OTHER', name: 'P-OTHER', story: 'US-9999999'})
    }
    // Like the real CLI: `promotion list` gives 18-char IDs…
    return this.promotionsCreated.map((p) => ({id: `${p.id}AAA`, name: p.name, status: 'Draft'}))
  }

  async promotion(id18: string) {
    const id = id18.replace(/AAA$/, '')
    const p = this.promotionsCreated.find((x) => x.id === id)!
    return (
      this.overridePromotion?.(id) ?? {
        id, // …while `promotion get` gives the 15-char ID

        name: p.name,
        status: this.deployed.includes(p.story) ? 'Completed' : 'Draft',
        sourceEnvironmentName: 'Dev2',
        destinationEnvironmentName: 'MutationLab',
        isBackPromotion: false,
        userStories: [{name: p.story}],
      }
    )
  }

  async promotionRunDeploy(id: string) {
    if (!id.endsWith('AAA'))
      throw new Error('Promotion ID must be an 18-character Salesforce ID, not a display name.')
    const p = this.promotionsCreated.find((x) => `${x.id}AAA` === id)!
    this.calls.push(`deploy ${p.story}`)
    if (this.failDeployOf.has(p.story))
      return {jobMonitors: [{jobExecutionId: 'JE', jobExecutionStatus: 'Failed'}]}
    if (!this.ignoreDeployOf.has(p.story)) {
      for (const [file, content] of Object.entries(this.storyFiles.get(p.story)!)) this.org.set(file, content)
    }
    this.deployed.push(p.story)
    return {
      jobMonitors: [
        {jobExecutionId: 'JE1', jobExecutionStatus: 'Successful'},
        {jobExecutionId: 'JE2', jobExecutionStatus: 'Successful'},
      ],
    }
  }

  async crtRun(_p: number, _j: number, out: {archive: string; xunit: string}) {
    this.calls.push('crtRun')
    const red = this.baselineRed || this.suiteFails()
    fs.writeFileSync(out.xunit, red ? RED : GREEN)
    fs.writeFileSync(out.archive, 'zip')
    return {finalBuild: {id: 1, status: red ? 'failed' : 'succeeded'}}
  }

  async metadataContentGet(_org: unknown, type: string, apiName: string, outputFile: string) {
    fs.writeFileSync(outputFile, this.org.get(fileOf(`${type}:${apiName}`))!)
  }
}

let root: string
let labRepo: string
let config: MutantConfig
let sim: SimCopado
const events: string[] = []

const io: RunnerIO = {
  info: (m) => events.push(`info ${m}`),
  warn: (m) => events.push(`warn ${m}`),
  mutant: (r) => events.push(`mutant ${r.outcome} ${r.id}`),
  promotionsNeeded: (units) => events.push(`promotions-needed ${units.length}`),
}

const PICK = [
  'VR_DEACTIVATE:ValidationRule:Opportunity.Discount_Max:active', // survives the happy path
  'LAYOUT_FIELD_REMOVE:Layout:Opportunity-Opportunity Layout:Discount_Percent__c', // killed
  'PERMSET_FLS_REVOKE:PermissionSet:Sales_Discounts:Opportunity.Discount_Percent__c:edit', // killed
]

function newState(ids = PICK): {state: RunState; store: RunStore} {
  const all = new Map(generateMutants(demo).map((m) => [m.id, m]))
  const mutants = ids.map((id) => all.get(id)!)
  const plan = buildPlan({
    packageDir: demo,
    scope: {kind: 'all'},
    max: 3,
    operators: OPERATORS,
    lab: {environment: 'MutationLab', source: 'Dev2', pipeline: 'Demo Pipeline'},
  })
  const now = new Date().toISOString()
  const state: RunState = {
    version: 1,
    runId: 'r-test',
    phase: 'created',
    createdAt: now,
    updatedAt: now,
    plan,
    lab: plan.lab,
    units: buildUnits(mutants, demo, 'r-test', 'Mutant Lab –'),
    mutants: initialResults(mutants),
  }
  const store = new RunStore(root, 'r-test')
  store.save(state)
  return {state, store}
}

function runner(
  state: RunState,
  store: RunStore,
  over: Partial<ConstructorParameters<typeof Runner>[1]> = {},
) {
  return new Runner(state, {
    copado: sim as unknown as Copado,
    lab,
    config,
    packageDir: demo,
    labRepo,
    store,
    io,
    baselineRuns: 1,
    promotionWaitMs: 60_000,
    pollMs: 1,
    sleep: async () => {},
    projectId: 'PROJ',
    ...over,
  })
}

const labMatchesBaseline = () =>
  components.every((c) =>
    matchesBaseline(fs.readFileSync(path.join(demo, c.file), 'utf8'), sim.org.get(c.file)!),
  )

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-run-'))
  labRepo = path.join(root, 'lab')
  fs.mkdirSync(labRepo)
  await execa('git', ['init', '-q'], {cwd: labRepo})
  await execa('git', ['config', 'user.email', 't@example.com'], {cwd: labRepo})
  await execa('git', ['config', 'user.name', 'T'], {cwd: labRepo})
  await execa('git', ['commit', '-q', '--allow-empty', '-m', 'init'], {cwd: labRepo})
  await execa('git', ['branch', 'base'], {cwd: labRepo})
  sim = new SimCopado(labRepo)
  events.length = 0
  config = {
    version: 1,
    labEnvironment: 'MutationLab',
    sourceEnvironment: 'Dev2',
    pipeline: 'Demo Pipeline',
    labRepoPath: 'lab',
    packageDirectory: demo,
    labPackageDirectory: 'force-app',
    storyTitlePrefix: 'Mutant Lab –',
    crt: {projectId: 1, jobId: 2},
    ai: {},
    budget: {maxMutants: 10, mutantTimeoutMinutes: 20},
    operators: {allow: [], deny: []},
    lockFile: path.join(root, '.org-busy'),
    iKnowThisIsALab: false,
  }
})

describe('Runner end to end (simulated lab)', () => {
  it('baseline → stories → promotions → mutants → revert → verify', async () => {
    const {state, store} = newState()
    expect(await runner(state, store).run()).toBe('done')

    expect(state.mutants.map((m) => m.outcome)).toEqual(['survived', 'killed', 'killed'])
    expect(state.mutants[1]!.killedBy).toEqual([
      {
        name: 'Create opportunity with a small discount',
        message: expect.stringContaining('Discount Percent'),
      },
    ])
    expect(state.score).toMatchObject({killed: 2, survived: 1, score: 2 / 3})
    expect(state.verify).toMatchObject({ok: true, drifted: []})
    expect(labMatchesBaseline()).toBe(true)
    // 4 stories (3 mutants + final revert), deployed in order, each promotion matched to its own story.
    expect(sim.deployed).toEqual(state.units.map((u) => u.story!.name))
    expect(state.units.every((u) => u.promotion?.name === `P-${u.story!.name}`)).toBe(true)
    expect(events).toContain('promotions-needed 4')
  })

  it('publishes permission sets as full metadata', async () => {
    const {state, store} = newState()
    await runner(state, store).run()
    expect(sim.calls.filter((c) => c.startsWith('publish')).map((c) => c.split(' ')[2])).toEqual([
      '',
      '',
      'PermissionSet:Sales_Discounts',
      'PermissionSet:Sales_Discounts',
    ])
  })

  it('writes results.json and state.json into the run directory', async () => {
    const {state, store} = newState()
    await runner(state, store).run()
    const results = JSON.parse(fs.readFileSync(store.path('results.json'), 'utf8'))
    expect(results.score.killed).toBe(2)
    expect(results.mutants[0].test.artifacts.xunit).toBe('artifacts/mutant-1/xunit.xml')
    expect(fs.existsSync(store.path('artifacts/baseline-1/xunit.xml'))).toBe(true)
    expect(store.load().phase).toBe('done')
  })

  it('fails at prepare time (nothing deployed) when a story would commit nothing', async () => {
    // The base branch already contains the mutated validation rule, so unit 1 has nothing to commit.
    const vr = generateMutants(demo).find((m) => m.id === PICK[0])!
    const target = path.join(labRepo, 'force-app', vr.file)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, vr.mutated)
    await execa('git', ['checkout', '-q', 'base'], {cwd: labRepo})
    await execa('git', ['add', '.'], {cwd: labRepo})
    await execa('git', ['commit', '-q', '-m', 'mutant on base'], {cwd: labRepo})
    const {state, store} = newState()
    expect(await runner(state, store).run()).toBe('failed')
    expect(state.failure).toMatch(/nothing to commit/)
    expect(sim.deployed).toHaveLength(0)
    const status = await execa('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: labRepo})
    expect(status.stdout).toBe('')
  })

  it('stops before touching Copado when the baseline is red', async () => {
    sim.baselineRed = true
    const {state, store} = newState()
    expect(await runner(state, store).run()).toBe('failed')
    expect(state.failure).toMatch(/Baseline is red/)
    expect(sim.stories).toHaveLength(0)
    expect(sim.deployed).toHaveLength(0)
  })

  it('classifies a failed deploy as invalid and the next unit still restores the lab', async () => {
    const {state, store} = newState()
    // Fail the second unit's deploy once stories exist.
    const r = runner(state, store)
    const origCreate = sim.workCreate.bind(sim)
    sim.workCreate = async (input) => {
      const s = await origCreate(input)
      if (sim.stories.length === 2) sim.failDeployOf.add(s.name)
      return s
    }
    expect(await r.run()).toBe('done')
    expect(state.mutants.map((m) => m.outcome)).toEqual(['survived', 'invalid', 'killed'])
    expect(state.score).toMatchObject({killed: 1, survived: 1, invalid: 1, score: 0.5})
    expect(labMatchesBaseline()).toBe(true)
  })

  it('counts a deploy job that ran and failed (CLI error envelope) as invalid', async () => {
    const {state, store} = newState()
    const orig = sim.promotionRunDeploy.bind(sim)
    sim.promotionRunDeploy = async (id: string) => {
      if (id.includes(sim.stories[1]!.name)) {
        const {AgentiaError} = await import('../../src/lib/agentia/index.js')
        throw new AgentiaError(
          'Promotion job a0sXXXXXXXXXXXXXXX finished with status Error: Metadata Deployment - Flow:X - Enter a label for the default outcome.',
          {command: 'agentia cicd promotion run', exitCode: 1},
        )
      }
      return orig(id)
    }
    expect(await runner(state, store).run()).toBe('done')
    expect(state.mutants[1]).toMatchObject({
      outcome: 'invalid',
      reason: expect.stringContaining('default outcome'),
    })
    expect(labMatchesBaseline()).toBe(true)
  })

  it('pauses when promotions are not created in time, and resumes later', async () => {
    sim.createPromotionsAfterPolls = 1_000
    const {state, store} = newState()
    expect(await runner(state, store, {promotionWaitMs: 0}).run()).toBe('awaiting-promotions')
    expect(sim.deployed).toHaveLength(0)
    expect(store.load().phase).toBe('awaiting-promotions')

    sim.createPromotionsAfterPolls = 0
    sim.polls = 0
    const resumed = store.load()
    expect(await runner(resumed, store).run()).toBe('done')
    expect(resumed.mutants.map((m) => m.outcome)).toEqual(['survived', 'killed', 'killed'])
    // Stories were not re-created on resume.
    expect(sim.stories).toHaveLength(4)
  })

  it('keeps polling for promotions through network errors', async () => {
    const {state, store} = newState()
    const orig = sim.promotions.bind(sim)
    let failures = 2
    sim.promotions = async () => {
      if (failures-- > 0) throw new Error('getaddrinfo ENOTFOUND na.api.copado.com')
      return orig()
    }
    expect(await runner(state, store).run()).toBe('done')
    expect(events.filter((e) => e.startsWith('warn Could not reach Copado'))).toHaveLength(2)
  })

  it('stopping (Ctrl-C) after the first mutant still reverts and verifies', async () => {
    const {state, store} = newState()
    let tested = 0
    const r = runner(state, store, {shouldStop: () => tested >= 1})
    const orig = io.mutant
    io.mutant = (res, i, n) => {
      tested++
      orig(res, i, n)
    }
    try {
      expect(await r.run()).toBe('failed')
    } finally {
      io.mutant = orig
    }
    expect(state.failure).toMatch(/Stopped by the user.*reverted and verified/)
    expect(state.mutants.map((m) => m.outcome)).toEqual(['survived', undefined, undefined])
    expect(sim.deployed.at(-1)).toBe(state.units.at(-1)!.story!.name)
    expect(labMatchesBaseline()).toBe(true)
  })

  it('refuses a promotion that is not exactly source → lab with this story, and reverts', async () => {
    const {state, store} = newState()
    sim.overridePromotion = (id) =>
      id === `PROMO_${sim.stories[0]!.name}` && sim.promotionsCreated.length && sim.deployed.length === 0
        ? {
            id,
            name: 'P-X',
            status: 'Draft',
            sourceEnvironmentName: 'Dev2',
            destinationEnvironmentName: 'UAT',
            userStories: [{name: sim.stories[0]!.name}],
          }
        : undefined
    expect(await runner(state, store).run()).toBe('failed')
    expect(state.failure).toMatch(/Refusing to run P-X: destination is UAT/)
    expect(sim.calls).not.toContain(`deploy ${sim.stories[0]!.name}`)
  })

  it('fails with exact recovery steps when the lab does not match the baseline after the revert', async () => {
    const {state, store} = newState()
    const origCreate = sim.workCreate.bind(sim)
    sim.workCreate = async (input) => {
      const s = await origCreate(input)
      if (input.title.includes('final revert')) sim.ignoreDeployOf.add(s.name)
      return s
    }
    expect(await runner(state, store).run()).toBe('failed')
    expect(state.verify?.ok).toBe(false)
    expect(state.failure).toMatch(/does not match the baseline/)
    expect(state.failure).toMatch(/agentia cicd promotion run PROMO_US-\d+AAA --operation merge_and_deploy/)
  })
})

describe('unsafePromotion', () => {
  const unit = {index: 0, files: {}, components: [], title: 't', story: {id: 'S', name: 'US-1'}}
  const good = {
    id: 'P',
    name: 'P1',
    status: 'Draft',
    sourceEnvironmentName: 'Dev2',
    destinationEnvironmentName: 'MutationLab',
    isBackPromotion: false,
    userStories: [{name: 'US-1'}],
  }

  it('accepts a draft forward promotion with exactly this story', () => {
    expect(unsafePromotion(good, unit, lab)).toBeUndefined()
  })

  it.each([
    [{destinationEnvironmentName: 'UAT'}, /destination is UAT/],
    [{sourceEnvironmentName: 'Dev1'}, /source is Dev1/],
    [{isBackPromotion: true}, /back-promotion/],
    [{userStories: [{name: 'US-1'}, {name: 'US-2'}]}, /contains US-1, US-2/],
    [{status: 'Completed'}, /status is Completed/],
  ])('refuses %o', (over, msg) => {
    expect(unsafePromotion({...good, ...over}, unit, lab)).toMatch(msg)
  })
})

describe('isTransient', () => {
  it.each([
    'getaddrinfo ENOTFOUND na.api.copado.com',
    'read ECONNRESET',
    'socket hang up',
    'Timed out after 300 s',
  ])('retries %s', (m) => expect(isTransient(new Error(m))).toBe(true))
  it('does not retry real errors', () => {
    expect(isTransient(new Error('Invalid input: expected string'))).toBe(false)
  })
})
