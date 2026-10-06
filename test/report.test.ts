import fs from 'node:fs'
import path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {describe, expect, it} from 'vitest'

import {renderHtml} from '../src/lib/report/html.js'
import {buildReportModel, type RunResults} from '../src/lib/report/model.js'
import {renderMarkdown, renderTerminal} from '../src/lib/report/text.js'

// Synthetic, mixed outcomes built from the demo app's real mutants (not a real run).
const results = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/results-mixed.json'), 'utf8'),
) as RunResults
const model = buildReportModel(results)

describe('buildReportModel', () => {
  it('scores killed / (killed + survived)', () => {
    expect(model.score).toEqual({killed: 3, survived: 4, invalid: 1, timeout: 0, error: 0, score: 3 / 7})
    expect(model.percent).toBe(43)
    expect(model.durationSeconds).toBe(41 * 60)
  })

  it('groups by metadata type, weakest first', () => {
    expect(model.byType.map((g) => [g.group, g.killed, g.survived, g.total])).toEqual([
      ['Field', 0, 1, 1],
      ['Flow', 0, 2, 3],
      ['Validation Rule', 1, 1, 2],
      ['Page Layout', 1, 0, 1],
      ['Permission Set', 1, 0, 1],
    ])
  })

  it('splits survivors, killed and not-scored mutants', () => {
    expect(model.survivors).toHaveLength(4)
    expect(model.killed).toHaveLength(3)
    expect(model.other.map((m) => m.outcome)).toEqual(['invalid'])
    expect(model.byComponent.map((g) => g.group)).toContain('Validation Rule · Opportunity.Discount_Max')
  })

  it('has no percentage when nothing was scored', () => {
    const m = buildReportModel({...results, mutants: results.mutants.filter((x) => x.outcome === 'invalid')})
    expect(m.percent).toBeUndefined()
  })
})

describe('renderHtml', () => {
  const html = renderHtml(model)

  it('is a self-contained page: no external scripts, styles, fonts or images', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/(src|href)=["']https?:/i)
    expect(html).not.toMatch(/@import|url\(/i)
  })

  it('shows the score, the counts and the verified lab', () => {
    expect(html).toContain('>43%<')
    expect(html).toContain('Your tests caught <strong>3 of 7</strong> configuration breakages.')
    expect(html).toContain('MutationLab was reverted and verified identical to the baseline')
  })

  it('renders a card per survivor with what a test should check and the diff', () => {
    expect(html.match(/class="card survivor/g)).toHaveLength(4)
    expect(html).toContain('<strong>A test should check:</strong>')
    expect(html).toMatch(/<span class="add">\+\s+&lt;operator&gt;LessThanOrEqualTo&lt;\/operator&gt;<\/span>/)
    expect(html).toMatch(/<span class="del">-\s+&lt;operator&gt;GreaterThan&lt;\/operator&gt;<\/span>/)
  })

  it('marks healed survivors', () => {
    expect(html).toContain('✔ now caught by “Reject discounts above 40 percent”')
    expect(html.match(/card survivor healed/g)).toHaveLength(1)
  })

  it('escapes content from metadata', () => {
    const evil = buildReportModel({
      ...results,
      mutants: [{...results.mutants[0]!, description: '<img src=x onerror=alert(1)>', outcome: 'survived'}],
    })
    expect(renderHtml(evil)).not.toContain('<img src=x')
  })

  it('renders a before/after comparison', () => {
    const cmp = renderHtml(model, {
      before: {runId: 'a', percent: 43, killed: 3, survived: 4},
      after: {runId: 'b', percent: 86, killed: 6, survived: 1},
      newlyCaught: [
        {id: 'x', description: 'Validation rule `Discount_Max` switched off', by: 'Reject discounts'},
      ],
    })
    expect(cmp).toContain('After healing')
    expect(cmp).toMatch(/cmp-pct good">86%/)
    expect(cmp).toContain('<code>Discount_Max</code>')
  })
})

describe('text renderers', () => {
  it('renders Markdown with a diff block per survivor', () => {
    const md = renderMarkdown(model)
    expect(md).toMatch(/^# Mutation test report: 43% of configuration breakages caught/)
    expect(md.match(/```diff/g)).toHaveLength(4)
    expect(md).toContain('| Flow | 0 | 2 | 1 | 0% |')
  })

  it('renders a terminal summary', () => {
    const text = stripVTControlCharacters(renderTerminal(model))
    expect(text).toContain('Mutation score 43%')
    expect(text).toContain('✔ 3 caught')
    expect(text).toContain('✘ 4 blind spot(s)')
  })
})
