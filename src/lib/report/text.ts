import chalk from 'chalk'

import {formatDuration} from '../estimate.js'
import type {ReportModel} from './model.js'
import {typeLabel} from './model.js'

const pct = (score?: number) => (score === undefined ? 'n/a' : `${Math.round(score * 100)}%`)

/** Markdown report: for PR comments, Slack, and the repo. */
export function renderMarkdown(model: ReportModel): string {
  const s = model.score
  const out: string[] = []
  out.push(
    `# Mutation test report: ${model.percent === undefined ? 'n/a' : `${model.percent}%`} of configuration breakages caught`,
  )
  out.push('')
  out.push(
    `Run \`${model.runId}\` · lab **${model.lab.environment}** ← ${model.lab.source}` +
      (model.durationSeconds ? ` · ${formatDuration(model.durationSeconds)}` : '') +
      ` · ${model.baselineTests} baseline test(s)`,
  )
  out.push('')
  out.push(`| Caught | Blind spots | Invalid | Timeout | Error |`)
  out.push(`|---|---|---|---|---|`)
  out.push(`| ${s.killed} | ${s.survived} | ${s.invalid} | ${s.timeout} | ${s.error} |`)
  if (model.verified !== undefined) {
    out.push('')
    out.push(
      model.verified
        ? `✔ ${model.lab.environment} reverted and verified identical to the baseline.`
        : '✘ The lab did not match the baseline after the run.',
    )
  }
  if (model.failure) out.push('', '> **Run problems:** ' + model.failure.split('\n').join('\n> '))
  if (model.survivors.length) {
    out.push('', `## Blind spots (${model.survivors.length})`)
    for (const m of model.survivors) {
      const healed = m.healedBy?.length ? ` — ✔ now caught by “${m.healedBy[0]!.name}”` : ''
      out.push(
        '',
        `### ${m.description}${healed}`,
        '',
        `*${typeLabel(m.component.type)} \`${m.component.apiName}\` · \`${m.operator}\`*`,
        '',
      )
      out.push(`**A test should check:** ${m.shouldCheck}`, '', '```diff', m.diff.trimEnd(), '```')
    }
  }
  out.push(
    '',
    '## By metadata type',
    '',
    '| Type | Caught | Missed | Not scored | Score |',
    '|---|---|---|---|---|',
  )
  for (const g of model.byType) {
    out.push(
      `| ${g.group} | ${g.killed} | ${g.survived} | ${g.total - g.killed - g.survived} | ${pct(g.score)} |`,
    )
  }
  if (model.killed.length) {
    out.push('', `## Caught (${model.killed.length})`, '')
    for (const m of model.killed)
      out.push(`- ✔ ${m.description} — caught by “${m.killedBy?.[0]?.name ?? 'a test'}”`)
  }
  if (model.other.length) {
    out.push('', `## Not scored (${model.other.length})`, '')
    for (const m of model.other)
      out.push(`- **${m.outcome ?? 'not run'}** ${m.description}${m.reason ? `: ${m.reason}` : ''}`)
  }
  out.push('', '---', '*Copado runs your tests. Mutant tests your tests.*', '')
  return out.join('\n')
}

/** Compact terminal summary. */
export function renderTerminal(model: ReportModel): string {
  const s = model.score
  const color =
    model.percent === undefined
      ? chalk.dim
      : model.percent < 50
        ? chalk.red
        : model.percent < 80
          ? chalk.yellow
          : chalk.green
  const lines: string[] = []
  lines.push(
    `${chalk.bold('Mutation score')} ${color.bold(model.percent === undefined ? 'n/a' : `${model.percent}%`)}  ` +
      chalk.dim(
        `run ${model.runId} · lab ${model.lab.environment}${model.durationSeconds ? ` · ${formatDuration(model.durationSeconds)}` : ''}`,
      ),
  )
  lines.push(
    `${chalk.green(`✔ ${s.killed} caught`)}   ${chalk.red(`✘ ${s.survived} blind spot(s)`)}   ` +
      chalk.dim(`${s.invalid} invalid · ${s.timeout} timeout · ${s.error} error`),
  )
  if (model.verified !== undefined) {
    lines.push(
      model.verified
        ? chalk.green(`✔ ${model.lab.environment} verified identical to the baseline`)
        : chalk.red('✘ lab drift after the run'),
    )
  }
  lines.push('')
  for (const g of model.byType) {
    lines.push(
      `  ${g.group.padEnd(16)} ${pct(g.score).padStart(4)}  ${chalk.dim(`${g.killed} caught / ${g.killed + g.survived} scored`)}`,
    )
  }
  if (model.survivors.length) {
    lines.push('', chalk.bold('Blind spots'))
    for (const m of model.survivors) {
      const healed = m.healedBy?.length ? chalk.green(` ✔ now caught by “${m.healedBy[0]!.name}”`) : ''
      lines.push(`  ${chalk.red('✘')} ${m.description}${healed}`)
      lines.push(chalk.dim(`     a test should check: ${m.shouldCheck}`))
    }
  }
  if (model.other.length) {
    lines.push('', chalk.bold('Not scored'))
    for (const m of model.other)
      lines.push(
        `  ${chalk.yellow('!')} ${m.description} ${chalk.dim(`(${m.outcome ?? 'not run'}: ${m.reason ?? ''})`)}`,
      )
  }
  return lines.join('\n')
}
