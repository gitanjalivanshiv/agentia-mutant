import fs from 'node:fs'
import path from 'node:path'

import {type Operator, OPERATORS} from '../operators/index.js'
import {diffStats, unifiedDiff} from './diff.js'
import {type Component, listComponents} from './metadata.js'
import {applyEdits, isWellFormed, parseXmlTree, rootElement} from './xml.js'

/** One concrete, deployable breakage. */
export interface Mutant {
  /** Stable ID: `<OPERATOR>:<Type>:<apiName>:<siteKey>`. */
  id: string
  operator: string
  component: Component
  siteKey: string
  description: string
  shouldCheck: string
  /** Path relative to the package directory. */
  file: string
  original: string
  mutated: string
  diff: string
  stats: {added: number; removed: number}
}

export interface GenerateOptions {
  operators?: readonly Operator[]
  /** Only these components (by `Type:apiName` or apiName). */
  components?: string[]
}

export function mutantId(operator: string, component: Component, siteKey: string): string {
  return `${operator}:${component.type}:${component.apiName}:${siteKey}`
}

/** Every mutant one operator can make in one component's XML. Pure. */
export function mutantsFor(operator: Operator, component: Component, xml: string): Mutant[] {
  if (operator.metadataType !== component.type) return []
  const root = rootElement(parseXmlTree(xml))
  return operator.sites({xml, root, component}).map((site) => {
    const mutated = applyEdits(xml, site.edits)
    if (mutated === xml)
      throw new Error(`${operator.id} produced no change at ${site.key} in ${component.file}`)
    if (!isWellFormed(mutated))
      throw new Error(`${operator.id} produced malformed XML at ${site.key} in ${component.file}`)
    return {
      id: mutantId(operator.id, component, site.key),
      operator: operator.id,
      component,
      siteKey: site.key,
      description: site.description,
      shouldCheck: site.shouldCheck,
      file: component.file,
      original: xml,
      mutated,
      diff: unifiedDiff(xml, mutated, component.file),
      stats: diffStats(xml, mutated),
    }
  })
}

function matches(component: Component, filter: string[]): boolean {
  return filter.some((f) => f === component.apiName || f === `${component.type}:${component.apiName}`)
}

/** All mutants for a Source Format package directory. */
export function generateMutants(packageDir: string, options: GenerateOptions = {}): Mutant[] {
  const operators = options.operators ?? OPERATORS
  let components = listComponents(packageDir)
  if (options.components?.length) components = components.filter((c) => matches(c, options.components!))
  return components.flatMap((component) => {
    const xml = fs.readFileSync(path.join(packageDir, component.file), 'utf8')
    return operators.flatMap((op) => mutantsFor(op, component, xml))
  })
}
