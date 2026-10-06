# Decisions and deviations from the brief

Each entry: what the brief assumed, what the real CLI does, what we do.

## 2026-10-04 — Phase 0 discovery (agentia-cli 1.0.0-beta.2)

1. **Agentia skills live globally, not in the project.** `~/.agents/skills/agentia-{cicd,testing,ai}`; the project has no `.agents/skills`. `mutant init` will install our skill to the project's `.agents/skills/mutant` (and `.claude/skills/mutant` if present) and fall back to telling the user to run `agentia setup skills update`.
2. **AI auth never reports `ready`.** `auth get --ai` returns `set: true, ready: null`. `doctor` treats AI as ready when `set` is true **and** `ai quota get` succeeds.
3. **Parse errors are huge.** With `--json`, a missing-flag error embeds the whole oclif config (~750 KB). `AgentiaClient` reads only `error.message/name/code` and never logs raw payloads.
4. **Error exit code is 1 for everything** (API errors and parse errors alike); JSON goes to stdout even on failure.
5. **`work submit` without `--done` is validate-only.** Deploying a mutant to the lab requires `work submit --done` (promote + deploy). Each real mutant deploy is therefore a Copado promotion: the lab must be the *next* pipeline environment after the lab story's source environment.
6. **Permission set mutations need `--full-metadata PermissionSet:<name>` on publish**, otherwise publish sends only RetrieveOnly nested entries and a *removed* permission might not travel. To verify in Phase 4.
7. **`cicd work promote --deploy` is off-limits** — it deploys with `sf project deploy start` directly, which would bypass Copado's deploy path.
8. **Revert verification** uses `cicd metadata content compare` (ENVIRONMENT vs REPOSITORY branch) per mutated component.
9. **`agentia_ai_ask --agent test`** exists and accepts `--component`/`--user-story` context — good fit for `heal`.
10. **CI/CD auth is project-scoped.** The user's key lives in `~/.agentia/config.user.json` (home folder "project"), so it is invisible from `~/hackathon/mutant`. Fix: run `agentia setup` (or `agentia auth set --cicd … --local`) inside this folder. Each project keeps its own `--local` auth so neither session's reconfiguration affects the other.
11. **Deploy strategy: chained mutants (option A), chosen by Claude at the user's request.** One long-lived lab user story. Commit *k* reverts mutant *k−1* and applies mutant *k*; one final revert commit restores baseline, followed by verification. N+1 Copado promotions per run instead of 2N. Trade-off: a crash mid-run leaves one mutant live in the lab, so `run --resume` and `doctor` must detect and finish the revert.

## Coordination with Agentia Data Time Machine (same Copado playground)

| Shared thing | Rule |
|---|---|
| Copado org writes | Both check `~/hackathon/.org-busy` before writing; holder writes `<project>: <action> started <time>`, removes it in `finally`. |
| Environments | Mutant writes metadata only to `labEnvironment`. Time Machine never deploys to Mutant's lab; Mutant never touches data templates or TM's environment. |
| User stories | Mutant uses its own dedicated lab story (title prefixed `Mutant Lab –`). Never reuse a TM story. |
| Agentia auth | Project-local (`--local`) in each folder; never change the global keychain entries. |
| `.agentia/config.user.json` | Per-project folder; `work set` in one project does not affect the other. |
| CRT | Mutant creates its own CRT project (prefixed `Mutant –`). |
| Git repository | The pipeline's repo is shared with Time Machine. Mutant only commits on its own `feature/<Mutant Lab story>` branch; Copado merges it into `dev2-sfp` and `int-sfp`. Mutant never pushes to `main`, `dev1-sfp`, or Time Machine branches. The local clone lives in `~/hackathon/mutant-lab/`, separate from this plugin repo. |
| Environments (assigned) | Mutant: source **Dev2-SFP** → lab **INT-SFP** (user-approved 2026-10-04). Time Machine: **Dev1-SFP**. |

