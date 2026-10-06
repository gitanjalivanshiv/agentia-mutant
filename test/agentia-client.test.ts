import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {
  AgentiaError,
  describeCommand,
  FakeAgentiaClient,
  parseStdout,
  unwrap,
} from '../src/lib/agentia/index.js'

describe('unwrap', () => {
  it('returns result on success', () => {
    expect(unwrap({result: {a: 1}, status: 0}, 0, ['x'])).toEqual({a: 1})
  })

  it('validates with a schema and keeps unknown fields', () => {
    const schema = z.looseObject({a: z.number()})
    expect(unwrap({result: {a: 1, extra: true}, status: 0}, 0, ['x'], schema)).toEqual({a: 1, extra: true})
  })

  it('throws AgentiaError with only safe fields from the error envelope', () => {
    const doc = {
      error: {
        name: 'CicdGatewayError',
        message: 'CICD Gateway request failed (404).',
        statusCode: 404,
        requestUrl: 'https://na.api.copado.com/...?api_key=secret',
        oclif: {huge: 'x'.repeat(1000)},
      },
    }
    try {
      unwrap(doc, 1, ['cicd', 'work', 'submit'])
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AgentiaError)
      const err = e as AgentiaError
      expect(err.message).toBe('CICD Gateway request failed (404).')
      expect(err.details).toEqual({
        command: 'agentia cicd work submit',
        exitCode: 1,
        errorName: 'CicdGatewayError',
        statusCode: 404,
        code: undefined,
      })
      expect(JSON.stringify(err.details)).not.toContain('api_key')
    }
  })

  it('throws on schema mismatch', () => {
    expect(() => unwrap({result: {a: 'nope'}}, 0, ['x'], z.object({a: z.number()}))).toThrow(
      /Unexpected JSON shape/,
    )
  })

  it('throws when there is no JSON', () => {
    expect(() => unwrap(undefined, 2, ['x'])).toThrow(/no JSON/)
  })

  it('throws on non-zero exit without an error envelope, keeping the result for diagnosis', () => {
    expect(() => unwrap({result: {jobMonitors: []}}, 3, ['x'])).toThrow(/exited with 3/)
    try {
      unwrap({result: {jobMonitors: [{jobExecutionStatus: 'Failed'}]}}, 1, ['x'])
    } catch (e) {
      expect((e as AgentiaError).details.result).toEqual({jobMonitors: [{jobExecutionStatus: 'Failed'}]})
    }
  })
})

describe('parseStdout', () => {
  it('parses plain JSON', () => expect(parseStdout('{"result":1}')).toEqual({result: 1}))
  it('tolerates noise before the document', () =>
    expect(parseStdout('warning\n{"result":1}')).toEqual({result: 1}))
  it('returns undefined for empty or invalid output', () => {
    expect(parseStdout('')).toBeUndefined()
    expect(parseStdout('not json')).toBeUndefined()
  })
})

describe('describeCommand', () => {
  it('hides values of secret flags', () => {
    expect(describeCommand(['auth', 'set', '--crt', 'PAK123', '--crt-org', '9'])).toBe(
      'agentia auth set --crt *** --crt-org 9',
    )
  })
})

describe('FakeAgentiaClient', () => {
  it('matches on args regardless of --json', async () => {
    const fake = new FakeAgentiaClient().ok(['a', 'b'], {x: 1})
    await expect(fake.run(['a', 'b', '--json'])).resolves.toEqual({x: 1})
    expect(fake.calls).toEqual([['a', 'b']])
  })

  it('replays a queue in order and repeats the last entry (polling)', async () => {
    const fake = new FakeAgentiaClient().ok(['poll'], 'executing').ok(['poll'], 'succeeded')
    expect(await fake.run(['poll'])).toBe('executing')
    expect(await fake.run(['poll'])).toBe('succeeded')
    expect(await fake.run(['poll'])).toBe('succeeded')
  })

  it('replays failures as AgentiaError', async () => {
    const fake = new FakeAgentiaClient().fail(['x'], {message: 'boom', statusCode: 403})
    await expect(fake.run(['x'])).rejects.toMatchObject({name: 'AgentiaError', details: {statusCode: 403}})
  })

  it('fails loudly when no fixture matches', async () => {
    await expect(new FakeAgentiaClient().run(['missing'])).rejects.toThrow(/no fixture/)
  })
})

describe('Copado.promotion (real `promotion get` shape)', () => {
  it('takes the name from identification.promotionName', async () => {
    const {Copado} = await import('../src/lib/agentia/index.js')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const exchange = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'samples/agentia/promotion-get.json'), 'utf8'),
    )
    const detail = await new Copado(new FakeAgentiaClient([exchange])).promotion('PROMO')
    expect(detail.name).toBe('P00004')
    expect(detail.sourceEnvironmentName).toBe('Dev2-SFP')
    expect(detail.userStories?.map((u) => u.name)).toEqual(['US-0000028'])
  })
})

describe('Copado read retries', () => {
  it('retries read-only calls on transient gateway errors', async () => {
    const {Copado} = await import('../src/lib/agentia/index.js')
    const args = ['cicd', 'environment', 'list', '--page-size', '200']
    const fake = new FakeAgentiaClient()
      .fail(args, {message: 'CICD Gateway request failed (500).', statusCode: 500})
      .fail(args, {message: 'Unauthorized. Request: GET /corpus/environments'})
      .ok(args, {data: [{id: 'E', name: 'Lab'}]})
    const copado = new Copado(fake, undefined, async () => {})
    expect((await copado.environments()).map((e) => e.name)).toEqual(['Lab'])
    expect(fake.calls).toHaveLength(3)
  })

  it('gives up after 3 attempts', async () => {
    const {Copado} = await import('../src/lib/agentia/index.js')
    const args = ['ai', 'quota', 'get']
    const fake = new FakeAgentiaClient().fail(args, {message: 'read ECONNRESET'})
    await expect(new Copado(fake, undefined, async () => {}).aiQuota()).rejects.toThrow(/ECONNRESET/)
    expect(fake.calls).toHaveLength(3)
  })

  it('never retries writes', async () => {
    const {Copado} = await import('../src/lib/agentia/index.js')
    const args = ['cicd', 'promotion', 'run', 'P', '--operation', 'merge_and_deploy', '--wait-timeout', '120']
    const fake = new FakeAgentiaClient().fail(args, {
      message: 'CICD Gateway request failed (500).',
      statusCode: 500,
    })
    await expect(new Copado(fake, undefined, async () => {}).promotionRunDeploy('P', 120)).rejects.toThrow()
    expect(fake.calls).toHaveLength(1)
  })

  it('classifies commands', async () => {
    const {isReadOnly} = await import('../src/lib/agentia/index.js')
    expect(isReadOnly(['cicd', 'metadata', 'content', 'get', '--api-name', 'x'])).toBe(true)
    expect(isReadOnly(['testing', 'job', 'download', '1', '-p', '2'])).toBe(true)
    expect(isReadOnly(['cicd', 'work', 'set', 'US-1'])).toBe(false)
    expect(isReadOnly(['testing', 'test', 'run', '1', '-p', '2'])).toBe(false)
    expect(isReadOnly(['ai', 'agent', 'ask', '-p', 'list all the things'])).toBe(false)
  })
})
