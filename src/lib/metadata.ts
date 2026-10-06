import fs from 'node:fs'
import path from 'node:path'
import {XMLParser} from 'fast-xml-parser'

/** A Source Format metadata component on disk. */
export interface Component {
  type: string
  /** Metadata API full name, e.g. `Opportunity.Discount_Max`. */
  apiName: string
  /** Path relative to the package directory. */
  file: string
}

const RULES: {re: RegExp; type: string; name: (m: RegExpMatchArray) => string}[] = [
  {
    re: /objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/,
    type: 'CustomField',
    name: (m) => `${m[1]}.${m[2]}`,
  },
  {
    re: /objects\/([^/]+)\/validationRules\/([^/]+)\.validationRule-meta\.xml$/,
    type: 'ValidationRule',
    name: (m) => `${m[1]}.${m[2]}`,
  },
  {re: /flows\/([^/]+)\.flow-meta\.xml$/, type: 'Flow', name: (m) => m[1] as string},
  {
    re: /permissionsets\/([^/]+)\.permissionset-meta\.xml$/,
    type: 'PermissionSet',
    name: (m) => m[1] as string,
  },
  {
    re: /layouts\/([^/]+)\.layout-meta\.xml$/,
    type: 'Layout',
    name: (m) => decodeURIComponent(m[1] as string),
  },
  {re: /classes\/([^/]+)\.cls-meta\.xml$/, type: 'ApexClass', name: (m) => m[1] as string},
]

export function componentForFile(relativeFile: string): Component | undefined {
  const f = relativeFile.split(path.sep).join('/')
  for (const rule of RULES) {
    const m = f.match(rule.re)
    if (m) return {type: rule.type, apiName: rule.name(m), file: f}
  }
  return undefined
}

/** Lists supported components under a Source Format package directory. */
export function listComponents(packageDir: string): Component[] {
  const out: Component[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const c = componentForFile(path.relative(packageDir, full))
        if (c) out.push(c)
      }
    }
  }
  if (fs.existsSync(packageDir)) walk(packageDir)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

const parser = new XMLParser({ignoreAttributes: true, parseTagValue: false, trimValues: true})

type Xml = unknown

function root(xml: string): Record<string, Xml> {
  const doc = parser.parse(xml) as Record<string, Xml>
  const key = Object.keys(doc).find((k) => k !== '?xml')
  const r = key ? doc[key] : undefined
  return r && typeof r === 'object' ? (r as Record<string, Xml>) : {}
}

function asArray(v: Xml): Xml[] {
  return Array.isArray(v) ? v : [v]
}

function normalise(v: Xml): Xml {
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return v
}

/**
 * True when everything in `expected` is present in `actual` with the same value.
 * Orgs return extra elements (defaults, other fields' permissions), so drift is checked as
 * "baseline ⊆ org". Repeated elements match as a set, in any order. `fullName` is ignored, and an
 * element that is `false` in the baseline may be absent in the org (Salesforce drops false defaults).
 */
export function isSubset(expected: Xml, actual: Xml): boolean {
  expected = normalise(expected)
  actual = normalise(actual)
  if (expected === undefined || expected === null || expected === '') return true
  if (typeof expected !== 'object') return expected === actual
  if (Array.isArray(expected)) {
    const pool = asArray(actual)
    return expected.every((e) => pool.some((a) => isSubset(e, a)))
  }
  if (actual === null || typeof actual !== 'object') return false
  if (Array.isArray(actual)) return actual.some((a) => isSubset(expected, a))
  const act = actual as Record<string, Xml>
  return Object.entries(expected as Record<string, Xml>).every(([k, v]) => {
    if (k === 'fullName') return true
    // Salesforce omits boolean elements that are false (e.g. <externalId>false</externalId>).
    if (!(k in act)) return normalise(v) === 'false'
    return isSubset(v, act[k])
  })
}

/** Lists top-level elements of `expected` that the org copy is missing or has changed (for messages). */
export function driftSummary(expectedXml: string, actualXml: string): string[] {
  const e = root(expectedXml)
  const a = root(actualXml)
  return Object.keys(e).filter((k) => k !== 'fullName' && !isSubset(e[k], a[k]))
}

export function matchesBaseline(baselineXml: string, orgXml: string): boolean {
  return isSubset(root(baselineXml), root(orgXml))
}
