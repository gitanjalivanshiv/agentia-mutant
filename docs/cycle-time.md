# Mutation cycle time

> **Status: NOT YET MEASURED.** The manual cycle (§4.5 of the brief) is blocked on:
> 1. CI/CD API key not configured (`agentia auth get --cicd` → `set: false`).
> 2. No lab environment chosen yet.
> 3. The configured CRT org has **zero projects**, so there is no CRT job to run.
>
> Numbers below marked *measured* are real; everything else is a placeholder to be replaced.

## Measured so far (read-only calls, 2026-10-04)

| Step | Command | Duration |
|---|---|---|
| CLI cold start + CRT API call | `agentia testing project list --json` | 5.1 s *measured* |

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
