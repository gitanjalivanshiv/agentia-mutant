import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {lastChangedFromGit} from '../../lib/changes.js'
import {labNameProblem, loadConfig, resolveFromRoot} from '../../lib/config.js'
import {runDoctor} from '../../lib/doctor.js'
import {formatDuration} from '../../lib/estimate.js'
import {loadHistory} from '../../lib/history.js'
import {resolveLab, resolveProject} from '../../lib/lab.js'
import {acquireLock, readLock, releaseLock} from '../../lib/lock.js'
import {loadPlan, plansDir} from '../../lib/plan-file.js'
import {renderHtml} from '../../lib/report/html.js'
import {buildReportModel, loadResults} from '../../lib/report/model.js'
import {buildPlan, type Plan} from '../../lib/planner.js'
import {newRunId, RunStore} from '../../lib/runner/run-store.js'
import {Runner, type RunnerIO, type RunOutcome} from '../../lib/runner/runner.js'
import type {DeployUnit, RunState, Score} from '../../lib/runner/types.js'
import {buildUnits, initialResults, resolvePlanMutants} from '../../lib/runner/units.js'
import {selectOperators} from '../../operators/index.js'

interface RunCommandResult {
  runId?: string
  outcome: RunOutcome | 'dry-run'
  phase?: string
  score?: Score
  resultsFile?: string
  reportFile?: string
  failure?: string
  /** When paused for promotions: stories that still need one. */
  storiesAwaitingPromotion?: string[]
  units?: {title: string; components: string[]; files: string[]}[]
}

export default class MutantRun extends MutantCommand {
  static override summary = 'Run a mutation plan against the lab through Copado and score your tests'
  static override description = `Baseline → prepare one Copado user story per deploy → you create their promotions in Pipeline Manager in one sitting → for each mutant: promote + deploy to the lab, run the Robotic Testing suite, classify killed/survived → final revert → verify the lab matches the baseline.

Writes ONLY to the configured labEnvironment, holds the shared org lock while running, always reverts once anything was deployed, and saves state after every step so --resume can continue after a crash or a pause.`

  static override examples = [
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --plan .mutant/plans/latest.json',
    '<%= config.bin %> <%= command.id %> --resume r-20261006-142501',
    '<%= config.bin %> <%= command.id %> --yes --json',
  ]

  static override flags = {
    plan: Flags.string({
      description: 'Plan file from `agentia mutant plan` (default: make a fresh plan now)',
    }),
    resume: Flags.string({
      description: 'Resume a paused or crashed run by ID ("latest" for the most recent)',
    }),
    'dry-run': Flags.boolean({
      description: 'Show the stories and deploys this run would make; write nothing',
    }),
    yes: Flags.boolean({char: 'y', description: 'Do not ask for confirmation (required with --json)'}),
    'baseline-twice': Flags.boolean({description: 'Run the baseline twice and exclude flaky tests'}),
    'promotion-wait': Flags.integer({
      description: 'Minutes to wait for promotions to be created before pausing the run',
      default: 30,
      min: 0,
    }),
    'skip-drift': Flags.boolean({description: 'Skip the doctor baseline-drift check before starting'}),
    'i-know-this-is-a-lab': Flags.boolean({
      description: 'Accept a lab name that looks like prod/uat/staging',
    }),
  }

  private stop = false

