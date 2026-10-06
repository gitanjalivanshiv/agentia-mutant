import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import type {Copado} from '../src/lib/agentia/index.js'
import type {MutantConfig} from '../src/lib/config.js'
import {applyHeals, healDir, loadHealState, prepareApply, proposeHeals} from '../src/lib/heal/heal.js'
import {buildHealPrompt, extractProposal, mergeIntoSuite, ProposalError} from '../src/lib/heal/robot.js'
import {compareRuns} from '../src/lib/report/compare.js'
import type {RunResults} from '../src/lib/report/model.js'

const SUITE = fs.readFileSync(
  path.resolve(__dirname, '../examples/demo/tests/discount_happy_path.robot'),
  'utf8',
)
/** The real reply from the Copado AI Test agent for the Discount_Max survivor (recorded 2026-10-06). */
const AI = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'samples/agentia/ai-ask-heal.json'), 'utf8'))
  .stdout.result
const mixed = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/results-mixed.json'), 'utf8'),
) as RunResults

describe('extractProposal', () => {
  it('extracts the test from the real Copado AI reply', () => {
    const p = extractProposal(AI.content)
    expect(p.testNames).toEqual(['Create opportunity with an excessive discount is rejected'])
    expect(p.testCases).toContain('VerifyText          Discount cannot exceed 40%')
    expect(p.keywords).toBeUndefined()
  })

  it('takes the last robot block and picks up helper keywords', () => {
    const p = extractProposal(
      'first:\n```robot\n*** Test Cases ***\nOld\n    Log    x\n```\nbetter:\n```robot\n*** Test Cases ***\nNew Test\n    Open Discount Form\n\n*** Keywords ***\nOpen Discount Form\n    ClickText    New\n```',
    )
    expect(p.testNames).toEqual(['New Test'])
    expect(p.keywordNames).toEqual(['Open Discount Form'])
  })

  it('rejects replies without a complete code block or test section', () => {
    expect(() => extractProposal('Sorry, I cannot help with that.')).toThrow(ProposalError)
    expect(() => extractProposal('```robot\n*** Keywords ***\nX\n    Log  y\n```')).toThrow(
      /no \*\*\* Test Cases/,
    )
    expect(() => extractProposal('```robot\n*** Test Cases ***\n')).toThrow(ProposalError) // stream cut off
  })

  it.each([
    'Run Process    rm    -rf    /',
    'Evaluate    __import__("os").system("x")',
    'Delete Record    Opportunity',
  ])('rejects forbidden keyword: %s', (line) => {
    expect(() => extractProposal(`\`\`\`robot\n*** Test Cases ***\nT\n    ${line}\n\`\`\``)).toThrow(
      /forbidden/,
    )
  })
})

describe('buildHealPrompt', () => {
  it('grounds the prompt in the breakage, the diff and the real suite', () => {
    const m = mixed.mutants.find((x) => x.operator === 'VR_DEACTIVATE')!
    const prompt = buildHealPrompt(m, SUITE)
    expect(prompt).toContain('Breakage: Validation rule `Discount_Max` on Opportunity switched off')
    expect(prompt).toContain('-    <active>true</active>')
    expect(prompt).toContain('*** Keywords ***\nSetup Browser')
    expect(prompt).toMatch(/PASSES on the correct configuration and FAILS when the breakage/)
  })
})

describe('mergeIntoSuite', () => {
  it('appends the test to the existing Test Cases section and leaves the rest untouched', () => {
    const {suite, added} = mergeIntoSuite(SUITE, [extractProposal(AI.content)])
    expect(added).toEqual(['Create opportunity with an excessive discount is rejected'])
    const tests = suite.indexOf('*** Test Cases ***')
    const keywords = suite.indexOf('*** Keywords ***')
    const newTest = suite.indexOf('Create opportunity with an excessive discount is rejected')
    expect(newTest).toBeGreaterThan(tests)
    expect(newTest).toBeLessThan(keywords)
    expect(suite).toContain('Create opportunity with a small discount')
    expect(suite.slice(keywords)).toBe(SUITE.slice(SUITE.indexOf('*** Keywords ***')))
  })

  it('renames duplicate test names and does not duplicate existing keywords', () => {
    const p = extractProposal(
      '```robot\n*** Test Cases ***\nCreate opportunity with a small discount\n    Login\n\n*** Keywords ***\nLogin\n    Log    dup\nNew Helper\n    Log    ok\n```',
    )
    const {suite, added} = mergeIntoSuite(SUITE, [p])
    expect(added).toEqual(['Create opportunity with a small discount (2)'])
    expect(suite.match(/^Login$/gm)).toHaveLength(1)
    expect(suite).toMatch(/^New Helper$/m)
  })

  it('creates a Test Cases section when the suite has none', () => {
    const {suite} = mergeIntoSuite('*** Settings ***\nLibrary    QWeb\n', [extractProposal(AI.content)])
    expect(suite).toMatch(
      /\*\*\* Test Cases \*\*\*\nCreate opportunity with an excessive discount is rejected/,
    )
  })
})

