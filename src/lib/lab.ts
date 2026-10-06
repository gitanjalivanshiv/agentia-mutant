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
