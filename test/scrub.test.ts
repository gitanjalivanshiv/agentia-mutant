import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {createRecorder, FakeAgentiaClient} from '../src/lib/agentia/index.js'
import {Scrubber} from '../src/lib/agentia/scrub.js'

describe('Scrubber', () => {
  it('replaces Salesforce IDs consistently and keeps their length', () => {
    const s = new Scrubber()
    const a = s.string('story a1vXX000000AbC1AAQ and env a0cXX0000012xY9AAE')
    const b = s.string('again a1vXX000000AbC1AAQ')
    expect(a).not.toContain('a1vXX000000AbC1AAQ')
    const id = a.split(' ')[1] as string
    expect(id).toHaveLength(18)
    expect(b).toContain(id)
  })

  it('does not treat ordinary words as IDs', () => {
    expect(new Scrubber().string('Discount_Percent__c Approval_Required__c')).toBe(
      'Discount_Percent__c Approval_Required__c',
    )
  })

  it('redacts sensitive keys, emails, UUIDs, URLs and numeric CRT IDs', () => {
    const out = new Scrubber().value({
      masked: 'abcDE...12345',
      orgId: '99999',
      username: 'robot@example.org',
      note: 'mail me at someone@company.com',
      id: '3f2b9c1e-1111-4222-8333-944455556666',
      logReportUrl: 'https://robotic.example.com/robots/55501/r/1',
      projectId: 55501,
      name: 'Mutant Lab Robot',
    }) as Record<string, unknown>
    expect(out.masked).toBe('<redacted>')
    expect(out.orgId).toBe('<redacted>')
    expect(out.username).toBe('<redacted>')
    expect(out.note).toBe('mail me at user1@example.com')
    expect(out.id).toMatch(/^00000000-0000-4000-8000-/)
    expect(out.logReportUrl).toMatch(/^https:\/\/example\.invalid\//)
    expect(out.projectId).not.toBe(55501)
    expect(out.name).toBe('Mutant Lab Robot')
  })

  it('scrubs numeric IDs in args the same way as in results', () => {
    const s = new Scrubber()
    const args = s.args(['testing', 'job', 'get', '55502', '-p', '55501'])
    const result = s.value({jobId: 55502, projectId: 55501}) as {jobId: number; projectId: number}
    expect(args[3]).toBe(String(result.jobId))
    expect(args[5]).toBe(String(result.projectId))
  })
})

describe('Scrubber.prime', () => {
  it('replaces primed numeric IDs inside strings and keeps non-ID numbers in args', () => {
    const s = new Scrubber()
    const stdout = {
      result: {
        id: 55502,
        projectId: 55501,
        storage: {snapshotPath: '/next/project/55501/job/55502/snapshot'},
      },
    }
    s.prime(stdout)
    const out = JSON.stringify(s.value(stdout))
    expect(out).not.toMatch(/55501|55502/)
    expect(s.args(['cicd', 'environment', 'list', '--page-size', '200'])).toEqual([
      'cicd',
      'environment',
      'list',
      '--page-size',
      '200',
    ])
    expect(s.args(['testing', 'job', 'get', '55502', '-p', '55501']).join(' ')).not.toMatch(/55501|55502/)
  })

  it('gives Salesforce org IDs the same placeholder in results and args, but redacts other org IDs', () => {
    const s = new Scrubber()
    const env = s.value({orgId: '00D5g000004ABCDEAA'}) as {orgId: string}
    expect(env.orgId).toMatch(/^a0+\d+$/)
    expect(s.args(['--source-org-id', '00D5g000004ABCDEAA'])[1]).toBe(env.orgId)
    expect((s.value({orgId: '99999'}) as {orgId: string}).orgId).toBe('<redacted>')
  })

  it('replaces the home directory with ~', () => {
    expect(new Scrubber().string(`${os.homedir()}/project/.agentia/config.json`)).toBe(
      '~/project/.agentia/config.json',
    )
  })
})

describe('record → replay', () => {
  it('writes scrubbed fixtures that the fake client can replay', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-rec-'))
    const record = createRecorder(dir)
    record({
      args: ['testing', 'project', 'list'],
      exitCode: 0,
      stdout: {result: [{id: 55501, name: 'Lab'}], status: 0},
    })
    const files = fs.readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, files[0] as string), 'utf8')).not.toContain('55501')
    const fake = FakeAgentiaClient.fromDirectory(dir)
    const projects = (await fake.run(['testing', 'project', 'list'])) as {name: string}[]
    expect(projects[0]?.name).toBe('Lab')
  })
})
