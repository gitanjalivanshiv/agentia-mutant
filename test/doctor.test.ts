import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import {beforeEach, describe, expect, it} from 'vitest'

import {Copado, FakeAgentiaClient} from '../src/lib/agentia/index.js'
import {type MutantConfig} from '../src/lib/config.js'
import {runDoctor} from '../src/lib/doctor.js'
import {listComponents} from '../src/lib/metadata.js'

const demo = path.resolve(__dirname, '../examples/demo/force-app')
const REPO_URI = 'git@github.com:acme/lab-repo.git'

let root: string
let config: MutantConfig

async function makeLabClone(dir: string) {
  fs.mkdirSync(dir, {recursive: true})
  await execa('git', ['init', '-q'], {cwd: dir})
  await execa('git', ['remote', 'add', 'origin', 'https://github.com/acme/lab-repo.git'], {cwd: dir})
}

/** A fake Copado where everything is healthy; individual tests break one thing. */
function healthyFake(): FakeAgentiaClient {
  const fake = new FakeAgentiaClient()
    .ok(['auth', 'get', '--ai', '--cicd', '--crt'], {
      credentials: [
        {type: 'cicd', set: true, ready: null, source: 'global'},
        {type: 'crt', set: true, ready: true, source: 'local', domain: 'robotic.example'},
        {type: 'ai', set: true, ready: null, source: 'global'},
      ],
    })
    .ok(['cicd', 'environment', 'list', '--page-size', '200'], {
      data: [
        {id: 'ENV_SRC', name: 'Dev2', orgId: 'ORG_SRC', credentials: [{id: 'CRED_SRC'}]},
        {id: 'ENV_LAB', name: 'MutationLab', orgId: 'ORG_LAB', credentials: [{id: 'CRED_LAB'}]},
      ],
    })
    .ok(['cicd', 'pipeline', 'list', '--page-size', '200'], {
      data: [{id: 'PIPE', name: 'Demo Pipeline', gitRepositoryId: 'REPO'}],
    })
    // The real CLI returns a bare array here (unlike the paged environment/pipeline lists).
    .ok(
      ['cicd', 'pipeline', 'connection', 'list', '--pipeline-id', 'PIPE'],
      [{id: 'C1', sourceEnvironmentId: 'ENV_SRC', destinationEnvironmentId: 'ENV_LAB', branch: 'dev2'}],
    )
    .ok(['cicd', 'environment', 'auth', 'status', 'ENV_LAB', '--credentialid', 'CRED_LAB'], {validated: true})
    .ok(['testing', 'job', 'get', '2', '-p', '1'], {id: 2, name: 'Discount Approval Suite', robotId: 3})
    .ok(['ai', 'quota', 'get'], {limit: 100, usage: 5})
    .ok(['cicd', 'repository', 'get', 'REPO'], {name: 'lab-repo', uri: REPO_URI})
  // Lab content identical to the baseline for every demo component.
  for (const c of listComponents(demo)) {
    fake.ok(contentArgs(c.type, c.apiName), [{}], {
      '--output-file': fs.readFileSync(path.join(demo, c.file), 'utf8'),
    })
  }
  return fake
}

function contentArgs(type: string, apiName: string) {
  return [
    'cicd',
    'metadata',
    'content',
    'get',
    '--metadata-type',
    type,
    '--api-name',
    apiName,
    '--source',
    'ENVIRONMENT',
    '--pipeline-id',
    'PIPE',
    '--source-org-id',
    'ORG_LAB',
    '--source-credential-id',
    'CRED_LAB',
    '--output-file',
    'x',
  ]
}

const statusOf = (report: Awaited<ReturnType<typeof runDoctor>>, id: string) =>
  report.checks.find((c) => c.id === id)?.status

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-doc-'))
  await makeLabClone(path.join(root, 'lab'))
  config = {
    version: 1,
    labEnvironment: 'MutationLab',
    sourceEnvironment: 'Dev2',
    pipeline: 'Demo Pipeline',
    labRepoPath: 'lab',
    packageDirectory: demo,
    labPackageDirectory: 'force-app',
    storyTitlePrefix: 'Mutant Lab –',
    crt: {projectId: 1, jobId: 2},
    ai: {},
    budget: {maxMutants: 10, mutantTimeoutMinutes: 20},
    operators: {allow: [], deny: []},
    lockFile: path.join(root, '.org-busy'),
    iKnowThisIsALab: false,
  }
})

