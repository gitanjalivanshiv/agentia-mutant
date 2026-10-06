import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import {Flags} from '@oclif/core'
import chalk from 'chalk'

import {MutantCommand} from '../../lib/base-command.js'
import {
  configPath,
  labNameProblem,
  type MutantConfig,
  MutantConfigSchema,
  resolveFromRoot,
  saveConfig,
} from '../../lib/config.js'
import {resolveLab} from '../../lib/lab.js'
import {installSkill, type SkillInstall} from '../../lib/skill.js'

interface InitResult {
  configFile: string
  config: MutantConfig
  verified: boolean
  skill: SkillInstall[]
}

export default class MutantInit extends MutantCommand {
  static override summary = 'Create .mutant/config.json and install the Mutant Agent Skill'
  static override description = `Asks for (or takes as flags) the lab environment, the environment mutant stories start from, the pipeline, the local clone of the pipeline repository, the package directory with the baseline metadata, and the Robotic Testing project and job. Verifies the names against Copado (read-only) unless --no-verify.

Installs the Agent Skill into .agents/skills/mutant (and .claude/skills/mutant when .claude exists).`

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --lab-environment MutationLab --source-environment Dev2 --pipeline "My Pipeline" --lab-repo ../lab-clone --package-dir force-app --crt-project 123 --crt-job 456 --json',
  ]

  static override flags = {
    'lab-environment': Flags.string({description: 'The ONLY environment Mutant deploys to'}),
    'source-environment': Flags.string({
      description: 'Environment mutant stories start from (promotes into the lab)',
    }),
    pipeline: Flags.string({description: 'Copado pipeline name'}),
    'lab-repo': Flags.string({description: "Path to a local clone of the pipeline's Git repository"}),
    'package-dir': Flags.string({description: 'Source Format package directory with the baseline metadata'}),
    'crt-project': Flags.integer({description: 'Copado Robotic Testing project ID'}),
    'crt-job': Flags.integer({description: 'Copado Robotic Testing job ID that holds the test suite'}),
    'ai-workspace': Flags.string({description: 'Copado AI workspace ID used by `mutant heal` (optional)'}),
    'max-mutants': Flags.integer({description: 'Default mutant budget per run', default: 10}),
    'i-know-this-is-a-lab': Flags.boolean({
      description: 'Accept a lab name that looks like prod/uat/staging',
    }),
    verify: Flags.boolean({description: 'Verify names against Copado', default: true, allowNo: true}),
    force: Flags.boolean({description: 'Overwrite an existing .mutant/config.json'}),
    'skip-skill': Flags.boolean({description: 'Do not install the Agent Skill'}),
    'skill-only': Flags.boolean({description: 'Only (re)install the Agent Skill; leave the config alone'}),
  }

  public async run(): Promise<InitResult> {
    const {flags} = await this.parse(MutantInit)
    const root = process.cwd()
    if (flags['skill-only']) {
      const skill = installSkill(root)
      for (const s of skill)
        this.log(chalk.green('✔ ') + `Agent Skill ${s.action}: ${path.relative(root, s.target)}`)
      return {
        configFile: configPath(root),
        config: undefined as unknown as MutantConfig,
        verified: false,
        skill,
      }
    }
    const file = configPath(root)
    if (fs.existsSync(file) && !flags.force) {
      this.error(`${file} already exists. Use --force to overwrite.`, {exit: 2})
    }

    const interactive = !this.jsonEnabled() && process.stdin.isTTY
    const ask = await askerFor(interactive)
    try {
      const value = async (flag: string | undefined, question: string, fallback?: string) =>
        flag ?? (await ask(question, fallback))
      const draft = {
        version: 1 as const,
        labEnvironment: await value(
          flags['lab-environment'],
          'Lab environment (the ONLY environment Mutant deploys to)',
        ),
        sourceEnvironment: await value(
          flags['source-environment'],
          'Source environment (promotes into the lab)',
        ),
        pipeline: await value(flags.pipeline, 'Copado pipeline name'),
        labRepoPath: await value(flags['lab-repo'], "Local clone of the pipeline's Git repository"),
        packageDirectory: await value(
          flags['package-dir'],
          'Package directory with the baseline metadata',
          'force-app',
        ),
        crt: {
          projectId: flags['crt-project'] ?? Number(await ask('Robotic Testing project ID')),
          jobId: flags['crt-job'] ?? Number(await ask('Robotic Testing job ID')),
        },
        ai: {
          workspaceId:
            flags['ai-workspace'] ?? ((await ask('Copado AI workspace ID (optional)', '')) || undefined),
        },
        budget: {maxMutants: flags['max-mutants'], mutantTimeoutMinutes: 20},
        iKnowThisIsALab: flags['i-know-this-is-a-lab'],
      }
      const parsed = MutantConfigSchema.safeParse(draft)
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')
        this.error(`Missing or invalid settings:\n  ${issues}\nPass them as flags (see --help).`, {exit: 2})
      }
      const config = parsed.data

      const nameProblem = labNameProblem(config)
      if (nameProblem) this.error(nameProblem, {exit: 2})
      if (!fs.existsSync(resolveFromRoot(root, config.packageDirectory))) {
        this.warn(`Package directory ${config.packageDirectory} does not exist yet.`)
      }

      let verified = false
      if (flags.verify) {
        try {
          const lab = await resolveLab(this.copado(root), config)
          verified = true
          this.log(chalk.green('✔ ') + `Copado: ${lab.pipeline.name}: ${lab.source.name} → ${lab.lab.name}`)
        } catch (error) {
          this.error(
            `Could not verify against Copado: ${(error as Error).message}\nFix the names or use --no-verify.`,
            {
              exit: 2,
            },
          )
        }
      }

      const configFile = saveConfig(root, config)
      this.log(
        chalk.green('✔ ') +
          `Wrote ${path.relative(root, configFile)} (git-ignored: it holds org-specific IDs)`,
      )
      const skill = flags['skip-skill'] ? [] : installSkill(root)
      for (const s of skill)
        this.log(chalk.green('✔ ') + `Agent Skill ${s.action}: ${path.relative(root, s.target)}`)
      this.log(`\nNext: ${chalk.bold('agentia mutant doctor')}`)
      return {configFile, config, verified, skill}
    } finally {
      ask.close()
    }
  }
}

type Asker = ((question: string, fallback?: string) => Promise<string | undefined>) & {close: () => void}

async function askerFor(interactive: boolean): Promise<Asker> {
  if (!interactive) {
    const none = (async (_q: string, fallback?: string) => fallback) as Asker
    none.close = () => {}
    return none
  }
  const rl = readline.createInterface({input: process.stdin, output: process.stdout})
  const ask = (async (question: string, fallback?: string) => {
    const suffix = fallback ? chalk.dim(` (${fallback})`) : ''
    const answer = (await rl.question(`${question}${suffix}: `)).trim()
    return answer || fallback
  }) as Asker
  ask.close = () => rl.close()
  return ask
}
