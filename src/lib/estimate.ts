/**
 * Run-time estimate from measured cycle times (docs/cycle-time.md, measured on the real
 * Dev2-SFP → INT-SFP lab, 2026-10-06). Later runs refine these with their own averages.
 */
export interface CycleTimings {
  /** One CRT suite run, start to xUnit. Measured 40–61 s. */
  testSeconds: number
  /** One Copado promotion with deploy into the lab. Measured 135–169 s. */
  promoteSeconds: number
  /** Story create + set + commit + publish + SFDX Commit job. Measured 69–118 s. */
  prepSeconds: number
  /** Fetch one component from the lab and compare with the baseline. Measured ~3 s. */
  verifySecondsPerComponent: number
}

export const MEASURED_TIMINGS: CycleTimings = {
  testSeconds: 50,
  promoteSeconds: 140,
  prepSeconds: 70,
  verifySecondsPerComponent: 3,
}

export interface Estimate {
  mutants: number
  /** Chained mode: each deploy reverts the previous mutant and applies the next, plus one final revert. */
  promotions: number
  testRuns: number
  totalSeconds: number
  breakdown: {label: string; seconds: number}[]
  timings: CycleTimings
}

/**
 * Chained run (decision 11): baseline test, then for each mutant one promotion (revert previous +
 * apply this) and one test run, then a final revert promotion and verification. Story prep for
 * all promotions happens up front (decision: batch promotion creation), before the timed loop.
 */
export function estimateRun(
  mutants: number,
  components: number,
  timings: CycleTimings = MEASURED_TIMINGS,
): Estimate {
  const promotions = mutants > 0 ? mutants + 1 : 0
  const breakdown = [
    {label: 'prepare and publish stories', seconds: promotions * timings.prepSeconds},
    {label: 'baseline test run', seconds: timings.testSeconds},
    {
      label: `${mutants} × (deploy + test)`,
      seconds: mutants * (timings.promoteSeconds + timings.testSeconds),
    },
    {label: 'final revert deploy', seconds: mutants > 0 ? timings.promoteSeconds : 0},
    {label: 'verify lab = baseline', seconds: components * timings.verifySecondsPerComponent},
  ].filter((b) => b.seconds > 0)
  return {
    mutants,
    promotions,
    testRuns: mutants + 1,
    totalSeconds: breakdown.reduce((sum, b) => sum + b.seconds, 0),
    breakdown,
    timings,
  }
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m}m ${String(rest).padStart(2, '0')}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}
