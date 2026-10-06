#!/usr/bin/env node
// Standalone entry point for trying Mutant without the Agentia CLI (e.g. `MUTANT_FAKE=… bin/run.js mutant doctor`).
// Inside Agentia, the same commands run as `agentia mutant …` after `agentia plugins link .`.
import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
