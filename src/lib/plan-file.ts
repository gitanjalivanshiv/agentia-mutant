import fs from 'node:fs'
import path from 'node:path'

import {CONFIG_DIR} from './config.js'
import type {Plan} from './planner.js'

export function plansDir(root: string): string {
  return path.join(root, CONFIG_DIR, 'plans')
}

/** Writes the plan as `.mutant/plans/<timestamp>.json` and `.mutant/plans/latest.json`. */
export function savePlan(root: string, plan: Plan, file?: string): string {
  const target = file
    ? path.resolve(root, file)
    : path.join(plansDir(root), `${plan.createdAt.replace(/[:.]/g, '-')}.json`)
  const json = JSON.stringify(plan, null, 2) + '\n'
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, json)
  if (!file) fs.writeFileSync(path.join(plansDir(root), 'latest.json'), json)
  return target
}

export function loadPlan(file: string): Plan {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8')) as Plan
  if (plan.version !== 1 || !Array.isArray(plan.mutants)) throw new Error(`${file} is not a Mutant plan`)
  return plan
}
