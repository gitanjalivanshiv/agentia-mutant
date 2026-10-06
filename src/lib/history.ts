import fs from 'node:fs'
import path from 'node:path'

import {CONFIG_DIR} from './config.js'
import type {CycleTimings} from './estimate.js'

/**
 * What the planner learns from earlier runs in `.mutant/runs/<id>/results.json`:
 * which operators tend to survive (the most useful mutants to run) and real cycle times.
 * Tolerant by design: unreadable or partial results are ignored.
 */
export interface RunResultSummary {
  mutants?: {
    operator?: string
    outcome?: string
    durations?: {deploySeconds?: number; testSeconds?: number}
  }[]
}

export interface History {
  runs: number
  /** operator → survived / (killed + survived), only for operators with scored outcomes. */
  survivalRate: Record<string, number>
  /** Averages of measured durations, when present. */
  timings: Partial<CycleTimings>
}

export function runsDir(root: string): string {
  return path.join(root, CONFIG_DIR, 'runs')
}

export function loadHistory(root: string): History {
  const dir = runsDir(root)
  const history: History = {runs: 0, survivalRate: {}, timings: {}}
  if (!fs.existsSync(dir)) return history
  const counts: Record<string, {killed: number; survived: number}> = {}
  const deploys: number[] = []
  const tests: number[] = []
  for (const run of fs.readdirSync(dir)) {
    const file = path.join(dir, run, 'results.json')
    if (!fs.existsSync(file)) continue
    let data: RunResultSummary
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8')) as RunResultSummary
    } catch {
      continue
    }
    history.runs += 1
    for (const m of data.mutants ?? []) {
      if (m.operator && (m.outcome === 'killed' || m.outcome === 'survived')) {
        const c = (counts[m.operator] ??= {killed: 0, survived: 0})
        c[m.outcome] += 1
      }
      if (typeof m.durations?.deploySeconds === 'number') deploys.push(m.durations.deploySeconds)
      if (typeof m.durations?.testSeconds === 'number') tests.push(m.durations.testSeconds)
    }
  }
  for (const [op, c] of Object.entries(counts))
    history.survivalRate[op] = c.survived / (c.killed + c.survived)
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  if (deploys.length) history.timings.promoteSeconds = Math.round(avg(deploys))
  if (tests.length) history.timings.testSeconds = Math.round(avg(tests))
  return history
}
