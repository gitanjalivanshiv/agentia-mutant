import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {loadConfig} from '../../lib/config.js'
import {type CheckStatus, type DoctorReport, runDoctor} from '../../lib/doctor.js'

const ICON: Record<CheckStatus, string> = {
  pass: chalk.green('✔'),
  warn: chalk.yellow('⚠'),
  fail: chalk.red('✘'),
  skip: chalk.dim('–'),
}

export default class MutantDoctor extends MutantCommand {
  static override summary =
    'Check that Mutant can run safely: auth, lab, test job, lab clone, lock and baseline drift'
  static override description = `Read-only. Never writes to the org.

Checks Copado CI/CD, Robotic Testing and AI auth, that the lab environment is reachable through the configured pipeline, that the lab name is not protected, that the lab clone is clean, that no other tool holds the org lock, and that every baseline component in the lab still matches the package directory.`

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --skip-drift',
  ]

  static override flags = {
    'skip-drift': Flags.boolean({description: 'Skip comparing lab metadata with the baseline (faster)'}),
    'i-know-this-is-a-lab': Flags.boolean({
      description: 'Accept a lab name that looks like prod/uat/staging. Only for genuinely disposable labs.',
    }),
  }

  public async run(): Promise<DoctorReport> {
    const {flags} = await this.parse(MutantDoctor)
    const loaded = loadConfig()
    const root = loaded.ok ? loaded.root : (loaded.root ?? process.cwd())
    if (!this.jsonEnabled()) this.log(chalk.bold('Agentia Mutant doctor') + chalk.dim('  (read-only)\n'))

    const report = await runDoctor({
      root,
      config: loaded.ok ? loaded.config : undefined,
      configError: loaded.ok ? undefined : loaded.error,
      copado: this.copado(root),
      iKnowThisIsALab: flags['i-know-this-is-a-lab'],
      skipDrift: flags['skip-drift'],
    })

    const width = Math.max(...report.checks.map((c) => c.title.length))
    for (const c of report.checks) {
      this.log(
        `${ICON[c.status]} ${c.title.padEnd(width)}  ${c.status === 'pass' ? chalk.dim(c.detail) : c.detail}`,
      )
      if (c.fix && (c.status === 'fail' || c.status === 'warn'))
        this.log(`  ${' '.repeat(width)}  ${chalk.cyan('→ ' + c.fix)}`)
    }
    const s = report.summary
    this.log(
      `\n${report.ok ? chalk.green.bold('Ready.') : chalk.red.bold('Not ready.')} ${s.pass} passed, ${s.warn} warning(s), ${s.fail} failed, ${s.skip} skipped.`,
    )
    if (!report.ok) process.exitCode = 1
    return report
  }
}
