import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {labNameProblem, loadConfig, resolveFromRoot} from '../../lib/config.js'
import {runDoctor} from '../../lib/doctor.js'
import {checkDrift} from '../../lib/drift.js'
import {fetchSuite} from '../../lib/heal/heal.js'
import {resolveLab, resolveProject} from '../../lib/lab.js'
import {acquireLock, readLock, releaseLock} from '../../lib/lock.js'
import {listComponents} from '../../lib/metadata.js'
import {buildPlan} from '../../lib/planner.js'
import {newRunId, RunStore} from '../../lib/runner/run-store.js'
import {Runner, type RunOutcome} from '../../lib/runner/runner.js'
import type {DeployUnit, RunState} from '../../lib/runner/types.js'
import {OPERATORS} from '../../operators/index.js'

interface ResetResult {
  drifted: string[]
  suiteReplaced: boolean
  deploy?: {runId: string; outcome: RunOutcome; verified?: boolean; failure?: string}
  nothingToDo?: boolean
}

export default class MutantReset extends MutantCommand {
  static override summary = 'Restore the lab metadata (through Copado) and the test suite to the baseline'
  static override description = `Checks every baseline component in the lab. If any differs (or --force), deploys the whole baseline package through ONE Copado user story from the source environment (you create its promotion in Pipeline Manager) and verifies the lab afterwards. With --suite, also replaces the Robotic Testing suite file with that local file (e.g. the demo's deliberately incomplete suite).

Used by examples/demo/seed.sh (first deploy, --force) and examples/demo/reset.sh.`

  static override examples = [
    '<%= config.bin %> <%= command.id %> --suite examples/demo/tests/discount_happy_path.robot',
    '<%= config.bin %> <%= command.id %> --force --yes',
    '<%= config.bin %> <%= command.id %> --resume reset-20261007-091500',
  ]

  static override flags = {
    suite: Flags.string({description: 'Local .robot file that should be the Robotic Testing suite'}),
    force: Flags.boolean({
      description: 'Deploy the baseline even if the lab already matches it (first seed)',
    }),
    yes: Flags.boolean({char: 'y', description: 'Do not ask for confirmation (required with --json)'}),
    resume: Flags.string({description: 'Resume a paused reset run by ID'}),
    'promotion-wait': Flags.integer({description: 'Minutes to wait for the promotion', default: 30, min: 0}),
  }

