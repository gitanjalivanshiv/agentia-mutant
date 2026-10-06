import type {Plan} from '../planner.js'

/**
 * killed:   a baseline-passing test failed with the mutant deployed (good: the suite noticed)
 * survived: every baseline-passing test still passed (a blind spot)
 * invalid:  the mutant failed to deploy (not counted in the score)
 * timeout:  deploy + test exceeded the per-mutant budget (reported separately)
 * error:    the test run itself broke (no result); not counted
 */
export type Outcome = 'killed' | 'survived' | 'invalid' | 'timeout' | 'error'

export interface TestCaseResult {
  name: string
  classname: string
  status: 'passed' | 'failed' | 'skipped'
  message?: string
}

export interface TestRunRecord {
  buildId?: number
  status?: string
  seconds: number
  tests: TestCaseResult[]
  /** Paths relative to the run directory. */
  artifacts: {archive?: string; xunit?: string}
  error?: string
}

/**
 * One Copado deploy. Unit k applies mutant k on top of a lab where every component touched by
 * earlier mutants is written back to its baseline; the last unit restores the baseline only.
 * That makes every unit self-healing: a failed deploy never leaves the next one in an unknown state.
 */
export interface DeployUnit {
  index: number
  /** Mutant applied by this unit; undefined for the final revert unit. */
  mutantId?: string
  /** Package-relative file → content to write in the lab clone. */
  files: Record<string, string>
  /** `Type:apiName` of every component this unit writes. */
  components: string[]
  title: string
  story?: {id: string; name: string}
  commitJobId?: string
  committed?: boolean
  promotion?: {id: string; name: string}
  deploy?: {
    ok: boolean
    /** False when Copado never started a deploy job (the request itself was rejected). */
    started?: boolean
    seconds: number
    message?: string
    jobIds: string[]
    timedOut?: boolean
  }
}

export interface MutantResult {
  id: string
  operator: string
  component: {type: string; apiName: string}
  file: string
  description: string
  shouldCheck: string
  diff: string
  outcome?: Outcome
  /** Tests that failed because of this mutant. */
  killedBy?: {name: string; message?: string}[]
  reason?: string
  durations?: {deploySeconds?: number; testSeconds?: number}
  story?: string
  promotion?: string
  test?: TestRunRecord
}

export type Phase =
  | 'created'
  | 'baseline'
  | 'prepare'
  | 'awaiting-promotions'
  | 'mutants'
  | 'revert'
  | 'verify'
  | 'done'
  | 'failed'

export interface Score {
  killed: number
  survived: number
  invalid: number
  timeout: number
  error: number
  /** killed / (killed + survived); undefined when nothing was scored. */
  score?: number
}

export interface RunState {
  version: 1
  runId: string
  /** `reset`: one deploy that restores the lab to the baseline (no baseline tests, no mutants). */
  kind?: 'mutation' | 'reset'
  phase: Phase
  createdAt: string
  updatedAt: string
  finishedAt?: string
  plan: Plan
  lab: {environment: string; source: string; pipeline: string}
  baseline?: {runs: TestRunRecord[]; flaky: string[]; passing: string[]}
  units: DeployUnit[]
  mutants: MutantResult[]
  verify?: {ok: boolean; drifted: string[]; checkedAt: string}
  score?: Score
  /** Human-readable reason when phase is `failed`. */
  failure?: string
}
