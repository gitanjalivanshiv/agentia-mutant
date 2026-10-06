import os from 'node:os'

/**
 * Scrubs recorded Agentia output so fixtures can live in a public repo:
 * Salesforce record IDs, org IDs, CRT numeric IDs, UUIDs, emails, usernames, masked keys
 * and URLs are replaced with stable placeholders (same input → same placeholder within a run).
 */

const SENSITIVE_KEYS = new Set([
  'masked',
  'username',
  'email',
  'orgId',
  'organization_id',
  'sourceOrgId',
  'oauthSignature',
  'signature',
  'requestUrl',
  'configuration',
  'domain',
  // Git and record links (ssh URIs are not caught by the URL pattern)
  'uri',
  'pullRequestBaseUrl',
  'tagBaseUrl',
  'commitBaseUrl',
  'branchBaseUrl',
  'sourceCredentialLink',
  'sourceEnvironmentLink',
  // People
  'createdBy',
  'lastModifiedBy',
  'createdByName',
  'lastModifiedByName',
  'created_by',
  'modified_by',
  'owner',
  'ownerName',
  'assigneeName',
  // CRT build secrets and session data
  'runTokenHash',
  'permitTokenHash',
  'archiveTokenHash',
  'mobileApiKey',
  'sessionData',
  'executionParameters',
])
const NUMERIC_ID_KEYS = new Set([
  'id',
  'projectId',
  'jobId',
  'robotId',
  'dwId',
  'buildId',
  'project_id',
  'job_id',
])

// 15/18-char Salesforce IDs: key prefix 0xx or axx, must contain a digit.
const SF_ID = /\b(?=[A-Za-z0-9]*\d)(?:0|a)[A-Za-z0-9]{14}(?:[A-Za-z0-9]{3})?\b/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL = /https?:\/\/[^\s"')]+/g

const ORG_ID_KEYS = new Set(['orgId', 'sourceOrgId'])
const ID_VALUE_FLAGS = new Set(['-p', '--project', '-j', '--job', '--crt-project', '--crt-job'])

export class Scrubber {
  private readonly map = new Map<string, string>()
  private counter = 0
  private readonly numericIds = new Set<string>()
  private readonly home = os.homedir()

  /** Registers numeric IDs found under ID keys so they are also replaced inside strings (paths, URLs). */
  prime(v: unknown, key?: string): void {
    if (v === null || v === undefined) return
    if (
      (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) &&
      key &&
      NUMERIC_ID_KEYS.has(key)
    ) {
      this.numericIds.add(String(v))
      return
    }
    if (Array.isArray(v)) v.forEach((x) => this.prime(x))
    else if (typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) this.prime(x, k)
  }

  private placeholder(original: string, kind: string): string {
    const key = `${kind}:${original}`
    const existing = this.map.get(key)
    if (existing) return existing
    this.counter += 1
    const n = String(this.counter)
    let value: string
    switch (kind) {
      case 'sfid':
        value = ('a00' + '0'.repeat(original.length)).slice(0, original.length - n.length) + n
        break
      case 'uuid':
        value = `00000000-0000-4000-8000-${n.padStart(12, '0')}`
        break
      case 'email':
        value = `user${n}@example.com`
        break
      case 'url':
        value = `https://example.invalid/${n}`
        break
      case 'num':
        value = String(1000 + this.counter)
        break
      default:
        value = `<redacted-${n}>`
    }
    this.map.set(key, value)
    return value
  }

  string(s: string): string {
    let out = s.split(this.home).join('~')
    for (const id of this.numericIds) {
      out = out.replace(new RegExp(`\\b${id}\\b`, 'g'), this.placeholder(id, 'num'))
    }
    return out
      .replace(URL, (m) => this.placeholder(m, 'url'))
      .replace(EMAIL, (m) => this.placeholder(m, 'email'))
      .replace(UUID, (m) => this.placeholder(m.toLowerCase(), 'uuid'))
      .replace(SF_ID, (m) => this.placeholder(m, 'sfid'))
  }

  value(v: unknown, key?: string): unknown {
    if (v === null || v === undefined) return v
    // Salesforce org IDs must keep a consistent placeholder: they are echoed back as command args.
    if (
      key &&
      ORG_ID_KEYS.has(key) &&
      typeof v === 'string' &&
      /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(v)
    ) {
      return this.placeholder(v, 'sfid')
    }
    if (key && SENSITIVE_KEYS.has(key))
      return typeof v === 'string' ? '<redacted>' : v === null ? null : '<redacted>'
    if (typeof v === 'number' && key && NUMERIC_ID_KEYS.has(key))
      return Number(this.placeholder(String(v), 'num'))
    if (typeof v === 'string') {
      if (key && NUMERIC_ID_KEYS.has(key) && /^\d+$/.test(v)) return this.placeholder(v, 'num')
      return this.string(v)
    }
    if (Array.isArray(v)) return v.map((x) => this.value(x))
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = this.value(x, k)
      return out
    }
    return v
  }

  /** Numeric args are IDs when positional or after an ID flag; values like `--page-size 200` stay as they are. */
  args(args: string[]): string[] {
    return args.map((a, i) => {
      const prev = i > 0 ? (args[i - 1] as string) : ''
      const positional = !prev.startsWith('-')
      if (/^\d+$/.test(a) && (this.numericIds.has(a) || ID_VALUE_FLAGS.has(prev) || positional)) {
        this.numericIds.add(a)
        return this.placeholder(a, 'num')
      }
      return this.string(a)
    })
  }
}
