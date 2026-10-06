#!/usr/bin/env bash
# Restore the demo starting state: lab metadata = examples/demo/force-app (deploys through Copado
# only if something drifted) and the Robotic Testing suite = the incomplete happy-path suite.
set -euo pipefail
cd "$(dirname "$0")/../.."

agentia mutant reset --suite examples/demo/tests/discount_happy_path.robot "$@"
agentia mutant doctor
