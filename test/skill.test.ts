import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {installSkill, pluginRoot} from '../src/lib/skill.js'

describe('installSkill', () => {
  it('finds the plugin root', () => {
    expect(fs.existsSync(path.join(pluginRoot(), 'skills', 'mutant', 'SKILL.md'))).toBe(true)
  })

  it('installs into .agents/skills, and .claude/skills only when .claude exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-skill-'))
    expect(installSkill(root).map((s) => [path.relative(root, s.target), s.action])).toEqual([
      ['.agents/skills/mutant/SKILL.md', 'installed'],
    ])
    fs.mkdirSync(path.join(root, '.claude'))
    expect(installSkill(root).map((s) => [path.relative(root, s.target), s.action])).toEqual([
      ['.agents/skills/mutant/SKILL.md', 'unchanged'],
      ['.claude/skills/mutant/SKILL.md', 'installed'],
    ])
  })

  it('updates a stale copy', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-skill-'))
    installSkill(root)
    fs.writeFileSync(path.join(root, '.agents/skills/mutant/SKILL.md'), 'old')
    expect(installSkill(root)[0]?.action).toBe('updated')
  })

  it('ships front-matter that matches the Agentia skill format', () => {
    const text = fs.readFileSync(path.join(pluginRoot(), 'skills', 'mutant', 'SKILL.md'), 'utf8')
    expect(text).toMatch(/^---\nname: mutant\ndescription: .+\n---\n/)
  })
})
