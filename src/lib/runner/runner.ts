import fs from 'node:fs'
import path from 'node:path'

import {AgentiaError, type Copado, type PromotionDetail, type PromotionRunResult} from '../agentia/index.js'
import type {MutantConfig} from '../config.js'
import {git, trackedChanges} from '../git.js'
import type {LabContext} from '../lab.js'
import {matchesBaseline, driftSummary, listComponents} from '../metadata.js'
import {classify, computeScore, judgeBaseline, parseXunit} from './classify.js'
import type {RunStore} from './run-store.js'
import type {DeployUnit, MutantResult, RunState, TestRunRecord} from './types.js'

export interface RunnerIO {
  /** Section headings and progress lines. */
  info(message: string): void
  /** A finished mutant, for the live progress line. */
  mutant(result: MutantResult, index: number, total: number): void
  warn(message: string): void
  /** Shown once when the run needs the user to create promotions. */
  promotionsNeeded(units: DeployUnit[], lab: LabContext): void
}

export interface RunnerDeps {
  copado: Copado
  lab: LabContext
  config: MutantConfig
  packageDir: string
  labRepo: string
  store: RunStore
  io: RunnerIO
  baselineRuns: 1 | 2
  /** How long to wait for the user to create promotions before pausing the run. */
  promotionWaitMs: number
  pollMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Set to true (e.g. on Ctrl-C) to stop testing mutants and go straight to the revert. */
  shouldStop?: () => boolean
  /** Copado project of the source environment's stories. */
  projectId: string
}

