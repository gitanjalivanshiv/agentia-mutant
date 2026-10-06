# Architecture

Agentia Mutant is an oclif plugin for the Agentia CLI. It never imports Agentia internals: **every** Copado interaction spawns the public `agentia` binary with `--json` and parses stdout.

```
agentia mutant <command>                       (src/commands/mutant/*.ts)
        │
        ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ Operators  src/operators/     pure functions: Source Format XML → mutants  │
 │ Planner    src/lib/planner.ts recency + survival history + type variety    │
 │ Runner     src/lib/runner/    baseline → stories → promotions → deploy →   │
 │                               test → classify → revert → verify (resumable)│
 │ Scorer     runner/classify.ts killed / survived / invalid / timeout / error│
 │ Healer     src/lib/heal/      Copado AI Test agent → reviewed tests → CRT  │
 │ Reporter   src/lib/report/    terminal · JSON · Markdown · offline HTML    │
 │ Safety     config.ts lock.ts doctor.ts drift.ts                           │
 └───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 Copado facade   src/lib/agentia/copado.ts   typed, zod-validated, read retries
 AgentiaClient   src/lib/agentia/client.ts   spawn `agentia … --json`
                 src/lib/agentia/fake.ts     replay + record (MUTANT_FAKE / MUTANT_RECORD)
        │
        ▼
 Copado CI/CD · Copado Robotic Testing · Copado AI     (+ git in the pipeline-repo clone)
```

## The deploy path (why it looks like this)

Measured on a real Copado Source Format pipeline (docs/cycle-time.md, docs/decisions.md):

- A mutant reaches the lab only through a **Copado promotion with deploy** from the source environment. `work submit --done` fails in a preflight on the test org, and the CLI has no promotion-create command, so the user creates promotions in Pipeline Manager — **all of them in one sitting** — and Mutant matches each to its story (`promotion get` → `userStories`) and runs it (`promotion run --operation merge_and_deploy`).
- A promoted story moves to the lab environment, so **every deploy uses a fresh story** from the source environment.
- **Chained, self-healing deploy units:** unit *k* writes the baseline of every component touched by mutants 0…k−1 plus mutant *k*; the last unit restores all baselines. N mutants cost N+1 promotions, and a failed deploy never leaves the next unit in an unknown state.
- **Safety check before every deploy:** the promotion must be source → lab, not a back-promotion, contain exactly that story, and be in a runnable status.
- **Verify:** each touched component is fetched from the lab through Copado (`cicd metadata content get --source ENVIRONMENT`) and compared with the baseline file ("baseline ⊆ org", tolerant of formatting, ordering and omitted `false` defaults).

## Run state

```
.mutant/
  config.json                 lab, source, pipeline, CRT project/job, budget (git-ignored)
  plans/<timestamp>.json      mutant list, baseline hash, mutated-file hashes, estimate
  runs/<run-id>/
    state.json                phase + per-unit progress, saved atomically after every step
    plan.json                 the plan this run executed
    results.json              per-mutant outcome, killers, durations, evidence paths
    artifacts/<label>/        CRT artifacts.zip + xunit.xml (explicit paths)
    verify/                   lab copies used for verification
    heal/                     AI proposals (*.robot), suite.diff, heal.json
    report.html, compare.html
```

`run --resume` continues from `state.json` after a crash, a pause for promotions, or a network failure. Reset runs (`reset-…`) reuse the same runner with a single "restore baseline" unit.

## Concurrency and shared playground

- `~/hackathon/.org-busy` is a shared lock with the Time Machine project; Mutant takes it (O_EXCL) for every write and never deletes another tool's lock.
- Mutant writes only to `labEnvironment` and never touches data templates.
- CRT auth is folder-scoped (`agentia auth set --crt … --local`), so `AgentiaClient` always runs with the project root as cwd; lab-clone git/`work` commands pass the clone explicitly.

## Testing

- Operators: real demo XML + invented samples (applies, skips, minimal diff, well-formed output).
- Runner: a simulated Copado/Salesforce lab that tracks org metadata, plays the user who creates promotions, and checks the lab really ends at the baseline (happy path, red baseline, failed deploy, pause/resume, Ctrl-C, unsafe promotion, drift after revert, reset run, network errors).
- Doctor: unit tests with fakes plus a replay of a scrubbed recording of the real lab (`fixtures/doctor`).
- Reports, heal and compare: the real Copado AI reply and real run results (scrubbed).
- CI runs lint, typecheck, build, tests and the offline quickstart; it never talks to Copado.
