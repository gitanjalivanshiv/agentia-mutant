import {execa} from 'execa'

/** Minimal git helpers for checks on the lab clone. Always pass the clone as cwd explicitly. */

export async function git(cwd: string, args: string[]): Promise<{ok: boolean; stdout: string}> {
  const r = await execa('git', args, {cwd, reject: false})
  return {ok: r.exitCode === 0, stdout: typeof r.stdout === 'string' ? r.stdout.trim() : ''}
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).stdout === 'true'
}

/** Tracked changes only: Agentia's own `.agentia/` folder is untracked and allowed. */
export async function trackedChanges(cwd: string): Promise<string[]> {
  const r = await git(cwd, ['status', '--porcelain', '--untracked-files=no'])
  return r.stdout ? r.stdout.split('\n') : []
}

export async function remoteUrl(cwd: string, remote = 'origin'): Promise<string | undefined> {
  const r = await git(cwd, ['remote', 'get-url', remote])
  return r.ok ? r.stdout : undefined
}

/** `owner/repo` from https or ssh GitHub-style URLs, for comparing a clone with Copado's repository record. */
export function repoSlug(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)
  return m?.[1]?.toLowerCase()
}