describe('runDoctor', () => {
  it('passes when everything is healthy', async () => {
    const report = await runDoctor({
      root,
      config,
      copado: new Copado(healthyFake(), root),
      nodeVersion: '22.1.0',
    })
    expect(report.checks.filter((c) => c.status !== 'pass')).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.checks.map((c) => c.id)).toEqual([
      'node',
      'config',
      'lab-name',
      'cicd-auth',
      'pipeline',
      'lab-auth',
      'crt-auth',
      'crt-job',
      'ai',
      'lab-repo',
      'lock',
      'drift',
    ])
  })

  it('fails early without config', async () => {
    const report = await runDoctor({root, configError: 'No config', copado: new Copado(healthyFake(), root)})
    expect(report.ok).toBe(false)
    expect(statusOf(report, 'config')).toBe('fail')
  })

  it('fails on an old Node.js', async () => {
    const report = await runDoctor({
      root,
      config,
      copado: new Copado(healthyFake(), root),
      nodeVersion: '18.19.0',
    })
    expect(statusOf(report, 'node')).toBe('fail')
  })

  it('refuses a protected lab name', async () => {
    const report = await runDoctor({
      root,
      config: {...config, labEnvironment: 'UAT'},
      copado: new Copado(healthyFake(), root),
    })
    expect(statusOf(report, 'lab-name')).toBe('fail')
    expect(report.ok).toBe(false)
  })

  it('fails when the pipeline has no source → lab connection', async () => {
    const fake = healthyFake().replace({
      args: ['cicd', 'pipeline', 'connection', 'list', '--pipeline-id', 'PIPE'],
      exitCode: 0,
      stdout: {result: {data: []}, status: 0},
    })
    const report = await runDoctor({root, config, copado: new Copado(fake, root)})
    expect(statusOf(report, 'pipeline')).toBe('fail')
    expect(report.checks.find((c) => c.id === 'pipeline')?.detail).toMatch(/no Dev2 → MutationLab connection/)
    expect(statusOf(report, 'drift')).toBe('skip')
  })

  it('fails when CRT auth is not ready', async () => {
    const fake = new FakeAgentiaClient().ok(['auth', 'get', '--ai', '--cicd', '--crt'], {
      credentials: [
        {type: 'cicd', set: false},
        {type: 'crt', set: true, ready: false},
        {type: 'ai', set: false},
      ],
    })
    const report = await runDoctor({root, config, copado: new Copado(fake, root), skipDrift: true})
    expect(statusOf(report, 'cicd-auth')).toBe('fail')
    expect(statusOf(report, 'crt-auth')).toBe('fail')
    expect(statusOf(report, 'ai')).toBe('warn')
    expect(statusOf(report, 'drift')).toBe('skip')
  })

  it('fails when the CRT job is not visible (e.g. wrong folder-scoped auth)', async () => {
    const fake = healthyFake().replace({
      args: ['testing', 'job', 'get', '2', '-p', '1'],
      exitCode: 1,
      stdout: {error: {name: 'TestingGatewayError', message: 'CRT request failed (404).', statusCode: 404}},
    })
    const report = await runDoctor({root, config, copado: new Copado(fake, root)})
    expect(statusOf(report, 'crt-job')).toBe('fail')
    expect(report.checks.find((c) => c.id === 'crt-job')?.fix).toMatch(/folder-scoped/)
  })

  it('fails when the lab clone has uncommitted tracked changes', async () => {
    const lab = path.join(root, 'lab')
    fs.writeFileSync(path.join(lab, 'a.txt'), 'x')
    await execa('git', ['add', 'a.txt'], {cwd: lab})
    const report = await runDoctor({root, config, copado: new Copado(healthyFake(), root)})
    expect(statusOf(report, 'lab-repo')).toBe('fail')
  })

  it('fails when the lab clone points at a different repository', async () => {
    await execa('git', ['remote', 'set-url', 'origin', 'https://github.com/someone/else.git'], {
      cwd: path.join(root, 'lab'),
    })
    const report = await runDoctor({root, config, copado: new Copado(healthyFake(), root)})
    expect(report.checks.find((c) => c.id === 'lab-repo')?.detail).toMatch(/pipeline uses acme\/lab-repo/)
  })

  it('warns when another tool holds the org lock', async () => {
    fs.writeFileSync(config.lockFile, 'timemachine: restore started now')
    const report = await runDoctor({root, config, copado: new Copado(healthyFake(), root)})
    expect(statusOf(report, 'lock')).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('fails when the lab has drifted from the baseline (e.g. a mutant left behind)', async () => {
    const vr = listComponents(demo).find((c) => c.type === 'ValidationRule')!
    const mutated = fs
      .readFileSync(path.join(demo, vr.file), 'utf8')
      .replace('<active>true</active>', '<active>false</active>')
    const fake = healthyFake().replace({
      args: contentArgs(vr.type, vr.apiName),
      exitCode: 0,
      stdout: {result: [{}], status: 0},
      writes: {'--output-file': mutated},
    })
    const report = await runDoctor({root, config, copado: new Copado(fake, root)})
    expect(statusOf(report, 'drift')).toBe('fail')
    expect(report.checks.find((c) => c.id === 'drift')?.detail).toMatch(
      /ValidationRule Opportunity.Discount_Max \(active\)/,
    )
  })
})
