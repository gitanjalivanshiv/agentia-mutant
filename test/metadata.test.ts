import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {componentForFile, driftSummary, listComponents, matchesBaseline} from '../src/lib/metadata.js'

const demo = path.resolve(__dirname, '../examples/demo/force-app')
const vrFile = path.join(
  demo,
  'main/default/objects/Opportunity/validationRules/Discount_Max.validationRule-meta.xml',
)
const vr = fs.readFileSync(vrFile, 'utf8')

describe('componentForFile', () => {
  it.each([
    [
      'main/default/objects/Opportunity/fields/Discount_Percent__c.field-meta.xml',
      'CustomField',
      'Opportunity.Discount_Percent__c',
    ],
    [
      'main/default/objects/Opportunity/validationRules/Discount_Max.validationRule-meta.xml',
      'ValidationRule',
      'Opportunity.Discount_Max',
    ],
    ['main/default/flows/Discount_Approval.flow-meta.xml', 'Flow', 'Discount_Approval'],
    [
      'main/default/permissionsets/Sales_Discounts.permissionset-meta.xml',
      'PermissionSet',
      'Sales_Discounts',
    ],
    [
      'main/default/layouts/Opportunity-Opportunity Layout.layout-meta.xml',
      'Layout',
      'Opportunity-Opportunity Layout',
    ],
  ])('%s → %s %s', (file, type, apiName) => {
    expect(componentForFile(file)).toMatchObject({type, apiName})
  })

  it('ignores unsupported files', () => {
    expect(componentForFile('main/default/staticresources/x.resource-meta.xml')).toBeUndefined()
  })
})

describe('listComponents', () => {
  it('finds every component of the demo app', () => {
    expect(listComponents(demo).map((c) => c.type)).toEqual([
      'Flow',
      'Layout',
      'CustomField',
      'CustomField',
      'ValidationRule',
      'PermissionSet',
    ])
  })
})

describe('matchesBaseline', () => {
  // What Copado returned from INT-SFP after the M1 revert: one line, fullName qualified.
  const fromOrg =
    '<?xml version="1.0" encoding="UTF-8"?><ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Opportunity.Discount_Max</fullName><active>true</active><description>Discounts above 40% are not allowed (Mutant demo app).</description><errorConditionFormula>Discount_Percent__c &gt; 0.40</errorConditionFormula><errorDisplayField>Discount_Percent__c</errorDisplayField><errorMessage>Discount cannot exceed 40%.</errorMessage></ValidationRule>'

  it('treats formatting and fullName differences as identical', () => {
    expect(matchesBaseline(vr, fromOrg)).toBe(true)
  })

  it('detects a deactivated rule', () => {
    const mutated = fromOrg.replace('<active>true</active>', '<active>false</active>')
    expect(matchesBaseline(vr, mutated)).toBe(false)
    expect(driftSummary(vr, mutated)).toEqual(['active'])
  })

  it('tolerates extra elements and reordered repeated elements in the org copy', () => {
    const base =
      '<PermissionSet><fieldPermissions><field>A</field><editable>true</editable></fieldPermissions><fieldPermissions><field>B</field><editable>false</editable></fieldPermissions></PermissionSet>'
    const org =
      '<PermissionSet><label>X</label><fieldPermissions><field>B</field><editable>false</editable></fieldPermissions><fieldPermissions><field>C</field></fieldPermissions><fieldPermissions><editable>true</editable><field>A</field></fieldPermissions></PermissionSet>'
    expect(matchesBaseline(base, org)).toBe(true)
  })

  it('accepts false booleans that the org omits (observed: externalId on INT-SFP)', () => {
    const base =
      '<CustomField><externalId>false</externalId><required>false</required><type>Percent</type></CustomField>'
    expect(matchesBaseline(base, '<CustomField><type>Percent</type></CustomField>')).toBe(true)
  })

  it('still detects a true flag that the org drops or flips', () => {
    const base = '<CustomField><required>true</required></CustomField>'
    expect(matchesBaseline(base, '<CustomField></CustomField>')).toBe(false)
    expect(matchesBaseline(base, '<CustomField><required>false</required></CustomField>')).toBe(false)
  })

  it('detects a revoked permission', () => {
    const base =
      '<PermissionSet><fieldPermissions><field>A</field><editable>true</editable></fieldPermissions></PermissionSet>'
    const org =
      '<PermissionSet><fieldPermissions><field>A</field><editable>false</editable></fieldPermissions></PermissionSet>'
    expect(matchesBaseline(base, org)).toBe(false)
  })

  it('detects a removed layout field', () => {
    const base =
      '<Layout><layoutItems><field>Name</field></layoutItems><layoutItems><field>Discount_Percent__c</field></layoutItems></Layout>'
    const org = '<Layout><layoutItems><field>Name</field></layoutItems></Layout>'
    expect(matchesBaseline(base, org)).toBe(false)
  })
})
