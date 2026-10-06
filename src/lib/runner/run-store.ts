import fs from 'node:fs'
import path from 'node:path'

import {runsDir} from '../history.js'
import type {RunState} from './types.js'

/** Run ID like `r-20261006-142501`: sortable and short enough for story titles. */
export function newRunId(now: Date = new Date(), prefix = 'r'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
}

export class RunStore {
  readonly dir: string

  constructor(
    root: string,
    readonly runId: string,
  ) {
    this.dir = path.join(runsDir(root), runId)
  }

  static exists(root: string, runId: string): boolean {
    return fs.existsSync(path.join(runsDir(root), runId, 'state.json'))
  }

  /** Most recent run ID, if any. */
  static latest(root: string): string | undefined {
    const dir = runsDir(root)
    if (!fs.existsSync(dir)) return undefined
    return (
      fs
        .readdirSync(dir)
        // Mutation runs only (`r-…`); reset runs (`reset-…`) have no results worth reporting.
        .filter((d) => d.startsWith('r-') && fs.existsSync(path.join(dir, d, 'state.json')))
        .sort()
        .pop()
    )
  }

  path(...parts: string[]): string {
    return path.join(this.dir, ...parts)
  }

  /** Relative to the run directory, for portable references in state and results. */
  rel(file: string): string {
    return path.relative(this.dir, file)
  }

  /** Atomic write (temp + rename) so a crash never leaves a half-written state file. */
  save(state: RunState): void {
    fs.mkdirSync(this.dir, {recursive: true})
    state.updatedAt = new Date().toISOString()
    const tmp = this.path('state.json.tmp')
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
    fs.renameSync(tmp, this.path('state.json'))
    if (!fs.existsSync(this.path('plan.json'))) {
      fs.writeFileSync(this.path('plan.json'), JSON.stringify(state.plan, null, 2) + '\n')
    }
  }

  load(): RunState {
    return JSON.parse(fs.readFileSync(this.path('state.json'), 'utf8')) as RunState
  }

  writeResults(state: RunState): string {
    const file = this.path('results.json')
    const results = {
      version: 1,
      runId: state.runId,
      phase: state.phase,
      createdAt: state.createdAt,
      finishedAt: state.finishedAt,
      lab: state.lab,
      score: state.score,
      baseline: state.baseline,
      verify: state.verify,
      failure: state.failure,
      mutants: state.mutants,
    }
    fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n')
    return file
  }
}
