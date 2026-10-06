import {computeScore} from '../runner/classify.js'
import type {Comparison} from './html.js'
import type {RunResults} from './model.js'

export interface CompareResult {
  comparison: Comparison
  /** Run A's results with each mutant's outcome after run B (and healedBy for newly caught survivors). */
  after: RunResults
  /** Mutants of A that B did not re-run (their outcome carries over). */
  carriedOver: string[]
}

/**
 * Before/after for the demo finale. Run B usually re-runs only A's survivors (after healing), so a
 * mutant B didn't run keeps A's outcome: adding tests to a suite cannot un-catch a breakage.
 */
export function compareRuns(a: RunResults, b: RunResults): CompareResult {
  const inB = new Map(b.mutants.map((m) => [m.id, m]))
  const carriedOver: string[] = []
  const newlyCaught: Comparison['newlyCaught'] = []
  const mutants = a.mutants.map((m) => {
    const later = inB.get(m.id)
    if (!later || !later.outcome) {
      carriedOver.push(m.id)
      return m
    }
    if (m.outcome === 'survived' && later.outcome === 'killed') {
      const by = later.killedBy?.[0]?.name
      newlyCaught.push({id: m.id, description: m.description, ...(by ? {by} : {})})
      return {...m, healedBy: by ? [{name: by}] : [{name: 'a new test'}]}
    }
    return {...m, outcome: later.outcome, killedBy: later.killedBy, reason: later.reason}
  })
  const before = computeScore(a.mutants)
  const afterScore = computeScore(
    mutants.map((m) => ({outcome: m.healedBy ? ('killed' as const) : m.outcome})),
  )
  const pct = (s?: number) => (s === undefined ? undefined : Math.round(s * 100))
  return {
    comparison: {
      before: {runId: a.runId, percent: pct(before.score), killed: before.killed, survived: before.survived},
      after: {
        runId: b.runId,
        percent: pct(afterScore.score),
        killed: afterScore.killed,
        survived: afterScore.survived,
      },
      newlyCaught,
    },
    after: {...a, mutants},
    carriedOver,
  }
}
