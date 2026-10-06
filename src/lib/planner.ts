import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {Operator} from '../operators/index.js'
import {type Estimate, estimateRun, MEASURED_TIMINGS} from './estimate.js'
import type {History} from './history.js'
import {type Component, listComponents} from './metadata.js'
import {generateMutants, type Mutant} from './mutants.js'

export type Scope =
  | {kind: 'all'}
  | {kind: 'components'; components: string[]}
  /** Components changed in a Copado user story (resolved from its feature branch diff). */
  | {kind: 'story'; story: string; components: string[]}

export interface PlannedMutant {
  id: string
  operator: string
  component: {type: string; apiName: string}
  file: string
  description: string
  shouldCheck: string
  diff: string
  /** sha256 of the mutated file, so `run` can confirm it regenerates the same mutant. */
  mutatedSha256: string
  priority: {score: number; reasons: string[]}
}

export interface Plan {
  version: 1
  createdAt: string
  scope: Scope
  lab: {environment: string; source: string; pipeline: string}
  packageDirectory: string
  /** sha256 over the baseline files; `run` refuses a plan made from different metadata. */
  baselineSha256: string
  candidates: number
  mutants: PlannedMutant[]
  notSelected: {id: string; reason: string}[]
  estimate: Estimate
}

export interface PlanInput {
  packageDir: string
  scope: Scope
  max: number
  operators: readonly Operator[]
  lab: Plan['lab']
  history?: History
  /** Explicit mutant IDs, in this order (overrides scoring and --max). */
  mutantIds?: string[]
  /** Component key (`Type:apiName`) → last change, epoch seconds. Missing = unknown. */
  lastChanged?: Record<string, number>
  now?: Date
}

const key = (c: {type: string; apiName: string}) => `${c.type}:${c.apiName}`
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function baselineHash(
  packageDir: string,
  components: Component[] = listComponents(packageDir),
): string {
  const h = createHash('sha256')
  for (const c of components) {
    h.update(c.file)
      .update('\0')
      .update(fs.readFileSync(path.join(packageDir, c.file)))
      .update('\0')
  }
  return h.digest('hex')
}

function inScope(c: Component, scope: Scope): boolean {
  if (scope.kind === 'all') return true
  return scope.components.some((f) => f === c.apiName || f === key(c))
}

/**
 * Priority (brief §6): components changed recently, then operators with the highest historical
 * survival, then variety across metadata types. Scores are 0..1 and only order candidates;
 * variety is enforced by round-robin selection.
 */
function score(
  m: Mutant,
  input: PlanInput,
  newest: number,
  oldest: number,
): {score: number; reasons: string[]} {
  const reasons: string[] = []
  let recency = 0.5
  const changed = input.lastChanged?.[key(m.component)]
  if (input.scope.kind === 'story') {
    recency = 1
    reasons.push(`changed in ${input.scope.story}`)
  } else if (changed !== undefined && newest > oldest) {
    recency = (changed - oldest) / (newest - oldest)
    if (recency >= 0.999) reasons.push('most recently changed')
  }
  const survival = input.history?.survivalRate[m.operator]
  if (survival !== undefined) reasons.push(`survived ${Math.round(survival * 100)}% of past runs`)
  const s = 0.6 * recency + 0.4 * (survival ?? 0.5)
  return {score: Math.round(s * 1000) / 1000, reasons}
}

/**
 * Greedy round-robin over metadata types: each round takes the best remaining mutant from every
 * type (types ordered by their best score), preferring operators not used yet. Deterministic.
 */
export function selectMutants(scored: {m: Mutant; score: number}[], max: number): Mutant[] {
  const byType = new Map<string, {m: Mutant; score: number}[]>()
  for (const s of scored) {
    const list = byType.get(s.m.component.type) ?? []
    list.push(s)
    byType.set(s.m.component.type, list)
  }
  for (const list of byType.values()) list.sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id))
  const types = [...byType.keys()].sort(
    (a, b) => byType.get(b)![0]!.score - byType.get(a)![0]!.score || a.localeCompare(b),
  )
  const picked: Mutant[] = []
  const usedOperators = new Set<string>()
  const usedComponents = new Set<string>()
  while (picked.length < max && types.some((t) => byType.get(t)!.length)) {
    for (const t of types) {
      if (picked.length >= max) break
      const list = byType.get(t)!
      if (!list.length) continue
      // Prefer a new operator, then a new component, then the best score.
      const idx = Math.max(
        0,
        list.findIndex((s) => !usedOperators.has(s.m.operator)),
      )
      const fresh = list.findIndex(
        (s) => !usedOperators.has(s.m.operator) && !usedComponents.has(key(s.m.component)),
      )
      const choice = list.splice(fresh >= 0 ? fresh : idx, 1)[0]!
      picked.push(choice.m)
      usedOperators.add(choice.m.operator)
      usedComponents.add(key(choice.m.component))
    }
  }
  return picked
}

export function buildPlan(input: PlanInput): Plan {
  const components = listComponents(input.packageDir)
  const candidates = generateMutants(input.packageDir, {operators: input.operators}).filter((m) =>
    inScope(m.component, input.scope),
  )
  const times = Object.values(input.lastChanged ?? {})
  const newest = times.length ? Math.max(...times) : 0
  const oldest = times.length ? Math.min(...times) : 0
  const scored = candidates.map((m) => ({m, ...score(m, input, newest, oldest)}))
  const reasonsById = new Map(scored.map((s) => [s.m.id, {score: s.score, reasons: s.reasons}]))
  let selected: Mutant[]
  if (input.mutantIds?.length) {
    const byId = new Map(candidates.map((m) => [m.id, m]))
    const unknown = input.mutantIds.filter((id) => !byId.has(id))
    if (unknown.length) throw new Error(`Unknown mutant ID(s) in this scope: ${unknown.join(', ')}`)
    selected = input.mutantIds.map((id) => byId.get(id)!)
  } else selected = selectMutants(scored, input.max)
  const selectedIds = new Set(selected.map((m) => m.id))
  const touched = new Set(selected.map((m) => key(m.component)))
  const timings = {...MEASURED_TIMINGS, ...input.history?.timings}
  return {
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    scope: input.scope,
    lab: input.lab,
    packageDirectory: input.packageDir,
    baselineSha256: baselineHash(input.packageDir, components),
    candidates: candidates.length,
    mutants: selected.map((m) => ({
      id: m.id,
      operator: m.operator,
      component: {type: m.component.type, apiName: m.component.apiName},
      file: m.file,
      description: m.description,
      shouldCheck: m.shouldCheck,
      diff: m.diff,
      mutatedSha256: sha256(m.mutated),
      priority: reasonsById.get(m.id)!,
    })),
    notSelected: candidates
      .filter((m) => !selectedIds.has(m.id))
      .map((m) => ({
        id: m.id,
        reason: input.mutantIds?.length ? 'not in --mutants' : `over budget (--max ${input.max})`,
      })),
    estimate: estimateRun(selected.length, touched.size, timings),
  }
}
