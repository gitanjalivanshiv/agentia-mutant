import {z} from 'zod'

import type {AgentiaClient} from './client.js'

/**
 * Typed wrappers for the Agentia commands Mutant uses. Every schema is a loose object:
 * we validate what we read and keep everything else, so CLI additions never break us.
 * Shapes were observed against agentia-cli 1.0.0-beta.2 (docs/agentia-commands.md).
 */

const Credential = z.looseObject({
  type: z.enum(['cicd', 'crt', 'ai']),
  set: z.boolean(),
  ready: z.boolean().nullish(),
  source: z.string().nullish(),
  issues: z.array(z.string()).nullish(),
  missing: z.array(z.string()).nullish(),
  domain: z.string().nullish(),
})
export type AuthCredential = z.infer<typeof Credential>

const AuthGet = z.looseObject({credentials: z.array(Credential)})

/** Some list commands return a bare array, others a paged object; accept both, return the array. */
const List = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.array(item), z.looseObject({data: z.array(item)})])
    .transform((v) => (Array.isArray(v) ? v : v.data) as z.infer<T>[])

const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.looseObject({data: z.array(item), hasMore: z.boolean().optional(), nextCursor: z.string().nullish()})

const EnvCredential = z.looseObject({id: z.string(), name: z.string().nullish()})
const Environment = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().nullish(),
  platform: z.string().nullish(),
  orgId: z.string().nullish(),
  credentials: z.array(EnvCredential).nullish(),
})
export type Environment = z.infer<typeof Environment>

const Pipeline = z.looseObject({
  id: z.string(),
  name: z.string(),
  active: z.boolean().nullish(),
  platform: z.string().nullish(),
  mainBranch: z.string().nullish(),
  gitRepositoryId: z.string().nullish(),
})
export type Pipeline = z.infer<typeof Pipeline>

const PipelineConnection = z.looseObject({
  id: z.string(),
  sourceEnvironmentId: z.string().nullish(),
  destinationEnvironmentId: z.string().nullish(),
  branch: z.string().nullish(),
  destinationBranch: z.string().nullish(),
})
export type PipelineConnection = z.infer<typeof PipelineConnection>

const WorkItem = z.looseObject({
  id: z.string(),
  name: z.string(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  sourceEnvironmentName: z.string().nullish(),
  projectPipelineMainBranch: z.string().nullish(),
})
export type WorkItem = z.infer<typeof WorkItem>

const JobStep = z.looseObject({name: z.string().nullish(), status: z.string().nullish()})
const Job = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  steps: z.array(JobStep).nullish(),
})
export type Job = z.infer<typeof Job>

const Publish = z.looseObject({
  branch: z.string().nullish(),
  push: z.looseObject({message: z.string().nullish(), jobId: z.string().nullish()}).nullish(),
})

const WorkSet = z.looseObject({
  message: z.string().nullish(),
  warnings: z.array(z.string()).nullish(),
  git: z.looseObject({branch: z.string().nullish()}).nullish(),
})

const PromotionSummary = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string().nullish(),
  sourceEnvironmentName: z.string().nullish(),
  destinationEnvironmentName: z.string().nullish(),
  isBackPromotion: z.boolean().nullish(),
  createdDate: z.string().nullish(),
})
export type PromotionSummary = z.infer<typeof PromotionSummary>

/** `promotion get` differs from `promotion list`: the name lives in identification.promotionName. */
const PromotionDetail = z
  .looseObject({
    id: z.string(),
    name: z.string().nullish(),
    identification: z.looseObject({promotionName: z.string().nullish()}).nullish(),
    status: z.string().nullish(),
    sourceEnvironmentName: z.string().nullish(),
    destinationEnvironmentName: z.string().nullish(),
    isBackPromotion: z.boolean().nullish(),
    userStories: z
      .array(z.looseObject({id: z.string().nullish(), name: z.string(), title: z.string().nullish()}))
      .nullish(),
    includedMetadata: z
      .array(
        z.looseObject({
          type: z.string().nullish(),
          metadataApiName: z.string().nullish(),
          name: z.string().nullish(),
        }),
      )
      .nullish(),
  })
  .transform((p) => ({...p, name: p.name ?? p.identification?.promotionName ?? p.id}))
