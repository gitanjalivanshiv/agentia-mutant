import fs from 'node:fs'
import path from 'node:path'

import {
  type AgentiaClient,
  type AgentiaExchange,
  OUTPUT_PATH_FLAGS,
  outputPaths,
  type RunOptions,
  stripJson,
  unwrap,
} from './client.js'
import {Scrubber} from './scrub.js'

/**
 * Replays recorded exchanges. Matching is on the exact argument list (without `--json`);
 * a response may be a single exchange or a queue (consumed in order, last one repeats),
 * which models polling (`executing` → `executing` → `succeeded`).
 */
export class FakeAgentiaClient implements AgentiaClient {
  readonly calls: string[][] = []
  private readonly queues = new Map<string, AgentiaExchange[]>()

  constructor(exchanges: AgentiaExchange[] = []) {
    for (const e of exchanges) this.add(e)
  }

  static key(args: string[]): string {
    const clean = stripJson(args)
    return clean
      .map((a, i) => (i > 0 && OUTPUT_PATH_FLAGS.includes(clean[i - 1] as string) ? '<path>' : a))
      .join('\u0000')
  }

  add(exchange: AgentiaExchange): this {
    const k = FakeAgentiaClient.key(exchange.args)
    const q = this.queues.get(k) ?? []
    q.push(exchange)
    this.queues.set(k, q)
    return this
  }

  /** Drops any queued responses for these args and registers this one instead. */
  replace(exchange: AgentiaExchange): this {
    this.queues.delete(FakeAgentiaClient.key(exchange.args))
    return this.add(exchange)
  }

  /** Convenience for tests: respond with `{result, status: 0}`. */
  ok(args: string[], result: unknown, writes?: Record<string, string>): this {
    return this.add({args, exitCode: 0, stdout: {result, status: 0}, ...(writes ? {writes} : {})})
  }

  /** Convenience for tests: respond with an error envelope. */
  fail(args: string[], error: {message: string; name?: string; statusCode?: number}): this {
    return this.add({args, exitCode: 1, stdout: {error: {name: 'Error', ...error}}})
  }

  async run<T = unknown>(args: string[], options: RunOptions<T> = {}): Promise<T> {
    const clean = stripJson(args)
    this.calls.push(clean)
    const q = this.queues.get(FakeAgentiaClient.key(clean))
    if (!q || q.length === 0) {
      throw new Error(`FakeAgentiaClient: no fixture for: agentia ${clean.join(' ')}`)
    }
    const exchange = (q.length > 1 ? q.shift() : q[0]) as AgentiaExchange
    const targets = outputPaths(clean)
    for (const [flag, content] of Object.entries(exchange.writes ?? {})) {
      const target = targets[flag]
      if (!target) continue
      const full = path.resolve(options.cwd ?? process.cwd(), target)
      fs.mkdirSync(path.dirname(full), {recursive: true})
      fs.writeFileSync(full, content)
    }
    return unwrap(exchange.stdout, exchange.exitCode, clean, options.schema)
  }

  static fromDirectory(dir: string): FakeAgentiaClient {
    const fake = new FakeAgentiaClient()
    if (!fs.existsSync(dir)) return fake
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as
        AgentiaExchange | AgentiaExchange[]
      for (const e of Array.isArray(data) ? data : [data]) fake.add(e)
    }
    return fake
  }
}

/** Record mode (`MUTANT_RECORD=<dir>`): writes each real exchange, scrubbed, as a fixture file. */
export function createRecorder(dir: string): (exchange: AgentiaExchange) => void {
  const scrubber = new Scrubber()
  let n = 0
  fs.mkdirSync(dir, {recursive: true})
  return (exchange) => {
    n += 1
    scrubber.prime(exchange.stdout)
    const scrubbed: AgentiaExchange = {
      args: scrubber
        .args(exchange.args)
        .map((a, i, all) => (i > 0 && OUTPUT_PATH_FLAGS.includes(all[i - 1] as string) ? '<path>' : a)),
      exitCode: exchange.exitCode,
      stdout: scrubber.value(exchange.stdout),
      ...(exchange.writes
        ? {
            writes: Object.fromEntries(
              Object.entries(exchange.writes).map(([k, v]) => [k, scrubber.string(v)]),
            ),
          }
        : {}),
    }
    const slug = scrubbed.args
      .filter((a) => !a.startsWith('-'))
      .slice(0, 4)
      .join('-')
      .replace(/[^a-z0-9-]+/gi, '_')
    fs.writeFileSync(
      path.join(dir, `${String(n).padStart(3, '0')}-${slug}.json`),
      JSON.stringify(scrubbed, null, 2) + '\n',
    )
  }
}