  public async run(): Promise<RunCommandResult> {
    const {flags} = await this.parse(MutantRun)
    const loaded = loadConfig()
    if (!loaded.ok) this.error(loaded.error, {exit: 2})
    const {config, root} = loaded
    const nameProblem = labNameProblem(config, flags['i-know-this-is-a-lab'])
    if (nameProblem) this.error(nameProblem, {exit: 2})
    const copado = this.copado(root)
    const packageDir = resolveFromRoot(root, config.packageDirectory)
    const labRepo = resolveFromRoot(root, config.labRepoPath)

    // Resume or start
    let state: RunState
    let store: RunStore
    if (flags.resume) {
      const runId = flags.resume === 'latest' ? RunStore.latest(root) : flags.resume
      if (!runId || !RunStore.exists(root, runId))
        this.error(`No run "${flags.resume}" in .mutant/runs/.`, {exit: 2})
      store = new RunStore(root, runId)
      state = store.load()
      const nothingDeployed = state.units.every(
        (u) => !u.deploy || (u.deploy.started !== true && !u.deploy.jobIds.length),
      )
      if (state.phase === 'failed' && nothingDeployed && state.units.every((u) => u.committed)) {
        // A failed attempt that never started a deploy left the lab untouched: retry with the same
        // stories, re-matching their (still Draft) promotions.
        for (const u of state.units) {
          u.deploy = undefined
          u.promotion = undefined
        }
        state.mutants = state.mutants.map(
          ({id, operator, component, file, description, shouldCheck, diff}) => ({
            id,
            operator,
            component,
            file,
            description,
            shouldCheck,
            diff,
          }),
        )
        delete state.failure
        delete state.score
        delete state.verify
        delete state.finishedAt
        state.phase = 'awaiting-promotions'
        this.log(
          chalk.dim(
            'The failed attempt never started a deploy, so the lab is untouched: retrying with the same stories.',
          ),
        )
      } else if (state.phase === 'done' || state.phase === 'failed') {
        this.error(`Run ${runId} already finished (${state.phase}). Start a new run instead.`, {exit: 2})
      }
      this.log(chalk.bold(`Resuming ${runId}`) + chalk.dim(` from phase "${state.phase}"`))
    } else {
      this.log(
        chalk.bold('Agentia Mutant run') +
          chalk.dim(` · lab ${config.labEnvironment} ← ${config.sourceEnvironment}\n`),
      )
      const doctor = await runDoctor({
        root,
        config,
        copado,
        iKnowThisIsALab: flags['i-know-this-is-a-lab'],
        skipDrift: flags['skip-drift'],
      })
      const failures = doctor.checks.filter((c) => c.status === 'fail')
      if (failures.length) {
        this.error(
          `Not ready (agentia mutant doctor):\n${failures.map((f) => `  ✘ ${f.title}: ${f.detail}${f.fix ? `\n    → ${f.fix}` : ''}`).join('\n')}`,
          {exit: 1},
        )
      }
      this.log(chalk.green('✔ ') + `doctor: ${doctor.summary.pass} checks passed`)
      const plan = await this.loadOrBuildPlan(flags.plan, root, packageDir)
      const mutants = resolvePlanMutants(plan, packageDir)
      if (!mutants.length) this.error('The plan has no mutants.', {exit: 2})
      const runId = newRunId()
      const units = buildUnits(mutants, packageDir, runId, config.storyTitlePrefix)

      if (flags['dry-run']) return this.dryRun(plan, units)

      this.log(
        `\n${mutants.length} mutant(s), ${units.length} Copado promotions into ${chalk.bold(config.labEnvironment)}, ` +
          `estimated ~${formatDuration(plan.estimate.totalSeconds)}.`,
      )
      if (
        !(await this.confirm(
          flags.yes,
          `Deploy ${mutants.length} mutant(s) to ${config.labEnvironment} now?`,
        ))
      ) {
        this.log('Cancelled. Nothing was written.')
        return {outcome: 'dry-run'}
      }
      store = new RunStore(root, runId)
      const now = new Date().toISOString()
      state = {
        version: 1,
        runId,
        phase: 'created',
        createdAt: now,
        updatedAt: now,
        plan,
        lab: plan.lab,
        units,
        mutants: initialResults(mutants),
      }
      store.save(state)
    }

    // Lock: refuse if another tool holds it; take over our own lock on resume.
    const lock = readLock(config.lockFile)
    if (lock.held) {
      const ours = lock.ownedByMutant && lock.content?.includes(state.runId)
      if (!ours) {
        this.error(`The org is busy (${lock.path}):\n  ${lock.content}\nWait for it to finish, then retry.`, {
          exit: 1,
        })
      }
      releaseLock(config.lockFile)
    }
    acquireLock(config.lockFile, `run ${state.runId}`)
    const onSigint = () => {
      if (this.stop) return
      this.stop = true
      this.warn(
        'Stopping after the current step; the lab will be reverted and verified. Press Ctrl-C again only if you must.',
      )
    }
    process.on('SIGINT', onSigint)
    let outcome: RunOutcome
    try {
      const lab = await resolveLab(copado, config)
      const project = await resolveProject(copado, config, lab)
      const runner = new Runner(state, {
        copado,
        lab,
        config,
        packageDir,
        labRepo,
        store,
        io: this.io(),
        baselineRuns: flags['baseline-twice'] ? 2 : 1,
        promotionWaitMs: flags['promotion-wait'] * 60_000,
        shouldStop: () => this.stop,
        projectId: project.id,
      })
      outcome = await runner.run()
    } finally {
      process.off('SIGINT', onSigint)
      releaseLock(config.lockFile)
    }
    return this.summarize(state, store, outcome)
  }

  private async loadOrBuildPlan(file: string | undefined, root: string, packageDir: string): Promise<Plan> {
    if (file) return loadPlan(path.resolve(file))
    const loaded = loadConfig()
    if (!loaded.ok) throw new Error(loaded.error)
    const {config} = loaded
    const {operators} = selectOperators(config.operators.allow, config.operators.deny)
    this.log(
      chalk.dim(`No --plan given: planning now (${path.relative(root, plansDir(root))} keeps saved plans).`),
    )
    return buildPlan({
      packageDir,
      scope: {kind: 'all'},
      max: config.budget.maxMutants,
      operators,
      lab: {environment: config.labEnvironment, source: config.sourceEnvironment, pipeline: config.pipeline},
      history: loadHistory(root),
      lastChanged: await lastChangedFromGit(packageDir),
    })
  }

