# Mutation cycle time

> **Status: MEASURED** — one full mutation cycle (M1, `VR_DEACTIVATE` on `Discount_Max`) completed 2026-10-06.
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

## Measured mutation cycle M1 (2026-10-06)

`VR_DEACTIVATE` on `Opportunity.Discount_Max` → **survived** (happy-path suite stayed green).

| # | Step | Command | Duration |
|---|---|---|---|
| 1 | New story from Dev2 | `cicd work create --source-credential <Dev2>` | 2 s |
| 2 | Activate | `cicd work set US-… --json` | 4 s |
| 3 | Apply mutation + commit | edit XML, `git commit` | ~0 s |
| 4 | Publish | `cicd work publish --json` | 14 s |
| 5 | Wait for SFDX Commit job | poll `cicd job get` | 49 s |
| 6 | *(human)* Create Promotion in Pipeline Manager | — | manual |
| 7 | Safety check + promote/deploy to INT | `cicd promotion list --name`, `cicd promotion run … merge_and_deploy` | 142 s |
| 8 | Run CRT suite + evidence | `testing test run … --wait-for-result --save-artifacts --xunit` | 51 s |
| 9 | Revert story: create + set + commit + publish + commit job | as 1–5 | 118 s |
| 10 | *(human)* Create Promotion | — | manual |
| 11 | Promote/deploy revert | `cicd promotion run …` | 139 s |
| 12 | Verify INT == baseline | `cicd metadata content get --source ENVIRONMENT` + semantic XML compare | 3 s |
| | **Total machine time** | | **≈ 522 s (8.7 min)** + 2 manual clicks |

Observed spread across 4 promotions: 135–169 s (1-component ≈ 135–142 s). Commit job: 20–60 s. CRT run: 40–61 s.

## Budget per demo run

Chained mode (deploy *k* = revert *k−1* + apply *k*, one promotion per mutant):

```
per_mutant ≈ prep 70 s + promote 140 s + test 50 s ≈ 260 s (4.3 min)
prep of mutant k+1 can overlap promote+test of mutant k → ≈ 190 s (3.2 min)
run_total(N) ≈ baseline 50 s + N × per_mutant + final revert 210 s + verify
```

| N | Sequential | With prep overlap |
|---|---|---|
| 3 | ~18 min | ~14 min |
| 10 | ~48 min | ~37 min |
| 12 | ~57 min | ~43 min |

**10–12 mutants per demo run are affordable** (time-lapsed video), provided promotions don't need a human click each (see decisions.md).

## First real `agentia mutant run` (3 mutants, 2026-10-06, run r-20261006-114841)

| Step | Duration |
|---|---|
| Doctor (12 checks incl. drift) | ~40 s |
| Baseline CRT run | 52 s |
| Prepare + publish 4 stories (incl. commit jobs) | ~4 min |
| User creates 4 promotions | manual (~2 min) |
| Unit 1 deploy (1 component) / test | 239 s / 41 s |
| Unit 2 deploy (2 components, permission set Full) / test | 235 s / 41 s |
| Unit 3 deploy (3 components) — rejected by Salesforce | 108 s |
| Final revert deploy (3 components) | 149 s |
| Verify 3 components | ~10 s |
| **Wall clock (excluding the earlier promotion-ID retry)** | **≈ 24 min** |

Deploys inside a run were slower than the earlier single-component promotions (235–239 s vs 135–169 s). `mutant plan` learns from each run's `results.json`, so estimates now use the observed averages.

## Heal + survivors-only re-run (r-20261006-133159)

| Step | Duration |
|---|---|
| `heal`: 2 Copado AI proposals (Test agent) | ≈ 4.5 min |
| `heal --apply` (CRT upload) | ≈ 10 s |
| Baseline with 3 tests | ≈ 2 min |
| Prepare 3 stories | ≈ 3 min |
| 2 × (deploy + test, 3 tests) + final revert + verify | ≈ 14 min |
