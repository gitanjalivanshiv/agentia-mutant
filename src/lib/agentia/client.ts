import fs from 'node:fs'
import path from 'node:path'
import {execa} from 'execa'
import type {ZodType} from 'zod'

/**
 * The only way Mutant talks to Copado: spawn the public `agentia` binary with `--json`
 * and parse stdout. See docs/agentia-commands.md for the envelope this relies on.
 */

export interface RunOptions<T> {
  /** Working directory. Matters: project-scoped (`--local`) auth is resolved from cwd. */
  cwd?: string
  timeoutMs?: number
  /** Validates `result`. Schemas should be permissive (passthrough) so new fields never break us. */
  schema?: ZodType<T>
  /** Text piped to stdin (e.g. `--value-stdin`). Never logged. */
  input?: string
}

export interface AgentiaClient {
  run<T = unknown>(args: string[], options?: RunOptions<T>): Promise<T>
}

/** One recorded or replayed invocation. Also the on-disk fixture format. */
export interface AgentiaExchange {
  args: string[]
  exitCode: number
  /** Parsed stdout document (`{result,status}` or `{error}`), already scrubbed when recorded. */
  stdout: unknown
  /** Text files the command wrote, keyed by the flag that named the path (e.g. `--output-file`). */
  writes?: Record<string, string>
}

/** Flags whose value is a local output path. Their values vary per run, so fixtures match on `<path>`. */
export const OUTPUT_PATH_FLAGS = [
  '--output-file',
  '--output',
  '-o',
  '--xunit',
  '--save-artifacts',
  '--output-dir',
]

export function outputPaths(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  args.forEach((a, i) => {
    if (OUTPUT_PATH_FLAGS.includes(a) && i + 1 < args.length) out[a] = args[i + 1] as string
  })
  return out
}

export class AgentiaError extends Error {
  override readonly name = 'AgentiaError'
  constructor(
    message: string,
    readonly details: {
      command: string
      exitCode?: number
      /** Error class reported by the CLI, e.g. CicdGatewayError, TestingGatewayError. */
      errorName?: string
      statusCode?: number
      code?: string
    },
  ) {
    super(message)
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
// Flag-parse errors embed the whole oclif config (~750 KB); leave plenty of headroom.
const MAX_BUFFER = 64 * 1024 * 1024

/** Command line for messages: drops values that follow secret-looking flags. */
export function describeCommand(args: string[]): string {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    out.push(a)
    if (/^--(crt|cicd|ai|value|git-password)$/.test(a) && i + 1 < args.length) {
      out.push('***')
      i++
    }
  }
  return `agentia ${out.join(' ')}`
}

/**
 * Turns a parsed stdout document into the `result` or an AgentiaError.
 * Reads only message/name/statusCode/code from errors: never the raw payload, which can
 * contain the CLI config, request URLs with org IDs, or masked keys.
 */
export function unwrap<T>(doc: unknown, exitCode: number, args: string[], schema?: ZodType<T>): T {
  const command = describeCommand(args)
  if (!doc || typeof doc !== 'object') {
    throw new AgentiaError(`agentia returned no JSON (exit ${exitCode})`, {command, exitCode})
  }
  const d = doc as {result?: unknown; error?: Record<string, unknown>}
  if (d.error) {
    const e = d.error
    const message = typeof e.message === 'string' ? e.message : 'agentia command failed'
    throw new AgentiaError(message, {
      command,
      exitCode,
      errorName: typeof e.name === 'string' ? e.name : undefined,
      statusCode: typeof e.statusCode === 'number' ? e.statusCode : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    })
  }
  if (exitCode !== 0) {
    throw new AgentiaError(`agentia exited with ${exitCode}`, {command, exitCode})
  }
  if (!schema) return d.result as T
  const parsed = schema.safeParse(d.result)
  if (!parsed.success) {
    throw new AgentiaError(`Unexpected JSON shape from ${command}: ${parsed.error.message}`, {
      command,
      exitCode,
    })
  }
  return parsed.data
}

export function parseStdout(stdout: string): unknown {
  const text = stdout.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    // Defensive: if anything precedes the JSON document, parse from the first brace.
    const start = text.indexOf('{')
    if (start > 0) {
      try {
        return JSON.parse(text.slice(start))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

export interface ProcessAgentiaClientOptions {
  bin?: string
  defaultCwd?: string
  /** Called after every real call; used by record mode. */
  onExchange?: (exchange: AgentiaExchange) => void
}

/** Real client. stderr is ignored on purpose: other linked plugins print oclif warnings there. */
export class ProcessAgentiaClient implements AgentiaClient {
  constructor(private readonly options: ProcessAgentiaClientOptions = {}) {}

  async run<T = unknown>(args: string[], options: RunOptions<T> = {}): Promise<T> {
    const fullArgs = args.includes('--json') ? args : [...args, '--json']
    const proc = await execa(this.options.bin ?? 'agentia', fullArgs, {
      cwd: options.cwd ?? this.options.defaultCwd,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      reject: false,
      input: options.input,
      env: {NO_COLOR: '1', FORCE_COLOR: '0'},
    })
    if (proc.timedOut) {
      throw new AgentiaError(
        `Timed out after ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s`,
        {
          command: describeCommand(args),
        },
      )
    }
    if (proc.failed && proc.exitCode === undefined) {
      throw new AgentiaError(`Could not run agentia: ${proc.shortMessage}`, {command: describeCommand(args)})
    }
    const exitCode = proc.exitCode ?? 1
    const doc = parseStdout(typeof proc.stdout === 'string' ? proc.stdout : '')
    if (this.options.onExchange) {
      const writes: Record<string, string> = {}
      for (const [flag, file] of Object.entries(outputPaths(args))) {
        const full = path.resolve(options.cwd ?? this.options.defaultCwd ?? process.cwd(), file)
        // Only small text outputs are worth replaying; zips and logs stay out of fixtures.
        if (
          fs.existsSync(full) &&
          fs.statSync(full).size < 1_000_000 &&
          /\.(xml|json|txt|robot)$/i.test(full)
        ) {
          writes[flag] = fs.readFileSync(full, 'utf8')
        }
      }
      this.options.onExchange({
        args: stripJson(args),
        exitCode,
        stdout: doc,
        ...(Object.keys(writes).length ? {writes} : {}),
      })
    }
    return unwrap(doc, exitCode, args, options.schema)
  }
}

export function stripJson(args: string[]): string[] {
  return args.filter((a) => a !== '--json')
}
