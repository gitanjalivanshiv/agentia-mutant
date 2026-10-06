import fs from 'node:fs'
import path from 'node:path'

import {computeScore} from '../runner/classify.js'
import type {MutantResult, Outcome, Score} from '../runner/types.js'

/** What `results.json` holds (written by the runner; healing fields are added by `mutant heal`). */
export interface RunResults {
  version: 1
  runId: string
  phase: string
  createdAt: string
  finishedAt?: string
  lab: {environment: string; source: string; pipeline: string}
  score?: Score
  baseline?: {runs: {seconds: number; tests: unknown[]}[]; flaky: string[]; passing: string[]}
  verify?: {ok: boolean; drifted: string[]; checkedAt: string}
  failure?: string
  mutants: (MutantResult & {healedBy?: {name: string}[]})[]
}

export interface GroupScore extends Score {
  group: string
  total: number
}

export interface ReportModel {
  runId: string
  lab: RunResults['lab']
  phase: string
  createdAt: string
  finishedAt?: string
  durationSeconds?: number
  score: Score
  /** Score as a whole percentage, or undefined when nothing was scored. */
  percent?: number
  baselineTests: number
  flakyTests: string[]
  verified?: boolean
  failure?: string
  byType: GroupScore[]
  byComponent: GroupScore[]
  survivors: ReportModel['mutants']
  killed: ReportModel['mutants']
  /** invalid, timeout, error, and unscored mutants. */
  other: ReportModel['mutants']
  mutants: RunResults['mutants']
}

const TYPE_LABEL: Record<string, string> = {
  ValidationRule: 'Validation Rule',
  Flow: 'Flow',
  CustomField: 'Field',
  PermissionSet: 'Permission Set',
  Layout: 'Page Layout',
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type
}

function group(mutants: RunResults['mutants'], keyOf: (m: MutantResult) => string): GroupScore[] {
  const groups = new Map<string, RunResults['mutants']>()
  for (const m of mutants) groups.set(keyOf(m), [...(groups.get(keyOf(m)) ?? []), m])
  return [...groups]
    .map(([g, ms]) => ({group: g, total: ms.length, ...computeScore(ms)}))
    .sort((a, b) => (a.score ?? 2) - (b.score ?? 2) || a.group.localeCompare(b.group))
}

export function buildReportModel(results: RunResults): ReportModel {
  const score = computeScore(results.mutants)
  const is = (o: Outcome) => (m: MutantResult) => m.outcome === o
  const started = Date.parse(results.createdAt)
  const finished = results.finishedAt ? Date.parse(results.finishedAt) : undefined
  return {
    runId: results.runId,
    lab: results.lab,
    phase: results.phase,
    createdAt: results.createdAt,
    finishedAt: results.finishedAt,
    durationSeconds: finished ? Math.round((finished - started) / 1000) : undefined,
    score,
    percent: score.score === undefined ? undefined : Math.round(score.score * 100),
    baselineTests: results.baseline?.passing.length ?? 0,
    flakyTests: results.baseline?.flaky ?? [],
    verified: results.verify?.ok,
    failure: results.failure,
    byType: group(results.mutants, (m) => typeLabel(m.component.type)),
    byComponent: group(results.mutants, (m) => `${typeLabel(m.component.type)} · ${m.component.apiName}`),
    survivors: results.mutants.filter(is('survived')),
    killed: results.mutants.filter(is('killed')),
    other: results.mutants.filter((m) => m.outcome !== 'killed' && m.outcome !== 'survived'),
    mutants: results.mutants,
  }
}

export function loadResults(runDir: string): RunResults {
  const file = path.join(runDir, 'results.json')
  if (!fs.existsSync(file)) throw new Error(`No results.json in ${runDir}. Has the run finished?`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RunResults
}
