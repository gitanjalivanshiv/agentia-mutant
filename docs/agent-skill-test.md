# Agent Skill test: does Claude Code follow the skill unprompted?

**Date:** 2026-10-06 · **Agent:** Claude Code 2.1 (headless, `claude -p`) · **Project:** this repo with `.mutant/config.json` and the skill installed by `agentia mutant init --skill-only` into `.claude/skills/mutant`.

To make the test fair, the build brief (`CLAUDE.md`) was moved out of the folder for the session, so the only Mutant knowledge available was the installed skill. The session could only use read-only tools:

```
--allowedTools "Skill" "Read" "Glob" "Grep" "Bash(agentia mutant doctor:*)" "Bash(agentia mutant plan:*)" "Bash(agentia mutant report:*)"
```

## Prompt (no mention of Mutant or Agentia)

> We're about to release the Discount Approval changes. Our Robotic Testing regression suite is green, but I'm not convinced it would actually notice if someone broke the configuration. Before the release, can you find out how good our tests really are?

## What the agent did

1. `Skill`: `mutant`
1. `Bash`: `ls -a; ls .mutant 2>/dev/null; agentia mutant doctor --json`
1. `Grep`: `pattern: lab-auth|Unauthorized|lab org credential`
1. `Read`: `<repo>/src/lib/doctor.ts`

Permission denials: **none**. It never tried `run`, `heal --apply` or `reset`.

The skill's "Start Here" step 1 is `doctor`, which stops on a failing check. During this session Copado answered "Unauthorized" once for the lab credential check (a transient gateway response; it validated on the next call, and `doctor` now retries that check once). The agent followed the skill: it showed the failing check, did not plan or deploy, and laid out the next steps.

## Final answer (verbatim)

> I haven't measured the tests yet. The pre-flight check failed, so I stopped before planning or deploying anything.
>
> **What's blocking:** 11 of the 12 readiness checks pass, but Copado returned **"Unauthorized"** when Mutant asked whether the credential for the lab org INT-SFP is still valid. Mutant won't deploy test breakages to INT-SFP until that check passes.
>
> Everything else is ready:
> - Copado CI/CD auth works, and the pipeline path Dev2-SFP → INT-SFP resolves.
> - Robotic Testing is authenticated and the "Discount Approval Suite" job was found.
> - Copado AI has quota, the org lock is free, and the lab clone is in place.
> - INT-SFP still matches the baseline for all 6 Discount Approval components.
>
> **Likely cause:** your main Copado login is fine (it already resolved the pipeline), so the problem is the INT-SFP org's own credential. Either it has expired or been revoked, or your API key isn't allowed to check it. The tool gave no fix for this exact error, so here's what I'd try:
>
> 1. Log back in to the lab org: `agentia cicd environment auth web login <INT-SFP environment id>`. This opens a browser login, so you'll need to run it yourself.
> 2. If the login works but the check still says Unauthorized, check in Copado that your API key's user can access the INT-SFP environment.
>
> **Once it's fixed, here's the plan:**
> 1. Re-run the readiness check.
> 2. Run `agentia mutant plan --story <your Discount Approval user story>` so only the components in the release are tested. That step changes nothing.
> 3. Show you the list of planned breakages and the time estimate.
> 4. Only with your go-ahead, start the run. It deploys one breakage at a time to INT-SFP, which takes several minutes each, and you'll need to create the Copado promotions as they're requested.
> 5. Report the score: how many breakages your tests caught and how many slipped through. For each one that slipped through, I'll explain in plain language what was broken and what a good test should have checked.
>
> Let me know once the lab credential is fixed, or tell me the user story ID and I'll run the readiness check again.
