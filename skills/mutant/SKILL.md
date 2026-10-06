---
name: mutant
description: Use this skill when the user asks how good their Salesforce tests really are, whether their tests would catch a broken configuration, about test blind spots, test effectiveness, mutation testing or a mutation score, or wants confidence in their regression tests before a release. Agentia Mutant (`agentia mutant …`) deliberately breaks Salesforce configuration (validation rules, flows, fields, permission sets, page layouts) in a lab environment through Copado, runs the Copado Robotic Testing suite, reports which breakages the tests missed, and uses Copado AI to write tests for the blind spots.
---

<!-- Installed by `agentia mutant init`. Source: skills/mutant in agentia-plugin-mutant. -->

# Agentia Mutant

Mutant answers one question: **if this configuration broke, would our tests notice?** It makes one small, realistic breakage (a *mutant*) at a time, deploys it to a lab environment through Copado, runs the team's Robotic Testing suite and records whether a test failed (mutant **killed**: good) or everything stayed green (mutant **survived**: a blind spot). Mutation score = killed ÷ (killed + survived).

Run every command from the project folder that contains `.mutant/` (Copado auth can be folder-scoped) and add `--json` whenever you parse the output.

## Start Here

1. `agentia mutant doctor --json` (read-only). Every check must be `pass`; `warn` is acceptable for `ai` and `lock`. If anything fails, show the user each failing check's `detail` and `fix`, and stop.
2. `agentia mutant plan --json` (read-only). Show the user the mutant list (`mutants[].description`) and the estimate (`estimate.totalSeconds`, `estimate.promotions`). For a release, scope it: `--story <US-…>` (components changed in that user story) or `--components <…>`.
3. **Ask the user before running.** `agentia mutant run` deploys to the lab and takes minutes per mutant. Only with their approval: `agentia mutant run --plan <planFile> --yes --json`.
4. While it runs, the user must create one Copado promotion per story in Pipeline Manager (see [references/workflow.md](references/workflow.md)). Relay the story list exactly.
5. `agentia mutant report --json`, then explain the result (below).

## Safety Rules

- Mutant only deploys to `labEnvironment` in `.mutant/config.json`. **Never edit the config to point at another environment** unless the user explicitly asks, and never at anything that looks like production, UAT or staging. Never pass `--i-know-this-is-a-lab` on the user's behalf.
- Never run `agentia mutant run`, `heal --apply` or `reset` without the user's explicit go-ahead in this conversation.
- If `doctor` or `run` reports the org lock as held by another tool, wait. Never delete `~/hackathon/.org-busy` or any lock file.
- If a run fails with recovery steps, show them verbatim and do not improvise deploys.

## Explaining Results

- Lead with the score and the counts, then each **survivor** in plain language: what was broken (`description`), why the suite stayed green, and what a good test should check (`shouldCheck`).
- `invalid` mutants did not deploy and `error`/`timeout` ones could not be judged; none count toward the score. Say so instead of hiding them.
- Offer `agentia mutant heal` to have Copado AI propose tests for the survivors. Proposals land in `.mutant/runs/<id>/heal/` for **human review**.
- **Never run `heal --apply` until the user has reviewed and approved the proposed tests.** Then re-run the survivors and finish with `agentia mutant compare <before> <after>`.

## References

- Every command, flag and JSON field: [references/commands.md](references/commands.md)
- The run → promotions → heal → compare loop, resuming and resetting the lab: [references/workflow.md](references/workflow.md)

## Report Back

Report the mutation score, killed/survived/invalid counts, survivors in plain language, the run ID and the report path. Never include credentials, org IDs or record IDs.