  private dryRun(plan: Plan, units: DeployUnit[]): RunCommandResult {
    this.log(chalk.bold('\nDry run: nothing will be written.\n'))
    this.log(`Baseline: run the Robotic Testing suite on ${plan.lab.environment}.`)
    this.log(
      `Then ${units.length} Copado user stories from ${plan.lab.source}, one promotion each into ${plan.lab.environment}:\n`,
    )
    for (const u of units) {
      this.log(`${chalk.cyan(String(u.index + 1).padStart(2))}  ${u.title}`)
      this.log(chalk.dim(`    writes ${Object.keys(u.files).length} file(s): ${u.components.join(', ')}`))
    }
    this.log(`\nFinally: verify ${plan.lab.environment} matches the baseline.`)
    return {
      outcome: 'dry-run',
      units: units.map((u) => ({title: u.title, components: u.components, files: Object.keys(u.files)})),
    }
  }

  private async confirm(yes: boolean, question: string): Promise<boolean> {
    if (yes) return true
    if (this.jsonEnabled() || !process.stdin.isTTY) {
      this.error('Refusing to write to the org without confirmation: pass --yes.', {exit: 2})
    }
    const rl = readline.createInterface({input: process.stdin, output: process.stdout})
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} (y/N) `)).trim())
    } finally {
      rl.close()
    }
  }

  private io(): RunnerIO {
    return {
      info: (m) => this.log(m),
      warn: (m) => this.warn(m),
      mutant: (r, i, total) => {
        const n = chalk.dim(`[${i + 1}/${total}]`)
        const line =
          r.outcome === 'killed'
            ? `${chalk.green('✔ killed')} by "${r.killedBy?.[0]?.name ?? 'a test'}"`
            : r.outcome === 'survived'
              ? chalk.red.bold('✘ survived')
              : r.outcome === 'invalid'
                ? chalk.yellow(`⚠ invalid (did not deploy: ${r.reason})`)
                : r.outcome === 'timeout'
                  ? chalk.yellow(`⏱ timeout (${r.reason})`)
                  : chalk.yellow(`! error (${r.reason})`)
        this.log(`${n} ${line}  ${chalk.dim(r.description)}`)
      },
      promotionsNeeded: (units, lab) => {
        this.log(
          `\n${chalk.bold.yellow('Action needed:')} create ${units.length} promotion(s) in Copado.\n` +
            `  Pipeline Manager → ${lab.pipeline.name} → ${lab.source.name} → ${lab.lab.name}\n` +
            `  For EACH story below: select it alone → Create Promotion (do not deploy; Mutant runs them in order).\n`,
        )
        for (const u of units) this.log(`    ${chalk.bold(u.story?.name ?? '?')}  ${chalk.dim(u.title)}`)
        this.log(chalk.dim('\n  Waiting for the promotions to appear (checking every 15 s)…'))
      },
    }
  }

  private summarize(state: RunState, store: RunStore, outcome: RunOutcome): RunCommandResult {
    const resultsFile = fs.existsSync(store.path('results.json')) ? store.path('results.json') : undefined
    if (outcome === 'awaiting-promotions') {
      const waiting = state.units.filter((u) => !u.promotion).map((u) => u.story?.name ?? '?')
      this.log(
        `\n${chalk.yellow('Paused:')} still waiting for promotions for ${waiting.join(', ')}.\n` +
          `Nothing has been deployed. Create them, then: ${chalk.bold(`agentia mutant run --resume ${state.runId}`)}`,
      )
      return {runId: state.runId, outcome, phase: state.phase, storiesAwaitingPromotion: waiting}
    }
    const s = state.score
    if (s) {
      const pct = s.score === undefined ? 'n/a' : `${Math.round(s.score * 100)}%`
      this.log(
        `\n${chalk.bold('Mutation score:')} ${chalk.bold(pct)}  ` +
          chalk.dim(
            `killed ${s.killed} · survived ${s.survived} · invalid ${s.invalid} · timeout ${s.timeout} · error ${s.error}`,
          ),
      )
    }
    if (state.verify) {
      this.log(
        state.verify.ok
          ? chalk.green(`✔ ${state.lab.environment} verified identical to the baseline`)
          : chalk.red('✘ lab drift detected'),
      )
    }
    if (outcome === 'failed') {
      this.log(`\n${chalk.red.bold('Run failed:')} ${state.failure}`)
      process.exitCode = 1
    }
    let reportFile: string | undefined
    if (resultsFile) {
      reportFile = store.path('report.html')
      fs.writeFileSync(reportFile, renderHtml(buildReportModel(loadResults(store.dir))))
      this.log(`\nResults: ${path.relative(process.cwd(), resultsFile)}`)
      this.log(
        `Report:  ${path.relative(process.cwd(), reportFile)}  ${chalk.dim('(agentia mutant report for details)')}`,
      )
    }
    return {
      runId: state.runId,
      outcome,
      phase: state.phase,
      score: state.score,
      resultsFile,
      reportFile,
      failure: state.failure,
    }
  }
}