// ---- propose / apply with a stub Copado ----------------------------------------------------

let runDir: string
let uploads: {local: string; remote: string; content: string}[]
let remoteSuite: string
let aiReplies: string[]

const config = {crt: {projectId: 1, jobId: 2}, ai: {workspaceId: 'WS'}} as MutantConfig

const stub = {
  async crtJobFiles() {
    return [{path: 'discount_happy_path.robot', size: remoteSuite.length}]
  },
  async crtDownload(_p: number, _j: number, files: string[], out: string) {
    fs.mkdirSync(out, {recursive: true})
    fs.writeFileSync(path.join(out, files[0]!), remoteSuite)
    return [{path: files[0]!, value: remoteSuite}]
  },
  async aiAsk() {
    return {content: aiReplies.shift() ?? AI.content, completed: false, dialogueId: 'D1'}
  },
  async crtReplace(_p: number, _j: number, local: string, remote: string) {
    uploads.push({local, remote, content: fs.readFileSync(local, 'utf8')})
    remoteSuite = fs.readFileSync(local, 'utf8')
    return {}
  },
} as unknown as Copado

beforeEach(() => {
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-heal-'))
  uploads = []
  remoteSuite = SUITE
  aiReplies = []
})

describe('proposeHeals', () => {
  it('asks once per survivor, saves reviewable proposals and writes nothing to Copado', async () => {
    const results = {...mixed, mutants: mixed.mutants.map((m) => ({...m, healedBy: undefined}))}
    const state = await proposeHeals({copado: stub, config, runDir, results})
    expect(state.proposals).toHaveLength(4)
    expect(state.proposals.every((p) => p.status === 'proposed')).toBe(true)
    expect(uploads).toEqual([])
    const first = fs.readFileSync(path.join(healDir(runDir), state.proposals[0]!.file!), 'utf8')
    expect(first).toMatch(/^# Proposed by Copado AI \(Test agent\) for mutant /)
    expect(fs.readFileSync(path.join(healDir(runDir), 'suite.diff'), 'utf8')).toContain(
      '+Create opportunity with an excessive discount is rejected',
    )
    expect(loadHealState(runDir)?.suiteFile).toBe('discount_happy_path.robot')
  })

  it('retries once, then records a survivor without a usable test as failed', async () => {
    const results = {
      ...mixed,
      mutants: [{...mixed.mutants.find((m) => m.outcome === 'survived')!, healedBy: undefined}],
    }
    aiReplies = ['I cannot do that.', 'Still no code.']
    const state = await proposeHeals({copado: stub, config, runDir, results})
    expect(state.proposals[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/no complete robot code block/),
    })
  })

  it('refuses a run without survivors', async () => {
    const results = {...mixed, mutants: mixed.mutants.filter((m) => m.outcome !== 'survived')}
    await expect(proposeHeals({copado: stub, config, runDir, results})).rejects.toThrow(/no survivors/)
  })
})

