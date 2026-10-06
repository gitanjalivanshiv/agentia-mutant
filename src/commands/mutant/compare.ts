import fs from 'node:fs'
import path from 'node:path'
import {Args, Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {findProjectRoot} from '../../lib/config.js'
import {loadHealState} from '../../lib/heal/heal.js'
import {compareRuns, type CompareResult} from '../../lib/report/compare.js'
import {renderHtml} from '../../lib/report/html.js'
import {buildReportModel, loadResults} from '../../lib/report/model.js'
import {RunStore} from '../../lib/runner/run-store.js'

export default class MutantCompare extends MutantCommand {
  static override summary = 'Before/after mutation score of two runs (e.g. before and after `mutant heal`)'
  static override description = `Run B usually re-runs only run A's survivors after healing; mutants B did not run keep A's outcome (adding tests cannot un-catch a breakage). Writes a before/after HTML report into run B's directory.`

  static override examples = ['<%= config.bin %> <%= command.id %> r-20261006-114841 r-20261007-090000']

  static override args = {
    before: Args.string({required: true, description: 'Run ID before healing'}),
    after: Args.string({required: true, description: 'Run ID after healing'}),
  }

  static override flags = {
    output: Flags.string({description: 'Where to write the HTML (default: <run B>/compare.html)'}),
  }

  public async run(): Promise<CompareResult & {reportFile: string}> {
    const {args, flags} = await this.parse(MutantCompare)
    const root = findProjectRoot()
    if (!root) this.error('No .mutant/config.json found. Run this from the project folder.', {exit: 2})
    for (const id of [args.before, args.after]) {
      if (!RunStore.exists(root, id)) this.error(`No run "${id}" in .mutant/runs/.`, {exit: 2})
    }
    const a = new RunStore(root, args.before)
    const b = new RunStore(root, args.after)
    const heal = loadHealState(a.dir)
    const healedTests = Object.fromEntries((heal?.proposals ?? []).map((p) => [p.mutantId, p.testNames]))
    const result = compareRuns(loadResults(a.dir), loadResults(b.dir), healedTests)
    const reportFile = path.resolve(flags.output ?? b.path('compare.html'))
    fs.writeFileSync(reportFile, renderHtml(buildReportModel(result.after), result.comparison))

    const c = result.comparison
    const fmt = (p?: number) => (p === undefined ? 'n/a' : `${p}%`)
    this.log(
      `${chalk.bold('Mutation score')}  ${chalk.red.bold(fmt(c.before.percent))} ${chalk.dim('→')} ${chalk.green.bold(fmt(c.after.percent))}` +
        chalk.dim(
          `   (${c.before.killed}/${c.before.killed + c.before.survived} → ${c.after.killed}/${c.after.killed + c.after.survived} caught)`,
        ),
    )
    for (const n of c.newlyCaught)
      this.log(`  ${chalk.green('✔')} ${n.description}${n.by ? chalk.dim(` — now caught by “${n.by}”`) : ''}`)
    if (result.carriedOver.length)
      this.log(chalk.dim(`  ${result.carriedOver.length} mutant(s) not re-run keep their earlier outcome.`))
    this.log(`\nReport: ${path.relative(process.cwd(), reportFile)}`)
    return {...result, reportFile}
  }
}
