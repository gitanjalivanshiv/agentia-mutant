import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {beforeEach, describe, expect, it} from 'vitest'
import {syncBranchWithRemote} from '../src/lib/git.js'

const ours = (s: string) => / Mutant Lab /.test(s)
let clone: string

async function g(cwd: string, ...args: string[]) {
  return (await execa('git', args, {cwd})).stdout
}

async function commit(cwd: string, file: string, message: string) {
  fs.writeFileSync(path.join(cwd, file), message)
  await g(cwd, 'add', file)
  await g(cwd, 'commit', '-q', '-m', message)
}

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-git-'))
  const origin = path.join(dir, 'origin.git')
  clone = path.join(dir, 'clone')
  await execa('git', ['init', '-q', '--bare', '-b', 'main', origin])
  await execa('git', ['clone', '-q', origin, clone])
  for (const [k, v] of [
    ['user.email', 't@example.com'],
    ['user.name', 'T'],
    ['commit.gpgsign', 'false'],
  ])
    await g(clone, 'config', k, v)
  await commit(clone, 'a.txt', 'base')
  await g(clone, 'push', '-q', 'origin', 'main')
  await g(clone, 'checkout', '-q', '-b', 'dev2')
  await g(clone, 'push', '-q', '-u', 'origin', 'dev2')
})

describe('syncBranchWithRemote', () => {
  it('leaves a branch that matches the remote alone', async () => {
    expect(await syncBranchWithRemote(clone, 'dev2', ours)).toEqual({status: 'in-sync'})
  })

  it("drops Mutant's unpushed story merge left by a failed push", async () => {
    await g(clone, 'checkout', '-q', '-b', 'feature/US-1', 'main')
    await commit(clone, 'b.txt', 'US-1 Mutant Lab – r-x #2/3 VR_DEACTIVATE Opportunity.Discount_Max')
    await g(clone, 'checkout', '-q', 'dev2')
    await g(clone, 'merge', '-q', '--no-ff', '-m', "Merge branch 'feature/US-1' into dev2", 'feature/US-1')
    await g(clone, 'checkout', '-q', 'feature/US-1')
    const r = await syncBranchWithRemote(clone, 'dev2', ours)
    expect(r).toEqual({
      status: 'reset',
      dropped: ['US-1 Mutant Lab – r-x #2/3 VR_DEACTIVATE Opportunity.Discount_Max'],
    })
    expect(await g(clone, 'rev-parse', 'dev2')).toBe(await g(clone, 'rev-parse', 'origin/dev2'))
  })

  it('resets the branch even when it is checked out', async () => {
    await commit(clone, 'b.txt', 'US-2 Mutant Lab – r-x final revert to baseline')
    expect((await syncBranchWithRemote(clone, 'dev2', ours)).status).toBe('reset')
    expect(await g(clone, 'rev-parse', 'HEAD')).toBe(await g(clone, 'rev-parse', 'origin/dev2'))
  })

  it("refuses to drop someone else's unpushed work", async () => {
    await commit(clone, 'c.txt', 'US-36 VIP Case Escalation')
    const r = await syncBranchWithRemote(clone, 'dev2', ours)
    expect(r).toEqual({status: 'foreign', commits: ['US-36 VIP Case Escalation']})
    expect(await g(clone, 'log', '-1', '--format=%s', 'dev2')).toBe('US-36 VIP Case Escalation')
  })

  it('reports a branch the remote does not have', async () => {
    expect(await syncBranchWithRemote(clone, 'nope', ours)).toEqual({status: 'no-remote-branch'})
  })
})
