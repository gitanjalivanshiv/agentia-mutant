import path from 'node:path'

import {type AgentiaClient, ProcessAgentiaClient} from './client.js'
import {createRecorder, FakeAgentiaClient} from './fake.js'

export * from './client.js'
export * from './copado.js'
export {createRecorder, FakeAgentiaClient} from './fake.js'

/**
 * Chooses the client from the environment:
 * - `MUTANT_FAKE=<dir>`   replay recorded fixtures (CI, quickstart without an org)
 * - `MUTANT_RECORD=<dir>` real calls, each written as a scrubbed fixture
 * - otherwise             real `agentia` binary
 */
export function createAgentiaClient(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentiaClient {
  if (env.MUTANT_FAKE) return FakeAgentiaClient.fromDirectory(path.resolve(projectRoot, env.MUTANT_FAKE))
  const onExchange = env.MUTANT_RECORD
    ? createRecorder(path.resolve(projectRoot, env.MUTANT_RECORD))
    : undefined
  return new ProcessAgentiaClient({defaultCwd: projectRoot, bin: env.MUTANT_AGENTIA_BIN, onExchange})
}
