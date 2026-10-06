import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {diffStats, unifiedDiff} from '../../src/lib/diff.js'
import {generateMutants} from '../../src/lib/mutants.js'
import {
  applyEdits,
  childText,
  isWellFormed,
  parseXmlTree,
  removeElement,
  rootElement,
  select,
} from '../../src/lib/xml.js'
import {OPERATORS, selectOperators} from '../../src/operators/index.js'

const demoDir = path.resolve(__dirname, '../../examples/demo/force-app')

describe('xml tree', () => {
  const xml =
    '<?xml version="1.0"?>\n<A xmlns="x">\n  <b>1</b>\n  <!-- <b>skip</b> -->\n  <c><b>2</b></c>\n  <e/>\n</A>\n'

  it('finds elements with offsets, ignoring comments and declarations', () => {
    const root = rootElement(parseXmlTree(xml))
    expect(root.name).toBe('A')
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c', 'e'])
    expect(childText(xml, root, 'b')).toBe('1')
    expect(select(root, ['c', 'b']).map((n) => xml.slice(n.innerStart, n.innerEnd))).toEqual(['2'])
  })

  it('rejects malformed XML', () => {
    expect(() => parseXmlTree('<A><b></A>')).toThrow(/Malformed/)
    expect(() => parseXmlTree('<A><b>')).toThrow(/never closed/)
  })

  it('removes an element with its own line', () => {
    const root = rootElement(parseXmlTree(xml))
    const out = applyEdits(xml, [removeElement(xml, root.children[0]!)])
    expect(out).toBe(
      '<?xml version="1.0"?>\n<A xmlns="x">\n  <!-- <b>skip</b> -->\n  <c><b>2</b></c>\n  <e/>\n</A>\n',
    )
    expect(isWellFormed(out)).toBe(true)
  })

  it('refuses overlapping edits', () => {
    expect(() =>
      applyEdits('abcdef', [
        {start: 0, end: 3, replacement: 'x'},
        {start: 2, end: 4, replacement: 'y'},
      ]),
    ).toThrow(/Overlapping/)
  })
})

describe('diff', () => {
  it('produces a unified diff with context and stats', () => {
    const before = 'a\nb\nc\nd\ne\n'
    const after = 'a\nb\nX\nd\ne\n'
    expect(unifiedDiff(before, after, 'f.xml', 1)).toBe(
      '--- a/f.xml\n+++ b/f.xml\n@@ -2,3 +2,3 @@\n b\n-c\n+X\n d\n',
    )
    expect(diffStats(before, after)).toEqual({added: 1, removed: 1})
    expect(unifiedDiff(before, before)).toBe('')
  })
})

describe('generateMutants on the demo app', () => {
  const all = generateMutants(demoDir)

  it('produces the expected mutant set', () => {
    expect(all.length).toBe(15)
    const byOperator = Object.fromEntries(
      OPERATORS.map((o) => [o.id, all.filter((m) => m.operator === o.id).length]),
    )
    expect(byOperator).toEqual({
      VR_DEACTIVATE: 1,
      VR_NEGATE: 1,
      FLOW_DECISION_FLIP: 1,
      FLOW_BOUNDARY: 2,
      FLOW_DROP_ASSIGNMENT: 2,
      FIELD_REQUIRED_OFF: 0,
      PICKLIST_DEFAULT: 0,
      CHECKBOX_DEFAULT_FLIP: 1,
      PERMSET_FLS_REVOKE: 3,
      PERMSET_OBJ_REVOKE: 2,
      LAYOUT_FIELD_REMOVE: 2,
    })
  })

  it('gives every mutant a unique id and a small diff', () => {
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length)
    for (const m of all) {
      expect(m.stats.added + m.stats.removed).toBeLessThanOrEqual(8)
      expect(m.diff).toContain(`--- a/${m.file}`)
    }
  })

  it('is deterministic', () => {
    expect(generateMutants(demoDir).map((m) => m.id)).toEqual(all.map((m) => m.id))
  })

  it('filters by component', () => {
    const ms = generateMutants(demoDir, {components: ['ValidationRule:Opportunity.Discount_Max']})
    expect(ms.map((m) => m.operator)).toEqual(['VR_DEACTIVATE', 'VR_NEGATE'])
    expect(
      generateMutants(demoDir, {components: ['Discount_Approval']}).every((m) => m.component.type === 'Flow'),
    ).toBe(true)
  })

  it('honours operator allow/deny lists and reports unknown ids', () => {
    const {operators, unknown} = selectOperators(['VR_DEACTIVATE', 'NOPE'], [])
    expect(operators.map((o) => o.id)).toEqual(['VR_DEACTIVATE'])
    expect(unknown).toEqual(['NOPE'])
    const denied = selectOperators([], ['PERMSET_FLS_REVOKE']).operators
    expect(
      generateMutants(demoDir, {operators: denied}).some((m) => m.operator === 'PERMSET_FLS_REVOKE'),
    ).toBe(false)
  })

  it('never edits the original files', () => {
    const again = generateMutants(demoDir)
    expect(again.every((m, i) => m.original === all[i]!.original)).toBe(true)
  })
})
