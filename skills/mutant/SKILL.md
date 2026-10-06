---
name: mutant
description: Use this skill when the user wants to know how good their Salesforce tests really are, before a release, or asks about mutation testing, test effectiveness, test blind spots, or "would our tests catch this config breaking". Agentia Mutant deliberately breaks Salesforce configuration (validation rules, flows, fields, permission sets, layouts) in a lab environment through Copado, runs the Copado Robotic Testing suite, and reports which breakages the tests missed.
---

<!-- Installed by `agentia mutant init`. Source: skills/mutant/SKILL.md in agentia-plugin-mutant. -->

# Agentia Mutant

Mutant answers one question: **if this configuration broke, would our tests notice?** It makes one small, realistic breakage (a "mutant") at a time, deploys it to a lab environment through Copado, runs the team's Robotic Testing suite, and records whether the tests failed (mutant **killed**, good) or stayed green (mutant **survived**, a blind spot). Mutation score = killed ÷ (killed + survived).

Always add `--json` when you will parse the output.

## Start Here

1. Run `agentia mutant doctor --json`. Every check must be `pass` (warnings are acceptable for `ai` and `lock`). If anything fails, show the user the `detail` and `fix` fields and stop.
2. Run `agentia mutant plan --json` and show the user the mutant list and the estimated duration before running anything.
3. Only run `agentia mutant run` after the user confirms. Runs deploy to the lab through Copado and take minutes per mutant.

## Safety Rules

- Mutant only ever deploys to `labEnvironment` from `.mutant/config.json`. **Never edit the config to point at another environment** unless the user explicitly asks, and never at anything that looks like production, UAT or staging.
- Do not pass `--i-know-this-is-a-lab` on the user's behalf.
- Respect the shared org lock: if `doctor` reports the lock as held by another tool, wait; do not delete the lock file.
- Run Mutant from the project folder that contains `.mutant/`: Copado auth can be folder-scoped.

## Explaining Results

- Explain each survivor in plain language: what was broken, why the suite stayed green, and what a good test would check (the report includes this as "a test should check …").
- Suggest `agentia mutant heal` to have Copado AI propose tests for the survivors.
- **Never apply healed tests (`heal --apply`) without the user reviewing and approving the proposed tests first.**

## Report Back

Report the mutation score, killed/survived/invalid counts, the survivors in plain language, and the run ID. Do not include credentials, org IDs or record IDs.
