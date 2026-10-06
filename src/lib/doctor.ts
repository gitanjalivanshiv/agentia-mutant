import fs from 'node:fs'

import {AgentiaError, type AuthCredential, type Copado} from './agentia/index.js'
import {labNameProblem, type MutantConfig, resolveFromRoot} from './config.js'
import {isGitRepo, remoteUrl, repoSlug, trackedChanges} from './git.js'
import {type LabContext, resolveLab} from './lab.js'
import {checkDrift} from './drift.js'
import {readLock} from './lock.js'
import {listComponents} from './metadata.js'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface CheckResult {
  id: string
  title: string
  status: CheckStatus
  detail: string
  /** What the user should do about a warn/fail. */
  fix?: string
}

export interface DoctorReport {
  ok: boolean
  checks: CheckResult[]
  summary: Record<CheckStatus, number>
}

export interface DoctorOptions {
  root: string
  config?: MutantConfig
  configError?: string
  copado: Copado
  iKnowThisIsALab?: boolean
  skipDrift?: boolean
  nodeVersion?: string
}

const errorText = (e: unknown) => (e instanceof AgentiaError || e instanceof Error ? e.message : String(e))

/**
 * Readiness + safety checks (brief §7). Never writes to the org. Each check is independent
 * where possible so one failure still shows the full picture.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: CheckResult[] = []
  const add = (c: CheckResult) => checks.push(c)
  const {config, copado, root} = options

  // 1. Node
  const nodeVersion = options.nodeVersion ?? process.versions.node
  const major = Number(nodeVersion.split('.')[0])
  add(
    major >= 20
      ? {id: 'node', title: 'Node.js', status: 'pass', detail: `v${nodeVersion}`}
      : {
          id: 'node',
          title: 'Node.js',
          status: 'fail',
          detail: `v${nodeVersion}`,
          fix: 'Install Node.js 20 or newer.',
        },
  )

  // 2. Config
  if (!config) {
    add({
      id: 'config',
      title: 'Mutant config',
      status: 'fail',
      detail: options.configError ?? 'Missing',
      fix: 'Run `agentia mutant init`.',
    })
    return finish(checks)
  }
  add({
    id: 'config',
    title: 'Mutant config',
    status: 'pass',
    detail: `lab ${config.labEnvironment} ← ${config.sourceEnvironment}`,
  })

  // 3. Lab name safety
  const nameProblem = labNameProblem(config, options.iKnowThisIsALab)
  add(
    nameProblem
      ? {
          id: 'lab-name',
          title: 'Lab name safety',
          status: 'fail',
          detail: nameProblem,
          fix: 'Point labEnvironment at a disposable lab.',
        }
      : {
          id: 'lab-name',
          title: 'Lab name safety',
          status: 'pass',
          detail: `"${config.labEnvironment}" is not protected`,
        },
  )

  // 4. Auth (one call covers all three)
  let creds: AuthCredential[] = []
  try {
    creds = await copado.auth()
  } catch (e) {
    add({
      id: 'agentia',
      title: 'Agentia CLI',
      status: 'fail',
      detail: errorText(e),
      fix: 'Install the Agentia CLI and run `agentia setup`.',
    })
    return finish(checks)
  }
  const cred = (t: AuthCredential['type']) => creds.find((c) => c.type === t)
  const cicd = cred('cicd')
  const crt = cred('crt')
  const ai = cred('ai')

  // 5. CI/CD auth + lab resolution
  let lab: LabContext | undefined
  if (!cicd?.set) {
    add({
      id: 'cicd-auth',
      title: 'Copado CI/CD auth',
      status: 'fail',
      detail: 'Not configured',
      fix: 'Run `agentia setup` in this folder.',
    })
  } else {
    try {
      lab = await resolveLab(copado, config)
      add({
        id: 'cicd-auth',
        title: 'Copado CI/CD auth',
        status: 'pass',
        detail: `configured (${cicd.source ?? 'unknown'} scope)`,
      })
      add({
        id: 'pipeline',
        title: 'Pipeline path',
        status: 'pass',
        detail: `${lab.pipeline.name}: ${lab.source.name} → ${lab.lab.name}`,
      })
    } catch (e) {
      const isAuth = e instanceof AgentiaError
      add({
        id: isAuth ? 'cicd-auth' : 'pipeline',
        title: isAuth ? 'Copado CI/CD auth' : 'Pipeline path',
        status: 'fail',
        detail: errorText(e),
        fix: isAuth
          ? 'Check `agentia auth get --cicd`.'
          : 'Fix sourceEnvironment/labEnvironment/pipeline in .mutant/config.json.',
      })
    }
  }

  // 6. Lab org credential
  if (lab) {
    try {
      // Copado retries read-only calls itself (the gateway sometimes answers "Unauthorized" spuriously).
      const valid = await copado.environmentAuthStatus(lab.lab.id, lab.labOrg.credentialId)
      add(
        valid
          ? {
              id: 'lab-auth',
              title: 'Lab org credential',
              status: 'pass',
              detail: `${lab.lab.name} credential validated`,
            }
          : {
              id: 'lab-auth',
              title: 'Lab org credential',
              status: 'fail',
              detail: `${lab.lab.name} credential is not valid`,
              fix: `Re-authenticate it: \`agentia cicd environment auth web login <id>\`.`,
            },
      )
    } catch (e) {
      add({id: 'lab-auth', title: 'Lab org credential', status: 'fail', detail: errorText(e)})
    }
  } else {
    add({id: 'lab-auth', title: 'Lab org credential', status: 'skip', detail: 'Lab not resolved'})
  }

  // 7. CRT
  if (!crt?.ready) {
    add({
      id: 'crt-auth',
      title: 'Robotic Testing auth',
      status: 'fail',
      detail: crt?.set ? 'Set but not ready' : 'Not configured',
      fix: 'Run `agentia auth set --crt <key> --crt-org <org> --crt-domain <domain> --local` in this folder.',
    })
  } else {
    try {
      const job = await copado.crtJob(config.crt.projectId, config.crt.jobId)
      add({
        id: 'crt-auth',
        title: 'Robotic Testing auth',
        status: 'pass',
        detail: `ready (${crt.source ?? 'unknown'} scope${crt.domain ? `, ${crt.domain}` : ''})`,
      })
      add({id: 'crt-job', title: 'Robotic Testing job', status: 'pass', detail: `"${job.name}"`})
    } catch (e) {
      add({
        id: 'crt-auth',
        title: 'Robotic Testing auth',
        status: 'pass',
        detail: `ready (${crt.source ?? 'unknown'} scope)`,
      })
      add({
        id: 'crt-job',
        title: 'Robotic Testing job',
        status: 'fail',
        detail: errorText(e),
        fix: 'Check crt.projectId/jobId in .mutant/config.json. CRT auth is folder-scoped: run Mutant from the project folder.',
      })
    }
  }

  // 8. Copado AI (needed only by `mutant heal`: warn, don't fail)
  if (!ai?.set) {
    add({
      id: 'ai',
      title: 'Copado AI',
      status: 'warn',
      detail: 'Not configured; `mutant heal` will not work',
      fix: 'Run `agentia setup`.',
    })
  } else {
    try {
      const quota = await copado.aiQuota()
      let detail = `quota ${quota.usage}/${quota.limit}`
      let status: CheckStatus = quota.usage < quota.limit ? 'pass' : 'warn'
      if (config.ai.workspaceId) {
        const found = (await copado.aiWorkspaces()).find((w) => w.id === config.ai.workspaceId)
        if (found) detail += `, workspace "${found.name}"`
        else {
          status = 'warn'
          detail += ', configured workspace not found'
        }
      }
      add({id: 'ai', title: 'Copado AI', status, detail})
    } catch (e) {
      add({id: 'ai', title: 'Copado AI', status: 'warn', detail: errorText(e)})
    }
  }

  // 9. Lab repository clone
  const repoPath = resolveFromRoot(root, config.labRepoPath)
  if (!fs.existsSync(repoPath) || !(await isGitRepo(repoPath))) {
    add({
      id: 'lab-repo',
      title: 'Lab repository clone',
      status: 'fail',
      detail: `${repoPath} is not a git clone`,
      fix: "Clone the pipeline's Git repository there.",
    })
  } else {
    const problems: string[] = []
    const dirty = await trackedChanges(repoPath)
    if (dirty.length) problems.push(`${dirty.length} uncommitted tracked change(s)`)
    if (lab?.pipeline.gitRepositoryId) {
      try {
        const repo = await copado.repository(lab.pipeline.gitRepositoryId)
        const want = repoSlug(repo.uri)
        const have = repoSlug(await remoteUrl(repoPath))
        if (want && have && want !== have) problems.push(`origin is ${have}, pipeline uses ${want}`)
      } catch {
        /* repository lookup is best-effort */
      }
    }
    add(
      problems.length
        ? {
            id: 'lab-repo',
            title: 'Lab repository clone',
            status: 'fail',
            detail: problems.join('; '),
            fix: 'Commit or discard changes in the lab clone and make sure it clones the pipeline repo.',
          }
        : {id: 'lab-repo', title: 'Lab repository clone', status: 'pass', detail: repoPath},
    )
  }

  // 10. Lock file
  const lock = readLock(config.lockFile)
  add(
    !lock.held
      ? {id: 'lock', title: 'Org lock', status: 'pass', detail: 'free'}
      : {
          id: 'lock',
          title: 'Org lock',
          status: 'warn',
          detail: `held: ${lock.content}`,
          fix: lock.ownedByMutant
            ? 'A Mutant run may have crashed. Check the lab, then `agentia mutant run --resume` or delete the lock file.'
            : 'Another tool is writing to the org. Wait for it to finish.',
        },
  )

  // 11. Baseline drift: is the lab exactly the baseline?
  const packageDir = resolveFromRoot(root, config.packageDirectory)
  const components = listComponents(packageDir)
  if (options.skipDrift) {
    add({id: 'drift', title: 'Lab matches baseline', status: 'skip', detail: 'Skipped (--skip-drift)'})
  } else if (!lab) {
    add({id: 'drift', title: 'Lab matches baseline', status: 'skip', detail: 'Lab not resolved'})
  } else if (components.length === 0) {
    add({
      id: 'drift',
      title: 'Lab matches baseline',
      status: 'fail',
      detail: `No supported metadata found in ${packageDir}`,
      fix: 'Point packageDirectory at a Source Format package directory.',
    })
  } else {
    const {drifted, unreadable: errors} = await checkDrift(copado, lab.labOrg, packageDir, components)
    if (drifted.length || errors.length) {
      add({
        id: 'drift',
        title: 'Lab matches baseline',
        status: 'fail',
        detail: [...drifted.map((d) => `drifted: ${d}`), ...errors.map((e) => `unreadable: ${e}`)].join('; '),
        fix: 'Restore the lab (examples/demo/reset.sh) before running mutants: kills are only meaningful against the baseline.',
      })
    } else {
      add({
        id: 'drift',
        title: 'Lab matches baseline',
        status: 'pass',
        detail: `${components.length} component(s) identical in ${lab.lab.name}`,
      })
    }
  }

  return finish(checks)
}

function finish(checks: CheckResult[]): DoctorReport {
  const summary: Record<CheckStatus, number> = {pass: 0, warn: 0, fail: 0, skip: 0}
  for (const c of checks) summary[c.status] += 1
  return {ok: summary.fail === 0, checks, summary}
}
