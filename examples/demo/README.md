# Demo: Discount Approval

An invented, deliberately tiny Salesforce app, plus a deliberately incomplete test suite, so Mutant has something to find and Copado AI has something to heal. Everything here is safe to publish.

## The app (`force-app/`)

| Component | What it does |
|---|---|
| `Opportunity.Discount_Percent__c` | Discount offered on the opportunity (Percent) |
| `Opportunity.Approval_Required__c` | Checkbox set by the flow |
| Validation rule `Discount_Max` | Discounts above 40% are not allowed |
| Flow `Discount_Approval` | Before save: discount > 20% → `Approval_Required__c = true`, otherwise false |
| Permission set `Sales_Discounts` | Read/edit on the discount, read on the checkbox, create/edit Opportunity |
| `Opportunity-Opportunity Layout` | Salesforce's standard Opportunity layout + the two fields (Account Name made optional) |

The 11 operators produce **15 mutants** of this app (see [docs/operators.md](../../docs/operators.md)).

## The tests (`tests/`)

- `discount_happy_path.robot`: the starting suite. One test: create an opportunity with a 10% discount and check it saved. It never tries an over-limit discount and never checks a saved value, which is why most mutants survive.
- `healed/discount_suite_after_heal.robot`: the same suite after a real `agentia mutant heal` run: two tests written by the Copado AI Test agent (one edited during human review). With them, the two mutants that had survived were caught (0% → 100% on those mutants).

The CRT job needs two variables (type `secret`; the username may be non-sensitive): `username` and `password` of a test user in the lab org whose access to the discount fields comes **only** from the `Sales Discounts` permission set.

## Setup

1. `agentia mutant init` with your lab, source environment, pipeline, pipeline-repo clone and CRT project/job (see `mutant.config.example.json`).
2. `examples/demo/seed.sh` deploys the app to the lab through Copado (you create one promotion when asked) and installs the incomplete suite.
3. Assign `Sales Discounts` to the test user in the lab org.
4. `agentia mutant doctor` should report 12/12.

## The demo loop

```sh
agentia mutant plan                       # 10 mutants, ~45 min estimate
agentia mutant run --plan .mutant/plans/latest.json
agentia mutant report                     # opens with the score and the blind spots
agentia mutant heal                       # Copado AI proposes tests; review them
agentia mutant heal --apply               # upload after review; writes the survivors-only plan
agentia mutant run --plan .mutant/plans/heal-<run>.json
agentia mutant compare <run> <new-run>    # before → after
examples/demo/reset.sh                    # back to the starting state
```

Each run creates Opportunity records in the lab (names start with "Mutant Demo" / "Mutant FLS Edit"). They don't affect results; delete them whenever you like.
