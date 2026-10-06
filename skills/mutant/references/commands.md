# Agentia Mutant commands

All commands accept `--json` (output: the command's result object, no envelope) and `--help`. Exit code 1 means "not ready / failed"; 2 means a usage error.

| Command | Writes to Copado? | Purpose |
|---|---|---|
| `agentia mutant init` | no | Create `.mutant/config.json` (verified against Copado) and install this skill |
| `agentia mutant doctor` | no | Readiness and safety checks |
| `agentia mutant plan` | no | Choose mutants and estimate the run time |
| `agentia mutant run` | **yes** (lab only) | Deploy mutants through Copado, run tests, score |
| `agentia mutant report [run-id]` | no | Score, blind spots, per-type breakdown; writes HTML/Markdown/JSON |
| `agentia mutant heal [run-id]` | no | Ask Copado AI for tests that catch the survivors (proposals only) |
| `agentia mutant heal [run-id] --apply` | **yes** (CRT job) | Upload the reviewed tests; writes a survivors-only re-run plan |
| `agentia mutant compare <a> <b>` | no | Before/after score |
| `agentia mutant reset` | **yes** (lab + CRT job) | Restore the lab metadata and the test suite to the demo baseline |

## doctor

`agentia mutant doctor [--skip-drift] --json` → `{ok, summary: {pass, warn, fail, skip}, checks: [{id, title, status, detail, fix?}]}`.
Check IDs: `node`, `config`, `lab-name`, `cicd-auth`, `pipeline`, `lab-auth`, `crt-auth`, `crt-job`, `ai`, `lab-repo`, `lock`, `drift`. `drift` compares every baseline component in the lab with the package directory (takes ~3 s per component).

## plan

`agentia mutant plan [--max N] [--story US-…] [--components a,b] [--operators A,B] [--mutants id,id] [--list] [--output file] --json`
→ `{planFile, candidates, mutants: [{id, operator, component: {type, apiName}, description, shouldCheck, diff, priority: {score, reasons}}], notSelected, estimate: {totalSeconds, promotions, testRuns, breakdown}}`.
- `--list` prints every possible mutant ID in scope; `--mutants` picks exact IDs in order.
- Mutant ID format: `<OPERATOR>:<MetadataType>:<apiName>:<site>`.
- Plans are saved in `.mutant/plans/` (and `latest.json`).

## run

`agentia mutant run [--plan file] [--yes] [--dry-run] [--baseline-twice] [--promotion-wait minutes] [--resume run-id|latest] --json`
→ `{runId, outcome: done|failed|awaiting-promotions|dry-run, phase, score: {killed, survived, invalid, timeout, error, score}, resultsFile, reportFile, failure?, storiesAwaitingPromotion?}`.
- `--yes` is required with `--json`. `--dry-run` shows the stories/deploys and writes nothing.
- `outcome: awaiting-promotions` is a pause, not a failure: nothing was deployed; resume with `--resume <runId>` after the promotions exist.
- Outcomes per mutant: `killed` (with `killedBy[].name`), `survived`, `invalid` (did not deploy), `timeout`, `error`.

## report

`agentia mutant report [run-id] [--format html|md|json] [--output file]` → writes `.mutant/runs/<id>/report.<ext>`; JSON includes `percent`, `score`, `byType[]`, `survivors[]`, `killed[]`, `other[]`.

## heal

`agentia mutant heal [run-id] [--only id,id] [--force]` → `{proposals: [{mutantId, file, testNames, status: proposed|failed, error?}], nextSteps}`. Uses the Copado AI **Test** agent, grounded in the live CRT suite. Proposals: `.mutant/runs/<id>/heal/*.robot` (editable) and `suite.diff`.

`agentia mutant heal [run-id] --apply --yes` → uploads the reviewed tests (merged into the current suite) and writes `.mutant/plans/heal-<run-id>.json`. `--force` re-applies edited proposals if the suite is unchanged since Mutant uploaded it.

## compare

`agentia mutant compare <before> <after>` → `{comparison: {before: {percent, killed, survived}, after: {…}, newlyCaught: [{description, by}]}, reportFile}`. Mutants the after-run did not re-run keep their earlier outcome.

## reset

`agentia mutant reset [--suite local.robot] [--yes] [--force]`: checks drift; if the lab differs from the baseline (or `--force`), deploys the baseline through one Copado story/promotion (the user creates the promotion) and verifies it; with `--suite`, replaces the CRT suite file with that local file.
