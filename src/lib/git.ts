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

export type BranchSync =
  | {status: 'in-sync' | 'no-remote-branch'}
  | {status: 'reset'; dropped: string[]}
  | {status: 'foreign'; commits: string[]}

/**
 * `work publish` merges the story into the local copy of the source environment's branch and pushes
 * it. When that push fails (e.g. GitHub answers 500), the merge stays behind locally, and the next
 * publish tries to replay it on top of the remote branch and stops on a conflict. Drop such leftovers
 * when they are only Mutant's own commits; report anything else so a human decides.
 */
export async function syncBranchWithRemote(
  cwd: string,
  branch: string,
  isOurs: (subject: string) => boolean,
): Promise<BranchSync> {
  await git(cwd, ['fetch', '-q', 'origin', branch])
  if (!(await git(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`])).ok)
    return {status: 'no-remote-branch'}
  if (!(await git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])).ok)
    return {status: 'in-sync'}
  const log = await git(cwd, ['log', '--no-merges', '--format=%s', `origin/${branch}..${branch}`])
  const ahead = await git(cwd, ['rev-list', '--count', `origin/${branch}..${branch}`])
  if (ahead.stdout === '0') return {status: 'in-sync'}
  const commits = log.stdout ? log.stdout.split('\n') : []
  if (commits.some((s) => !isOurs(s))) return {status: 'foreign', commits}
  const current = await git(cwd, ['branch', '--show-current'])
  await git(
    cwd,
    current.stdout === branch
      ? ['reset', '-q', '--hard', `origin/${branch}`]
      : ['branch', '-f', branch, `origin/${branch}`],
  )
  return {status: 'reset', dropped: commits}
}
