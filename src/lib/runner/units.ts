import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {OPERATORS} from '../../operators/index.js'
import {generateMutants, type Mutant} from '../mutants.js'
import {baselineHash, type Plan} from '../planner.js'
import type {DeployUnit, MutantResult} from './types.js'

export class StalePlanError extends Error {}

/**
 * Regenerates the plan's mutants from the current baseline and confirms they are byte-identical
 * to what was planned. Refuses plans made from different metadata or a different operator version.
 */
export function resolvePlanMutants(plan: Plan, packageDir: string): Mutant[] {
  if (baselineHash(packageDir) !== plan.baselineSha256) {
    throw new StalePlanError(
      'The baseline metadata changed since this plan was made. Run `agentia mutant plan` again.',
    )
  }
  const all = new Map(generateMutants(packageDir, {operators: OPERATORS}).map((m) => [m.id, m]))
  return plan.mutants.map((p) => {
    const m = all.get(p.id)
    if (!m) throw new StalePlanError(`Mutant ${p.id} no longer exists. Run \`agentia mutant plan\` again.`)
    const sha = createHash('sha256').update(m.mutated).digest('hex')
    if (sha !== p.mutatedSha256) {
      throw new StalePlanError(
        `Mutant ${p.id} would deploy different content than planned. Run \`agentia mutant plan\` again.`,
      )
    }
    return m
  })
}

const key = (m: Mutant) => `${m.component.type}:${m.component.apiName}`

function shortTitle(prefix: string, runId: string, label: string): string {
  return `${prefix} ${runId} ${label}`.slice(0, 255)
}

/**
 * Chained deploy units (decision 11), made self-healing: unit k writes the baseline of every
 * component touched by mutants 0..k-1, then mutant k on top. The final unit writes all baselines.
 */
export function buildUnits(
  mutants: Mutant[],
  packageDir: string,
  runId: string,
  prefix: string,
): DeployUnit[] {
  const baselineOf = (file: string) => fs.readFileSync(path.join(packageDir, file), 'utf8')
  const touched = new Map<string, string>() // file → component key
  const units: DeployUnit[] = []
  mutants.forEach((m, k) => {
    const files: Record<string, string> = {}
    const components = new Set<string>()
    for (const [file, comp] of touched) {
      files[file] = baselineOf(file)
      components.add(comp)
    }
    files[m.file] = m.mutated
    components.add(key(m))
    units.push({
      index: k,
      mutantId: m.id,
      files,
      components: [...components],
      title: shortTitle(prefix, runId, `#${k + 1}/${mutants.length} ${m.operator} ${m.component.apiName}`),
    })
    touched.set(m.file, key(m))
  })
  if (mutants.length) {
    const files: Record<string, string> = {}
    for (const [file] of touched) files[file] = baselineOf(file)
    units.push({
      index: mutants.length,
      files,
      components: [...new Set(touched.values())],
      title: shortTitle(prefix, runId, 'final revert to baseline'),
    })
  }
  return units
}

export function initialResults(mutants: Mutant[]): MutantResult[] {
  return mutants.map((m) => ({
    id: m.id,
    operator: m.operator,
    component: {type: m.component.type, apiName: m.component.apiName},
    file: m.file,
    description: m.description,
    shouldCheck: m.shouldCheck,
    diff: m.diff,
  }))
}
