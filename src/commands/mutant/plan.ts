import path from 'node:path'
import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {lastChangedFromGit, storyComponents} from '../../lib/changes.js'
import {loadConfig, resolveFromRoot} from '../../lib/config.js'
import {formatDuration} from '../../lib/estimate.js'
import {loadHistory} from '../../lib/history.js'
import {savePlan} from '../../lib/plan-file.js'
import {buildPlan, type Plan, type Scope} from '../../lib/planner.js'
import {selectOperators} from '../../operators/index.js'

export default class MutantPlan extends MutantCommand {
  static override summary = 'Choose the mutants for a run and estimate how long it will take. Runs nothing.'
  static override description = `Generates every possible mutant for the baseline metadata, picks up to --max of them (recently changed components first, then operators that survived before, with variety across metadata types), and estimates the run time from measured Copado cycle times.

Writes the plan to .mutant/plans/ (and .mutant/plans/latest.json) for \`agentia mutant run\`. Read-only against Copado: --story only reads the story and fetches its branch.`

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --max 5 --json',
    '<%= config.bin %> <%= command.id %> --story US-0000042',
    '<%= config.bin %> <%= command.id %> --components ValidationRule:Opportunity.Discount_Max,Discount_Approval',
  ]

  static override flags = {
    max: Flags.integer({
      description: 'Maximum number of mutants (default: budget.maxMutants from config)',
      min: 1,
    }),
    story: Flags.string({
      description: 'Only components changed in this Copado user story',
      exclusive: ['components'],
    }),
    components: Flags.string({
      description: 'Only these components (comma-separated apiName or Type:apiName)',
      exclusive: ['story'],
    }),
    operators: Flags.string({description: 'Only these operators (comma-separated IDs); overrides config'}),
    output: Flags.string({description: 'Write the plan to this file instead of .mutant/plans/'}),
  }

  public async run(): Promise<Plan & {planFile: string}> {
    const {flags} = await this.parse(MutantPlan)
    const loaded = loadConfig()
    if (!loaded.ok) this.error(loaded.error, {exit: 2})
    const {config, root} = loaded

    const allow = flags.operators ? flags.operators.split(',').map((s) => s.trim()) : config.operators.allow
    const {operators, unknown} = selectOperators(allow, config.operators.deny)
    if (unknown.length) this.error(`Unknown operator(s): ${unknown.join(', ')}`, {exit: 2})

    let scope: Scope = {kind: 'all'}
    if (flags.components)
      scope = {kind: 'components', components: flags.components.split(',').map((s) => s.trim())}
    if (flags.story) {
      const components = await storyComponents(
        this.copado(root),
        resolveFromRoot(root, config.labRepoPath),
        flags.story,
      )
      scope = {kind: 'story', story: flags.story, components}
    }

    const packageDir = resolveFromRoot(root, config.packageDirectory)
    const plan = buildPlan({
      packageDir,
      scope,
      max: flags.max ?? config.budget.maxMutants,
      operators,
      lab: {environment: config.labEnvironment, source: config.sourceEnvironment, pipeline: config.pipeline},
      history: loadHistory(root),
      lastChanged: await lastChangedFromGit(packageDir),
    })
    const planFile = savePlan(root, plan, flags.output)
    this.render(plan, path.relative(process.cwd(), planFile))
    return {...plan, planFile}
  }

  private render(plan: Plan, planFile: string) {
    const scope =
      plan.scope.kind === 'all'
        ? 'all components'
        : plan.scope.kind === 'story'
          ? `components changed in ${plan.scope.story}`
          : plan.scope.components.join(', ')
    this.log(
      chalk.bold('Mutation plan') +
        chalk.dim(` · lab ${plan.lab.environment} ← ${plan.lab.source} · ${scope}`) +
        `\n${plan.mutants.length} of ${plan.candidates} possible mutants\n`,
    )
    if (plan.mutants.length === 0) {
      this.log(chalk.yellow('Nothing to mutate in this scope.'))
      return
    }
    const opWidth = Math.max(...plan.mutants.map((m) => m.operator.length))
    plan.mutants.forEach((m, i) => {
      this.log(`${String(i + 1).padStart(2)}  ${chalk.cyan(m.operator.padEnd(opWidth))}  ${m.description}`)
    })
    const e = plan.estimate
    this.log(
      `\n${chalk.bold('Estimated duration:')} ~${formatDuration(e.totalSeconds)} ` +
        chalk.dim(`(${e.promotions} Copado promotions, ${e.testRuns} test runs)`),
    )
    for (const b of e.breakdown) this.log(chalk.dim(`  ${b.label.padEnd(30)} ${formatDuration(b.seconds)}`))
    this.log(
      chalk.dim(
        `  You'll be asked to create ${e.promotions} promotions in Copado Pipeline Manager in one sitting (~2 min).`,
      ),
    )
    this.log(`\nSaved plan: ${planFile}\nNext: ${chalk.bold(`agentia mutant run --plan ${planFile}`)}`)
  }
}
