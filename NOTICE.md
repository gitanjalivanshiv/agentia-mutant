# Open-source components

Agentia Mutant is MIT-licensed (see [LICENSE](LICENSE)). It is built with the following open-source packages (direct dependencies; versions as locked in `package-lock.json`). Transitive dependencies are listed with their licences in `package-lock.json` / `node_modules/*/package.json`.

| Package | Version | Licence | Used for |
|---|---|---|---|
| `@oclif/core` | 4.14.0 | MIT | command framework (Agentia plugin model) (runtime) |
| `chalk` | 6.0.1 | MIT | terminal colours (runtime) |
| `execa` | 10.0.1 | MIT | spawning the agentia and git binaries (runtime) |
| `fast-xml-parser` | 5.11.2 | MIT | XML validation and baseline comparison (runtime) |
| `zod` | 4.6.5 | MIT | validating Agentia JSON output (runtime) |
| `@eslint/js` | 10.0.1 | MIT | linting (development) |
| `@types/node` | 22.20.5 | MIT | Node.js types (development) |
| `@vitest/coverage-v8` | 5.0.3 | MIT | test coverage (development) |
| `eslint` | 10.12.0 | MIT | linting (development) |
| `eslint-config-prettier` | 10.1.8 | MIT | linting (development) |
| `oclif` | 4.24.0 | MIT | plugin manifest (development) |
| `prettier` | 3.9.9 | MIT | formatting (development) |
| `shx` | 0.3.4 | MIT | build scripts (development) |
| `typescript` | 5.9.3 | Apache-2.0 | compiler (development) |
| `typescript-eslint` | 8.71.1 | MIT | linting (development) |
| `vitest` | 5.0.3 | MIT | tests (development) |

## Not bundled, used at runtime

- **Copado Agentia CLI** (`@copado/agentia-cli`): Mutant is a plugin for it and calls the public `agentia` binary; it is not redistributed here. Plugin scaffold generated with `@copado/create-agentia-plugin`.
- **git**: used to commit mutants in the local clone of the pipeline repository.
- The demo's Robotic Testing suite uses the QWeb/QForce libraries provided by Copado Robotic Testing.

The demo metadata in `examples/demo/force-app` is invented for this project; the Opportunity page layout starts from Salesforce's standard layout.