  public async run(): Promise<ResetResult> {
    const {flags} = await this.parse(MutantReset)
    const loaded = loadConfig()
    if (!loaded.ok) this.error(loaded.error, {exit: 2})
    const {config, root} = loaded
    const nameProblem = labNameProblem(config)
    if (nameProblem) this.error(nameProblem, {exit: 2})
    const copado = this.copado(root)
    const packageDir = resolveFromRoot(root, config.packageDirectory)
    const components = listComponents(packageDir)

    if (flags.resume) {
      if (!RunStore.exists(root, flags.resume)) this.error(`No reset run "${flags.resume}".`, {exit: 2})
      const store = new RunStore(root, flags.resume)
      return {
        drifted: [],
        suiteReplaced: false,
        deploy: await this.deploy(store.load(), store, flags['promotion-wait']),
      }
    }

    this.log(
      chalk.bold('Agentia Mutant reset') +
        chalk.dim(` · lab ${config.labEnvironment} ← ${config.sourceEnvironment}\n`),
    )
    const doctor = await runDoctor({root, config, copado, skipDrift: true})
    const failures = doctor.checks.filter((c) => c.status === 'fail')
    if (failures.length) {
      this.error(`Not ready:\n${failures.map((f) => `  ✘ ${f.title}: ${f.detail}`).join('\n')}`, {exit: 1})
    }
    const lab = await resolveLab(copado, config)

    // What needs restoring?
    let suite: {local: string; remote: string; differs: boolean} | undefined
    if (flags.suite) {
      const local = path.resolve(flags.suite)
      if (!fs.existsSync(local)) this.error(`No such file: ${flags.suite}`, {exit: 2})
      const remote = await fetchSuite(copado, config, fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-suite-')))
      suite = {local, remote: remote.file, differs: remote.text !== fs.readFileSync(local, 'utf8')}
    }
    this.log(`Checking ${components.length} baseline component(s) in ${lab.lab.name}…`)
    const drift = await checkDrift(copado, lab.labOrg, packageDir, components)
    const drifted = [...drift.drifted, ...drift.unreadable.map((u) => `unreadable: ${u}`)]
    const needDeploy = flags.force || drifted.length > 0

    for (const d of drifted) this.log(`  ${chalk.yellow('≠')} ${d}`)
    if (!drifted.length) this.log(chalk.green(`  ✔ all ${components.length} component(s) match the baseline`))
    if (suite) {
      this.log(
        suite.differs
          ? `  ${chalk.yellow('≠')} Robotic Testing suite ${suite.remote} differs from ${path.relative(process.cwd(), suite.local)}`
          : chalk.green(`  ✔ Robotic Testing suite matches ${path.relative(process.cwd(), suite.local)}`),
      )
    }
    if (!needDeploy && !suite?.differs) {
      this.log('\nNothing to do: the lab and the suite are at the baseline.')
      return {drifted, suiteReplaced: false, nothingToDo: true}
    }

    const actions = [
      ...(suite?.differs ? [`replace the Robotic Testing suite file ${suite.remote}`] : []),
      ...(needDeploy
        ? [
            `deploy the baseline (${components.length} components) to ${lab.lab.name} through one Copado story`,
          ]
        : []),
    ]
    if (!(await this.confirm(flags.yes, `This will ${actions.join(' and ')}. Continue?`))) {
      this.log('Cancelled. Nothing was written.')
      return {drifted, suiteReplaced: false}
    }

    const lock = readLock(config.lockFile)
    if (lock.held) this.error(`The org is busy (${lock.path}):\n  ${lock.content}`, {exit: 1})
    let suiteReplaced = false
    if (suite?.differs) {
      acquireLock(config.lockFile, 'reset suite')
      try {
        await copado.crtReplace(
          config.crt.projectId,
          config.crt.jobId,
          suite.local,
          suite.remote,
          'Mutant reset: restore the baseline suite',
        )
        suiteReplaced = true
        this.log(
          chalk.green('✔ ') +
            `Robotic Testing suite restored from ${path.relative(process.cwd(), suite.local)}`,
        )
      } finally {
        releaseLock(config.lockFile)
      }
    }
    if (!needDeploy) return {drifted, suiteReplaced}

    const runId = newRunId(new Date(), 'reset')
    const store = new RunStore(root, runId)
    const unit: DeployUnit = {
      index: 0,
      files: Object.fromEntries(
        components.map((c) => [c.file, fs.readFileSync(path.join(packageDir, c.file), 'utf8')]),
      ),
      components: components.map((c) => `${c.type}:${c.apiName}`),
      title: `${config.storyTitlePrefix} ${runId} restore baseline`.slice(0, 255),
    }
    const now = new Date().toISOString()
    const plan = buildPlan({
      packageDir,
      scope: {kind: 'all'},
      max: 0,
      operators: OPERATORS,
      lab: {environment: config.labEnvironment, source: config.sourceEnvironment, pipeline: config.pipeline},
    })
    const state: RunState = {
      version: 1,
      runId,
      kind: 'reset',
      phase: 'created',
      createdAt: now,
      updatedAt: now,
      plan,
      lab: plan.lab,
      units: [unit],
      mutants: [],
    }
    store.save(state)
    return {drifted, suiteReplaced, deploy: await this.deploy(state, store, flags['promotion-wait'])}
  }

  private async deploy(
    state: RunState,
    store: RunStore,
    waitMinutes: number,
  ): Promise<ResetResult['deploy']> {
    const loaded = loadConfig()
    if (!loaded.ok) throw new Error(loaded.error)
    const {config, root} = loaded
    const copado = this.copado(root)
    const lab = await resolveLab(copado, config)
    const project = await resolveProject(copado, config, lab)
    const lock = readLock(config.lockFile)
    if (lock.held && !(lock.ownedByMutant && lock.content?.includes(state.runId))) {
      this.error(`The org is busy (${lock.path}):\n  ${lock.content}`, {exit: 1})
    }
    releaseLock(config.lockFile)
    acquireLock(config.lockFile, `reset ${state.runId}`)
    let outcome: RunOutcome
    try {
      outcome = await new Runner(state, {
        copado,
        lab,
        config,
        packageDir: resolveFromRoot(root, config.packageDirectory),
        labRepo: resolveFromRoot(root, config.labRepoPath),
        store,
        baselineRuns: 1,
        promotionWaitMs: waitMinutes * 60_000,
        projectId: project.id,
        io: {
          info: (m) => this.log(m),
          warn: (m) => this.warn(m),
          mutant: () => {},
          promotionsNeeded: (units) => {
            this.log(
              `\n${chalk.bold.yellow('Action needed:')} in Copado Pipeline Manager → ${lab.pipeline.name} → ${lab.source.name} → ${lab.lab.name}, ` +
                `select ${chalk.bold(units[0]?.story?.name ?? '?')} alone and click Create Promotion (do not deploy).\n` +
                chalk.dim('  Waiting for it to appear (checking every 15 s)…'),
            )
          },
        },
      }).run()
    } finally {
      releaseLock(config.lockFile)
    }
    if (outcome === 'awaiting-promotions') {
      this.log(
        `\nPaused before deploying. Create the promotion, then: ${chalk.bold(`agentia mutant reset --resume ${state.runId}`)}`,
      )
    } else if (outcome === 'done') {
      this.log(chalk.green(`\n✔ ${state.lab.environment} restored and verified identical to the baseline`))
    } else {
      this.log(`\n${chalk.red.bold('Reset failed:')} ${state.failure}`)
      process.exitCode = 1
    }
    return {runId: state.runId, outcome, verified: state.verify?.ok, failure: state.failure}
  }

  private async confirm(yes: boolean, question: string): Promise<boolean> {
    if (yes) return true
    if (this.jsonEnabled() || !process.stdin.isTTY) {
      this.error('Refusing to write without confirmation: pass --yes.', {exit: 2})
    }
    const rl = readline.createInterface({input: process.stdin, output: process.stdout})
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} (y/N) `)).trim())
    } finally {
      rl.close()
    }
  }
}
