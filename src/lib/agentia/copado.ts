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

  private run<T>(args: string[], schema?: z.ZodType<T>, timeoutMs?: number): Promise<T> {
    return this.client.run(args, {cwd: this.cwd, schema, timeoutMs})
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
}
