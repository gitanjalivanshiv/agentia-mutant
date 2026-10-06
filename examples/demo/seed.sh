#!/usr/bin/env bash
# Seed the mutation lab with the Discount Approval demo app, through Copado.
#
#   1. checks readiness (agentia mutant doctor, without the drift check),
#   2. deploys the whole demo package to the configured labEnvironment through ONE Copado user
#      story (you create its promotion in Pipeline Manager when asked),
#   3. installs the demo's deliberately incomplete Robotic Testing suite.
#
# Run from anywhere; it works in the project folder that holds .mutant/config.json.
set -euo pipefail
cd "$(dirname "$0")/../.."

agentia mutant doctor --skip-drift
agentia mutant reset --force --suite examples/demo/tests/discount_happy_path.robot "$@"

echo
echo "Next: in Salesforce (the lab org), assign the 'Sales Discounts' permission set to the test user,"
echo "then: agentia mutant doctor && agentia mutant plan"
