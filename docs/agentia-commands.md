# Agentia commands used by Mutant

Source of truth: `agentia --help` output for **@copado/agentia-cli 1.0.0-beta.2**, saved verbatim in [`docs/help/`](help/) (276 pages), plus the managed Agentia skills (`agentia-cicd`, `agentia-testing`, `agentia-ai`). The MCP tool list is in [`mcp-tools.md`](mcp-tools.md).

Status legend: ✅ called and shape observed · 📄 from `--help` only (shape not yet observed) · ⛔ blocked (CI/CD auth not configured yet)

---

## 1. Output envelope, errors, exit codes (observed ✅)

Every `--json` call prints exactly one JSON document on **stdout**. Nothing was written to stderr in the cases we observed.

```ts
/** Success. Observed on `auth get`, `testing project list`, `ai quota get`, `ai workspace list`. */
interface AgentiaOk<T> {
  result: T;
  status: 0;
  transactionId: string; // uuid
}

/** Failure (API/config errors AND flag-parse errors). Exit code 1 in both cases. */
interface AgentiaErr {
  error: {
    message: string; // human-readable, e.g. "CICD API key is not configured. Run `agentia auth set --cicd ...`"
    name: string;    // "Error"
    code?: string;
    // Flag-parse errors also embed `oclif` and `parse` objects containing the
    // ENTIRE CLI config (hundreds of KB). AgentiaClient must read only
    // message/name/code and never log the raw payload.
    [k: string]: unknown;
  };
  transactionId: string;
}
```

| Case | Exit | Shape |
|---|---|---|
| Success | 0 | `AgentiaOk` |
| API / config error (e.g. missing CICD key) | 1 | `AgentiaErr`, small |
| Missing required flag | 1 | `AgentiaErr` with huge `oclif`/`parse` blobs |
| CRT run failed with `--wait-for-result` | non-zero unless `--no-exit-code` | 📄 |
| Cloud commit / promote job failed or timed out | non-zero, diagnostic IDs preserved | 📄 (skill doc) |
| CRT HTTP error (e.g. 403 on `testing project create`) | 1 | ✅ `error: { name: "TestingGatewayError", message, statusCode, requestMethod, requestUrl }` — `requestUrl` contains the CRT org ID, never log it |

**Adapter rules:** ignore stderr (other linked plugins print oclif warnings there, e.g. `agentia-plugin-timemachine is a linked ESM module…`); parse stdout as JSON regardless of exit code; discriminate on `"error" in doc`; cap stdout buffer generously (≥ 5 MB) because parse errors are large; never print `result` of `auth get` (contains masked keys and org IDs).

---

## 2. Auth / readiness

### `agentia auth get [--ai] [--cicd] [--crt] --json` ✅
```ts
interface AuthGetResult {
  configFiles: { exists: boolean; label: string; path: string; scope: 'project' | 'user' }[];
  credentials: {
    type: 'cicd' | 'crt' | 'ai';
    label: string;
    set: boolean;
    ready?: boolean | null;   // CRT reports true/false; AI reported null even when set
    missing?: string[] | null;
    issues?: string[] | null;
    source?: 'global' | string | null;
    masked?: string;          // DO NOT log
    domain?: string;
    orgId?: string;           // DO NOT log / commit
  }[];
}
```
Readiness rule for `mutant doctor`: CRT → `ready === true`; CICD → `set === true` **and** a cheap read call (`cicd environment list --page-size 1`) succeeds; AI → `set === true` and `ai quota get` succeeds (AI never reports `ready`).

---

## 3. CI/CD (✅ auth configured; read calls observed)