export type PromotionDetail = z.infer<typeof PromotionDetail>

const PromotionRun = z.looseObject({
  promotionAfter: z.looseObject({status: z.string().nullish()}).nullish(),
  jobMonitors: z
    .array(z.looseObject({jobExecutionId: z.string().nullish(), jobExecutionStatus: z.string().nullish()}))
    .nullish(),
})
export type PromotionRunResult = z.infer<typeof PromotionRun>

const CrtBuild = z.looseObject({
  id: z.number().nullish(),
  status: z.string().nullish(),
  duration: z.number().nullish(),
})
const CrtTestRun = z.looseObject({
  finalBuild: CrtBuild.nullish(),
  artifacts: z.looseObject({archive: z.string().nullish(), xunit: z.string().nullish()}).nullish(),
})
export type CrtTestRun = z.infer<typeof CrtTestRun>

const Project = z.looseObject({
  id: z.string(),
  name: z.string(),
  pipelineId: z.string().nullish(),
  pipeline: z.looseObject({id: z.string().nullish()}).nullish(),
})
export type Project = z.infer<typeof Project>

const Repository = z.looseObject({name: z.string().nullish(), uri: z.string().nullish()})

const EnvAuthStatus = z.looseObject({validated: z.boolean().nullish()})

const CrtProject = z.looseObject({id: z.number(), name: z.string()})
const CrtJob = z.looseObject({id: z.number(), name: z.string(), robotId: z.number().nullish()})

const AiQuota = z.looseObject({limit: z.number(), usage: z.number()})
const AiWorkspace = z.looseObject({id: z.string(), name: z.string()})
const AiWorkspaces = z.looseObject({workspaces: z.array(AiWorkspace)})

/** `metadata content get` returns an array of results; we only need decoded content via --output-file. */
const ContentGet = z.array(z.unknown())

export interface OrgRef {
  pipelineId: string
  orgId: string
  credentialId: string
}

export class Copado {
  constructor(
    readonly client: AgentiaClient,
    /** Project root: project-scoped (--local) auth is resolved from here. */
    readonly cwd?: string,
  ) {}

  private run<T>(args: string[], schema?: z.ZodType<T>, timeoutMs?: number, cwd?: string): Promise<T> {
    return this.client.run(args, {cwd: cwd ?? this.cwd, schema, timeoutMs})
  }

  async auth(): Promise<AuthCredential[]> {
    const r = await this.run(['auth', 'get', '--ai', '--cicd', '--crt'], AuthGet)
    return r.credentials
  }

  async environments(name?: string): Promise<Environment[]> {
    const args = ['cicd', 'environment', 'list', '--page-size', '200']
    if (name) args.push('--name', name)
    return (await this.run(args, Page(Environment))).data
  }

  async environmentAuthStatus(environmentId: string, credentialId?: string): Promise<boolean> {
    const args = ['cicd', 'environment', 'auth', 'status', environmentId]
    if (credentialId) args.push('--credentialid', credentialId)
    const r = await this.run(args, EnvAuthStatus)
    return r.validated === true
  }

  async pipelines(): Promise<Pipeline[]> {
    return (await this.run(['cicd', 'pipeline', 'list', '--page-size', '200'], Page(Pipeline))).data
  }

  async pipelineConnections(pipelineId: string): Promise<PipelineConnection[]> {
    return this.run(
      ['cicd', 'pipeline', 'connection', 'list', '--pipeline-id', pipelineId],
      List(PipelineConnection),
    )
  }

  async projects(): Promise<Project[]> {
    return this.run(['cicd', 'project', 'list'], List(Project))
  }

  async workItem(idOrName: string): Promise<WorkItem> {
    return this.run(['cicd', 'work', 'get', idOrName], WorkItem)
  }

  async repository(id: string) {
    return this.run(['cicd', 'repository', 'get', id], Repository)
  }

  async crtProjects() {
    return this.run(['testing', 'project', 'list'], z.array(CrtProject))
  }

