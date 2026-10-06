import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {Copado} from '../agentia/index.js'
import type {MutantConfig} from '../config.js'
import {unifiedDiff} from '../diff.js'
import type {RunResults} from '../report/model.js'
import {
  buildHealPrompt,
  extractProposal,
  mergeIntoSuite,
  ProposalError,
  type ProposedTest,
  proposalFile,
} from './robot.js'

export interface HealProposal {
  mutantId: string
  description: string
  /** Snippet the user reviews and may edit, relative to the heal directory. */
  file?: string
  testNames: string[]
  status: 'proposed' | 'failed'
  error?: string
  dialogueId?: string
}

export interface HealState {
  version: 1
  runId: string
  createdAt: string
  /** Remote CRT suite file the tests are added to. */
  suiteFile: string
  /** sha256 of the remote suite the proposals were written against. */
  baseSuiteSha256: string
  proposals: HealProposal[]
  applied?: {at: string; testNames: string[]; suiteSha256: string; planFile?: string}
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const slug = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

export function healDir(runDir: string): string {
  return path.join(runDir, 'heal')
}

export function loadHealState(runDir: string): HealState | undefined {
  const f = path.join(healDir(runDir), 'heal.json')
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as HealState) : undefined
}

function saveHealState(runDir: string, state: HealState) {
  fs.mkdirSync(healDir(runDir), {recursive: true})
  fs.writeFileSync(path.join(healDir(runDir), 'heal.json'), JSON.stringify(state, null, 2) + '\n')
}

/** Downloads every .robot file of the CRT job and picks the one holding the test cases. */
export async function fetchSuite(
  copado: Copado,
  config: MutantConfig,
  outDir: string,
): Promise<{file: string; text: string}> {
  const files = (await copado.crtJobFiles(config.crt.projectId, config.crt.jobId))
    .map((f) => f.path)
    .filter((p) => p.endsWith('.robot'))
  if (!files.length) throw new Error('The Robotic Testing job has no .robot files.')
  fs.mkdirSync(outDir, {recursive: true})
  const downloaded = await copado.crtDownload(config.crt.projectId, config.crt.jobId, files, outDir)
  const scored = downloaded
    .map((f) => ({file: f.path, text: f.value ?? fs.readFileSync(path.join(outDir, f.path), 'utf8')}))
    .map((f) => ({
      ...f,
      tests: /\*{3}\s*Test Cases?\s*\*{3}/i.test(f.text)
        ? f.text.split('\n').filter((l) => /^\S/.test(l)).length
        : -1,
    }))
    .sort((a, b) => b.tests - a.tests || a.file.localeCompare(b.file))
  return {file: scored[0]!.file, text: scored[0]!.text}
}

export interface ProposeOptions {
  copado: Copado
  config: MutantConfig
  runDir: string
  results: RunResults
  /** Only these survivors (default: all). */
  only?: string[]
  onProgress?: (message: string) => void
}

/** Asks Copado AI (Test agent) for one test per survivor and saves the proposals for review. Writes nothing to Copado. */
export async function proposeHeals(o: ProposeOptions): Promise<HealState> {
  const dir = healDir(o.runDir)
  const survivors = o.results.mutants.filter(
    (m) => m.outcome === 'survived' && (!o.only?.length || o.only.includes(m.id)),
  )
  if (!survivors.length) throw new Error('This run has no survivors to heal.')
  const suite = await fetchSuite(o.copado, o.config, path.join(dir, 'suite-base'))
  const state: HealState = {
    version: 1,
    runId: o.results.runId,
    createdAt: new Date().toISOString(),
    suiteFile: suite.file,
    baseSuiteSha256: sha256(suite.text),
    proposals: [],
  }
  for (const [i, m] of survivors.entries()) {
    o.onProgress?.(`Asking Copado AI (Test agent) for a test that catches: ${m.description}`)
    const prompt = buildHealPrompt(m, suite.text)
    let proposal: ProposedTest | undefined
    let error: string | undefined
    let dialogueId: string | undefined
    for (let attempt = 1; attempt <= 2 && !proposal; attempt++) {
      try {
        const answer = await o.copado.aiAsk({prompt, agent: 'test', workspace: o.config.ai.workspaceId})
        dialogueId = answer.dialogueId ?? undefined
        fs.mkdirSync(dir, {recursive: true})
        fs.writeFileSync(
          path.join(dir, `${String(i + 1).padStart(2, '0')}-response.md`),
          answer.content ?? '',
        )
        proposal = extractProposal(answer.content ?? '')
        error = undefined
      } catch (e) {
        error = e instanceof ProposalError ? e.message : `Copado AI call failed: ${(e as Error).message}`
      }
    }
    if (!proposal) {
      state.proposals.push({
        mutantId: m.id,
        description: m.description,
        testNames: [],
        status: 'failed',
        error,
      })
      o.onProgress?.(`  ✘ no usable test: ${error}`)
      continue
    }
    const file = `${String(i + 1).padStart(2, '0')}-${slug(proposal.testNames[0]!)}.robot`
    fs.writeFileSync(
      path.join(dir, file),
      proposalFile(proposal, [
        `Proposed by Copado AI (Test agent) for mutant ${m.id}`,
        `Breakage: ${m.description}`,
        `A test should check: ${m.shouldCheck}`,
        'Review and edit this file, then run: agentia mutant heal --apply',
      ]),
    )
    state.proposals.push({
      mutantId: m.id,
      description: m.description,
      file,
      testNames: proposal.testNames,
      status: 'proposed',
      dialogueId,
    })
    o.onProgress?.(`  ✔ proposed “${proposal.testNames.join('”, “')}” → heal/${file}`)
  }
  // Preview of the merged suite, so the reviewer sees exactly what --apply would upload.
  const accepted = state.proposals.filter((p) => p.status === 'proposed')
  const merged = mergeIntoSuite(
    suite.text,
    accepted.map((p) => readProposal(dir, p)),
  )
  fs.writeFileSync(path.join(dir, 'suite.robot'), merged.suite)
  fs.writeFileSync(path.join(dir, 'suite.diff'), unifiedDiff(suite.text, merged.suite, suite.file))
  saveHealState(o.runDir, state)
  return state
}

