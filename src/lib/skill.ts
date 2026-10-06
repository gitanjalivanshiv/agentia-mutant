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
  files: number
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full)]
  })
}

/**
 * Installs the Agent Skill folder (SKILL.md + references/) into the project: always
 * `.agents/skills/mutant`, and also `.claude/skills/mutant` when the project has a `.claude`
 * folder (brief §9). Files Mutant no longer ships are removed from the installed copy.
 */
export function installSkill(projectRoot: string, sourceRoot: string = pluginRoot()): SkillInstall[] {
  const source = path.join(sourceRoot, 'skills', 'mutant')
  const files = listFiles(source).sort()
  const targets = [path.join(projectRoot, '.agents', 'skills', 'mutant')]
  if (fs.existsSync(path.join(projectRoot, '.claude'))) {
    targets.push(path.join(projectRoot, '.claude', 'skills', 'mutant'))
  }
  return targets.map((dir) => {
    const existed = fs.existsSync(path.join(dir, 'SKILL.md'))
    let changed = false
    for (const f of files) {
      const content = fs.readFileSync(path.join(source, f))
      const target = path.join(dir, f)
      if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) continue
      fs.mkdirSync(path.dirname(target), {recursive: true})
      fs.writeFileSync(target, content)
      changed = true
    }
    if (existed) {
      for (const stale of listFiles(dir).filter((f) => !files.includes(f))) {
        fs.rmSync(path.join(dir, stale))
        changed = true
      }
    }
    const action = !existed ? 'installed' : changed ? 'updated' : 'unchanged'
    return {target: path.join(dir, 'SKILL.md'), action, files: files.length}
  })
}
