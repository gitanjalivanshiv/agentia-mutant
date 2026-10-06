import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {generateMutants} from '../../src/lib/mutants.js'
import {buildPlan} from '../../src/lib/planner.js'
import {buildUnits, resolvePlanMutants, StalePlanError} from '../../src/lib/runner/units.js'
import {OPERATORS} from '../../src/operators/index.js'

const demo = path.resolve(__dirname, '../../examples/demo/force-app')
const byId = new Map(generateMutants(demo).map((m) => [m.id, m]))
const VR = 'VR_DEACTIVATE:ValidationRule:Opportunity.Discount_Max:active'
const VR2 = 'VR_NEGATE:ValidationRule:Opportunity.Discount_Max:formula'
const FLOW = 'FLOW_BOUNDARY:Flow:Discount_Approval:Needs_Approval/0/plus'
const base = (file: string) => fs.readFileSync(path.join(demo, file), 'utf8')

describe('buildUnits (self-healing chained deploys)', () => {
  const [vr, flow] = [byId.get(VR)!, byId.get(FLOW)!]
  const units = buildUnits([vr, flow], demo, 'r-1', 'Mutant Lab –')

  it('makes one unit per mutant plus a final revert', () => {
    expect(units.map((u) => [u.index, u.mutantId])).toEqual([
      [0, VR],
      [1, FLOW],
      [2, undefined],
    ])
    expect(units.map((u) => u.title)).toEqual([
      'Mutant Lab – r-1 #1/2 VR_DEACTIVATE Opportunity.Discount_Max',
      'Mutant Lab – r-1 #2/2 FLOW_BOUNDARY Discount_Approval',
      'Mutant Lab – r-1 final revert to baseline',
    ])
  })

  it('unit 1 applies only the first mutant', () => {
    expect(units[0]!.files).toEqual({[vr.file]: vr.mutated})
  })

  it('unit 2 restores every earlier component and applies the next mutant', () => {
    expect(units[1]!.files).toEqual({[vr.file]: base(vr.file), [flow.file]: flow.mutated})
    expect(units[1]!.components.sort()).toEqual([
      'Flow:Discount_Approval',
      'ValidationRule:Opportunity.Discount_Max',
    ])
  })

  it('the final unit writes only baselines', () => {
    expect(units[2]!.files).toEqual({[vr.file]: base(vr.file), [flow.file]: base(flow.file)})
  })

  it('two mutants of the same file: the later mutant wins, the final unit restores it', () => {
    const u = buildUnits([vr, byId.get(VR2)!], demo, 'r-1', 'P')
    expect(u[1]!.files[vr.file]).toBe(byId.get(VR2)!.mutated)
    expect(u[2]!.files[vr.file]).toBe(base(vr.file))
  })

  it('no mutants, no units', () => {
    expect(buildUnits([], demo, 'r', 'P')).toEqual([])
  })
})

describe('resolvePlanMutants', () => {
  const plan = buildPlan({
    packageDir: demo,
    scope: {kind: 'all'},
    max: 3,
    operators: OPERATORS,
    lab: {environment: 'L', source: 'S', pipeline: 'P'},
  })

  it('regenerates exactly the planned mutants', () => {
    expect(resolvePlanMutants(plan, demo).map((m) => m.id)).toEqual(plan.mutants.map((m) => m.id))
  })

  it('refuses a plan made from different baseline metadata', () => {
    expect(() => resolvePlanMutants({...plan, baselineSha256: 'x'}, demo)).toThrow(StalePlanError)
  })

  it('refuses a mutant whose content changed', () => {
    const tampered = {
      ...plan,
      mutants: plan.mutants.map((m, i) => (i === 0 ? {...m, mutatedSha256: '0'.repeat(64)} : m)),
    }
    expect(() => resolvePlanMutants(tampered, demo)).toThrow(/different content/)
  })

  it('refuses unknown mutants', () => {
    const bogus = {...plan, mutants: [{...plan.mutants[0]!, id: 'NOPE:X:Y:z'}]}
    expect(() => resolvePlanMutants(bogus, demo)).toThrow(/no longer exists/)
  })
})
