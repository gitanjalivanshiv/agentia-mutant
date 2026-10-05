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
