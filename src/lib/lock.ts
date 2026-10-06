import fs from 'node:fs'
import path from 'node:path'

import {expandHome} from './config.js'

/**
 * The shared `.org-busy` lock agreed with the Time Machine project: whoever writes to the
 * Copado org puts `<project>: <action> started <time>` in it and removes it when done.
 */

export interface LockState {
  path: string
  held: boolean
  content?: string
  ownedByMutant?: boolean
}

export function readLock(lockFile: string): LockState {
  const p = expandHome(lockFile)
  if (!fs.existsSync(p)) return {path: p, held: false}
  const content = fs.readFileSync(p, 'utf8').trim()
  return {path: p, held: true, content, ownedByMutant: content.startsWith('mutant:')}
}

export class LockBusyError extends Error {
  constructor(readonly state: LockState) {
    super(`The org is busy (${state.path}): ${state.content ?? ''}`)
  }
}

/** Takes the lock or throws LockBusyError. Uses O_EXCL so two processes can't both win. */
export function acquireLock(lockFile: string, action: string, now: Date = new Date()): LockState {
  const p = expandHome(lockFile)
  fs.mkdirSync(path.dirname(p), {recursive: true})
  const content = `mutant: ${action} started ${now.toISOString()}`
  try {
    fs.writeFileSync(p, content + '\n', {flag: 'wx'})
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LockBusyError(readLock(lockFile))
    throw error
  }
  return {path: p, held: true, content, ownedByMutant: true}
}

/** Removes the lock only if Mutant owns it. */
export function releaseLock(lockFile: string): boolean {
  const state = readLock(lockFile)
  if (!state.held || !state.ownedByMutant) return false
  fs.rmSync(state.path, {force: true})
  return true
}

export async function withLock<T>(lockFile: string, action: string, fn: () => Promise<T>): Promise<T> {
  acquireLock(lockFile, action)
  try {
    return await fn()
  } finally {
    releaseLock(lockFile)
  }
}
