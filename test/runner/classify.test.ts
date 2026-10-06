import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {classify, computeScore, judgeBaseline, parseXunit, testKey} from '../../src/lib/runner/classify.js'
import type {TestCaseResult, TestRunRecord} from '../../src/lib/runner/types.js'

const xunit = (f: string) => fs.readFileSync(path.resolve(__dirname, '../samples/xunit', f), 'utf8')
const TEST = 'Discount Approval Suite.Discount Happy Path :: Create opportunity with a small discount'

const run = (tests: TestCaseResult[], extra: Partial<TestRunRecord> = {}): TestRunRecord => ({
  seconds: 50,
  tests,
  artifacts: {},
  ...extra,
})
const t = (name: string, status: TestCaseResult['status'], message?: string): TestCaseResult => ({
  name,
  classname: 'Suite',
  status,
  ...(message ? {message} : {}),
})

describe('parseXunit (real CRT reports)', () => {
  it('reads a green run', () => {
    const tests = parseXunit(xunit('green.xml'))
    expect(tests).toEqual([
      {
        classname: 'Discount Approval Suite.Discount Happy Path',
        name: 'Create opportunity with a small discount',
        status: 'passed',
      },
    ])
    expect(testKey(tests[0]!)).toBe(TEST)
  })

  it('reads a failure and its message', () => {
    const [test] = parseXunit(xunit('discount-field-missing.xml'))
    expect(test!.status).toBe('failed')
    expect(test!.message).toBe(
      'QWebElementNotFoundError: Unable to find element for locator Discount Percent in 20.0 sec',
    )
  })

  it('handles <testsuites>, skipped and error elements', () => {
    const xml = `<testsuites><testsuite name="S"><testcase classname="S" name="a"/><testcase classname="S" name="b"><skipped/></testcase><testcase classname="S" name="c"><error message="boom"/></testcase></testsuite></testsuites>`
    expect(parseXunit(xml).map((x) => [x.name, x.status, x.message])).toEqual([
      ['a', 'passed', undefined],
      ['b', 'skipped', undefined],
      ['c', 'failed', 'boom'],
    ])
  })
})

describe('judgeBaseline', () => {
  it('accepts a green baseline', () => {
    expect(judgeBaseline([run([t('a', 'passed'), t('b', 'passed')])])).toMatchObject({
      ok: true,
      passing: ['Suite :: a', 'Suite :: b'],
    })
  })

  it('rejects a red baseline', () => {
    const v = judgeBaseline([run([t('a', 'passed'), t('b', 'failed', 'x')])])
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/Baseline is red: Suite :: b/)
  })

  it('rejects a broken or empty baseline run', () => {
    expect(judgeBaseline([run([], {error: 'CRT request failed (404).'})]).reason).toBe(
      'CRT request failed (404).',
    )
    expect(judgeBaseline([run([])]).ok).toBe(false)
  })

  it('excludes tests that differ between two baseline runs as flaky', () => {
    const v = judgeBaseline([
      run([t('a', 'passed'), t('b', 'passed')]),
      run([t('a', 'passed'), t('b', 'failed')]),
    ])
    expect(v).toMatchObject({ok: true, flaky: ['Suite :: b'], passing: ['Suite :: a']})
  })

  it('rejects a baseline where nothing passes reliably', () => {
    const v = judgeBaseline([run([t('a', 'passed')]), run([t('a', 'failed')])])
    expect(v.ok).toBe(false)
  })
})

describe('classify', () => {
  const passing = ['Suite :: a', 'Suite :: b']
  const ok = {ok: true}

  it('killed: a baseline-passing test fails, naming the killer', () => {
    expect(
      classify({
        deploy: ok,
        passingAtBaseline: passing,
        test: run([t('a', 'passed'), t('b', 'failed', 'Discount cannot exceed 40%')]),
      }),
    ).toEqual({
      outcome: 'killed',
      killedBy: [{name: 'b', message: 'Discount cannot exceed 40%'}],
    })
  })

  it('survived: everything that passed at baseline still passes', () => {
    expect(
      classify({deploy: ok, passingAtBaseline: passing, test: run([t('a', 'passed'), t('b', 'passed')])})
        .outcome,
    ).toBe('survived')
  })

  it('ignores flaky tests (not in the baseline passing set)', () => {
    expect(
      classify({
        deploy: ok,
        passingAtBaseline: ['Suite :: a'],
        test: run([t('a', 'passed'), t('b', 'failed')]),
      }).outcome,
    ).toBe('survived')
  })

  it('invalid: the mutant did not deploy', () => {
    expect(
      classify({deploy: {ok: false, message: 'Field does not exist'}, passingAtBaseline: passing}),
    ).toEqual({
      outcome: 'invalid',
      reason: 'Field does not exist',
    })
  })

  it('timeout: deploy timed out or the budget was exceeded', () => {
    expect(classify({deploy: {ok: false, timedOut: true}, passingAtBaseline: passing}).outcome).toBe(
      'timeout',
    )
    expect(
      classify({deploy: ok, overBudget: true, passingAtBaseline: passing, test: run([t('a', 'passed')])})
        .outcome,
    ).toBe('timeout')
  })

  it('error: the test run broke or ran none of the baseline tests', () => {
    expect(classify({deploy: ok, passingAtBaseline: passing, test: run([], {error: 'CRT 404'})})).toEqual({
      outcome: 'error',
      reason: 'CRT 404',
    })
    expect(
      classify({deploy: ok, passingAtBaseline: passing, test: run([t('other', 'passed')])}).outcome,
    ).toBe('error')
  })
})

describe('computeScore', () => {
  it('scores killed / (killed + survived), ignoring invalid, timeout and error', () => {
    const s = computeScore(
      ['killed', 'killed', 'survived', 'invalid', 'timeout', 'error', undefined].map((outcome) => ({
        outcome,
      })) as {outcome?: never}[],
    )
    expect(s).toEqual({killed: 2, survived: 1, invalid: 1, timeout: 1, error: 1, score: 2 / 3})
  })

  it('has no score when nothing was scored', () => {
    expect(computeScore([{outcome: 'invalid'}]).score).toBeUndefined()
  })
})