export type RunOutcome = 'done' | 'failed' | 'awaiting-promotions'

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class Runner {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly pollMs: number

  constructor(
    private readonly state: RunState,
    private readonly deps: RunnerDeps,
  ) {
    this.sleep = deps.sleep ?? sleepReal
    this.now = deps.now ?? Date.now
    this.pollMs = deps.pollMs ?? 15_000
  }

  private save() {
    this.deps.store.save(this.state)
  }

  private fail(reason: string): RunOutcome {
    this.state.phase = 'failed'
    this.state.failure = reason
    this.finish()
    return 'failed'
  }

  private finish() {
    this.state.finishedAt = new Date(this.now()).toISOString()
    this.state.score = computeScore(this.state.mutants)
    this.save()
    this.deps.store.writeResults(this.state)
  }

  /** Runs (or resumes) every phase. The final revert always runs once any mutant was deployed. */
  async run(): Promise<RunOutcome> {
    const s = this.state
    if (s.phase === 'created' || s.phase === 'baseline') {
      const ok = await this.baseline()
      if (!ok) return 'failed'
    }
    if (s.phase === 'prepare') {
      const ok = await this.prepare()
      if (!ok) return 'failed'
    }
    if (s.phase === 'awaiting-promotions') {
      const complete = await this.awaitPromotions()
      if (!complete) return 'awaiting-promotions'
    }
    let interruption: string | undefined
    if (s.phase === 'mutants') {
      try {
        await this.mutants()
      } catch (error) {
        interruption = `Interrupted while testing mutants: ${(error as Error).message}`
        this.deps.io.warn(`${interruption}. Reverting the lab now.`)
      }
      if (this.deps.shouldStop?.()) interruption ??= 'Stopped by the user.'
      s.phase = 'revert'
      this.save()
    }
    if (s.phase === 'revert') {
      const ok = await this.revert()
      if (!ok) return this.fail(this.recovery('The final revert deploy failed.'))
    }
    if (s.phase === 'verify') {
      const ok = await this.verify()
      if (!ok)
        return this.fail(
          this.recovery(`The lab does not match the baseline: ${s.verify?.drifted.join('; ')}`),
        )
    }
    if (interruption)
      return this.fail(interruption + ' The lab was reverted and verified; unfinished mutants are unscored.')
    s.phase = 'done'
    this.finish()
    return 'done'
  }

  // ---- 1. Baseline -------------------------------------------------------------------------

  private async baseline(): Promise<boolean> {
    const s = this.state
    s.phase = 'baseline'
    this.save()
    this.deps.io.info(
      `Baseline: running the test suite on the clean lab${this.deps.baselineRuns === 2 ? ' (twice, to detect flaky tests)' : ''}`,
    )
    const runs: TestRunRecord[] = []
    for (let i = 0; i < this.deps.baselineRuns; i++) runs.push(await this.runTests(`baseline-${i + 1}`))
    const verdict = judgeBaseline(runs)
    s.baseline = {runs, flaky: verdict.flaky, passing: verdict.passing}
    if (!verdict.ok) {
      this.fail(
        `${verdict.reason} Fix the suite or the lab before mutating: kills are only meaningful against green tests.`,
      )
      return false
    }
    if (verdict.flaky.length) this.deps.io.warn(`Flaky tests excluded: ${verdict.flaky.join('; ')}`)
    this.deps.io.info(`Baseline green: ${verdict.passing.length} test(s) pass.`)
    s.phase = 'prepare'
    this.save()
    return true
  }

  // ---- 2. Prepare stories ------------------------------------------------------------------

  private async prepare(): Promise<boolean> {
    const {copado, lab, labRepo, config, io} = this.deps
    const sourceCredentialId = lab.source.credentials?.[0]?.id
    if (!sourceCredentialId)
      return this.failed(`Source environment ${lab.source.name} has no credential in Copado.`)
    io.info(
      `Preparing ${this.state.units.length} Copado user stories from ${lab.source.name} (one per deploy)`,
    )
    for (const unit of this.state.units) {
      if (!unit.story) {
        const item = await copado.workCreate({
          title: unit.title,
          projectId: this.deps.projectId,
          sourceCredentialId,
        })
        if (item.sourceEnvironmentName && item.sourceEnvironmentName !== lab.source.name) {
          return this.failed(
            `Story ${item.name} was created in ${item.sourceEnvironmentName}, not ${lab.source.name}.`,
          )
        }
        unit.story = {id: item.id, name: item.name}
        this.save()
      }
      if (!unit.commitJobId) {
        // Leftovers from an interrupted attempt at this unit (doctor confirmed a clean clone at start,
        // so any tracked change here is Mutant's own uncommitted work).
        if ((await trackedChanges(labRepo)).length) await git(labRepo, ['reset', '-q', '--hard', 'HEAD'])
        await copado.workSet(unit.story.name, labRepo)
        for (const [file, content] of Object.entries(unit.files)) {
          const target = path.join(labRepo, config.labPackageDirectory, file)
          fs.mkdirSync(path.dirname(target), {recursive: true})
          fs.writeFileSync(target, content)
        }
        await git(labRepo, ['add', '--', config.labPackageDirectory])
        const staged = await git(labRepo, ['diff', '--cached', '--name-only'])
        const expected = Object.keys(unit.files).length
        const stagedCount = staged.stdout ? staged.stdout.split('\n').length : 0
        if (stagedCount < expected) {
          // A file identical to the story's base branch would not be committed, so Copado would not
          // deploy it. Fail now, before anything has been deployed, and drop our staged files.
          await git(labRepo, ['reset', '-q', '--hard', 'HEAD'])
          return this.failed(
            stagedCount === 0
              ? `${unit.story.name}: nothing to commit (the base branch already has this content).`
              : `${unit.story.name}: only ${stagedCount} of ${expected} files differ from the base branch, so Copado would not deploy them all.`,
          )
        }
        const commit = await git(labRepo, ['commit', '-q', '-m', `${unit.story.name} ${unit.title}`])
        if (!commit.ok) return this.failed(`git commit failed in the lab clone for ${unit.story.name}.`)
        const permsets = unit.components.filter((c) => c.startsWith('PermissionSet:'))
        const published = await copado.workPublish(labRepo, permsets)
        if (!published.push?.jobId)
          return this.failed(`Publishing ${unit.story.name} returned no commit job.`)
        unit.commitJobId = published.push.jobId
        this.save()
        io.info(`  ${unit.story.name}  ${unit.title}`)
      }
    }
    // Commit jobs run asynchronously in Copado; wait for all of them together.
    for (const unit of this.state.units) {
      if (unit.committed) continue
      const status = await this.waitForJob(unit.commitJobId!, 10 * 60_000)
      if (status !== 'Successful')
        return this.failed(`Copado commit job for ${unit.story!.name} ended ${status}.`)
      unit.committed = true
      this.save()
    }
    await copado.workSetNone(labRepo).catch(() => undefined)
    this.state.phase = 'awaiting-promotions'
    this.save()
    return true
  }

  private failed(reason: string): false {
    this.fail(reason)
    return false
  }

  private async waitForJob(id: string, timeoutMs: number): Promise<string> {
    const deadline = this.now() + timeoutMs
    for (;;) {
      const job = await this.deps.copado.job(id)
      const status = job.status ?? 'Unknown'
      if (!/^(Queued|In Progress|Not Started|Pending|Unknown)$/i.test(status)) return status
      if (this.now() > deadline) return 'Timed out'
      await this.sleep(10_000)
    }
  }

  // ---- 3. Promotions (created by the user in one sitting, decision A) ----------------------

  private async awaitPromotions(): Promise<boolean> {
    const {copado, lab, io} = this.deps
    const missing = () => this.state.units.filter((u) => !u.promotion)
    if (missing().length) io.promotionsNeeded(missing(), lab)
    const deadline = this.now() + this.deps.promotionWaitMs
    const inspected = new Set<string>()
    while (missing().length) {
      let drafts: Awaited<ReturnType<typeof copado.promotions>> = []
      try {
        drafts = await copado.promotions({
          source: lab.source.name,
          destination: lab.lab.name,
          status: 'Draft',
        })
      } catch (error) {
        // Waiting on a human can take a while; ride out network blips and gateway hiccups.
        if (!isTransient(error)) throw error
        io.warn(`Could not reach Copado (${(error as Error).message}); retrying.`)
      }
      for (const p of drafts) {
        if (inspected.has(p.id) || this.state.units.some((u) => u.promotion?.id === p.id)) continue
        let detail: PromotionDetail
        try {
          detail = await copado.promotion(p.id)
        } catch (error) {
          io.warn(`Could not read promotion ${p.name}: ${(error as Error).message}`)
          continue
        }
        const names = (detail.userStories ?? []).map((u) => u.name)
        const unit = this.state.units.find((u) => u.story && names.includes(u.story.name))
        if (!unit) {
          inspected.add(p.id) // someone else's promotion
          continue
        }
        if (names.length !== 1) {
          io.warn(
            `${detail.name} contains ${names.length} stories (${names.join(', ')}). Create one promotion per story.`,
          )
          continue
        }
        // `promotion get` returns a 15-char ID; `promotion run` needs the 18-char ID from `promotion list`.
        unit.promotion = {id: p.id, name: detail.name}
        inspected.add(p.id)
        this.save()
        io.info(
          `  ✔ ${detail.name} → ${unit.story!.name}  (${this.state.units.length - missing().length}/${this.state.units.length})`,
        )
      }
      if (!missing().length) break
      if (this.now() >= deadline) {
        this.save()
        return false
      }
      await this.sleep(this.pollMs)
    }
    this.state.phase = 'mutants'
    this.save()
    return true
  }

  // ---- 4. Mutants --------------------------------------------------------------------------

  private async mutants() {
    const {io, config} = this.deps
    const units = this.state.units.filter((u) => u.mutantId)
    io.info(`Testing ${units.length} mutant(s) in ${this.deps.lab.lab.name}`)
    for (const unit of units) {
      const result = this.state.mutants.find((m) => m.id === unit.mutantId)!
      if (result.outcome) continue
      if (this.deps.shouldStop?.()) return
      const budgetMs = config.budget.mutantTimeoutMinutes * 60_000
      const started = this.now()
      if (!unit.deploy) await this.deploy(unit, budgetMs / 1000)
      result.story = unit.story?.name
      result.promotion = unit.promotion?.name
      result.durations = {deploySeconds: unit.deploy!.seconds}
      if (unit.deploy!.ok && !result.test) {
        const remainingMin = Math.max(1, (budgetMs - (this.now() - started)) / 60_000)
        result.test = await this.runTests(`mutant-${unit.index + 1}`, remainingMin)
        result.durations.testSeconds = result.test.seconds
      }
      const total = (result.durations.deploySeconds ?? 0) + (result.durations.testSeconds ?? 0)
      const verdict = classify({
        deploy: unit.deploy!,
        test: result.test,
        passingAtBaseline: this.state.baseline?.passing ?? [],
        overBudget: total * 1000 > budgetMs,
      })
      result.outcome = verdict.outcome
      if (verdict.killedBy) result.killedBy = verdict.killedBy
      if (verdict.reason) result.reason = verdict.reason
      this.save()
      io.mutant(result, units.indexOf(unit), units.length)
    }
  }

  /** Runs the unit's promotion with deploy, after re-checking it is still a safe source → lab promotion. */
  private async deploy(unit: DeployUnit, waitSeconds: number) {
    const {copado, lab} = this.deps
    const started = this.now()
    const detail = await copado.promotion(unit.promotion!.id)
    const problem = unsafePromotion(detail, unit, lab)
    if (problem) throw new Error(`Refusing to run ${detail.name}: ${problem}`)
    try {
      const r = await copado.promotionRunDeploy(unit.promotion!.id, waitSeconds)
      const jobs = r.jobMonitors ?? []
      const ok = jobs.length > 0 && jobs.every((j) => j.jobExecutionStatus === 'Successful')
      unit.deploy = {
        ok,
        started: true,
        seconds: Math.round((this.now() - started) / 1000),
        jobIds: jobs.map((j) => j.jobExecutionId ?? '').filter(Boolean),
        ...(ok
          ? {}
          : {
              message: `Deploy job(s) ended ${jobs.map((j) => j.jobExecutionStatus).join(', ') || 'without a status'}`,
            }),
      }
    } catch (error) {
      const message = error instanceof AgentiaError ? error.message : String(error)
      // A failed or timed-out deploy job makes the CLI exit non-zero but still report its jobs.
      const result =
        error instanceof AgentiaError ? (error.details.result as PromotionRunResult | undefined) : undefined
      const jobs = result?.jobMonitors ?? []
      const timedOut = /timed? ?out/i.test(message)
      // The CLI reports failed deploy jobs as an error envelope too: "Promotion job <id> finished with status Error: …".
      const jobRan = /\bjob\s+\S+\s+finished with status/i.test(message)
      unit.deploy = {
        ok: false,
        seconds: Math.round((this.now() - started) / 1000),
        jobIds: jobs.map((j) => j.jobExecutionId ?? '').filter(Boolean),
        message,
        // No job means Copado never started a deploy (e.g. the CLI rejected the request).
        started: jobs.length > 0 || timedOut || jobRan,
        ...(timedOut ? {timedOut: true} : {}),
      }
    }
    this.save()
  }

  private async runTests(
    label: string,
    timeoutMinutes = this.deps.config.budget.mutantTimeoutMinutes,
  ): Promise<TestRunRecord> {
    const {copado, config, store} = this.deps
    const dir = store.path('artifacts', label)
    fs.mkdirSync(dir, {recursive: true})
    const out = {archive: path.join(dir, 'artifacts.zip'), xunit: path.join(dir, 'xunit.xml')}
    const started = this.now()
    try {
      const r = await copado.crtRun(config.crt.projectId, config.crt.jobId, out, timeoutMinutes)
      const seconds = Math.round((this.now() - started) / 1000)
      const tests = fs.existsSync(out.xunit) ? parseXunit(fs.readFileSync(out.xunit, 'utf8')) : []
      return {
        buildId: r.finalBuild?.id ?? undefined,
        status: r.finalBuild?.status ?? undefined,
        seconds,
        tests,
        artifacts: {
          ...(fs.existsSync(out.archive) ? {archive: store.rel(out.archive)} : {}),
          ...(fs.existsSync(out.xunit) ? {xunit: store.rel(out.xunit)} : {}),
        },
        ...(tests.length
          ? {}
          : {error: `Test run ${r.finalBuild?.status ?? 'ended'} without an xUnit report.`}),
      }
    } catch (error) {
      return {
        seconds: Math.round((this.now() - started) / 1000),
        tests: [],
        artifacts: {},
        error: (error as Error).message,
      }
    }
  }

  // ---- 5. Revert + verify ------------------------------------------------------------------

  private async revert(): Promise<boolean> {
    const s = this.state
    const final = s.units[s.units.length - 1]
    const anyDeployed = s.units.some((u) => u.deploy)
    if (!final || final.mutantId || !anyDeployed) {
      s.phase = 'verify'
      this.save()
      return true
    }
    if (!final.deploy?.ok) {
      this.deps.io.info(`Reverting ${this.deps.lab.lab.name} to the baseline (${final.promotion?.name})`)
      final.deploy = undefined
      try {
        await this.deploy(final, 30 * 60)
      } catch (error) {
        this.deps.io.warn((error as Error).message)
        return false
      }
      if (!final.deploy!.ok) return false
    }
    s.phase = 'verify'
    this.save()
    return true
  }

  private async verify(): Promise<boolean> {
    const s = this.state
    const touched = new Set(s.units.flatMap((u) => u.components))
    const components = listComponents(this.deps.packageDir).filter((c) =>
      touched.has(`${c.type}:${c.apiName}`),
    )
    this.deps.io.info(
      `Verifying ${components.length} component(s) in ${this.deps.lab.lab.name} match the baseline`,
    )
    const drifted: string[] = []
    const dir = this.deps.store.path('verify')
    fs.mkdirSync(dir, {recursive: true})
    for (const c of components) {
      const out = path.join(dir, `${c.type}-${c.apiName}.xml`.replace(/[^\w.-]+/g, '_'))
      try {
        await this.deps.copado.metadataContentGet(this.deps.lab.labOrg, c.type, c.apiName, out)
        const baseline = fs.readFileSync(path.join(this.deps.packageDir, c.file), 'utf8')
        const org = fs.readFileSync(out, 'utf8')
        if (!matchesBaseline(baseline, org))
          drifted.push(`${c.type} ${c.apiName} (${driftSummary(baseline, org).join(', ')})`)
      } catch (error) {
        drifted.push(`${c.type} ${c.apiName} (unreadable: ${(error as Error).message})`)
      }
    }
    s.verify = {ok: drifted.length === 0, drifted, checkedAt: new Date(this.now()).toISOString()}
    this.save()
    return s.verify.ok
  }

  /** Exact recovery steps for a failed revert or verification (brief §7). */
  recovery(reason: string): string {
    const final = this.state.units[this.state.units.length - 1]
    const lines = [
      reason,
      'The lab may still contain a mutant. To restore it:',
      final?.promotion
        ? `  1. Re-run the final revert promotion ${final.promotion.name}: agentia cicd promotion run ${final.promotion.id} --operation merge_and_deploy --json`
        : '  1. Create a promotion for the final revert story and run it with merge_and_deploy.',
      `  2. If that promotion is already Completed, create a new ${this.deps.lab.source.name} story that commits the baseline files from ${this.deps.config.packageDirectory}, promote it to ${this.deps.lab.lab.name}, and deploy.`,
      `  3. Confirm with: agentia mutant doctor`,
      `The org lock (${this.deps.config.lockFile}) has been released; nothing else will touch the lab.`,
    ]
    return lines.join('\n')
  }
}