## 2026-10-04 — Blockers found while preparing the measured cycle
- **Pipeline Git repo access:** private repo, SSH key not loaded, `gh` account has no access → cannot clone for the local flow.
- **CRT permissions:** the configured PAK sees zero projects and `testing project create` returns 403. A CRT admin must create the project (or grant the PAK's user a role that can).
- **Resolved (2026-10-05):** CRT now uses a second account in a different CRT region/org, stored with `agentia auth set --crt … --local` in this folder only (`source: "local"`). Mutant's CRT project, robot and job were created there. CRT IDs live only in the git-ignored `.mutant/config.json`.
- **Resolved:** GitHub collaborator access granted; pipeline repo cloned to `~/hackathon/mutant-lab` with a repo-local `gh` credential helper.
- **AI workspace:** a Copado AI workspace "Mutant – Discount Approval Lab" exists; `heal` passes it via `--workspace`.

## 2026-10-05 — Seed attempt (US-0000025)
- `work create` 9 s, `work set` 4 s, `work publish` 25 s (+ ~60 s server-side "SFDX Commit" job, Successful). Brand-new PermissionSet auto-sent as `fullMetadata`.
- **`work submit --done` fails in preflight**: `GET /agentia/headless/work/user-stories-ahead-behind` → `CicdGatewayError` 404. No promotion created; INT untouched. CLI 1.0.0-beta.2 is the newest published. `promotion list --work-id <id>` also fails (500; id sent truncated to 15 chars). Both look like the org's Copado gateway being older than the CLI. Reported to the user; awaiting choice of workaround.
- `CicdGatewayError` shape: `{ name, message, statusCode, requestMethod, requestUrl, categories[] }` (`requestUrl` has the API key masked, still never log it).
- **Workaround adopted (user's choice):** the user creates the promotion in the Copado UI (Pipeline Manager, Dev2 → INT, "Create Promotion", not run); Mutant runs it with `agentia cicd promotion run <id> --operation merge_and_deploy --json`. Seed P00001: 169 s, Completed.
- **Confirmed: a promoted story moves.** After P00001, US-0000025's `sourceEnvironmentName` is `INT-SFP`. Re-submitting it would target UAT. Therefore **each mutant deploy uses a fresh `Mutant Lab –` story from Dev2-SFP**, and the runner refuses any promotion whose source ≠ Dev2-SFP or destination ≠ INT-SFP. US-0000025 is retired.
- `promotion run` result keys: `promotionId, operation, mode, promotionBefore, promotionAfter, jobMonitors[{jobExecutionId, jobExecutionStatus, deploymentDryRun, executionSteps}], deploymentSteps, wait, run, request, resultId, context`.
- `promotion list --name P… --json` ✅ works (paged `data[]` with `status, sourceEnvironmentName, destinationEnvironmentName, isBackPromotion, …`).

## 2026-10-06 — Baseline CRT bring-up
- CRT variables must be **type `secret`** (the default) to reach Robot Framework as `${name}`; type `config` is not injected. Non-secret values use `--type secret --not-sensitive`.
- Run evidence: `testing test run <job> -p <proj> --wait-for-result --no-exit-code --save-artifacts <zip> --xunit <xml> --json` → 40–60 s per run for one UI test; the zip contains `screenshots/*.png` on failure; xUnit `<failure message>` is the classifier's evidence. Async `build run` + `build get` polling also works (`status: executing|failed|…`, `logReportUrl`).
- Salesforce login pages vary (classic / username-first / email-first). The suite logs in by typing the username, pressing Enter, then typing the password and pressing Enter.
- The demo app needs the **Opportunity page layout** (fields weren't on it). Layout fetched with `cicd metadata content get --metadata-type Layout --api-name "Opportunity-Opportunity Layout" --source ENVIRONMENT …` (2–3 s, identical in Dev2 and INT). This also enables the `LAYOUT_FIELD_REMOVE` operator.

## 2026-10-06 — First measured mutation cycle (M1)
- M1 `VR_DEACTIVATE` Discount_Max: stories US-0000027 (mutant) / US-0000028 (revert), promotions P00003 / P00004. Result **survived**. INT verified identical to baseline afterwards.
- **Run `agentia` from the plugin folder.** CRT auth is `--local` to `~/hackathon/mutant`; running from the lab clone silently fell back to the old global CRT key (404 on a different CRT host). `AgentiaClient` must spawn with `cwd` = the Mutant project root, and the lab-clone git/`work` commands must pass the lab clone as `cwd` explicitly — and `doctor` should check both resolve the expected auth sources.
- **Feature branches start from `main`, which lacks the demo app.** Each story branch therefore *adds* the component file; Copado's merges into `dev2-sfp`/`int-sfp` resolved these add/add situations without conflicts (pipeline has smart conflict resolution enabled). Watch for this in Phase 4.
- **Verification method:** `cicd metadata content get --metadata-type ValidationRule --api-name Opportunity.Discount_Max --source ENVIRONMENT` (3 s) + canonical XML compare ignoring `fullName`. Simpler and more predictable than `content compare`; adopt for the runner's verify step.
- **Open: promotions need a human click.** `work submit` is blocked (gateway 404) and the CLI has no promotion-create command. Options proposed to the user in the Phase 0 report.
- **Promotion creation: option A chosen (2026-10-06).** `mutant run` prepares and publishes every mutant story (plus the final revert) up front, then prints the list of stories for the user to "Create Promotion" in Pipeline Manager in one sitting; the runner polls `promotion list` until each Draft promotion exists and then executes them in order, unattended.

## 2026-10-06 — Phase 1 (scaffold, AgentiaClient, init, doctor)
- Scaffolded with `npm init @copado/agentia-plugin` (`@copado/create-agentia-plugin@0.3.0`; interactive only — answers fed line by line) and linked with `agentia plugins link .`. Package `agentia-plugin-mutant`, topic `mutant`.
- Plugin commands' `--json` output is oclif's raw return value (no `{result,status}` envelope like core Agentia commands); exit code 1 when `doctor` is not ready.
- `cicd pipeline connection list` returns a **bare array**, unlike the paged `environment list` / `pipeline list`; schemas accept both.
- Salesforce omits `false` boolean elements (e.g. `externalId`) when Copado fetches content; the baseline compare treats a missing element as `false`.
- Record mode (`MUTANT_RECORD=<dir>`) writes scrubbed exchanges, including small text files written via `--output-file`; replay (`MUTANT_FAKE=<dir>` / `FakeAgentiaClient.fromDirectory`) matches on args with output paths normalised to `<path>`. Scrubbing: Salesforce IDs (incl. org IDs) → consistent placeholders, CRT numeric IDs (also inside paths) → placeholders, UUIDs, emails, URLs, ssh repo URIs, people's names, home directory → `~`.
- `fixtures/doctor/` is a scrubbed recording of the first real `agentia mutant doctor` pass against INT-SFP (12/12); `test/doctor-replay.test.ts` replays it offline.

## 2026-10-06 — Phase 2 (operators)
- 11 declarative operators (the brief's 10 + `CHECKBOX_DEFAULT_FLIP`); `APEX_COND_FLIP` stays a stretch goal. See docs/operators.md (generated from the registry).
- Operators edit XML text by offsets via a small position-aware element tree (`src/lib/xml.ts`) instead of fast-xml-parser round-trips, so diffs are minimal and formatting is untouched. fast-xml-parser is still used for validation and for the baseline compare.
- `FLOW_DROP_ASSIGNMENT` bypasses single-item assignments (rewire or remove the connectors leading to them) because an empty assignment would not deploy. Deployability of the "remove default connector" variant (Clear_Approval) is to be confirmed in Phase 4; if Salesforce rejects it, it is classified `invalid`, not counted.
- The unified diff slides change runs to whole XML blocks (git-style heuristic) so report diffs read cleanly.
- Demo app yields 15 mutants; `FIELD_REQUIRED_OFF` and `PICKLIST_DEFAULT` have no targets there and are covered by invented samples in test/samples/.

## 2026-10-06 — Phase 3 (planner + `mutant plan`)
- Selection: score = 0.6 × recency (git commit time of the component file, or 1.0 inside `--story`) + 0.4 × historical survival rate of the operator (0.5 when unknown). Variety is enforced by round-robin over metadata types, preferring an unused operator, then an unused component. Deterministic.
- `--story <US>` resolves components from the story's branch diff in the lab clone (`cicd work get` → `projectPipelineMainBranch`, `git fetch`, `git diff origin/<main>...origin/feature/<US>`); read-only.
- Estimate models the chained, batch-promotion run (decisions 11 and option A): (N+1) × prep up front, baseline test, N × (deploy + test), final revert deploy, per-component verify. Defaults are the measured timings; later runs' `results.json` averages override them.
- Plans store the baseline hash and each mutant's mutated-file sha256 so `mutant run` can refuse a stale plan; they are written to `.mutant/plans/` (git-ignored) plus `latest.json`.

## 2026-10-06 — Phase 4 (runner) and the first real run
- **Real 3-mutant run completed end to end; INT-SFP verified identical to the baseline afterwards.** Stories US-0000029…32, promotions P00005…08 (created by the user in one sitting and matched automatically).
- `promotion get` returns the **15-char** ID in `id` and the name in `identification.promotionName`; `promotion run` accepts only the **18-char** ID, which `promotion list` returns. The runner stores the list ID.
- The CLI reports a failed deploy job as an error envelope ("Promotion job … finished with status Error: …"); the runner treats that as a deploy that ran (→ `invalid`), while a request rejected before any job starts is `error` (a Mutant/CLI problem, not a mutant property).
- `run --resume` may retry a **failed** run when no deploy ever started (the lab is untouched): same stories, promotions re-matched.
- `FLOW_DROP_ASSIGNMENT` must keep `<defaultConnectorLabel>` when removing a decision's default connector: Salesforce rejected the mutant with "Enter a label for the default outcome". Operator fixed.
- **Open:** `PERMSET_FLS_REVOKE` (edit on Discount_Percent__c) **survived** although Copado deployed the permission set as Full (P00006, jobs Successful) and the Standard User profile grants no access to the field. The robot user must get edit access from another profile/permission set; to confirm with the user. Until then the demo's permission-set mutants measure nothing.
- Permission sets are published with `--full-metadata PermissionSet:<name>` (decision 6 confirmed: Copado shows the change as action "Full").

## 2026-10-06 — Phase 5 (scorer + report)
- One report model from `results.json` feeds four outputs: terminal summary, JSON (`--format json` / `--json`), Markdown (`--format md`, for PRs/Slack) and a single-file HTML report.
- HTML report: no scripts, external fonts, stylesheets or images (asserted by tests), light/dark via `prefers-color-scheme` (plus `data-theme`), responsive to phone width, print-friendly. Sections: score dial + counts + verified-lab line, blind-spot cards (description, "a test should check", diff, healed badge), per-type table, caught list (killing test + message), not-scored list, flaky tests. A before/after block is ready for `mutant compare`.
- `mutant run` writes `report.html` into the run directory when it finishes.
- `test/fixtures/results-mixed.json` is a **synthetic** results file built from the demo app's real mutants, used only by tests.

## 2026-10-06 — Phase 6 (`heal` + `compare`)
- `agentia ai agent ask --agent test --no-stream --no-credential-sync --workspace <ws> --json` → `result: {content, completed, dialogueId, warnings, …}`. Observed: `completed: false` with warning "AI stream ended before stream_complete" although the content was complete; `heal` accepts a reply only if it contains a complete robot code block, and retries once otherwise. ~60–140 s per proposal.
- The prompt is grounded in the breakage, its diff, "a test should check" and the **live** CRT suite (downloaded with `testing job download --output-dir`), so proposals reuse the suite's keywords. Replies are vetted: forbidden keywords (Run Process, OS/Process libraries, Evaluate with os/subprocess, record deletion) are rejected.
- Proposals are files the human reviews and may edit (`.mutant/runs/<id>/heal/*.robot`, plus `suite.diff`); nothing touches Copado until `heal --apply`, which re-reads the edited files, merges into the *current* remote suite (warns if it changed), shows the diff, asks for confirmation (or `--yes`) and uploads with `testing job upload --replace`. It then writes `.mutant/plans/heal-<run>.json` that re-runs only the healed survivors.
- `compare <a> <b>`: mutants B didn't re-run keep A's outcome (adding tests can't un-catch a breakage). Newly caught survivors get `healedBy`, which the report shows as "✔ now caught by …" and counts as caught.

## 2026-10-06 — Phase 6 gate: the score goes up for real
- `heal` on run r-20261006-114841 proposed 2 tests (≈4.5 min). Human review fixed one: the AI inline-edited a field the record page doesn't show on its default tab; edited to use Edit → Details. Re-applied with `heal --apply --force`.
- Survivors-only re-run r-20261006-133159 (stories US-0000033…35, promotions P00009…11): baseline green with 3 tests, **both survivors killed**, INT verified identical to the baseline. `compare`: **0% → 100%** on those mutants.
- **Root cause of the "permission set" survivor (Phase 4 open item): the original test, not the robot user.** With edit revoked, Salesforce still let the robot type into Discount Percent on the create form, but the value was not saved. The happy-path test never checked the saved value, so it passed. The healed tests check persisted values / error messages and fail. No change to the robot user is needed.
- `compare` credits the test `heal` wrote for a mutant when it is among the killers (otherwise the first failing test).
- The baseline gate caught a broken AI-written test before anything was deployed (r-20261006-132706): proposals must pass on the clean lab.

## 2026-10-06 — Phase 7 (skill, demo, seed/reset)
- The Agent Skill is a folder (`SKILL.md` + `references/commands.md` + `references/workflow.md`), mirroring the Agentia skills. `mutant init` installs the whole folder into `.agents/skills/mutant` (and `.claude/skills/mutant` when `.claude/` exists), pruning files no longer shipped; `init --skill-only` refreshes it without touching the config.
- **Skill gate passed:** a fresh headless Claude Code session, with the build brief removed and only read-only tools allowed, loaded the skill unprompted, ran `doctor` first, stopped on a failing check and laid out plan → ask → run → report (docs/agent-skill-test.md).
- `agentia mutant reset` (used by `examples/demo/seed.sh` with `--force` and `reset.sh`): drift check; if needed, ONE story deploying the whole baseline through Copado (a `reset` run kind on the same runner: promotion matching, safety checks, verify, resume); with `--suite`, restores the CRT suite file. Reset runs are named `reset-…` and are ignored by "latest run" lookups.
- The CICD gateway is intermittently flaky (alternating 500 and "Unauthorized" within seconds, auth unchanged). The Copado facade now retries **read-only** calls (get/list/status/files/download) up to 3 times with backoff; writes are never retried automatically.
- Drift comparison is one shared module (`src/lib/drift.ts`) used by doctor, the runner's verify step and reset.

## 2026-10-06 — Phase 8 (packaging)
- Offline quickstart (`examples/quickstart/run.sh`): Copado calls replayed from `fixtures/doctor` (`MUTANT_FAKE`), reports from two real runs copied with the scrubber; the flow mutant of the first run was re-classified with the current rules from its recorded deploy evidence (`invalid`). Fresh clone → `npm ci` → build → quickstart: 8 s with a warm npm cache. Runs in CI.
- `bin/run.js` runs the commands standalone (no Agentia CLI needed) for the quickstart; inside Agentia they are `agentia mutant …`.
- A full leak scan found real identifiers used as scrubber test inputs and a private repository name in one fixture; replaced with invented values **throughout the history** (rewritten before the first push), the build brief was removed from the repository, and commits use the author's GitHub noreply address.
