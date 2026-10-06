import fs from 'node:fs'
import path from 'node:path'
import {Args, Flags} from '@oclif/core'

import {MutantCommand} from '../../lib/base-command.js'
import {findProjectRoot} from '../../lib/config.js'
import {renderHtml} from '../../lib/report/html.js'
import {buildReportModel, loadResults, type ReportModel} from '../../lib/report/model.js'
import {renderMarkdown, renderTerminal} from '../../lib/report/text.js'
import {RunStore} from '../../lib/runner/run-store.js'

export default class MutantReport extends MutantCommand {
  static override summary = 'Show the mutation score, blind spots and per-type breakdown of a run'
  static override description = `Reads .mutant/runs/<run-id>/results.json. Prints a terminal summary and writes a self-contained HTML report (no external resources, works offline) next to the results. --format md|json writes Markdown or JSON instead.`

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> r-20261006-114841 --format md',
    '<%= config.bin %> <%= command.id %> --format html --output report.html',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static override args = {
    runId: Args.string({description: 'Run ID (default: the most recent run)'}),
  }

  static override flags = {
    format: Flags.string({
      options: ['html', 'md', 'json'],
      default: 'html',
      description: 'File format to write',
    }),
    output: Flags.string({description: 'Where to write the report (default: inside the run directory)'}),
  }

  public async run(): Promise<ReportModel & {reportFile: string}> {
    const {args, flags} = await this.parse(MutantReport)
    const root = findProjectRoot()
    if (!root) this.error('No .mutant/config.json found. Run this from the project folder.', {exit: 2})
    const runId = args.runId ?? RunStore.latest(root)
    if (!runId || !RunStore.exists(root, runId))
      this.error(`No run "${args.runId ?? '(latest)'}" in .mutant/runs/.`, {exit: 2})
    const store = new RunStore(root, runId)
    const model = buildReportModel(loadResults(store.dir))

    const ext = flags.format === 'md' ? 'md' : flags.format
    const reportFile = path.resolve(flags.output ?? store.path(`report.${ext}`))
    const content =
      flags.format === 'html'
        ? renderHtml(model)
        : flags.format === 'md'
          ? renderMarkdown(model)
          : JSON.stringify(model, null, 2) + '\n'
    fs.mkdirSync(path.dirname(reportFile), {recursive: true})
    fs.writeFileSync(reportFile, content)

    this.log(renderTerminal(model))
    this.log(`\nReport: ${path.relative(process.cwd(), reportFile)}`)
    return {...model, reportFile}
  }
}
