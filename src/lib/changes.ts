import path from 'node:path'

import type {Copado} from './agentia/index.js'
import {git, isGitRepo} from './git.js'
import {componentForFile, listComponents} from './metadata.js'

/** Last commit time (epoch seconds) per component under `packageDir`, from git. Empty when not a repo. */
export async function lastChangedFromGit(packageDir: string): Promise<Record<string, number>> {
  if (!(await isGitRepo(packageDir))) return {}
  const out: Record<string, number> = {}
  for (const c of listComponents(packageDir)) {
    const r = await git(packageDir, ['log', '-1', '--format=%ct', '--', path.join(packageDir, c.file)])
    const t = Number(r.stdout)
    if (r.ok && t > 0) out[`${c.type}:${c.apiName}`] = t
  }
  return out
}

export class StoryScopeError extends Error {}

/**
 * Components a Copado user story changed: the diff between the pipeline's main branch and the
 * story's `feature/<name>` branch in the lab clone (fetched first, read-only).
 */
export async function storyComponents(copado: Copado, labRepo: string, story: string): Promise<string[]> {
  const item = await copado.workItem(story)
  const base = item.projectPipelineMainBranch ?? 'main'
  const feature = `feature/${item.name}`
  const fetched = await git(labRepo, ['fetch', '--quiet', 'origin', base, feature])
  if (!fetched.ok) throw new StoryScopeError(`Cannot fetch ${feature} from the lab repository's origin.`)
  const diff = await git(labRepo, ['diff', '--name-only', `origin/${base}...origin/${feature}`])
  if (!diff.ok) throw new StoryScopeError(`Cannot diff origin/${base}...origin/${feature}.`)
  const keys = diff.stdout
    .split('\n')
    .filter(Boolean)
    .map((f) => componentForFile(f))
    .filter((c) => c !== undefined)
    .map((c) => `${c.type}:${c.apiName}`)
  return [...new Set(keys)]
}
