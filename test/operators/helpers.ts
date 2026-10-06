import fs from 'node:fs'
import path from 'node:path'
import {expect} from 'vitest'

import type {Component} from '../../src/lib/metadata.js'
import {type Mutant, mutantsFor} from '../../src/lib/mutants.js'
import {isWellFormed} from '../../src/lib/xml.js'
import type {Operator} from '../../src/operators/index.js'

export const DEMO = path.resolve(__dirname, '../../examples/demo/force-app/main/default')
export const SAMPLES = path.resolve(__dirname, '../samples')

export function demo(rel: string): string {
  return fs.readFileSync(path.join(DEMO, rel), 'utf8')
}

export function sample(file: string): string {
  return fs.readFileSync(path.join(SAMPLES, file), 'utf8')
}

export function component(type: string, apiName: string, file = 'x'): Component {
  return {type, apiName, file}
}

export function run(op: Operator, type: string, apiName: string, xml: string): Mutant[] {
  return mutantsFor(op, component(type, apiName), xml)
}

/** Lines removed/added by a mutant, without the diff headers. */
export function changedLines(m: Mutant): {removed: string[]; added: string[]} {
  const body = m.diff.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++'))
  return {
    removed: body.filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
    added: body.filter((l) => l.startsWith('+')).map((l) => l.slice(1).trim()),
  }
}

/** Invariants every mutant must satisfy. */
export function expectSane(m: Mutant) {
  expect(m.mutated).not.toBe(m.original)
  expect(isWellFormed(m.mutated)).toBe(true)
  expect(m.description.length).toBeGreaterThan(10)
  expect(m.shouldCheck.length).toBeGreaterThan(10)
  // The XML declaration and root element survive untouched.
  expect(m.mutated.split('\n')[0]).toBe(m.original.split('\n')[0])
}