describe('prepareApply / applyHeals', () => {
  async function proposed() {
    const results = {
      ...mixed,
      mutants: [{...mixed.mutants.find((m) => m.operator === 'VR_DEACTIVATE')!, healedBy: undefined}],
    }
    return proposeHeals({copado: stub, config, runDir, results})
  }

  it('honours edits the reviewer made to a proposal', async () => {
    const state = await proposed()
    const file = path.join(healDir(runDir), state.proposals[0]!.file!)
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(
          'Create opportunity with an excessive discount is rejected',
          'Reviewed: 45 percent discount is rejected',
        ),
    )
    const plan = await prepareApply(stub, config, runDir)
    expect(plan.added).toEqual(['Reviewed: 45 percent discount is rejected'])
  })

  it('uploads the merged suite to the same CRT file and records it once', async () => {
    await proposed()
    const plan = await prepareApply(stub, config, runDir)
    expect(plan.remoteChanged).toBe(false)
    await applyHeals(stub, config, runDir, plan)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.remote).toBe('discount_happy_path.robot')
    expect(uploads[0]!.content).toContain('Create opportunity with an excessive discount is rejected')
    await expect(prepareApply(stub, config, runDir)).rejects.toThrow(/already applied/)
  })

  it('--force re-applies edited proposals onto the original suite, only if the remote is still what Mutant uploaded', async () => {
    const state = await proposed()
    await applyHeals(stub, config, runDir, await prepareApply(stub, config, runDir))
    const file = path.join(healDir(runDir), state.proposals[0]!.file!)
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(/(VerifyText\s+)Discount cannot exceed 40%/, '$1Discount cannot exceed 40 percent'),
    )
    await expect(prepareApply(stub, config, runDir)).rejects.toThrow(/already applied/)
    const again = await prepareApply(stub, config, runDir, true)
    expect(again.merged).toContain('Discount cannot exceed 40 percent')
    expect(again.merged.match(/Create opportunity with an excessive discount is rejected/g)).toHaveLength(1)
    await applyHeals(stub, config, runDir, again)
    remoteSuite += '\n# someone edited this in CRT\n'
    await expect(prepareApply(stub, config, runDir, true)).rejects.toThrow(/refusing to overwrite/)
  })

  it('merges into the current remote suite when it changed after proposing', async () => {
    await proposed()
    remoteSuite = SUITE.replace(
      '*** Keywords ***',
      'Someone Else Added This\n    Log    hi\n\n*** Keywords ***',
    )
    const plan = await prepareApply(stub, config, runDir)
    expect(plan.remoteChanged).toBe(true)
    expect(plan.merged).toContain('Someone Else Added This')
    expect(plan.merged).toContain('Create opportunity with an excessive discount is rejected')
  })
})

describe('compareRuns', () => {
  const before = {...mixed, mutants: mixed.mutants.map((m) => ({...m, healedBy: undefined}))}
  const vr = before.mutants.find((m) => m.operator === 'VR_DEACTIVATE')!
  const flip = before.mutants.find((m) => m.operator === 'FLOW_DECISION_FLIP')!
  const after: RunResults = {
    ...before,
    runId: 'r-after',
    mutants: [
      {
        ...vr,
        outcome: 'killed',
        killedBy: [{name: 'Create opportunity with an excessive discount is rejected'}],
      },
      {...flip, outcome: 'survived'},
    ],
  }

  it('computes before → after, carrying over mutants that were not re-run', () => {
    const r = compareRuns(before, after)
    expect(r.comparison.before).toMatchObject({percent: 43, killed: 3, survived: 4})
    expect(r.comparison.after).toMatchObject({runId: 'r-after', percent: 57, killed: 4, survived: 3})
    expect(r.comparison.newlyCaught).toEqual([
      {
        id: vr.id,
        description: vr.description,
        by: 'Create opportunity with an excessive discount is rejected',
      },
    ])
    expect(r.carriedOver).toHaveLength(6)
  })

  it('credits the test heal wrote for a mutant when several tests caught it', () => {
    const b: RunResults = {
      ...after,
      mutants: [{...vr, outcome: 'killed', killedBy: [{name: 'Some other test'}, {name: 'Written for VR'}]}],
    }
    expect(compareRuns(before, b).comparison.newlyCaught[0]!.by).toBe('Some other test')
    expect(compareRuns(before, b, {[vr.id]: ['Written for VR']}).comparison.newlyCaught[0]!.by).toBe(
      'Written for VR',
    )
  })

  it('annotates newly caught survivors for the report', () => {
    const r = compareRuns(before, after)
    const healed = r.after.mutants.find((m) => m.id === vr.id)!
    expect(healed.outcome).toBe('survived')
    expect(healed.healedBy).toEqual([{name: 'Create opportunity with an excessive discount is rejected'}])
  })
})
