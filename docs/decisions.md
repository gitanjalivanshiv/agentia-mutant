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
