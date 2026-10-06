import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {describe, expect, it} from 'vitest'

import {lastChangedFromGit} from '../src/lib/changes.js'
import {estimateRun, formatDuration, MEASURED_TIMINGS} from '../src/lib/estimate.js'
import {loadHistory} from '../src/lib/history.js'
import {loadPlan, savePlan} from '../src/lib/plan-file.js'
import {baselineHash, buildPlan, type PlanInput} from '../src/lib/planner.js'
import {OPERATORS} from '../src/operators/index.js'

const demo = path.resolve(__dirname, '../examples/demo/force-app')
const lab = {environment: 'MutationLab', source: 'Dev2', pipeline: 'Demo'}
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  packageDir: demo,
  scope: {kind: 'all'},
  max: 10,
  operators: OPERATORS,
  lab,
  now: new Date('2026-10-06T12:00:00Z'),
  ...over,
})

describe('buildPlan', () => {
  it('respects --max and counts candidates', () => {
    const plan = buildPlan(input({max: 4}))
    expect(plan.candidates).toBe(15)
    expect(plan.mutants).toHaveLength(4)
    expect(plan.notSelected).toHaveLength(11)
    expect(plan.notSelected[0]!.reason).toBe('over budget (--max 4)')
  })

  it('covers every metadata type before repeating one', () => {
    const plan = buildPlan(input({max: 5}))
    expect(new Set(plan.mutants.map((m) => m.component.type)).size).toBe(5)
  })

  it('prefers new operators over repeating one', () => {
    const plan = buildPlan(input({max: 10}))
    const ops = plan.mutants.map((m) => m.operator)
    expect(new Set(ops).size).toBeGreaterThanOrEqual(9)
  })

  it('returns everything when max exceeds candidates', () => {
    expect(buildPlan(input({max: 100})).mutants).toHaveLength(15)
  })

  it('is deterministic', () => {
    expect(buildPlan(input()).mutants.map((m) => m.id)).toEqual(buildPlan(input()).mutants.map((m) => m.id))
  })

  it('puts the most recently changed component first', () => {
    const plan = buildPlan(
      input({
        max: 3,
        lastChanged: {
          'ValidationRule:Opportunity.Discount_Max': 2_000,
          'Flow:Discount_Approval': 1_000,
          'Layout:Opportunity-Opportunity Layout': 500,
        },
      }),
    )
    expect(plan.mutants[0]!.component.type).toBe('ValidationRule')
    expect(plan.mutants[0]!.priority.reasons).toContain('most recently changed')
  })

  it('favours operators that survived in earlier runs', () => {
    const history = {runs: 1, survivalRate: {VR_NEGATE: 1, VR_DEACTIVATE: 0}, timings: {}}
    const plan = buildPlan(
      input({max: 1, scope: {kind: 'components', components: ['Opportunity.Discount_Max']}, history}),
    )
    expect(plan.mutants[0]!.operator).toBe('VR_NEGATE')
    expect(plan.mutants[0]!.priority.reasons).toContain('survived 100% of past runs')
  })

  it('limits to --components', () => {
    const plan = buildPlan(input({scope: {kind: 'components', components: ['Flow:Discount_Approval']}}))
    expect(plan.candidates).toBe(5)
    expect(plan.mutants.every((m) => m.component.type === 'Flow')).toBe(true)
  })

  it('limits to a story and says why', () => {
    const plan = buildPlan(
      input({scope: {kind: 'story', story: 'US-1', components: ['PermissionSet:Sales_Discounts']}}),
    )
    expect(plan.mutants.every((m) => m.component.type === 'PermissionSet')).toBe(true)
    expect(plan.mutants[0]!.priority.reasons).toContain('changed in US-1')
  })

  it('takes explicit mutant IDs in the given order', () => {
    const ids = [
      'VR_DEACTIVATE:ValidationRule:Opportunity.Discount_Max:active',
      'LAYOUT_FIELD_REMOVE:Layout:Opportunity-Opportunity Layout:Discount_Percent__c',
    ]
    const plan = buildPlan(input({mutantIds: ids}))
    expect(plan.mutants.map((m) => m.id)).toEqual(ids)
    expect(plan.notSelected[0]!.reason).toBe('not in --mutants')
    expect(() => buildPlan(input({mutantIds: ['NOPE']}))).toThrow(/Unknown mutant ID/)
  })

  it('returns an empty plan for an empty scope', () => {
    const plan = buildPlan(input({scope: {kind: 'components', components: ['Nope']}}))
    expect(plan.mutants).toEqual([])
    expect(plan.estimate.promotions).toBe(0)
  })

  it('records what run needs to verify it regenerates the same mutants', () => {
    const plan = buildPlan(input({max: 1}))
    expect(plan.baselineSha256).toBe(baselineHash(demo))
    expect(plan.mutants[0]!.mutatedSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.mutants[0]!.diff).toContain('@@')
  })

  it('estimates from history timings when available', () => {
    const history = {runs: 2, survivalRate: {}, timings: {promoteSeconds: 100, testSeconds: 40}}
    const plan = buildPlan(input({max: 2, history}))
    expect(plan.estimate.timings.promoteSeconds).toBe(100)
    expect(plan.estimate.timings.prepSeconds).toBe(MEASURED_TIMINGS.prepSeconds)
  })
})

