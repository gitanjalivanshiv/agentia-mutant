import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

export const CONFIG_DIR = '.mutant'
export const CONFIG_FILE = 'config.json'

/** Environment names that must never be mutated without an explicit override. */
export const PROTECTED_ENV_PATTERN = /prod|production|uat|staging/i

export const MutantConfigSchema = z.object({
  version: z.literal(1),
  /** The ONLY environment Mutant deploys to. */
  labEnvironment: z.string().min(1),
  /** Environment each mutant story starts from; promotions must go source → lab. */
  sourceEnvironment: z.string().min(1),
  pipeline: z.string().min(1),
  /** Copado project for mutant stories; only needed when several projects use the pipeline. */
  project: z.string().optional(),
  /** Local clone of the pipeline's Git repository (relative to the project root or absolute). */
  labRepoPath: z.string().min(1),
  /** Source Format package directory holding the baseline metadata to mutate. */
  packageDirectory: z.string().min(1),
  /** Package directory inside the lab clone where mutated files are written (sfdx-project.json). */
  labPackageDirectory: z.string().min(1).default('force-app'),
  storyTitlePrefix: z.string().min(1).default('Mutant Lab –'),
  crt: z.object({projectId: z.number().int().positive(), jobId: z.number().int().positive()}),
  ai: z.object({workspaceId: z.string().optional()}).default({}),
  budget: z
    .object({
      maxMutants: z.number().int().positive().default(10),
      mutantTimeoutMinutes: z.number().positive().default(20),
    })
    .default({maxMutants: 10, mutantTimeoutMinutes: 20}),
  operators: z
    .object({allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([])})
    .default({allow: [], deny: []}),
  /** Shared lock file that tells other tools (e.g. Time Machine) the org is busy. */
  lockFile: z.string().default('~/hackathon/.org-busy'),
  /** Set only when the user explicitly accepts a protected-looking lab name. */
  iKnowThisIsALab: z.boolean().default(false),
})

export type MutantConfig = z.infer<typeof MutantConfigSchema>

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p
}

/** Walks up from `start` to the directory that contains `.mutant/config.json`. */
export function findProjectRoot(start: string = process.cwd()): string | undefined {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_DIR, CONFIG_FILE))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function configPath(root: string): string {
  return path.join(root, CONFIG_DIR, CONFIG_FILE)
}

export type LoadResult =
  {ok: true; config: MutantConfig; root: string} | {ok: false; error: string; root?: string}

export function loadConfig(start: string = process.cwd()): LoadResult {
  const root = findProjectRoot(start)
  if (!root) return {ok: false, error: `No ${CONFIG_DIR}/${CONFIG_FILE} found. Run \`agentia mutant init\`.`}
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath(root), 'utf8'))
  } catch (error) {
    return {ok: false, root, error: `Cannot read ${configPath(root)}: ${(error as Error).message}`}
  }
  const parsed = MutantConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    return {ok: false, root, error: `Invalid ${configPath(root)}: ${issues}`}
  }
  return {ok: true, config: parsed.data, root}
}

export function saveConfig(root: string, config: MutantConfig): string {
  const file = configPath(root)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(MutantConfigSchema.parse(config), null, 2) + '\n')
  return file
}

export function resolveFromRoot(root: string, p: string): string {
  return path.resolve(root, expandHome(p))
}

/** Safety rule from the brief (§7): refuse protected-looking lab names unless explicitly overridden. */
export function labNameProblem(
  config: Pick<MutantConfig, 'labEnvironment' | 'iKnowThisIsALab'>,
  override = false,
) {
  if (!PROTECTED_ENV_PATTERN.test(config.labEnvironment)) return undefined
  if (override || config.iKnowThisIsALab) return undefined
  return `Lab environment "${config.labEnvironment}" looks like a protected environment (prod/uat/staging). Refusing. Pass --i-know-this-is-a-lab only if it really is a disposable lab.`
}