  async crtJob(projectId: number, jobId: number) {
    return this.run(['testing', 'job', 'get', String(jobId), '-p', String(projectId)], CrtJob)
  }

  async aiQuota() {
    return this.run(['ai', 'quota', 'get'], AiQuota)
  }

  async aiWorkspaces() {
    return (await this.run(['ai', 'workspace', 'list'], AiWorkspaces)).workspaces
  }

  /** Fetches one component's XML from an org through Copado and writes it to `outputFile`. */
  async metadataContentGet(
    org: OrgRef,
    metadataType: string,
    apiName: string,
    outputFile: string,
  ): Promise<void> {
    await this.run(
      [
        'cicd',
        'metadata',
        'content',
        'get',
        '--metadata-type',
        metadataType,
        '--api-name',
        apiName,
        '--source',
        'ENVIRONMENT',
        '--pipeline-id',
        org.pipelineId,
        '--source-org-id',
        org.orgId,
        '--source-credential-id',
        org.credentialId,
        '--output-file',
        outputFile,
      ],
      ContentGet,
    )
  }

  // ---- Runner operations (writes). Lab-clone operations take the clone as cwd explicitly. ----

  async workCreate(input: {title: string; projectId: string; sourceCredentialId: string}): Promise<WorkItem> {
    return this.run(
      [
        'cicd',
        'work',
        'create',
        '--title',
        input.title,
        '--project',
        input.projectId,
        '--source-credential',
        input.sourceCredentialId,
        '--status',
        'Draft',
      ],
      WorkItem,
    )
  }

  async workSet(story: string, labRepo: string) {
    return this.run(['cicd', 'work', 'set', story], WorkSet, undefined, labRepo)
  }

  async workSetNone(labRepo: string) {
    return this.run(['cicd', 'work', 'set', '--none'], z.unknown(), undefined, labRepo)
  }

  async workPublish(labRepo: string, fullMetadata: string[] = []) {
    const args = ['cicd', 'work', 'publish']
    if (fullMetadata.length) args.push('--full-metadata', fullMetadata.join(','))
    return this.run(args, Publish, 10 * 60 * 1000, labRepo)
  }

  async job(id: string): Promise<Job> {
    return this.run(['cicd', 'job', 'get', id], Job)
  }

  async promotions(filter: {
    source: string
    destination: string
    status?: string
  }): Promise<PromotionSummary[]> {
    const args = [
      'cicd',
      'promotion',
      'list',
      '--source-environment-name',
      filter.source,
      '--destination-environment-name',
      filter.destination,
      '--page-size',
      '200',
    ]
    if (filter.status) args.push('--status', filter.status)
    return this.run(args, List(PromotionSummary))
  }

  async promotion(id: string): Promise<PromotionDetail> {
    return this.run(['cicd', 'promotion', 'get', id], PromotionDetail)
  }

  async promotionRunDeploy(id: string, waitTimeoutSeconds: number): Promise<PromotionRunResult> {
    return this.run(
      [
        'cicd',
        'promotion',
        'run',
        id,
        '--operation',
        'merge_and_deploy',
        '--wait-timeout',
        String(Math.max(60, Math.round(waitTimeoutSeconds))),
      ],
      PromotionRun,
      (waitTimeoutSeconds + 120) * 1000,
    )
  }

  /** Runs the CRT suite and waits; artifacts and xUnit go to explicit paths (never implicit). */
  async crtRun(
    projectId: number,
    jobId: number,
    out: {archive: string; xunit: string},
    timeoutMinutes: number,
  ): Promise<CrtTestRun> {
    return this.run(
      [
        'testing',
        'test',
        'run',
        String(jobId),
        '-p',
        String(projectId),
        '--wait-for-result',
        '--timeout',
        String(Math.max(1, Math.round(timeoutMinutes))),
        '--no-exit-code',
        '--save-artifacts',
        out.archive,
        '--xunit',
        out.xunit,
      ],
      CrtTestRun,
      (timeoutMinutes * 60 + 120) * 1000,
    )
  }
}
