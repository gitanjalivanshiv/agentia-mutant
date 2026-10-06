import {describe, expect, it} from 'vitest'

import {FLOW_BOUNDARY, FLOW_DECISION_FLIP, FLOW_DROP_ASSIGNMENT} from '../../src/operators/flow.js'
import {changedLines, demo, expectSane, run, sample} from './helpers.js'

const discount = demo('flows/Discount_Approval.flow-meta.xml')
const routing = sample('Case_Routing.flow-meta.xml')
const FLOW = 'Flow'

describe('FLOW_DECISION_FLIP', () => {
  it('flips > to ≤ in the demo flow with a one-line diff', () => {
    const [m, ...rest] = run(FLOW_DECISION_FLIP, FLOW, 'Discount_Approval', discount)
    expect(rest).toHaveLength(0)
    expectSane(m!)
    expect(changedLines(m!)).toEqual({
      removed: ['<operator>GreaterThan</operator>'],
      added: ['<operator>LessThanOrEqualTo</operator>'],
    })
    expect(m!.description).toBe(
      'Flow "Discount Approval": decision "Discount Above Threshold" now checks Discount_Percent__c ≤ 20.0 instead of Discount_Percent__c > 20.0',
    )
  })

  it('makes one mutant per flippable condition and skips operators it cannot flip (Contains)', () => {
    const ms = run(FLOW_DECISION_FLIP, FLOW, 'Case_Routing', routing)
    expect(ms.map((m) => m.siteKey)).toEqual(['Is_Gold/0', 'Is_Gold/1'])
    expect(changedLines(ms[0]!).added).toEqual(['<operator>NotEqualTo</operator>'])
    expect(changedLines(ms[1]!).added).toEqual(['<operator>LessThan</operator>'])
  })

  it('does not touch assignment operators', () => {
    for (const m of run(FLOW_DECISION_FLIP, FLOW, 'Case_Routing', routing)) {
      expect(m.mutated.match(/<operator>Assign<\/operator>/g)).toHaveLength(2)
    }
  })

  it('returns nothing for a flow without decisions', () => {
    const noDecisions = discount.replace(/<decisions>[\s\S]*<\/decisions>/, '')
    expect(run(FLOW_DECISION_FLIP, FLOW, 'Discount_Approval', noDecisions)).toEqual([])
  })
})

describe('FLOW_BOUNDARY', () => {
  it('moves the demo threshold to 21.0 and 19.0, preserving the literal format', () => {
    const ms = run(FLOW_BOUNDARY, FLOW, 'Discount_Approval', discount)
    expect(ms.map((m) => changedLines(m).added[0])).toEqual([
      '<numberValue>21.0</numberValue>',
      '<numberValue>19.0</numberValue>',
    ])
    ms.forEach(expectSane)
  })

  it('handles integer literals', () => {
    const ms = run(FLOW_BOUNDARY, FLOW, 'Case_Routing', routing)
    expect(ms.map((m) => [m.siteKey, changedLines(m).added[0]])).toEqual([
      ['Is_Gold/1/plus', '<numberValue>4</numberValue>'],
      ['Is_Gold/1/minus', '<numberValue>2</numberValue>'],
    ])
  })

  it('ignores numbers outside decision conditions (record update values)', () => {
    const ms = run(FLOW_BOUNDARY, FLOW, 'Case_Routing', routing)
    for (const m of ms) expect(m.mutated).toContain('<numberValue>1.0</numberValue>')
  })

  it('explains the boundary to test', () => {
    const [plus] = run(FLOW_BOUNDARY, FLOW, 'Discount_Approval', discount)
    expect(plus!.shouldCheck).toContain('at 20.0 and just above it')
  })
})

describe('FLOW_DROP_ASSIGNMENT', () => {
  it('bypasses a single-item assignment by removing the connector that leads to it', () => {
    const [flag] = run(FLOW_DROP_ASSIGNMENT, FLOW, 'Discount_Approval', discount)
    expectSane(flag!)
    expect(flag!.siteKey).toBe('Flag_Approval/bypass')
    expect(changedLines(flag!).removed).toEqual([
      '<connector>',
      '<targetReference>Flag_Approval</targetReference>',
      '</connector>',
    ])
    expect(changedLines(flag!).added).toEqual([])
    expect(flag!.description).toBe(
      'Flow "Discount Approval": step "Flag Approval" is skipped, so Approval_Required__c is never set to true',
    )
    // The assignment element itself stays, so the flow still deploys.
    expect(flag!.mutated).toContain('<name>Flag_Approval</name>')
  })

  it('removes a default connector but keeps its label (Salesforce requires it)', () => {
    const [, clear] = run(FLOW_DROP_ASSIGNMENT, FLOW, 'Discount_Approval', discount)
    expectSane(clear!)
    expect(clear!.mutated).not.toContain('<defaultConnector>')
    expect(clear!.mutated).toContain('<defaultConnectorLabel>Within Limit</defaultConnectorLabel>')
    expect(clear!.stats).toEqual({added: 0, removed: 3})
  })

  it('removes one item at a time from a multi-item assignment', () => {
    const ms = run(FLOW_DROP_ASSIGNMENT, FLOW, 'Case_Routing', routing).filter((m) =>
      m.siteKey.startsWith('Set_Priority'),
    )
    expect(ms.map((m) => m.siteKey)).toEqual(['Set_Priority/0', 'Set_Priority/1'])
    expect(ms[0]!.mutated).not.toContain('$Record.Priority')
    expect(ms[0]!.mutated).toContain('$Record.Escalated__c')
    expect(ms[0]!.stats).toEqual({added: 0, removed: 7})
    expect(ms[1]!.description).toBe('Flow "Case Routing": step "Set Priority" no longer sets Escalated__c')
  })

  it('removes one field at a time from a record update with several fields', () => {
    const ms = run(FLOW_DROP_ASSIGNMENT, FLOW, 'Case_Routing', routing).filter((m) =>
      m.siteKey.startsWith('Update_Account'),
    )
    expect(ms.map((m) => m.siteKey)).toEqual(['Update_Account/0', 'Update_Account/1'])
    expect(ms[1]!.mutated).not.toContain('Escalation_Count__c')
    ms.forEach(expectSane)
  })

  it('rewires around a single-item assignment that has a next step', () => {
    // Make Set_Priority single-item: the decision should then point straight at Update_Account.
    const single = routing.replace(
      /\s*<assignmentItems>\s*<assignToReference>\$Record\.Escalated__c[\s\S]*?<\/assignmentItems>/,
      '',
    )
    const [m] = run(FLOW_DROP_ASSIGNMENT, FLOW, 'Case_Routing', single).filter(
      (x) => x.siteKey === 'Set_Priority/bypass',
    )
    expectSane(m!)
    expect(changedLines(m!)).toEqual({
      removed: ['<targetReference>Set_Priority</targetReference>'],
      added: ['<targetReference>Update_Account</targetReference>'],
    })
  })
})