describe('estimateRun', () => {
  it('models a chained run: N+1 promotions, N+1 test runs', () => {
    const e = estimateRun(10, 6)
    expect(e.promotions).toBe(11)
    expect(e.testRuns).toBe(11)
    // 11×70 prep + 50 baseline + 10×(140+50) + 140 final + 6×3 verify
    expect(e.totalSeconds).toBe(770 + 50 + 1900 + 140 + 18)
  })

  it('costs nothing beyond a baseline when there are no mutants', () => {
    const e = estimateRun(0, 0)
    expect(e.promotions).toBe(0)
    expect(e.breakdown.map((b) => b.label)).toEqual(['baseline test run'])
  })

  it.each([
    [42, '42s'],
    [60, '1m'],
    [2875, '47m 55s'],
    [4000, '1h 06m'],
  ])('formats %ss as %s', (s, out) => expect(formatDuration(s)).toBe(out))
})

describe('history', () => {
  it('learns survival rates and timings from earlier results, ignoring junk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-hist-'))
    const write = (run: string, body: string) => {
      fs.mkdirSync(path.join(root, '.mutant/runs', run), {recursive: true})
      fs.writeFileSync(path.join(root, '.mutant/runs', run, 'results.json'), body)
    }
    write(
      'r1',
      JSON.stringify({
        mutants: [
          {operator: 'VR_DEACTIVATE', outcome: 'survived', durations: {deploySeconds: 120, testSeconds: 50}},
          {operator: 'VR_DEACTIVATE', outcome: 'killed', durations: {deploySeconds: 160, testSeconds: 60}},
          {operator: 'FLOW_BOUNDARY', outcome: 'invalid'},
        ],
      }),
    )
    write('r2', 'not json')
    const h = loadHistory(root)
    expect(h.runs).toBe(1)
    expect(h.survivalRate).toEqual({VR_DEACTIVATE: 0.5})
    expect(h.timings).toEqual({promoteSeconds: 140, testSeconds: 55})
  })

  it('is empty without runs', () => {
    expect(loadHistory(fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-hist-')))).toEqual({
      runs: 0,
      survivalRate: {},
      timings: {},
    })
  })
})

describe('plan file', () => {
  it('saves a timestamped plan plus latest.json and loads it back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-plan-'))
    const plan = buildPlan(input({max: 2}))
    const file = savePlan(root, plan)
    expect(path.basename(file)).toBe('2026-10-06T12-00-00-000Z.json')
    expect(loadPlan(path.join(root, '.mutant/plans/latest.json')).mutants.map((m) => m.id)).toEqual(
      plan.mutants.map((m) => m.id),
    )
  })

  it('rejects files that are not plans', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-plan-')), 'x.json')
    fs.writeFileSync(f, '{"hello":1}')
    expect(() => loadPlan(f)).toThrow(/not a Mutant plan/)
  })
})

describe('lastChangedFromGit', () => {
  it('reads per-component commit times', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-git-'))
    const env = {
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    }
    await execa('git', ['init', '-q'], {cwd: repo})
    const vr = 'objects/Opportunity/validationRules/A.validationRule-meta.xml'
    const flow = 'flows/B.flow-meta.xml'
    for (const [file, date] of [
      [vr, '2026-01-01T00:00:00Z'],
      [flow, '2026-02-01T00:00:00Z'],
    ] as const) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true})
      fs.writeFileSync(path.join(repo, file), '<x/>')
      await execa('git', ['add', file], {cwd: repo})
      await execa('git', ['commit', '-q', '-m', file], {
        cwd: repo,
        env: {...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date},
      })
    }
    const times = await lastChangedFromGit(repo)
    expect(times['Flow:B']! > times['ValidationRule:Opportunity.A']!).toBe(true)
  })

  it('returns nothing outside a git repository', async () => {
    expect(await lastChangedFromGit(fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-nogit-')))).toEqual({})
  })
})
