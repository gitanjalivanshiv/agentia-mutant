import {describe, expect, it} from 'vitest'

import {VR_DEACTIVATE, VR_NEGATE} from '../../src/operators/validation-rule.js'
import {changedLines, demo, expectSane, run, sample} from './helpers.js'

const discountMax = demo('objects/Opportunity/validationRules/Discount_Max.validationRule-meta.xml')
const VR = 'ValidationRule'

describe('VR_DEACTIVATE', () => {
  it('switches the demo rule off with a one-line diff', () => {
    const [m, ...rest] = run(VR_DEACTIVATE, VR, 'Opportunity.Discount_Max', discountMax)
    expect(rest).toHaveLength(0)
    expectSane(m!)
    expect(changedLines(m!)).toEqual({removed: ['<active>true</active>'], added: ['<active>false</active>']})
    expect(m!.stats).toEqual({added: 1, removed: 1})
  })

  it('describes the breakage and the test that would catch it', () => {
    const [m] = run(VR_DEACTIVATE, VR, 'Opportunity.Discount_Max', discountMax)
    expect(m!.description).toBe('Validation rule `Discount_Max` on Opportunity switched off')
    expect(m!.shouldCheck).toBe(
      'Saving an Opportunity that breaks `Discount_Max` (Discount_Percent__c > 0.40) is rejected with "Discount cannot exceed 40%".',
    )
  })

  it('skips a rule that is already inactive', () => {
    expect(
      run(VR_DEACTIVATE, VR, 'Case.Legacy_Check', sample('Legacy_Check.validationRule-meta.xml')),
    ).toEqual([])
  })

  it('ignores other metadata types', () => {
    expect(run(VR_DEACTIVATE, 'CustomField', 'Opportunity.Discount_Max', discountMax)).toEqual([])
  })

  it('has a stable id', () => {
    expect(run(VR_DEACTIVATE, VR, 'Opportunity.Discount_Max', discountMax)[0]!.id).toBe(
      'VR_DEACTIVATE:ValidationRule:Opportunity.Discount_Max:active',
    )
  })
})

describe('VR_NEGATE', () => {
  it('wraps the formula in NOT( … ) and keeps XML encoding', () => {
    const [m] = run(VR_NEGATE, VR, 'Opportunity.Discount_Max', discountMax)
    expectSane(m!)
    expect(changedLines(m!).added).toEqual([
      '<errorConditionFormula>NOT( Discount_Percent__c &gt; 0.40 )</errorConditionFormula>',
    ])
  })

  it('handles a multi-line formula as one change', () => {
    const xml = sample('Close_Date_Window.validationRule-meta.xml')
    const [m] = run(VR_NEGATE, VR, 'Opportunity.Close_Date_Window', xml)
    expectSane(m!)
    expect(m!.mutated).toContain('<errorConditionFormula>NOT( AND(')
    expect(m!.mutated).toContain('CloseDate &gt; TODAY()\n) )</errorConditionFormula>')
    expect(m!.stats).toEqual({added: 2, removed: 2})
    expect(m!.mutated).toContain('ISPICKVAL(StageName, &quot;Closed Won&quot;)')
  })

  it('skips an inactive rule (negating it would change nothing)', () => {
    expect(run(VR_NEGATE, VR, 'Case.Legacy_Check', sample('Legacy_Check.validationRule-meta.xml'))).toEqual(
      [],
    )
  })

  it('mentions the original condition in what a test should check', () => {
    const [m] = run(VR_NEGATE, VR, 'Opportunity.Discount_Max', discountMax)
    expect(m!.shouldCheck).toContain('Discount_Percent__c > 0.40')
  })
})