/** Safety check before any deploy: only Draft, forward promotions source → lab containing exactly this unit's story. */
export function unsafePromotion(
  detail: PromotionDetail,
  unit: DeployUnit,
  lab: LabContext,
): string | undefined {
  if (detail.sourceEnvironmentName !== lab.source.name)
    return `source is ${detail.sourceEnvironmentName}, expected ${lab.source.name}`
  if (detail.destinationEnvironmentName !== lab.lab.name)
    return `destination is ${detail.destinationEnvironmentName}, expected ${lab.lab.name}`
  if (detail.isBackPromotion) return 'it is a back-promotion'
  const names = (detail.userStories ?? []).map((u) => u.name)
  if (names.length !== 1 || names[0] !== unit.story?.name)
    return `it contains ${names.join(', ') || 'no stories'}, expected only ${unit.story?.name}`
  if (detail.status && !/^(Draft|Merge Conflict|Failed|In Progress)$/i.test(detail.status)) {
    return `its status is ${detail.status}`
  }
  return undefined
}

/** Network failures and gateway 5xx/429 responses that are worth retrying while polling. */
export function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof AgentiaError ? error.details.statusCode : undefined
  return (
    /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network|fetch failed|timed? ?out/i.test(
      message,
    ) ||
    (status !== undefined && (status >= 500 || status === 429))
  )
}