### Stories
| Command | Purpose |
|---|---|
| `cicd work list [--assigned-to-me] [--name] [--title] [--project-id] [--status] [--page-size] [--cursor] --json` | find the lab story |
| `cicd work get [ID] --json` | read story (ID optional after `work set`) |
| `cicd work create --title … [--project <id>] [--source-environment <id> \| --source-credential <id>] [--status] --json` | create lab story |
| `cicd work update [ID] [--status] [--source-credential] … --json` | adjust story |
| `cicd work set <ID\|name> [--base-branch] [--none] --json` | activate, checks out `feature/<story-name>`; writes `.agentia/config.user.json` (`lastWorkItemId`, `lastBaseBranch`, `lastDevOrgBranch`, …). `status:"warning"` ⇒ story misconfigured, stop |
| `cicd work status [ID] [--metadata-list-only] --json` | story + related job executions |

### Local delivery (the path Mutant uses)
| Command | Purpose / notes |
|---|---|
| `git commit` | apply mutant |
| `cicd work publish [--permissions T:N,…] [--full-metadata T:N,…] [--skip-nested-metadata-detection] --json` | push branch, register Copado commit(s) in `origin/<base>..HEAD`, merge into dev-org branch. Needs ≥1 new commit. **PermissionSet edits** are sent as RetrieveOnly nested metadata — use `--full-metadata PermissionSet:<name>` so a revoked permission actually deploys |
| `cicd work submit [--done\|--deploy] [--skip-local-tests] [--skip-pull-request] [--apex-test-classes] --json` | without `--done`: validate-only promote (`validate=true`). With `--done`: promote **and deploy** to next pipeline env. Waits ≤5 min for a pending Commit job |
| `cicd work test [--local] [--apex-test-classes] --json` | runs `.agentia_quality_gates.sh` (not CRT) |
| `cicd work test apex -t <classes> [-w <minutes>] --json` | named Apex tests |

