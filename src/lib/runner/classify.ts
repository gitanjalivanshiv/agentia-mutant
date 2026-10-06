import {XMLParser} from 'fast-xml-parser'

import type {MutantResult, Outcome, Score, TestCaseResult, TestRunRecord} from './types.js'

const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false})

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** Parses a Robot Framework / CRT xUnit report into test cases (nested suites flattened). */
export function parseXunit(xml: string): TestCaseResult[] {
  const doc = parser.parse(xml) as Record<string, unknown>
  const out: TestCaseResult[] = []
  const visit = (suite: Record<string, unknown>) => {
    for (const tc of asArray(suite.testcase as Record<string, unknown> | Record<string, unknown>[])) {
      const failure = (tc.failure ?? tc.error) as Record<string, unknown> | string | undefined
      const skipped = tc.skipped !== undefined
      const message =
        failure === undefined
          ? undefined
          : typeof failure === 'string'
            ? failure
            : (failure.message as string | undefined)
      out.push({
        name: String(tc.name ?? ''),
        classname: String(tc.classname ?? ''),
        status: failure !== undefined ? 'failed' : skipped ? 'skipped' : 'passed',
        ...(message ? {message: message.trim()} : {}),
      })
    }
    for (const child of asArray(suite.testsuite as Record<string, unknown> | Record<string, unknown>[]))
      visit(child)
  }
  for (const root of asArray((doc.testsuites as Record<string, unknown>)?.testsuite ?? doc.testsuite)) {
    visit(root as Record<string, unknown>)
  }
  return out
}

export const testKey = (t: TestCaseResult) => `${t.classname} :: ${t.name}`

export interface BaselineVerdict {
  ok: boolean
  passing: string[]
  flaky: string[]
  failing: string[]
  reason?: string
}

/**
 * The baseline must be green: you can't measure kills against red tests. With two baseline runs,
 * a test whose result differs between them is flaky and excluded from classification.
 */
export function judgeBaseline(runs: TestRunRecord[]): BaselineVerdict {
  const broken = runs.find((r) => r.error || r.tests.length === 0)
  if (broken) {
    return {
      ok: false,
      passing: [],
      flaky: [],
      failing: [],
      reason: broken.error ?? 'The baseline run produced no test results.',
    }
  }
  const status = new Map<string, Set<string>>()
  for (const r of runs) {
    for (const t of r.tests) {
      const s = status.get(testKey(t)) ?? new Set<string>()
      s.add(t.status)
      status.set(testKey(t), s)
    }
  }
  const flaky = [...status].filter(([, s]) => s.has('passed') && s.has('failed')).map(([k]) => k)
  const failing = [...status].filter(([, s]) => s.has('failed') && !s.has('passed')).map(([k]) => k)
  const passing = [...status].filter(([, s]) => s.size === 1 && s.has('passed')).map(([k]) => k)
  if (failing.length) {
    return {ok: false, passing, flaky, failing, reason: `Baseline is red: ${failing.join('; ')}`}
  }
  if (passing.length === 0) {
    return {ok: false, passing, flaky, failing, reason: 'No test passes reliably at baseline.'}
  }
  return {ok: true, passing, flaky, failing}
}

export interface Classification {
  outcome: Outcome
  killedBy?: {name: string; message?: string}[]
  reason?: string
}

/** Classifies one mutant from its deploy and test results against the baseline's passing tests. */
export function classify(input: {
  deploy: {ok: boolean; started?: boolean; message?: string; timedOut?: boolean}
  test?: TestRunRecord
  passingAtBaseline: string[]
  overBudget?: boolean
}): Classification {
  if (input.deploy.timedOut || input.overBudget) {
    return {
      outcome: 'timeout',
      reason: input.deploy.timedOut ? 'Deploy did not finish in time.' : 'Over the per-mutant time budget.',
    }
  }
  if (!input.deploy.ok && input.deploy.started === false) {
    return {
      outcome: 'error',
      reason: `Could not start the deploy: ${input.deploy.message ?? 'unknown error'}`,
    }
  }
  if (!input.deploy.ok) return {outcome: 'invalid', reason: input.deploy.message ?? 'Deploy failed.'}
  const test = input.test
  if (!test || test.error || test.tests.length === 0) {
    return {outcome: 'error', reason: test?.error ?? 'The test run produced no results.'}
  }
  const watched = new Set(input.passingAtBaseline)
  const failed = test.tests.filter((t) => t.status === 'failed' && watched.has(testKey(t)))
  if (failed.length) {
    return {
      outcome: 'killed',
      killedBy: failed.map((t) => ({name: t.name, ...(t.message ? {message: t.message} : {})})),
    }
  }
  const ran = test.tests.filter((t) => watched.has(testKey(t)))
  if (ran.length === 0) return {outcome: 'error', reason: 'None of the baseline tests ran.'}
  return {outcome: 'survived'}
}

export function computeScore(mutants: Pick<MutantResult, 'outcome'>[]): Score {
  const count = (o: Outcome) => mutants.filter((m) => m.outcome === o).length
  const killed = count('killed')
  const survived = count('survived')
  return {
    killed,
    survived,
    invalid: count('invalid'),
    timeout: count('timeout'),
    error: count('error'),
    ...(killed + survived > 0 ? {score: killed / (killed + survived)} : {}),
  }
}
