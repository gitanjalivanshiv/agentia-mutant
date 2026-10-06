import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {Copado, OrgRef} from './agentia/index.js'
import {type Component, driftSummary, matchesBaseline} from './metadata.js'

export interface DriftResult {
  checked: number
  /** `Type apiName (changed elements)` for components that differ from the baseline. */
  drifted: string[]
  /** Components that could not be read from the org. */
  unreadable: string[]
}

/**
 * Compares each baseline component with its copy in the org, fetched through Copado
 * (`cicd metadata content get --source ENVIRONMENT`). Shared by doctor, the runner's verify step
 * and reset. `outDir` keeps the fetched copies (default: a temporary directory that is removed).
 */
export async function checkDrift(
  copado: Copado,
  org: OrgRef,
  packageDir: string,
  components: Component[],
  outDir?: string,
): Promise<DriftResult> {
  const dir = outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-drift-'))
  fs.mkdirSync(dir, {recursive: true})
  const result: DriftResult = {checked: components.length, drifted: [], unreadable: []}
  try {
    for (const c of components) {
      const out = path.join(dir, `${c.type}-${c.apiName}.xml`.replace(/[^\w.-]+/g, '_'))
      try {
        await copado.metadataContentGet(org, c.type, c.apiName, out)
        const baseline = fs.readFileSync(path.join(packageDir, c.file), 'utf8')
        const actual = fs.readFileSync(out, 'utf8')
        if (!matchesBaseline(baseline, actual)) {
          result.drifted.push(`${c.type} ${c.apiName} (${driftSummary(baseline, actual).join(', ')})`)
        }
      } catch (error) {
        result.unreadable.push(`${c.type} ${c.apiName}: ${(error as Error).message}`)
      }
    }
  } finally {
    if (!outDir) fs.rmSync(dir, {recursive: true, force: true})
  }
  return result
}
