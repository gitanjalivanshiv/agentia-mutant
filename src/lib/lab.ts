import type {Copado, Environment, OrgRef, Pipeline} from './agentia/index.js'
import type {MutantConfig} from './config.js'

/** Everything Mutant needs to know about the lab, resolved from names in config to Copado IDs. */
export interface LabContext {
  pipeline: Pipeline
  lab: Environment
  source: Environment
  labOrg: OrgRef
  connection: {sourceBranch?: string | null; destinationBranch?: string | null}
}

export class LabResolutionError extends Error {}

function exactlyOne<T extends {name: string}>(items: T[], name: string, kind: string): T {
  const matches = items.filter((i) => i.name === name)
  if (matches.length === 0) throw new LabResolutionError(`${kind} "${name}" not found in Copado.`)
  if (matches.length > 1)
    throw new LabResolutionError(`${kind} "${name}" is ambiguous (${matches.length} matches).`)
  return matches[0] as T
}

export async function resolveLab(copado: Copado, config: MutantConfig): Promise<LabContext> {
  const [environments, pipelines] = await Promise.all([copado.environments(), copado.pipelines()])
  const lab = exactlyOne(environments, config.labEnvironment, 'Lab environment')
  const source = exactlyOne(environments, config.sourceEnvironment, 'Source environment')
  const pipeline = exactlyOne(pipelines, config.pipeline, 'Pipeline')
  const connections = await copado.pipelineConnections(pipeline.id)
  const edge = connections.find(
    (c) => c.sourceEnvironmentId === source.id && c.destinationEnvironmentId === lab.id,
  )
  if (!edge) {
    throw new LabResolutionError(
      `Pipeline "${pipeline.name}" has no ${source.name} → ${lab.name} connection, so mutants can't be promoted into the lab.`,
    )
  }
  const credentialId = lab.credentials?.[0]?.id
  if (!lab.orgId || !credentialId) {
    throw new LabResolutionError(`Lab environment "${lab.name}" has no org credential in Copado.`)
  }
  return {
    pipeline,
    lab,
    source,
    labOrg: {pipelineId: pipeline.id, orgId: lab.orgId, credentialId},
    connection: {sourceBranch: edge.branch, destinationBranch: edge.destinationBranch},
  }
}

/** The Copado project mutant stories are created in: the one tied to the lab pipeline. */
export async function resolveProject(
  copado: Copado,
  config: MutantConfig,
  lab: LabContext,
): Promise<{id: string; name: string}> {
  const projects = (await copado.projects()).filter(
    (p) =>
      (p.pipelineId ?? p.pipeline?.id) === lab.pipeline.id && (!config.project || p.name === config.project),
  )
  if (projects.length === 1) return {id: projects[0]!.id, name: projects[0]!.name}
  if (projects.length === 0) {
    throw new LabResolutionError(
      `No Copado project uses pipeline "${lab.pipeline.name}"${config.project ? ` with name "${config.project}"` : ''}.`,
    )
  }
  throw new LabResolutionError(
    `Several Copado projects use pipeline "${lab.pipeline.name}" (${projects.map((p) => p.name).join(', ')}). Set "project" in .mutant/config.json.`,
  )
}