**Not used:** `cicd work promote` (experimental, skips quality gates and deploys with `sf project deploy start` directly — that would bypass Copado's deploy path). `cicd cloud commit/promote` (cloud flow; must never be mixed with the local flow on the same story).

### Promotions / jobs (monitoring + recovery)
| Command | Purpose |
|---|---|
| `cicd promotion list --work-id <story> --json` | find promotion for the story |
| `cicd promotion get <id> --json` | read before run/resume |
| `cicd promotion run <id> --operation merge\|merge_and_deploy [--resume <jobExecId>] [--wait-timeout 900] --json` | explicit (re)run |
| `cicd promotion conflict list -p <id> --json` | conflict detection |
| `cicd job get <jobExecId> --json` | status + ordered steps |
| `cicd job log get <jobExecId> [--step <id>] --json` | deploy failure diagnosis → `invalid` classification |

### Verification (revert check)
| Command | Purpose |
|---|---|
| `cicd metadata content compare --metadata-type <T> --api-name <N> [--source ENVIRONMENT\|REPOSITORY\|GIT_MIRROR\|ORG_CACHE] [--target-source …] [--source-org-id/--target-org-id] [--source-credential-id] [--source-branch/--target-branch] [--pipeline-id] --json` | per-component diff lab vs baseline branch — **the `verify` step** |
| `cicd metadata index compare --comparison-mode BRANCH_COMPARE\|INDEX_FILE\|MIX …` | whole-org drift check for `doctor` |
| `cicd metadata list --source Changed --metadata-types … --change-date-from …` | planner: "recently changed" components |
| `cicd environment list [--name] [--type] [--page-size] --json` ✅ | `result: { data: Environment[]; currentPage; pageSize; totalPages; totalRecords; hasMore; nextCursor }`. Environment keys: `id, name, type, platform, orgId, credentials[], sourcePipelineConnections, destinationPipelineConnections, promotionDefaultCredential, apexTestLevel, runLocalTests, …` |
| `cicd environment auth status <envId> --json` ✅ | `result: { validated: boolean, … }` |
| `cicd pipeline list --json` ✅ | paged `data[]`: `id, name, platform, active, mainBranch, gitRepositoryId, blockCommits, …` |
| `cicd pipeline connection list --pipeline-id <id> --json` ✅ | **bare array** (not paged): `sourceEnvironmentId, destinationEnvironmentId, branch, destinationBranch, stage, …` — confirm lab is a promotion destination |
| `cicd repository get <id> --json` ✅ | `name, provider, authType, uri, pullRequestBaseUrl, …` |

---

## 4. Copado Robotic Testing

| Command | Status | Notes |
|---|---|---|
| `testing project list --json` | ✅ | `result: { id: number; name: string; … }[]` |
| `testing project create --name … [--description] [--type ta\|rpa] --json` | ✅ | returned 403 under the first CRT org (no CRT entitlement); project was then created in the UI under a second org |
| `testing robot list -p <project> --json` | ✅ | `result: { id: number; name: string; … }[]` — projects start with a "Default Robot" |
| `testing robot create -p <project> --name … [--description] --json` | ✅ ~1 s | `result: { id: number; name; description; projectId; fwVersion; os; reporting; robotType; runEnvironment; createdDate }` |
| `testing job list -p <project> [--name] --json`, `testing job get <job> -p <project>` | 📄 | CRT job = test definition (≠ `cicd job`) |
| `testing test create -p <project> --robot <id> --name … --dir <d> --base-path <d> [--message] --json` | ✅ ~2 s | `result: { jobId: number; projectId: number; filesUploaded: number; job: { id; name; description; projectId; robotId; storage; suiteType; parallelExecution; showVideoParams; createdDate } }` |
| `testing job files <job> -p <project> --json` | ✅ | `result: { path: string; size: number }[]` |
| `testing variable create -p <project> --key K [--type secret\|config\|…] [--sensitive] [--job\|--robot <id>] --value-stdin --json` | 📄 | secrets via stdin only |
| `testing job upload <job> -p <project> --add\|--replace local[:remote] [--remove path] [--message] [--dry-run] --json` | 📄 | **`heal --apply` uploads tests here**; `--dry-run` gives a plan without mutation |
| `testing job files <job> -p <project>` / `job download` | 📄 | snapshot current suite before heal |
| `testing build run <job> -p <project> [--test …] [--include tag] [--wait-for-result] [--timeout min] [--no-exit-code] [--xunit <path>] [--save-artifacts <path>] [--run-type regression\|development] --json` | 📄 | same flags as `testing test run`. `--stream-logs`/`--watch` incompatible with `--json` |
| `testing build get <build> -p <project> -j <job> [--full] --json` | 📄 | poll |
| `testing build latest -p <project> [--status …]` | 📄 | |
| `testing build logs <build> -p <project> -j <job> [-o <path>] [--tail-lines] --json` | 📄 | explicit `-o` path only |
| `testing build abort` | 📄 | needs `--yes` |

Runner plan: `build run --json` (no wait) → poll `build get` every 10 s → on terminal: `build get --full` + `build logs -o artifacts/<mutant>/crt.log` (+ `--xunit` path if we use `--wait-for-result` instead). Per-test pass/fail parsed from xUnit to name the killing test.

---

## 5. Copado AI

| Command | Status | Shape |
|---|---|---|
| `ai quota get --json` | ✅ | `result: { limit: number; usage: number }` |
| `ai workspace list --json` | ✅ | `result: { workspaces: { id; name; description; organization_id; created_at; created_by; modified_at; modified_by; icon_url }[] }` (3 workspaces visible) |
| `ai agent ask -p <prompt> --agent test [--component <name>] [--user-story <id>] [--sf-org <env>] [--workspace <uuid>] [--dialogue <uuid>] [--no-stream] [--timeout s] [--no-credential-sync] --json` | 📄 | `--agent test` is selectable ✅ — used by `heal`. `--no-credential-sync` avoids needing CICD for pure test generation |

---

## 6. MCP

`agentia mcp start` — stdio server, 192 tools (see [`mcp-tools.md`](mcp-tools.md)). Relevant to the demo: `agentia_testing_build_run/get/logs`, `agentia_testing_job_upload`, `agentia_ai_ask`, `agentia_work_*`, `agentia_metadata_content_compare`. MCP destructive ops take `confirm: true`. No CLI subcommand lists tools; we used a raw JSON-RPC `tools/list`.

---

## 7. Plugin scaffolding

- Generator: `npm init @copado/agentia-plugin <dir>` → package `@copado/create-agentia-plugin@0.3.0` (exists on npm ✅).
- Link: `agentia plugins link .` · `agentia plugins` currently reports "No plugins installed."
- Host CLI: oclif 4, `topicSeparator: " "`, Node ≥ 18 (we have Node 24.18).

---

## 8. Observed in Phases 4–6 (runner, heal)

| Command | Status | Shape / notes |
|---|---|---|
| `cicd work create --title … --project <id> --source-credential <id> --status Draft --json` | ✅ 2–9 s | `result: WorkItem { id, name: "US-…", title, status, sourceEnvironmentName, projectPipelineMainBranch, oauthSignature (never log), … }` |
| `cicd work set <US> --json` (cwd = pipeline-repo clone) | ✅ 4–5 s | `result: { message, warnings[], git: { branch: "feature/US-…", branchCreated, fetched }, … }`; writes `.agentia/config.user.json` in the clone |
| `cicd work publish [--full-metadata PermissionSet:X] --json` | ✅ 13–25 s | `result: { branch, push: { message, jobId }, changeListUpdate, nestedMetadata, commits, logs[] }`; async "SFDX Commit" job 20–60 s |
| `cicd work submit --done` | ⛔ | preflight `GET /agentia/headless/work/user-stories-ahead-behind` → 404 on the test org |
| `cicd job get <id> --json` | ✅ | `result: { id, name: "JE-…", status: Successful\|Failed\|…, steps: [{ name, status, … }], template, … }` |
| `cicd promotion list --source-environment-name A --destination-environment-name B --status Draft --json` | ✅ | paged `data[]`, **18-char** `id`, `name: "P…"`, `status`, env names, `isBackPromotion` |
| `cicd promotion get <id> --json` | ✅ | **15-char** `id`, `name: null`, name in `identification.promotionName`, `userStories[{ name, title, … }]`, `includedMetadata[{ type, metadataApiName, action: Add\|Full\|… }]` |
| `cicd promotion run <18-char id> --operation merge_and_deploy --wait-timeout N --json` | ✅ 108–239 s | `result: { promotionAfter, jobMonitors[{ jobExecutionId, jobExecutionStatus, executionSteps }], … }`; a failed deploy job → error envelope "Promotion job … finished with status Error: …"; a 15-char ID is rejected before submission |
| `cicd metadata content get --metadata-type T --api-name N --source ENVIRONMENT --pipeline-id --source-org-id --source-credential-id --output-file f --json` | ✅ 2–3 s | `result: [{ contentBase64, … }]`; decoded XML written to `--output-file`. Org copies omit `false` booleans. Works for Profile too (~390 KB). |
| `testing test run <job> -p <proj> --wait-for-result --timeout m --no-exit-code --save-artifacts zip --xunit xml --json` | ✅ 40–120 s | `result: { finalBuild: { id, status: succeeded\|failed, … }, artifacts: { archive, xunit }, wait }`; `finalBuild.configuration` contains variable values (username in clear) — never log |
| `testing job files <job> -p <proj> --json` | ✅ | `result: [{ path, size }]` |
| `testing job download <job> -p <proj> -f <path> --output-dir d --json` | ✅ | `result: { files: [{ path, value }] }` |
| `testing job upload <job> -p <proj> --replace local:remote --message m --json` | ✅ ~1 s | `result: { operations, response }` |
| `testing variable update <id> -p <proj> --type secret --not-sensitive --json` | ✅ | variables must be type `secret` to reach Robot Framework |
| `ai agent ask --agent test --no-stream --no-credential-sync --workspace <uuid> --timeout 240 -p … --json` | ✅ 60–140 s | `result: { content, completed, dialogueId, workspaceId, warnings[], followups[], links[], statuses[] }`; `completed: false` + warning "AI stream ended before stream_complete" even when `content` is complete |

Gateway behaviour: read calls intermittently return 500 or "Unauthorized" and succeed seconds later; the Copado facade retries read-only calls (3 attempts) and never retries writes.
