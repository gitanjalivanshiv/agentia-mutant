import {describe, expect, it} from 'vitest'

import {
  CHECKBOX_DEFAULT_FLIP,
  FIELD_REQUIRED_OFF,
  PICKLIST_DEFAULT,
} from '../../src/operators/custom-field.js'
import {changedLines, demo, expectSane, run, sample} from './helpers.js'

const region = sample('Region__c.field-meta.xml')
const notes = sample('Notes__c.field-meta.xml')
const approval = demo('objects/Opportunity/fields/Approval_Required__c.field-meta.xml')
const discount = demo('objects/Opportunity/fields/Discount_Percent__c.field-meta.xml')
const CF = 'CustomField'

describe('FIELD_REQUIRED_OFF', () => {
  it('makes a required field optional', () => {
    const [m] = run(FIELD_REQUIRED_OFF, CF, 'Case.Region__c', region)
    expectSane(m!)
    expect(changedLines(m!)).toEqual({
      removed: ['<required>true</required>'],
      added: ['<required>false</required>'],
    })
    expect(m!.description).toBe('Field "Region" (Case.Region__c) is no longer required')
  })

  it('skips fields that are not required (the demo field)', () => {
    expect(run(FIELD_REQUIRED_OFF, CF, 'Opportunity.Discount_Percent__c', discount)).toEqual([])
    expect(run(FIELD_REQUIRED_OFF, CF, 'Case.Notes__c', notes)).toEqual([])
  })

  it('skips fields without a required element', () => {
    expect(run(FIELD_REQUIRED_OFF, CF, 'Opportunity.Approval_Required__c', approval)).toEqual([])
  })
})

describe('PICKLIST_DEFAULT', () => {
  it('offers removing the default and moving it to the next value', () => {
    const ms = run(PICKLIST_DEFAULT, CF, 'Case.Region__c', region)
    expect(ms.map((m) => m.siteKey)).toEqual(['remove', 'move'])
    ms.forEach(expectSane)
  })

  it('removes the default with a one-line diff', () => {
    const [remove] = run(PICKLIST_DEFAULT, CF, 'Case.Region__c', region)
    expect(remove!.stats).toEqual({added: 1, removed: 1})
    expect(remove!.mutated).not.toContain('<default>true</default>')
  })

  it('moves the default from EMEA to AMER', () => {
    const [, move] = run(PICKLIST_DEFAULT, CF, 'Case.Region__c', region)
    expect(move!.description).toBe(
      'Picklist "Region" (Case.Region__c) now defaults to "AMER" instead of "EMEA"',
    )
    const amer = move!.mutated.slice(move!.mutated.indexOf('<fullName>AMER'))
    expect(amer).toMatch(/^<fullName>AMER<\/fullName>\s*<default>true<\/default>/)
    expect(move!.mutated.match(/<default>true<\/default>/g)).toHaveLength(1)
  })

  it('skips picklists without a default and non-picklist fields', () => {
    expect(
      run(
        PICKLIST_DEFAULT,
        CF,
        'Case.Region__c',
        region.replace('<default>true</default>', '<default>false</default>'),
      ),
    ).toEqual([])
    expect(run(PICKLIST_DEFAULT, CF, 'Case.Notes__c', notes)).toEqual([])
  })
})

describe('CHECKBOX_DEFAULT_FLIP', () => {
  it('flips the demo checkbox default from false to true', () => {
    const [m] = run(CHECKBOX_DEFAULT_FLIP, CF, 'Opportunity.Approval_Required__c', approval)
    expectSane(m!)
    expect(changedLines(m!).added).toEqual(['<defaultValue>true</defaultValue>'])
    expect(m!.shouldCheck).toBe('A new Opportunity starts with "Approval Required" unchecked.')
  })

  it('flips true to false', () => {
    const [m] = run(
      CHECKBOX_DEFAULT_FLIP,
      CF,
      'Opportunity.Approval_Required__c',
      approval.replace('<defaultValue>false', '<defaultValue>true'),
    )
    expect(changedLines(m!).added).toEqual(['<defaultValue>false</defaultValue>'])
  })

  it('skips non-checkbox fields', () => {
    expect(run(CHECKBOX_DEFAULT_FLIP, CF, 'Opportunity.Discount_Percent__c', discount)).toEqual([])
  })
})
