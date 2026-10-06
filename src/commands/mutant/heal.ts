import path from 'node:path'
import readline from 'node:readline/promises'
import {Args, Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {loadConfig, resolveFromRoot} from '../../lib/config.js'
import {
  applyHeals,
  healDir,
  type HealState,
  loadHealState,
  prepareApply,
  proposeHeals,
  recordHealPlan,
} from '../../lib/heal/heal.js'
import {savePlan} from '../../lib/plan-file.js'
import {buildPlan} from '../../lib/planner.js'
import {loadResults} from '../../lib/report/model.js'
import {RunStore} from '../../lib/runner/run-store.js'
import {OPERATORS} from '../../operators/index.js'

export default class MutantHeal extends MutantCommand {
  static override summary = 'Ask Copado AI to write tests that catch the survivors; apply them after review'
  static override description = `Without --apply: for each survivor, asks the Copado AI Test agent for one Robot Framework test, grounded in the breakage, its diff, what a test should check and the current Robotic Testing suite. Proposals are saved to .mutant/runs/<id>/heal/ for HUMAN REVIEW (edit them freely). Nothing is written to Copado.

With --apply (after review): merges the reviewed tests into the current suite, shows the diff, uploads it to the Robotic Testing job, and writes a plan that re-runs only the survivors. Then run that plan and \`agentia mutant compare\` to show the new score.`

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> r-20261006-114841 --apply',
    '<%= config.bin %> <%= command.id %> --apply --yes --json',
  ]

  static override args = {runId: Args.string({description: 'Run ID (default: the most recent run)'})}

  static override flags = {
    apply: Flags.boolean({description: 'Upload the reviewed proposals to the Robotic Testing job'}),
    yes: Flags.boolean({
      char: 'y',
      description: 'Do not ask for confirmation before uploading (required with --json)',
    }),
    only: Flags.string({description: 'Only these survivor mutant IDs (comma-separated)'}),
    force: Flags.boolean({
      description:
        'Without --apply: ask Copado AI again. With --apply: re-apply edited proposals (only if the suite is unchanged since Mutant uploaded it)',
    }),
  }

  public async run(): Promise<HealState & {nextSteps: string[]}> {
    const {args, flags} = await this.parse(MutantHeal)
    const loaded = loadConfig()
    if (!loaded.ok) this.error(loaded.error, {exit: 2})
    const {config, root} = loaded
    const runId = args.runId ?? RunStore.latest(root)
    if (!runId || !RunStore.exists(root, runId))
      this.error(`No run "${args.runId ?? '(latest)'}" in .mutant/runs/.`, {exit: 2})
    const store = new RunStore(root, runId)
    const copado = this.copado(root)
    const rel = (p: string) => path.relative(process.cwd(), p)

    if (!flags.apply) {
      const existing = loadHealState(store.dir)
      if (existing && !flags.force) {
        this.log(`Proposals already exist in ${rel(healDir(store.dir))} (use --force to ask again).`)
        return {...existing, nextSteps: [`agentia mutant heal ${runId} --apply`]}
      }
      const results = loadResults(store.dir)
      this.log(
        chalk.bold(`Healing ${runId}`) +
          chalk.dim(` · Copado AI Test agent${config.ai.workspaceId ? ' · Mutant workspace' : ''}\n`),
      )
      const state = await proposeHeals({
        copado,
        config,
        runDir: store.dir,
        results,
        only: flags.only?.split(',').map((s) => s.trim()),
        onProgress: (m) => this.log(m),
      })
      const ok = state.proposals.filter((p) => p.status === 'proposed').length
      const dir = rel(healDir(store.dir))
      this.log(
        `\n${ok} of ${state.proposals.length} survivor(s) have a proposed test. ${chalk.bold('Nothing was written to Copado.')}\n` +
          `Review (and edit) the proposals:\n  ${dir}/*.robot\n  ${dir}/suite.diff   ${chalk.dim('(what --apply would upload)')}\n` +
          `Then: ${chalk.bold(`agentia mutant heal ${runId} --apply`)}`,
      )
      return {...state, nextSteps: [`agentia mutant heal ${runId} --apply`]}
    }

    // --apply
    const plan = await prepareApply(copado, config, store.dir, flags.force)
    this.log(
      chalk.bold(`Applying ${plan.added.length} reviewed test(s) to Robotic Testing`) +
        chalk.dim(` · ${plan.remote.file}\n`),
    )
    if (plan.remoteChanged)
      this.warn(
        'The suite changed in Robotic Testing since the proposals were made; merging into the current version.',
      )
    this.log(plan.diff.split('\n').map(colorDiff).join('\n'))
    if (!(await this.confirm(flags.yes, `Upload this suite to the Robotic Testing job?`))) {
      this.log('Cancelled. Nothing was uploaded.')
      return {...plan.state, nextSteps: []}
    }
    const state = await applyHeals(copado, config, store.dir, plan)
    this.log(chalk.green('✔ ') + `Uploaded: ${state.applied!.testNames.map((t) => `“${t}”`).join(', ')}`)

    // A plan that re-runs only the survivors that now have a test.
    const healedIds = plan.state.proposals.filter((p) => p.status === 'proposed').map((p) => p.mutantId)
    const reRun = buildPlan({
      packageDir: resolveFromRoot(root, config.packageDirectory),
      scope: {kind: 'all'},
      max: healedIds.length,
      operators: OPERATORS,
      lab: {environment: config.labEnvironment, source: config.sourceEnvironment, pipeline: config.pipeline},
      mutantIds: healedIds,
    })
    const planFile = savePlan(root, reRun, path.join('.mutant', 'plans', `heal-${runId}.json`))
    recordHealPlan(store.dir, planFile)
    const next = [
      `agentia mutant run --plan ${rel(planFile)}`,
      `agentia mutant compare ${runId} <new-run-id>`,
    ]
    this.log(
      `\nRe-run only the healed survivors, then compare:\n  ${chalk.bold(next[0])}\n  ${chalk.bold(next[1])}`,
    )
    return {...state, nextSteps: next}
  }

  private async confirm(yes: boolean, question: string): Promise<boolean> {
    if (yes) return true
    if (this.jsonEnabled() || !process.stdin.isTTY) {
      this.error('Refusing to upload tests without confirmation: review the proposals, then pass --yes.', {
        exit: 2,
      })
    }
    const rl = readline.createInterface({input: process.stdin, output: process.stdout})
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} (y/N) `)).trim())
    } finally {
      rl.close()
    }
  }
}

function colorDiff(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return chalk.green(line)
  if (line.startsWith('-') && !line.startsWith('---')) return chalk.red(line)
  return chalk.dim(line)
}
