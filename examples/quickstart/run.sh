#!/usr/bin/env bash
# Quickstart without a Copado account: every Copado call is replayed from fixtures recorded
# against the real lab (MUTANT_FAKE), and the reports use two real, scrubbed runs.
#
#   npm ci && npm run build && examples/quickstart/run.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mutant-quickstart.XXXXXX")"
MUTANT="$REPO/bin/run.js"

# A throwaway project: config + the two recorded runs, a stand-in lab clone, a private lock file.
cp -R "$REPO/examples/quickstart/project/.mutant" "$WORK/.mutant"
sed -i.bak -e "s#__PACKAGE_DIR__#$REPO/examples/demo/force-app#" -e "s#__LOCK_FILE__#$WORK/.org-busy#" "$WORK/.mutant/config.json"
rm "$WORK/.mutant/config.json.bak"
git init -q "$WORK/lab"
export MUTANT_FAKE="$REPO/fixtures/doctor"
cd "$WORK"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "agentia mutant doctor   (replayed from a recording of the real lab)"
"$MUTANT" mutant doctor

step "agentia mutant plan     (pure: generates and picks mutants, estimates the run)"
"$MUTANT" mutant plan --max 10

step "agentia mutant report   (the real first run: the happy-path suite missed the breakages)"
"$MUTANT" mutant report r-20261006-114841

step "agentia mutant compare  (after Copado AI healed the suite and the survivors were re-run)"
"$MUTANT" mutant compare r-20261006-114841 r-20261006-133159

printf '\nOpen the reports:\n  %s\n  %s\n' \
  "$WORK/.mutant/runs/r-20261006-114841/report.html" \
  "$WORK/.mutant/runs/r-20261006-133159/compare.html"
