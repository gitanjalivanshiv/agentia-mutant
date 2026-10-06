import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import {
  findProjectRoot,
  labNameProblem,
  loadConfig,
  type MutantConfig,
  saveConfig,
} from '../src/lib/config.js'
import {acquireLock, LockBusyError, readLock, releaseLock, withLock} from '../src/lib/lock.js'

export const sampleConfig = (over: Partial<MutantConfig> = {}): MutantConfig => ({
  version: 1,
  labEnvironment: 'MutationLab',
  sourceEnvironment: 'Dev2',
  pipeline: 'Demo Pipeline',
  labRepoPath: '../lab',
  packageDirectory: 'force-app',
  labPackageDirectory: 'force-app',
  storyTitlePrefix: 'Mutant Lab –',
  crt: {projectId: 1, jobId: 2},
  ai: {},
  budget: {maxMutants: 10, mutantTimeoutMinutes: 20},
  operators: {allow: [], deny: []},
  lockFile: '/tmp/never-used',
  iKnowThisIsALab: false,
  ...over,
})

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-cfg-'))
})

describe('config', () => {
  it('saves, finds from a subfolder and loads with defaults applied', () => {
    saveConfig(tmp, sampleConfig())
    const sub = path.join(tmp, 'a', 'b')
    fs.mkdirSync(sub, {recursive: true})
    expect(findProjectRoot(sub)).toBe(tmp)
    const loaded = loadConfig(sub)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.config.budget.maxMutants).toBe(10)
  })

  it('reports a missing config with the init hint', () => {
    const r = loadConfig(tmp)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/mutant init/)
  })

  it('reports invalid configs field by field', () => {
    fs.mkdirSync(path.join(tmp, '.mutant'))
    fs.writeFileSync(
      path.join(tmp, '.mutant', 'config.json'),
      JSON.stringify({version: 1, labEnvironment: ''}),
    )
    const r = loadConfig(tmp)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/labEnvironment/)
  })

  it.each(['Production', 'UAT-SFP', 'staging2', 'prod-copy'])('refuses protected lab name %s', (name) => {
    expect(labNameProblem(sampleConfig({labEnvironment: name}))).toMatch(/Refusing/)
  })

  it('allows protected names only with an explicit override', () => {
    expect(labNameProblem(sampleConfig({labEnvironment: 'UAT'}), true)).toBeUndefined()
    expect(labNameProblem(sampleConfig({labEnvironment: 'UAT', iKnowThisIsALab: true}))).toBeUndefined()
  })

  it('accepts a normal lab name', () => {
    expect(labNameProblem(sampleConfig({labEnvironment: 'INT-SFP'}))).toBeUndefined()
  })
})

describe('org lock', () => {
  it('acquires, reports and releases its own lock', () => {
    const file = path.join(tmp, '.org-busy')
    acquireLock(file, 'run-1', new Date('2026-10-06T10:00:00Z'))
    expect(readLock(file)).toMatchObject({
      held: true,
      ownedByMutant: true,
      content: 'mutant: run-1 started 2026-10-06T10:00:00.000Z',
    })
    expect(releaseLock(file)).toBe(true)
    expect(readLock(file).held).toBe(false)
  })

  it('refuses when another tool holds the lock and never deletes it', () => {
    const file = path.join(tmp, '.org-busy')
    fs.writeFileSync(file, 'timemachine: restore started now\n')
    expect(() => acquireLock(file, 'run-2')).toThrow(LockBusyError)
    expect(releaseLock(file)).toBe(false)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('withLock releases on failure', async () => {
    const file = path.join(tmp, '.org-busy')
    await expect(
      withLock(file, 'run-3', async () => Promise.reject(new Error('deploy failed'))),
    ).rejects.toThrow()
    expect(fs.existsSync(file)).toBe(false)
  })
})
