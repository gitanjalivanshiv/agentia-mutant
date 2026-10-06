# Agentia Mutant workflow

## 1. Before a release

```sh
agentia mutant doctor --json
agentia mutant plan --story US-0000042 --json     # or --components / --max
```

Show the plan and the estimate. Ask before running.

## 2. Run

```sh
agentia mutant run --plan .mutant/plans/latest.json --yes --json
```

What happens:
1. Baseline: the suite runs on the clean lab. If it is red, the run stops before touching Copado.
2. Mutant prepares one Copado user story per deploy (from the configured source environment) and publishes them.
3. **The user creates the promotions.** Tell them exactly:
   *"In Copado Pipeline Manager → `<pipeline>` → `<source>` → `<lab>`: for each story below, select it alone and click Create Promotion (do not deploy): `<story list>`."*
   Mutant finds the promotions automatically (it ignores unrelated ones and refuses promotions with several stories).
4. For each mutant: safety-checked promote + deploy, test run, classification.
5. Final revert deploy, then verification that the lab matches the baseline.

If the run returns `outcome: awaiting-promotions`, nothing was deployed. Once the user has created the promotions:

```sh
agentia mutant run --resume <runId> --json
```

A crashed or interrupted run also resumes with `--resume`. A run that failed before any deploy started can be retried the same way.

## 3. Explain

```sh
agentia mutant report --json
```

Survivors are blind spots: describe each in plain language with what a test should check. The HTML report (`reportFile`) is the shareable version.

## 4. Heal (human in the loop)

```sh
agentia mutant heal --json                 # Copado AI proposes tests; nothing uploaded
```

Show the user each proposal (`.mutant/runs/<id>/heal/*.robot`) and `suite.diff`. They may edit the files. **Only after they approve:**

```sh
agentia mutant heal --apply --yes --json   # uploads, writes the survivors-only plan
agentia mutant run --plan .mutant/plans/heal-<runId>.json --yes --json
agentia mutant compare <runId> <newRunId>
```

The re-run's baseline must pass with the new tests on the clean lab; a broken proposal stops the run before any deploy, so fix the proposal and use `heal --apply --force`.

## 5. Reset the lab (demo or after drift)

```sh
agentia mutant reset --suite examples/demo/tests/discount_happy_path.robot --yes
```

Only with the user's go-ahead: it may deploy (one story, one promotion the user creates) and it replaces the CRT suite file.
