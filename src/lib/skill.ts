import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/** Locates this plugin's package root (works from src/ under vitest and dist/ when installed). */
export function pluginRoot(from: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = from
  for (;;) {
    const pkg = path.join(dir, 'package.json')
    if (fs.existsSync(pkg)) {
      try {
        if ((JSON.parse(fs.readFileSync(pkg, 'utf8')) as {name?: string}).name === 'agentia-plugin-mutant')
          return dir
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Cannot locate the agentia-plugin-mutant package root')
    dir = parent
  }
}

export interface SkillInstall {
  target: string
  action: 'installed' | 'updated' | 'unchanged'
}

/**
 * Installs the Agent Skill into the project: always `.agents/skills/mutant`, and also
 * `.claude/skills/mutant` when the project has a `.claude` folder (brief §9).
 */
export function installSkill(projectRoot: string, sourceRoot: string = pluginRoot()): SkillInstall[] {
  const source = path.join(sourceRoot, 'skills', 'mutant', 'SKILL.md')
  const content = fs.readFileSync(source, 'utf8')
  const targets = [path.join(projectRoot, '.agents', 'skills', 'mutant')]
  if (fs.existsSync(path.join(projectRoot, '.claude')))
    targets.push(path.join(projectRoot, '.claude', 'skills', 'mutant'))
  return targets.map((dir) => {
    const file = path.join(dir, 'SKILL.md')
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
    if (existing === content) return {target: file, action: 'unchanged' as const}
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(file, content)
    return {target: file, action: existing === undefined ? ('installed' as const) : ('updated' as const)}
  })
}