/** Re-reads a proposal file (the user may have edited it after review). */
export function readProposal(dir: string, p: HealProposal): ProposedTest {
  return extractProposal(
    '```robot\n' + fs.readFileSync(path.join(dir, p.file!), 'utf8').replace(/^#.*$/gm, '') + '\n```',
  )
}

export interface ApplyPlan {
  state: HealState
  /** Current remote suite and the suite --apply would upload. */
  remote: {file: string; text: string}
  merged: string
  added: string[]
  diff: string
  remoteChanged: boolean
}

/**
 * Prepares --apply: merges the (possibly edited) proposals into the CURRENT remote suite. Read-only.
 * With `reapply`, replaces what Mutant uploaded earlier by merging into the original suite instead,
 * but only if nobody changed the suite in Robotic Testing since.
 */
export async function prepareApply(
  copado: Copado,
  config: MutantConfig,
  runDir: string,
  reapply = false,
): Promise<ApplyPlan> {
  const state = loadHealState(runDir)
  if (!state) throw new Error('No healing proposals for this run. Run `agentia mutant heal` first.')
  if (state.applied && !reapply) {
    throw new Error(
      `These proposals were already applied at ${state.applied.at}. Use --force to re-apply edited proposals.`,
    )
  }
  const dir = healDir(runDir)
  const accepted = state.proposals.filter(
    (p) => p.status === 'proposed' && p.file && fs.existsSync(path.join(dir, p.file)),
  )
  if (!accepted.length) throw new Error('No usable proposals to apply.')
  const remote = await fetchSuite(copado, config, path.join(dir, 'suite-current'))
  let base = remote.text
  if (state.applied) {
    if (sha256(remote.text) !== state.applied.suiteSha256) {
      throw new Error(
        'The suite changed in Robotic Testing since Mutant uploaded it; refusing to overwrite. Edit it there instead.',
      )
    }
    base = fs.readFileSync(path.join(dir, 'suite-base', state.suiteFile), 'utf8')
  }
  const merged = mergeIntoSuite(
    base,
    accepted.map((p) => readProposal(dir, p)),
  )
  return {
    state,
    remote,
    merged: merged.suite,
    added: merged.added,
    diff: unifiedDiff(remote.text, merged.suite, remote.file),
    remoteChanged: !state.applied && sha256(remote.text) !== state.baseSuiteSha256,
  }
}

/** Uploads the merged suite to the CRT job (replacing the suite file) and records it. */
export async function applyHeals(
  copado: Copado,
  config: MutantConfig,
  runDir: string,
  plan: ApplyPlan,
): Promise<HealState> {
  const dir = healDir(runDir)
  const local = path.join(dir, 'suite.robot')
  fs.writeFileSync(local, plan.merged)
  await copado.crtReplace(
    config.crt.projectId,
    config.crt.jobId,
    local,
    plan.remote.file,
    `Mutant heal (${plan.state.runId}): add ${plan.added.length} test(s) for survivors`,
  )
  plan.state.applied = {at: new Date().toISOString(), testNames: plan.added, suiteSha256: sha256(plan.merged)}
  saveHealState(runDir, plan.state)
  return plan.state
}

export function recordHealPlan(runDir: string, planFile: string) {
  const state = loadHealState(runDir)
  if (state?.applied) {
    state.applied.planFile = planFile
    saveHealState(runDir, state)
  }
}
