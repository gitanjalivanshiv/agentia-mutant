import {describe, expect, it} from 'vitest'

import {LAYOUT_FIELD_REMOVE} from '../../src/operators/layout.js'
import {PERMSET_FLS_REVOKE, PERMSET_OBJ_REVOKE} from '../../src/operators/permission-set.js'
import {changedLines, demo, expectSane, run, sample} from './helpers.js'

const sales = demo('permissionsets/Sales_Discounts.permissionset-meta.xml')
const readOnly = sample('Read_Only.permissionset-meta.xml')
const oppLayout = demo('layouts/Opportunity-Opportunity Layout.layout-meta.xml')
const caseLayout = sample('Case-Case_Layout.layout-meta.xml')
const PS = 'PermissionSet'

describe('PERMSET_FLS_REVOKE', () => {
  it('offers edit and read revocations for the demo permission set', () => {
    const ms = run(PERMSET_FLS_REVOKE, PS, 'Sales_Discounts', sales)
    expect(ms.map((m) => m.siteKey)).toEqual([
      'Opportunity.Approval_Required__c:read',
      'Opportunity.Discount_Percent__c:edit',
      'Opportunity.Discount_Percent__c:read',
    ])
    ms.forEach(expectSane)
  })

  it('revokes edit with a one-line diff', () => {
    const edit = run(PERMSET_FLS_REVOKE, PS, 'Sales_Discounts', sales).find((m) =>
      m.siteKey.endsWith('Discount_Percent__c:edit'),
    )!
    expect(changedLines(edit)).toEqual({
      removed: ['<editable>true</editable>'],
      added: ['<editable>false</editable>'],
    })
    expect(edit.description).toBe(
      'Permission set "Sales Discounts" can no longer edit Opportunity.Discount_Percent__c',
    )
  })

  it('revoking read also revokes edit, so the result is a valid permission combination', () => {
    const read = run(PERMSET_FLS_REVOKE, PS, 'Sales_Discounts', sales).find((m) =>
      m.siteKey.endsWith('Discount_Percent__c:read'),
    )!
    expect(changedLines(read).added.sort()).toEqual([
      '<editable>false</editable>',
      '<readable>false</readable>',
    ])
  })

  it('skips permissions that are already off', () => {
    expect(run(PERMSET_FLS_REVOKE, PS, 'Read_Only', readOnly)).toEqual([])
  })
})

describe('PERMSET_OBJ_REVOKE', () => {
  it('revokes create and edit on Opportunity separately', () => {
    const ms = run(PERMSET_OBJ_REVOKE, PS, 'Sales_Discounts', sales)
    expect(ms.map((m) => [m.siteKey, changedLines(m).added[0]])).toEqual([
      ['Opportunity:create', '<allowCreate>false</allowCreate>'],
      ['Opportunity:edit', '<allowEdit>false</allowEdit>'],
    ])
    ms.forEach(expectSane)
  })

  it('never revokes read or touches delete/modify-all', () => {
    for (const m of run(PERMSET_OBJ_REVOKE, PS, 'Sales_Discounts', sales)) {
      expect(m.mutated).toContain('<allowRead>true</allowRead>')
      expect(m.mutated).toContain('<allowDelete>false</allowDelete>')
    }
  })

  it('skips a read-only permission set', () => {
    expect(run(PERMSET_OBJ_REVOKE, PS, 'Read_Only', readOnly)).toEqual([])
  })
})

describe('LAYOUT_FIELD_REMOVE', () => {
  it('offers removing each custom field from the demo layout', () => {
    const ms = run(LAYOUT_FIELD_REMOVE, 'Layout', 'Opportunity-Opportunity Layout', oppLayout)
    expect(ms.map((m) => m.siteKey)).toEqual(['Discount_Percent__c', 'Approval_Required__c'])
    ms.forEach(expectSane)
  })

  it('removes exactly the layout item block', () => {
    const [m] = run(LAYOUT_FIELD_REMOVE, 'Layout', 'Opportunity-Opportunity Layout', oppLayout)
    expect(changedLines(m!)).toEqual({
      removed: [
        '<layoutItems>',
        '<behavior>Edit</behavior>',
        '<field>Discount_Percent__c</field>',
        '</layoutItems>',
      ],
      added: [],
    })
    expect(m!.shouldCheck).toBe(
      'Discount_Percent__c is visible and editable on the record page for users of "Opportunity-Opportunity Layout".',
    )
  })

  it('leaves standard fields, Required items and blank spaces alone', () => {
    const ms = run(LAYOUT_FIELD_REMOVE, 'Layout', 'Case-Case_Layout', caseLayout)
    expect(ms.map((m) => m.siteKey)).toEqual(['Notes__c', 'Escalated__c'])
  })

  it('never removes standard fields from the real Opportunity layout', () => {
    for (const m of run(LAYOUT_FIELD_REMOVE, 'Layout', 'Opportunity-Opportunity Layout', oppLayout)) {
      for (const std of ['Name', 'AccountId', 'CloseDate', 'StageName', 'Amount']) {
        expect(m.mutated).toContain(`<field>${std}</field>`)
      }
    }
  })
})
