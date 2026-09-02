# Operations and Deployment

> Canonical deployment entry point: [`README.md`](https://github.com/sjohnston1972/darwin/blob/main/README.md). This page owns operational detail and is reviewed with the [documentation freshness checklist](https://github.com/sjohnston1972/darwin/blob/main/docs/DOCUMENTATION.md).

## Production components

| Component         | Platform          | Identifier            |
| ----------------- | ----------------- | --------------------- |
| control room      | Cloudflare Pages  | `darwin-control-room` |
| API               | Cloudflare Worker | `darwin-api`          |
| persistence       | Cloudflare D1     | `darwin-telemetry`    |
| target            | Cloudflare Pages  | `darwin-projectflow`  |
| target automation | GitHub Actions    | ProjectFlow workflows |

## Worker configuration

Non-secret production variables live in `workers/api/wrangler.toml`:

- AI mode, model, and timeout;
- deterministic simulation seed/count;
- configured target repository/branch;
- production and study URLs;
- allowed browser origins;
- D1 and rate-limiter bindings.

Do not commit credentials to Wrangler configuration.

The checked-in D1 database UUID, rate-limit namespace IDs, Worker/Pages names,
public origins, repository name, and deployment URLs are routing identifiers,
not credentials. They are intentionally public. API tokens, operator/viewer
tokens, ingestion/callback secrets, GitHub credentials, and OpenAI credentials
remain encrypted platform secrets and must never appear in Wrangler or tracked
Vite environment files. `wrangler.toml.example` contains every required binding
with replacement infrastructure IDs.

## Required secrets

```powershell
npx wrangler secret put OPENAI_API_KEY --config workers/api/wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config workers/api/wrangler.toml
npx wrangler secret put DARWIN_CALLBACK_TOKEN --config workers/api/wrangler.toml
npx wrangler secret put DARWIN_OPERATOR_TOKEN --config workers/api/wrangler.toml
npx wrangler secret put PROJECTFLOW_INGESTION_SECRET --config workers/api/wrangler.toml
npx wrangler pages secret put PROJECTFLOW_INGESTION_SECRET --project-name darwin-projectflow
```

ProjectFlow Actions requires the matching callback secret and its own provider/deployment credentials. Darwin combines that secret with a per-execution nonce to sign the repository, immutable manifest or reset policy, timestamp, and callback payload; the shared secret itself is never a workflow input. The ProjectFlow Pages Function and Darwin Worker must share the same ingestion secret. `DARWIN_OPERATOR_TOKEN` must be distinct from both.

## D1 migrations

Apply migrations before deploying Worker code that depends on them:

```powershell
npm run deploy:migrate
```

Migrations are append-only SQL files under `workers/api/migrations`. Test new migrations against a disposable/local D1 database first. Never edit an already-applied production migration.

The Worker runs the indexed retention sweep daily at `03:17 UTC`. System status reports aggregate quota usage, pending expiry count and the last successful sweep. An authenticated operator can run the same idempotent maintenance path with `POST /api/retention/sweep`; policy and targeted deletion details are in [Data retention and deletion](../RETENTION.md).

## Build and deploy

Create a semantic tag such as `v0.1.0` on a commit with successful CI, then manually dispatch `.github/workflows/deploy.yml` using that tag. The workflow rejects branch dispatches and generates one build identity from the tag plus its 40-character commit SHA.

`npm run deploy` combines build, migration, API deploy, and Pages deploy. For an operator-run deployment, provide `DARWIN_RELEASE` and `DARWIN_COMMIT_SHA` in the environment so the same metadata is injected into Wrangler and Vite.

## ProjectFlow deployment

ProjectFlow production deploys from `main`. Darwin candidate branches produce isolated preview URLs after mutation validation passes. The preview URL is stored on the repository execution.

Release merges the reviewed pull request. Rollback creates and validates a separate inverse pull request.

## Production smoke test

`npm run smoke:production` verifies:

- Worker semantic release and exact workflow commit;
- target connection and repository identity;
- Darwin and ProjectFlow HTML availability;
- authenticated D1 telemetry insertion and aggregate readback;
- deterministic 10,000-event simulation response.

Set `DARWIN_OPERATOR_TOKEN`, `PROJECTFLOW_INGESTION_SECRET`, `DARWIN_RELEASE`, and `DARWIN_COMMIT_SHA` in the smoke-test environment. The smoke test rejects a deployment whose health metadata differs from that expected workflow commit, verifies one deterministic automated event, deletes its participant-scoped data immediately, and does not merge code, invoke GPT, or run a live Codex mutation.

`npm run smoke:production` never dispatches a Darwin Lab experiment, so it does not prove that a managed GitHub-hosted runner can claim and complete real browser work. The check below closes that gap.

## Darwin Lab managed runner smoke check

This is a manual, occasional check — it is not wired into `npm run smoke:production`, CI, or any npm script, because it dispatches a real GitHub Actions run and real browser traffic against production. Run it by hand, from a shell, only when verifying the managed-runner dispatch/claim path after a change to `dispatchManagedRunner` (`workers/api/src/lab/handler.ts`), the `darwin-lab-runner.yml` workflow, or `packages/lab-runner`.

### Prerequisites

- Darwin API, control room, and ProjectFlow are already deployed, and `npm run smoke:production` currently passes.
- Worker secrets `GITHUB_TOKEN` (a token with `actions:write`/`contents:read` on `sjohnston1972/darwin`) and `DARWIN_OPERATOR_TOKEN` are set (see Required secrets, above).
- The `sjohnston1972/darwin` repository has an Actions secret named `DARWIN_OPERATOR_TOKEN` matching the Worker's operator token — the `darwin-lab-runner.yml` workflow injects it into the runner process.
- `gh` CLI authenticated against `sjohnston1972/darwin` (`gh auth status`) with permission to list and view Actions runs.
- The operator's `DARWIN_OPERATOR_TOKEN` value available in the shell (`$env:DARWIN_OPERATOR_TOKEN` in PowerShell).

### Procedure

1. Create a minimal experiment against the deployed, explicitly-allowed ProjectFlow target. Small budgets keep the check fast:

   ```powershell
   $body = @{
     name           = "Managed runner smoke $(Get-Date -Format o)"
     targetUrl      = "https://darwin-projectflow.pages.dev/"
     populationSize = 1
     maxActions     = 5
     maxDurationMs  = 60000
     seed           = 1859
   } | ConvertTo-Json
   $experiment = Invoke-RestMethod -Method Post `
     -Uri "https://darwin-api.stevie-johnston.workers.dev/api/lab/experiments" `
     -Headers @{ Authorization = "Bearer $env:DARWIN_OPERATOR_TOKEN" } `
     -ContentType "application/json" -Body $body
   $experiment.experimentId
   ```

   Expect HTTP 201, `status: "draft"`, and an `experimentId` beginning `lab-exp-`.

2. Start it. This exercises the exact guarded path under test — `POST /api/lab/experiments/:id/start` must persist `awaiting_runner` first and only then call GitHub's `workflow_dispatch` for `darwin-lab-runner.yml`:

   ```powershell
   $started = Invoke-RestMethod -Method Post `
     -Uri "https://darwin-api.stevie-johnston.workers.dev/api/lab/experiments/$($experiment.experimentId)/start" `
     -Headers @{ Authorization = "Bearer $env:DARWIN_OPERATOR_TOKEN" }
   $started.status
   ```

   - Pass: HTTP 200, `status: "awaiting_runner"`.
   - If this returns HTTP 502 with `managed_runner_unavailable` (missing `GITHUB_TOKEN`) or `managed_runner_dispatch_<status>` (GitHub rejected the dispatch), stop: fix credentials or workflow permissions and restart from step 1. The experiment itself stays queued and recoverable — that failure mode is the one covered by the automated dispatch-guard tests in `workers/api/src/lab/handler.test.ts`; this manual check only needs to go further, past the dispatch call, onto a live runner.

3. Confirm GitHub queued and ran the workflow for this experiment:

   ```bash
   gh run list --repo sjohnston1972/darwin --workflow=darwin-lab-runner.yml --limit 3
   gh run watch <run-id> --repo sjohnston1972/darwin --exit-status
   ```

   Identify the matching run from its inputs (`gh run view <run-id> --repo sjohnston1972/darwin --json displayTitle`) or the "Execute real-target Darwin Lab population" step log, which prints the claimed experiment ID.

4. Poll the experiment until it leaves `running`:

   ```powershell
   do {
     Start-Sleep -Seconds 5
     $poll = Invoke-RestMethod `
       -Uri "https://darwin-api.stevie-johnston.workers.dev/api/lab/experiments/$($experiment.experimentId)" `
       -Headers @{ Authorization = "Bearer $env:DARWIN_OPERATOR_TOKEN" }
     $poll.status
   } while ($poll.status -in @('awaiting_runner', 'running'))
   $poll | ConvertTo-Json -Depth 6
   ```

### Pass criteria

All of the following must hold:

- `gh run watch` exits `0` — the GitHub Actions job itself succeeded.
- `$poll.runnerId` matches `github-actions-<run-id>` for the run identified in step 3 — proof that a *managed* GitHub runner, not a local `npm run lab:runner` process, claimed the experiment through `POST /api/lab/experiments/:id/claim`.
- `$poll.runs.Count -eq 1` and that run's `actions.Count -gt 0` — the population produced real browser behavior rather than tripping the zero-action infrastructure guard.
- `$poll.status` is `completed` (or `analysed`), `$poll.evidence` is non-null, and `$poll.error` is `null`.

### Distinguishing a runner failure from an agent failure

- **Runner/infrastructure failure**: the GitHub Actions job itself is red (`gh run watch` exits non-zero); or the experiment ends `status: "failed"` with `error` containing "zero browser actions" (the aggregate guard in the `finish` handler, `workers/api/src/lab/handler.ts`); or an individual run has `status: "blocked"` with an `error` describing a thrown exception (navigation timeout, browser crash) rather than a task judgement (`packages/lab-runner/src/runner.ts`). Each of these means the browser or the dispatch/claim path itself never gave the agent a fair run.
- **Agent failure**: the GitHub Actions job is green, the run's `status` is `succeeded`/`failed`/`abandoned`, `actions.length > 0`, and `taskOutcome` reflects the agent's own judgement — it acted in the browser but did, or did not, complete the goal. That is expected behavioural variance, not a runner-lifecycle defect.

### Cleanup

The check creates one real experiment and dispatches one real GitHub Actions run against production. Clean up immediately after a pass or a failure:

```powershell
# Archive the experiment once it is terminal (completed/analysed/failed/cancelled).
Invoke-RestMethod -Method Post `
  -Uri "https://darwin-api.stevie-johnston.workers.dev/api/lab/experiments/$($experiment.experimentId)/archive" `
  -Headers @{ Authorization = "Bearer $env:DARWIN_OPERATOR_TOKEN" }

# Remove the experiment-scoped study telemetry it generated.
Invoke-RestMethod -Method Delete `
  -Uri "https://darwin-api.stevie-johnston.workers.dev/api/studies/$($experiment.studyId)" `
  -Headers @{ Authorization = "Bearer $env:DARWIN_OPERATOR_TOKEN" }
```

If the workflow is still `running` past its 30-minute job timeout and GitHub cannot reconcile it, use the experiment's `force-fail` action (`POST /api/lab/experiments/:id/force-fail`) with the exact experiment ID before archiving — the same recovery pattern as a stranded repository execution (see Recovery, below).

> **This procedure has not been executed.** Writing it down is the acceptance-criteria deliverable; running it dispatches a real GitHub Actions workflow and real browser traffic against production infrastructure, which is explicitly out of scope for the change that added this section.

## Operational checks

Before a demo or release, inspect:

1. Worker health and live model availability.
2. The System status diagnostics panel for recent privileged transitions and provider failures.
3. Connected target base SHA/source fingerprint.
4. D1 migration status.
5. GitHub Actions queue and permissions.
6. Cloudflare Pages production and preview deployments.
7. Current event/evidence counts and any stale execution.

Every Worker response carries `X-Request-ID`; a valid inbound request ID is
propagated, otherwise the Worker creates one. Structured logs and the System
status JSON export use that identifier to correlate authorization decisions,
provider calls, and the final response.

Operational audit/metric records are retained in `operational_events` for 30
days and pruned when new records are written. They contain only actor, bounded
action/target identifiers, outcome, state labels, provider operation, duration,
and error code. They must never contain request or callback bodies, telemetry
payloads, repository patches, prompts/model output, headers, tokens, credentials,
or arbitrary exception messages. The diagnostics endpoint returns at most 100
redacted transitions and aggregate latency/error counts; the UI export contains
the same bounded response.

Configure Cloudflare Worker log retention to no more than 30 days. Console logs
follow the same redaction allowlist, but their deletion is controlled by the
Cloudflare account rather than D1; do not attach Logpush destinations with a
longer retention window for this demo environment.

## Recovery

### Worker deploy failed

Keep the previous Worker active, inspect Wrangler output, and correct configuration/migration errors before retrying.

### Pages deploy failed

The prior Pages deployment remains available. Rebuild locally and inspect Vite output before redeploying.

### D1 migration failed

Do not delete the database. Inspect remote migration state, make a new forward migration, and rerun migration apply.

### Repository execution failed

Keep its failed record. Correct provider/workflow configuration and use the explicit retry path so the failure remains auditable.

If a dispatch remains `dispatching` after the 15-minute recovery window and
GitHub cannot reconcile it, use the execution's force-fail action with the
exact execution ID. The API compare-and-swap transition preserves the stranded
record and refuses early or mismatched recovery requests.

### Released mutation is unsuitable

Use the controlled rollback workflow. Do not force-push or reset ProjectFlow `main`.

### Demo reset and data export

Export the bounded System status diagnostics and any evidence needed for the
demo record before reset. Reset requires the literal confirmation
`RESET DARWIN DEMO` plus `exportAcknowledged: true`, and the `delete_data`
capability. A reset dispatch does not erase state; Darwin clears demo state only
after the baseline workflow and exact production identity have been verified.

## Diagnostics failure

Operational trace persistence is best-effort and cannot replace the original
API response. If the System status panel reports diagnostics unavailable, verify
migration `0012_operational_events.sql`, D1 health, and Worker logs using the
response request ID. Do not enable body/header logging while investigating.
