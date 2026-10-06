import {Command} from '@oclif/core'

import {Copado, createAgentiaClient} from './agentia/index.js'

/** Shared plumbing: `--json` on every command (brief §2.10) and a Copado facade rooted at the project. */
export abstract class MutantCommand extends Command {
  static override enableJsonFlag = true

  protected copado(projectRoot: string): Copado {
    return new Copado(createAgentiaClient(projectRoot), projectRoot)
  }
}
