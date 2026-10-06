# Mutation cycle time

> **Status: PARTIALLY MEASURED** (seed deploy done 2026-10-06; mutant cycle pending).
>
> Original blockers (all resolved): The manual cycle (§4.5 of the brief) is blocked on:
> 1. CI/CD API key not configured (`agentia auth get --cicd` → `set: false`).
> 2. No lab environment chosen yet.
> 3. The configured CRT org has **zero projects**, so there is no CRT job to run.
>
> Numbers below marked *measured* are real; everything else is a placeholder to be replaced.

## Measured so far (read-only calls, 2026-10-04)

| Step | Command | Duration |
|---|---|---|
| CLI cold start + CRT API call | `agentia testing project list --json` | 5.1 s *measured* |
| Create user story | `agentia cicd work create … --json` | 9 s *measured* |
| Activate story | `agentia cicd work set US-… --json` | 4 s *measured* |
| Publish (push, register, merge to dev2-sfp) | `agentia cicd work publish --json` | 25 s *measured* (+ ~60 s async SFDX Commit job) |
| `work submit --done` | — | fails in preflight (404), see decisions.md |
| Promote + deploy Dev2 → INT (5 components) | `agentia cicd promotion run <id> --operation merge_and_deploy --json` (waits) | **169 s** *measured* (merge job ~53 s, deploy job ~94 s) |
| Create + set + commit + publish (1 component, US-0000026) | `work create`, `work set`, `git commit`, `work publish` | 3 s + 5 s + 0 s + 13 s *measured*; async SFDX Commit job 20 s |
| Promote + deploy Dev2 → INT (1 component, P00002) | `promotion run … merge_and_deploy` | **135 s** *measured* (merge 37 s, deploy 67 s) |
| Baseline CRT run (1 UI test, green) | `testing test run <job> -p <proj> --wait-for-result --save-artifacts … --xunit … --json` | **50 s** *measured* (40–60 s across 6 runs) |

So every `agentia` spawn costs roughly 1–5 s of overhead before any real work.

## Cycle to measure (per mutant)

| # | Step | Command | Duration |
|---|---|---|---|
| 1 | Apply mutation + commit | `git commit` | ~0 s |
| 2 | Publish | `agentia cicd work publish --json` | TBD |
| 3 | Promote + deploy to lab | `agentia cicd work submit --done --skip-local-tests --skip-pull-request --json` | TBD |
| 4 | Wait for promotion/deploy job | `agentia cicd job get <id> --json` (poll) | TBD |
| 5 | Run CRT suite | `agentia testing build run <job> -p <proj> --json` → poll `build get` | TBD |
| 6 | Collect evidence | `build get --full`, `build logs -o …` | TBD |
| 7 | Revert commit + publish + promote/deploy | as 1–4 | TBD |
| 8 | Verify lab == baseline | `agentia cicd metadata content compare …` | TBD |

## Budget model (to fill in)

```
per_mutant = publish + promote_deploy + crt_run (+ revert_publish + revert_deploy if not chained)
run_total  = baseline_crt + N × per_mutant + final_verify
```

Target: 10–12 mutants per demo run.
