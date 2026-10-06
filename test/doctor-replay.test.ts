import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {describe, expect, it} from 'vitest'

import {Copado, FakeAgentiaClient} from '../src/lib/agentia/index.js'
import {runDoctor} from '../src/lib/doctor.js'

/**
 * Replays the scrubbed recording of a real `agentia mutant doctor` run against the
 * INT-SFP lab (fixtures/doctor, recorded with MUTANT_RECORD). No org needed.
 */
const fixtures = path.resolve(__dirname, '../fixtures/doctor')
const demo = path.resolve(__dirname, '../examples/demo/force-app')

describe('doctor replay (recorded against the real lab)', () => {
  it('reports all 12 checks green from the recording', async () => {
    const jobArgs = JSON.parse(
      fs.readFileSync(
        path.join(
          fixtures,
          fs.readdirSync(fixtures).find((f) => f.includes('testing-job-get'))!,
        ),
        'utf8',
      ),
    ).args as string[]
    const workspaces = JSON.parse(
      fs.readFileSync(
        path.join(
          fixtures,
          fs.readdirSync(fixtures).find((f) => f.includes('ai-workspace'))!,
        ),
        'utf8',
      ),
    ).stdout.result.workspaces as {id: string; name: string}[]
    const workspaceId = workspaces.find((w) => w.name === 'Mutant – Discount Approval Lab')!.id
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-replay-'))
    const lab = path.join(root, 'lab')
    fs.mkdirSync(lab)
    await execa('git', ['init', '-q'], {cwd: lab})

    const report = await runDoctor({
      root,
      nodeVersion: '22.0.0',
      copado: new Copado(FakeAgentiaClient.fromDirectory(fixtures), root),
      config: {
        version: 1,
        labEnvironment: 'INT-SFP',
        sourceEnvironment: 'Dev2-SFP',
        pipeline: 'Trial - Salesforce Source Format Pipeline',
        labRepoPath: 'lab',
        packageDirectory: demo,
        labPackageDirectory: 'force-app',
        storyTitlePrefix: 'Mutant Lab –',
        crt: {projectId: Number(jobArgs[5]), jobId: Number(jobArgs[3])},
        ai: {workspaceId},
        budget: {maxMutants: 10, mutantTimeoutMinutes: 20},
        operators: {allow: [], deny: []},
        lockFile: path.join(root, '.org-busy'),
        iKnowThisIsALab: false,
      },
    })
    expect(report.checks.filter((c) => c.status !== 'pass').map((c) => `${c.id}: ${c.detail}`)).toEqual([])
    expect(report.summary.pass).toBe(12)
  })
})
