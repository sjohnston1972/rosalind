# Rosalind — Master Test Plan

**Rev 3 — rebaselined and revalidated case-by-case against the tree, not against memory.**

**Baseline commit:** `6513e4372582598b6d03967842fc03b4a698a509` on `main` (2026-09-02).
**Release tag at baseline:** none. The last tag is `v0.25.19` (`a6e7a40`, 2026-07-20); `main` is 26
commits ahead of it (`git rev-list --count v0.25.19..HEAD`) and `package.json` reads `0.25.20`
(unreleased). This plan therefore pins a **commit**, not a release.
**Plan revision:** the commit containing this document.

**Naming.** The product is **Rosalind**. The npm workspace root, the Worker, the D1 database, the
env-var prefix (`DARWIN_*`), the audit log prefix (`[darwin:*]`) and the **Darwin Labs** feature are
all still named *Darwin*, deliberately. Rosalind is the product name; Darwin Labs is the name of the
autonomous-usability subsystem inside it. Both are correct, and this plan uses both accordingly — it
does not attempt to rename Darwin Labs, its routes (`/api/lab/*`), its tables (`lab_*`), or its
identifiers.

---

## 0. What this revision is, and why the previous one could not be trusted

Rev 2 was written on 2026-07-20 against a branch that has since moved a long way. Revalidating each
row against a named test file and a named test at the pinned commit produced **46 status corrections
across 44 cases** — in both directions. The most important output of this revision is not the
corrected table cells; it is §17, which records exactly where the previous revision **claimed
coverage that does not exist**. Highlights:

- **`API-021`** (unauthenticated non-localhost request must 503) was `[covered]`. Nothing tests it.
  The string `authentication_unavailable` appears in `security/auth.ts` and in **no test file**.
- **`API-023`** (a *wrong* operator token is rejected) was `[covered]`. No test anywhere supplies an
  incorrect-but-present bearer token. Only the *missing*-token path is tested.
- **`LAB-003`** (Lab numeric inputs reject NaN) was `[covered]` citing `LabView.test.tsx`. Those
  inputs no longer exist — the Lab composer was rebuilt around a single free-text goal — and no such
  test exists. The whole of §9.1 described a UI that has been replaced.
- **`LAB-001`** claimed the Lab designer carries "≥20 `data-explain` labels". `LabView.tsx` contains
  **zero** `data-explain` attributes.
- **`API-010`** (the cron `scheduled` handler runs the retention sweep) was `[covered]`. The sweep is
  well tested; the `scheduled()` entry point at `workers/api/src/index.ts:4138` is never invoked by
  any test.
- **`API-082`** (too few events must yield 409 `insufficient_evidence`) was `[covered]`. That error is
  raised at `index.ts:2205` and `:2365` and asserted nowhere.
- **Six Observations/workspace UI rows** (`UI-040/042/045/046/047/100`) were `[covered]`. Their
  controls — `Generate evidence`, the session-index toggle, `Retry repository run` — appear in no
  test at all.

Statuses in this document are only `[covered]` where this revision could name the file **and** the
test. Where it could not, the row says `[partial]` or `[gap]` and says what is missing.

**Companion document caveat.** Rev 2 cross-indexed against `audit-report.md`. **That file does not
exist in this repository.** Finding IDs (C1, H1, M1–M5, L1–L7, A1–A8, B3/B5/B11, S1–S3, sec-1) are
retained below as historical labels, but their original text could not be consulted; where a finding
could not be matched to real code or a real test, §13 says so instead of guessing.

---

## 1. How to read this plan

**Case ID scheme:** `AREA-nnn`. Areas: `API`, `GH`, `SEC`, `UI`, `LAB`, `TEL` (telemetry client),
`GW` (gateway), `LC` (lifecycle/E2E), `NF` (non-functional), `MIG` (migrations), `CI`, `REG`.

**Status vocabulary — one status per case, no compound cells:**

- **[covered]** — a named test in a named file asserts this case. The row cites both.
- **[partial]** — part of the case is asserted; the row states precisely which part is not.
- **[gap]** — nothing asserts it. This plan proposes the case.
- **[obsolete]** — the behaviour this case described no longer exists in the product. Retained with
  an explanation rather than deleted, so the history of the claim is auditable.

Where Rev 2 packed two statuses into one cell (`[covered] → add explicit race [partial]`), the row
has been split into separate cases with separate IDs.

**Release gating** is *not* encoded per-row. §16 enumerates the release-blocking **P0** set by ID;
everything not listed there is **long-term hardening** and must never be quoted as a release claim.

---

## 2. Tooling & commands

| Concern                                              | Tool                             | Command                                                     |
| ---------------------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| Unit / integration (all workspaces)                  | Vitest 3                         | `npm test`                                                  |
| Coverage gates                                       | Vitest + `@vitest/coverage-v8`   | `npm run test:coverage` (per-workspace thresholds, §3)      |
| Web component tests                                  | Vitest + Testing-Library + jsdom | `npm test -w @darwin/web`                                   |
| Browser E2E                                          | Playwright 1.61 (chromium)       | `npm run test:e2e` / `-- --grep "@smoke"`                   |
| Visual regression                                    | Playwright                       | `npx playwright test --grep visual`                         |
| UI type-scale                                        | Playwright                       | `npm run test:ui-type`                                      |
| Production smoke                                     | tsx                              | `npm run smoke:production`                                  |
| Lab managed-runner smoke                             | manual (PowerShell + `gh`)       | `docs/wiki/Operations-and-Deployment.md` §Darwin Lab managed runner smoke check |
| Lint / format / types (+ contract/env/context drift) | eslint, prettier, tsc            | `npm run lint`, `npm run format:check`, `npm run typecheck` |

`npm run typecheck` chains `context:check` → `docs:check` → `env:check` → per-workspace `tsc`.

**Determinism levers (built in — use them):**

- `DARWIN_E2E_FIXTURES` / localhost — short-circuits GitHub + deployment, auto-advances repository
  executions.
- `DARWIN_AI_MODE=mock|live` — gates all OpenAI reasoning; mock is the CI default.
- `DARWIN_DEMO_SEED` — simulations require `seed === DARWIN_DEMO_SEED`; seeded PRNG makes replays
  reproducible.
- Absent operator tokens + ingestion secret on **localhost only** → `local-development`
  full-capability identity (`security/auth.ts:94-101`). Production must set them. Note that almost
  every test in `workers/api/src/index.test.ts` runs through this bypass implicitly — see `API-020`.

---

## 3. Verified baseline at the pinned commit

Every number below was produced by running the command shown, at
`6513e4372582598b6d03967842fc03b4a698a509`. Re-run them to re-derive the inventory; do not hand-edit
these figures.

| Measure                            | Value | Command                                                                                                                                   |
| ---------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/component test **files**      | 35    | `find . -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) -not -path "*/node_modules/*" \| wc -l`                                      |
| Unit/component test **cases**      | 213   | `npm test` (sum of the per-workspace "Tests" lines; authoritative — counts loop-generated cases that a static grep misses)                 |
| Playwright spec **files**          | 5     | `find . -type f -name "*.spec.ts" -not -path "*/node_modules/*" \| wc -l`                                                                  |
| Playwright **cases** (call sites)  | 17    | `grep -rhE "^\s*test\(" $(find . -type f -name "*.spec.ts" -not -path "*/node_modules/*") \| wc -l`                                        |
| Declared API routes                | 68    | `grep -cE "^\| (GET\|POST\|PUT\|DELETE) " docs/generated/API_ROUTES.md` (regenerate with `npm run docs:generate`)                          |
| D1 migrations                      | 25    | `ls workers/api/migrations \| wc -l`                                                                                                       |

**Per-workspace test-case split at this commit** (`npm test`): `@darwin/api` 25 files / 139 tests ·
`@darwin/web` 6 files / 35 tests · `@darwin/telemetry-client` 1 / 17 · `@darwin/shared` 2 / 14 ·
`@darwin/lab-runner` 1 / 8.

**Gate verification run at this commit:**

| Gate                    | Result at `6513e43`                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | **pass** (incl. `context:check`, `docs:check`, `env:check`)                                                                                                          |
| `npm test`              | **pass** — 35 files, 213 tests                                                                                                                                       |
| `npm run lint`          | **pass** (`--max-warnings 0`)                                                                                                                                        |
| `npm run format:check`  | fails **only on a Windows checkout**: `core.autocrlf=true` gives every file CRLF endings, which Prettier flags across ~120 files. Not repo drift; Linux CI is unaffected. |

**CI-enforced coverage gates** (from each workspace's `test:coverage` script):

| Workspace                   | lines | funcs | stmts | branches |
| --------------------------- | ----- | ----- | ----- | -------- |
| `apps/web`                  | 70    | 44    | 70    | 65       |
| `workers/api`               | 65    | 77    | 65    | 72       |
| `packages/shared`           | 71    | 0     | 71    | 19       |
| `packages/telemetry-client` | 82    | 84    | 82    | 60       |
| `packages/lab-runner`       | 21    | 29    | 21    | 65       |

**Test files at this commit** (the Rev 2 list was missing `api.test.ts`, `lab-contracts.test.ts` and
`reset-atomicity.test.ts`):

`workers/api`: `api-route-contract.test.ts`, `archive-pagination.test.ts`, `index.test.ts`,
`evidence/evidence.test.ts`, `fitness/fitness.test.ts`,
`lab/{evidence,handler,lab-repository,reasoning}.test.ts`,
`persistence/{pagination,reset-atomicity,retention,telemetry-d1}.test.ts`,
`reasoning/reasoning.test.ts`,
`repository/{deployment-verification,execution,github-actions,github-source,recovery}.test.ts`,
`security/{auth,bounded-body,callback,study-session}.test.ts`, `simulation/simulate.test.ts`,
`testing/e2e-fixtures.test.ts`.
`apps/web`: `App.test.tsx`, `LabView.test.tsx`, `api.test.ts`, `components/ErrorBoundary.test.tsx`,
`telemetry/useLiveTelemetry.test.tsx`, `views/dashboard-views.test.tsx`.
`packages`: `telemetry-client/src/telemetry-client.test.ts`, `shared/src/contracts.test.ts`,
`shared/src/lab-contracts.test.ts`, `lab-runner/src/runner.test.ts`.
Playwright: `e2e/demo.spec.ts`, `tests/e2e/{demo,workspaces}.spec.ts`,
`apps/web/e2e/observations.spec.ts`, `apps/web/visual/type-scale.spec.ts`.

**Largest untested surfaces:** `persistence/telemetry-repository.ts` (no dedicated test file; reached
only through other suites), `apps/web/src/App.tsx`'s `OperatorBoundary` (UI-001..004), the gateway
(§11, different repository), `packages/shared` function/branch gates (0 / 19), and the managed
GitHub runner in production (LAB-066).

---

## 4. Environments & harness

| Env                | Purpose                                                                   | Backing                                                                                   |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Unit               | Pure logic                                                                | in-memory repository doubles                                                              |
| Worker integration | Full `handleWorkerRequest`                                                | in-memory or Miniflare-backed D1 (`reset-atomicity.test.ts`, `telemetry-d1.test.ts` use real migrations); mocked GitHub/OpenAI fetch |
| Web component      | React under jsdom                                                         | `vi.stubGlobal('fetch', fetchMock)` URL router (`App.test.tsx`)                            |
| Browser E2E        | Real Chromium + local worker + checked-out ProjectFlow `demo-baseline-v3` | Playwright; `PROJECTFLOW_E2E_DIR`                                                         |
| Production smoke   | Post-deploy sanity                                                        | live Cloudflare                                                                           |

**Fixtures that exist:** signed target requests (`security/auth.test.ts` `signedRequest` helper),
signed callbacks (`security/callback.test.ts` `signedCallback`), study sessions
(`security/study-session.test.ts`), programmable GitHub `fetch` doubles (`repository/*.test.ts`),
canned OpenAI output (`installOpenAIResponse` in `index.test.ts`), and the non-secure-context client
harness (`telemetry-client.test.ts` "creates unique valid event IDs without `crypto.randomUUID`").
**Fixtures still to build:** a runtime operator-token harness that drives every contract route to its
handler (`API-026`), and a wrong-token harness (`API-023`).

---

## 5. API route test matrix

Every route: (a) happy path + status/body-schema, (b) each documented error status, (c) capability
enforcement, (d) body-size cap where one exists, (e) CORS/`X-Request-ID` echo. Operator routes must
have an explicit capability; unmatched routes fail closed with 404 before authorization.

### 5.1 Cross-cutting

| ID      | Case                                                                                                      | Expected                             | Status      | Evidence / what is missing                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API-001 | `OPTIONS` preflight, allowed origin                                                                        | 204 + CORS, no body                  | [gap]       | no test issues an `OPTIONS` request anywhere                                                                                             |
| API-002 | Any non-`OPTIONS`, disallowed origin                                                                       | 403                                  | [covered]   | `index.test.ts` "enforces production origins and telemetry rate limits" (untrusted `Origin` vs configured `ALLOWED_ORIGINS` → 403)      |
| API-003 | Empty `ALLOWED_ORIGINS` → wildcard; configured allowlist echoes only the matched origin + `Vary: Origin`   | correct CORS in both modes           | [partial]   | wildcard: `index.test.ts` "returns a schema-valid health response" (`ACAO: *`); matched-echo: "enforces production origins…". **`Vary: Origin` (`index.ts:409`) is never asserted** |
| API-004 | Malformed percent-encoding in path                                                                         | 400 `invalid_path_encoding`, not 500 | [covered]   | `index.test.ts` "rejects malformed path encoding before route parameters are decoded"                                                    |
| API-005 | `X-Request-ID` valid→echoed / absent→server-generated / invalid→server-generated                           | header format enforced               | [partial]   | echoed: `index.test.ts` "propagates request IDs and retains redacted privileged audit events"; absent: "returns a schema-valid health response". **Invalid-format input is never tested.** Rev 2 called this header `X-Darwin-Request-ID`; the real header is **`X-Request-ID`** (`index.ts:605,752`) |
| API-006 | Unmatched route                                                                                            | 404 `not_found`                      | [covered]   | `index.test.ts` "returns a structured 404 for unknown routes"                                                                            |
| API-007 | Handler throws                                                                                             | 500 `internal_error`, generic body   | [covered]   | `index.test.ts` "preserves JSON and CORS when an unexpected request error occurs" (asserts 500 + `internal_error` + CORS preserved)      |
| API-008 | Every contract entry resolves, every operator route has an explicit capability, unmatched routes fail closed | contract + runtime                   | [covered]   | `api-route-contract.test.ts` "resolves every declared route and requires capabilities on operator routes" + "assigns a first-matching, independently-reasoned policy rule to every contract route"; `index.test.ts` "returns a structured 404 for unknown routes" |
| API-009 | Worker JSON responses carry `nosniff`                                                                      | header present                       | [covered]   | `index.test.ts` "returns a structured 404 for unknown routes" (asserts `X-Content-Type-Options: nosniff`)                                |
| API-010 | Cron `scheduled` handler runs the retention sweep                                                          | sweep invoked from `scheduled()`     | [partial]   | the sweep itself is covered (`persistence/retention.test.ts`; `index.test.ts` "sweeps expired telemetry idempotently and records aggregate health" via `POST /api/retention/sweep`). **The `scheduled()` export (`index.ts:4138`) is never invoked by any test** |
| API-011 | **NEW — route regression:** the set of routes the Worker actually dispatches equals the declared contract  | no drift either direction            | [covered]   | `api-route-contract.test.ts` "matches the statically-detected set of handled routes exactly", backed by `workers/api/src/route-inventory.ts` (independent static scan of `index.ts`, `lab/handler.ts`, `routes/operations.ts`) |

### 5.2 Capability matrix

| ID      | Case                                                              | Expected                              | Status    | Evidence / what is missing                                                                                                          |
| ------- | ------------------------------------------------------------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API-020 | No tokens/secret, localhost                                        | `local-development`, all capabilities | [partial] | exercised implicitly by nearly every case in `index.test.ts` (all use `http://localhost` with no auth header and still reach handlers). **No test asserts the identity is `local-development` or checks its capability set.** |
| API-021 | No tokens, non-localhost                                           | 503 `authentication_unavailable`      | [gap]     | behaviour exists (`security/auth.ts:104-108`); `authentication_unavailable` appears in **no test file**. Rev 2 claimed `[covered]`   |
| API-022 | Missing bearer on operator route                                   | 401                                   | [covered] | `index.test.ts` "requires capability-scoped operator authorization on every control-plane route" (table over 31 protected routes)     |
| API-023 | Wrong operator token (constant-time compare)                       | 401, no timing oracle                 | [gap]     | `constantTimeEqual` exists (`security/auth.ts:121-133`) but **no test supplies an incorrect-but-present token**. Rev 2 claimed `[covered]` |
| API-024 | Viewer token on an `observe` route                                 | 200 / 204                             | [covered] | `index.test.ts` same test (viewer → 200 on study events summary, 204 on `GET /api/target-connection`)                                 |
| API-025 | Viewer token on a non-`observe` route                              | 403 `forbidden`                       | [partial] | same test denies viewer on six `inspect_evidence` routes. **`reason`/`execute`/`release`/`connect`/`simulate`/`delete_data` routes are not exercised with a viewer token** |
| API-026 | Operator token on every privileged route (table-driven)            | reaches its handler, not 401/403      | [gap]     | `api-route-contract.test.ts`'s exhaustive policy table is **static** — it validates declared access/capability, not runtime dispatch. Nothing drives all 68 routes with a valid operator token. Rev 2's "(capability matrix covered)" hedge conflated the two layers |
| API-027 | **NEW:** every declared capability value is a member of `OperatorCapability` | no typo'd capability strings | [covered] | `api-route-contract.test.ts` "only uses capability values from the declared operator capability set"                                  |

### 5.3 Health, ops, diagnostics, retention, deletion

| ID      | Route                                                             | Cases                                                | Status    | Evidence / what is missing                                                                       |
| ------- | ----------------------------------------------------------------- | ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| API-030 | `GET /api/health`                                                 | 200 + schema; degrades when D1 unreachable           | [partial] | `index.test.ts` "returns a schema-valid health response". **Degraded-DB path not asserted**       |
| API-031 | `GET /api/operations/metrics`                                     | 200 counters                                         | [covered] | `index.test.ts` "accepts only signed ProjectFlow telemetry with configured provenance" (schema-parses the metrics body and asserts the request/accepted/duplicate counters) |
| API-032 | `GET /api/diagnostics?limit≤100`                                  | 200 audit events + provider metrics                  | [covered] | `index.test.ts` "propagates request IDs and retains redacted privileged audit events"             |
| API-033 | `POST /api/retention/sweep` (`delete_data`)                       | 200; prunes past-window rows                         | [covered] | `index.test.ts` "sweeps expired telemetry idempotently and records aggregate health"              |
| API-034 | `DELETE /api/studies/:id/participants/:pid`                       | 200 deleted + evidence invalidated                   | [covered] | `index.test.ts` "deletes participant, study, and execution artifacts by explicit scope"           |
| API-035 | `DELETE /api/studies/:id`                                         | 200                                                  | [covered] | same test (Rev 2 said `[gap]`; the test covers all three deletion scopes)                          |
| API-036 | `DELETE /api/repository-executions/:id/artifacts`                 | 200                                                  | [covered] | same test                                                                                          |
| API-037 | **NEW:** invalid id/scope on any deletion route                   | 400, nothing deleted                                 | [gap]     | the deletion test only exercises well-formed ids                                                   |

### 5.4 Target connection

| ID      | Case                                      | Expected                                                     | Status    | Evidence / what is missing                                                                     |
| ------- | ----------------------------------------- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| API-040 | `GET`, none set → 204; set → 200 verified | correct                                                      | [covered] | `index.test.ts` "verifies, persists, and disconnects the configured target application"        |
| API-041 | `POST` valid → 201, snapshot captured     | checks list populated                                        | [covered] | same test                                                                                       |
| API-042 | `POST` fullName not on allowlist          | 403 `target_not_allowed`                                     | [covered] | `index.test.ts` "rejects target connections outside the configured control boundary"            |
| API-043 | `POST` invalid body / target              | 400                                                          | [partial] | malformed *config* is covered at the snapshot layer (`repository/github-source.test.ts` "rejects malformed or over-broad target configuration"). **A 400 on a malformed request body to this route is not asserted** |
| API-044 | `POST` > 16 KB                            | 413                                                          | [covered] | `security/bounded-body.test.ts` "rejects a chunked body before materialising bytes beyond the limit" |
| API-045 | `POST` GitHub verify fails                | 502, upstream detail not leaked                              | [partial] | fail-closed is covered at the snapshot layer (`github-source.test.ts` "fails closed when repository source cannot be fetched"). **The route-level 502 and the no-leak assertion are not tested** |
| API-046 | `POST /disconnect` → 204                  | subsequent GET 204                                           | [covered] | `index.test.ts` "verifies, persists, and disconnects the configured target application"        |

### 5.5 Study sessions & telemetry ingestion (target-auth)

| ID      | Case                                                                              | Expected                                             | Status    | Evidence / what is missing                                                                    |
| ------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| API-050 | `POST /api/study-sessions` valid signed                                            | 201 `{token,claims,expiresAt}`, 10-min TTL           | [covered] | `security/study-session.test.ts` "issues stable anonymous subjects and short-lived verifiable sessions"; `index.test.ts` "issues signed study sessions and binds telemetry to their exact subject" |
| API-051 | Study-session context forbidden combo                                              | 403                                                  | [partial] | subject-binding rejection is covered by the `index.test.ts` test above. **The specific forbidden-context error is not asserted by name** |
| API-052 | `POST /api/telemetry/events` valid batch (1–50)                                    | 202 receipt with four buckets                        | [covered] | `index.test.ts` "ingests, deduplicates, and exposes ordered real telemetry"                    |
| API-053 | Receipt returns nonzero `sequenceConflicts` on `(session,sequence)` collision      | bucket distinct from rejected/duplicate              | [covered] | same test                                                                                       |
| API-054 | 0 / 51 events                                                                      | 400 `invalid_request`                                | [partial] | oversized batches rejected at the schema layer (`shared/src/contracts.test.ts` "rejects raw values and oversized telemetry batches"). **The route-level 400 for 0 and for 51 is not asserted** |
| API-055 | Body > 256 KB incl. chunked / missing Content-Length                               | 413 before full buffer                               | [covered] | `security/bounded-body.test.ts` "rejects a chunked body before materialising bytes beyond the limit" |
| API-056 | Missing/invalid target signature                                                   | 401                                                  | [covered] | `security/auth.test.ts` "binds target HMACs to method, path, body, and deployment"; `index.test.ts` "accepts only signed ProjectFlow telemetry with configured provenance" |
| API-057 | Replayed target signature                                                          | 409 `target_request_replayed`                        | [covered] | `index.test.ts` "accepts only signed ProjectFlow telemetry with configured provenance"          |
| API-058 | Session-token subject ≠ event claims                                               | rejected                                             | [covered] | `index.test.ts` "issues signed study sessions and binds telemetry to their exact subject"       |
| API-059 | Rate limit exceeded (`INGESTION_RATE_LIMITER`)                                     | 429 + `Retry-After: 60`                              | [partial] | 429 covered by `index.test.ts` "rate limits signed telemetry on the edge-derived target identity" and "enforces production origins and telemetry rate limits". **`Retry-After` is asserted for simulations, not for ingestion** |
| API-060 | Timestamp outside ±5 min                                                           | 401                                                  | [covered] | `security/auth.test.ts` "rejects expired target signatures and wrong deployment origins"        |

### 5.6 Studies, events, sessions, workspace

| ID      | Case                                                        | Expected                       | Status    | Evidence / what is missing                                                                 |
| ------- | ----------------------------------------------------------- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------- |
| API-070 | `GET /api/studies/:id/events` summary                       | 200 counts                     | [covered] | `index.test.ts` "requires capability-scoped operator authorization on every control-plane route" (schema-parsed summary) |
| API-071 | `GET .../events/raw?limit≤200&cursor`                       | 200 page; 400 on a bad cursor  | [covered] | `index.test.ts` "ingests, deduplicates, and exposes ordered real telemetry" (paged reads plus `?cursor=not-a-cursor` → 400); `persistence/pagination.test.ts` "returns bounded stable pages across many evolution cycles". *Nuance: the 400 **status** is asserted, the `invalid_cursor` error **code** is not* |
| API-072 | `GET .../sessions/:sid`                                     | 200 ordered trace              | [covered] | `index.test.ts` "ingests, deduplicates, and exposes ordered real telemetry"; also exercised end-to-end in `e2e/demo.spec.ts` |
| API-073 | `GET .../participants/:pid/workspace` valid session subject | 200                            | [covered] | `index.test.ts` "persists participant-specific ProjectFlow workspaces"                       |
| API-074 | Workspace GET with session subject ≠ path participant       | 403 subject mismatch           | [covered] | same test (regression guard for the fixed IDOR, prior S1)                                    |
| API-075 | `PUT .../workspace` valid / 400 / 413                       | correct                        | [partial] | valid PUT covered by the same test. **400 and 413 on this route are not asserted**            |

### 5.7 Evidence & reasoning

| ID      | Case                                                                | Expected                                   | Status    | Evidence / what is missing                                                            |
| ------- | --------------------------------------------------------------------- | ------------------------------------------ | --------- | ---------------------------------------------------------------------------------------- |
| API-080 | `POST .../evidence?source=real_user`                                 | 201 deterministic `EvidencePack`           | [covered] | `index.test.ts` "generates and persists a hashed evidence pack from real events"; `evidence/evidence.test.ts` "creates stable, traceable excess-path evidence" |
| API-081 | `?source=` filter applied in the query, not after `LIMIT`            | correct count under other-source dominance | [partial] | evidence-class separation is covered (`evidence.test.ts` "rejects a measurement window containing mixed evidence classes"). **The filter-before-LIMIT ordering itself is not asserted** |
| API-082 | Insufficient events                                                  | 409 `insufficient_evidence`                | [gap]     | `insufficient_evidence` is raised at `index.ts:2205` and `:2365` and appears in **no test file**. The nearest test, "starts the initial evidence window when the target is connected", asserts the *success* path only |
| API-083 | Mixed app/telemetry versions                                         | 409                                        | [covered] | `index.test.ts` "rejects stale and mixed application versions before evidence generation"; `evidence.test.ts` "rejects a measurement window containing multiple application versions" |
| API-084 | Lab-provenance events into measured evidence                         | 409 `lab_evidence_boundary`                | [covered] | `lab/handler.test.ts` "runs a bounded population into separately labelled evidence" (asserts the `lab_evidence_boundary` code); `evidence/evidence.test.ts` "rejects a measurement window containing mixed evidence classes" |
| API-085 | Large corpus (~10k events) completes within CPU budget               | no 500                                     | [covered] | `evidence/evidence.test.ts` "processes a deterministic 10,000-event study within a bounded budget" (Rev 2 said `[partial]`) |
| API-086 | `POST .../analyse-evidence` mock mode                                | 201; cached repeat → 200                   | [covered] | `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest"          |
| API-087 | Analyse: repo snapshot unavailable / unattested source               | 502 / 409                                  | [partial] | fail-closed-without-live-GPT covered (`reasoning/reasoning.test.ts` "fails closed without live GPT instead of returning a substitute mutation"). **The 502 `repository_unavailable` route path is not asserted** |
| API-088 | Model-output validation: unknown evidence id / out-of-scope mutation | strict schema + post-validate              | [covered] | `reasoning/reasoning.test.ts` "rejects invented evidence and scope while grounding target labels" and "rejects duplicate and causally incoherent portfolio identifiers" |
| API-089 | **B5: the model's scorecard is not silently rescaled**               | selected mutation preserved, low scores stay low | [covered] | `reasoning/reasoning.test.ts` "keeps legitimate low percentage scores low when ranking candidates" (Rev 2 said `[gap]`/verify-and-close; the case exists and passes) |

### 5.8 Codex manifest & repository execution

| ID      | Case                                                                     | Expected                                | Status    | Evidence / what is missing                                                     |
| ------- | -------------------------------------------------------------------------- | --------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| API-100 | `POST .../codex-manifest` → 201 immutable, repo-bound; re-POST → 200      | correct                                 | [covered] | `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest"; `reasoning/reasoning.test.ts` "builds a stable raw-telemetry-free Codex manifest" |
| API-101 | **B11: re-POST different `mutationIds` *after* dispatch**                 | 409 or safe new execution, never stranded | [gap]   | the manifest test re-POSTs alternative ids **before** `/execution` is called; the post-dispatch race is untested |
| API-102 | `POST .../execution` → 201 queued; callback nonce; dispatches `darwin-evolve.yml` | correct                          | [covered] | `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest"; `repository/github-actions.test.ts` "dispatches the pinned manifest without exposing the callback secret" |
| API-103 | Execution creds missing → 503; dispatch fails → 502, no half-write        | correct                                 | [partial] | the Lab equivalents are covered (`lab/handler.test.ts` "keeps a queued experiment recoverable when managed dispatch fails" / "…when GitHub rejects the dispatch call"). **The repository-execution route's own 503/502 paths are not asserted** |
| API-104 | Concurrent double-dispatch → one 201, one 409, no duplicate row           | atomic                                  | [partial] | the CAS primitive is covered (`persistence/telemetry-d1.test.ts` "permits exactly one compare-and-swap execution transition"). **No test issues two concurrent dispatch requests** |
| API-105 | `GET /api/repository-executions/:id` poll (fixture auto-advance)          | advancing status                        | [covered] | `testing/e2e-fixtures.test.ts` "stubs only known GitHub boundary requests and rejects everything else"; `index.test.ts` execution polling within the manifest test |
| API-106 | `POST .../recovery/force-fail` window / confirmation rules               | 200 / 409 / 400                         | [covered] | `repository/recovery.test.ts` "waits for the recovery window and atomically force-fails one queued run" |

### 5.9 Release, rollback, fitness

| ID      | Case                                                                 | Expected                                | Status    | Evidence / what is missing                                                     |
| ------- | ---------------------------------------------------------------------- | --------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| API-120 | `POST .../release` from `preview_ready` → 200/202; squash-merge       | correct                                 | [covered] | `index.test.ts` (release flow inside the manifest/execution test); `repository/github-actions.test.ts` "merges only the reviewed execution head and dispatches reset" |
| API-121 | Release not from `preview_ready` → 409 `not_releasable`               | correct                                 | [partial] | forward-only transitions are covered at the model layer (`repository/execution.test.ts` "enforces forward-only workflow transitions"). **The route-level 409 is not asserted** |
| API-122 | Concurrent double-release — status-predicated CAS                     | atomic; a merged PR never recorded failed | [partial] | CAS primitive covered (`telemetry-d1.test.ts` "permits exactly one compare-and-swap execution transition"). **No concurrent-release race test** |
| API-123 | Merge 405 not-mergeable → 502, state consistent                       | correct                                 | [partial] | 405-already-merged reconciliation is covered (see API-124). **The not-mergeable 405 → 502 path is not asserted** |
| API-124 | Merge ambiguous/5xx → 502 `..._merge_state_unknown`, reconcile via PR  | correct                                 | [covered] | `repository/github-actions.test.ts` "reconciles an ambiguous merge request from the GitHub pull request" and "reports an unknown merge state when GitHub cannot be reconciled" |
| API-125 | Deploy verify pending→success: 202→200                                | evolution cycle advances once           | [partial] | `repository/deployment-verification.test.ts` "waits through a stale deployment and verifies the released commit" + "returns bounded pending evidence without retaining response bodies". **The advance-exactly-once count is not asserted** |
| API-126 | `POST .../rollback` from `released` → 201, dispatch `darwin-rollback.yml`; else 409 | correct                     | [covered] | `index.test.ts` (rollback flow); `github-actions.test.ts` "dispatches and merges a separately reviewable rollback"; `repository/execution.test.ts` "prepares a rollback only from a retained commit and enforces its review path" |
| API-127 | `POST .../rollback/release` from rollback `preview_ready` → 200; invalidates fitness | correct                     | [covered] | `index.test.ts` rollback-release flow; `fitness/fitness.test.ts` "stops a retained comparison after rollback" |
| API-128 | `GET/POST .../fitness` → 201 / 204 / 409; no div-by-zero              | correct                                 | [covered] | `fitness/fitness.test.ts` "calculates a deterministic weighted 0-100 outcome" and "persists gates instead of scoring incompatible or undersized cohorts" (the cohort gate is what prevents div-by-zero) |

### 5.10 Genome, observations, simulations

| ID      | Case                                                                        | Expected      | Status    | Evidence / what is missing                                                          |
| ------- | ----------------------------------------------------------------------------- | ------------- | --------- | -------------------------------------------------------------------------------------- |
| API-140 | `GET /api/genome?limit≤25&cursor` → 200 page; 400 on an out-of-range limit   | bounded       | [covered] | `archive-pagination.test.ts` "keeps multi-cycle genome pages bounded and defers heavy records"; `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest" (`?limit=1000` → 400). *Nuance: the 400 **status** is asserted, the `invalid_pagination` error **code** is not* |
| API-141 | **M1: one corrupt row in a list** → page skips it, still 200                 | skip-and-log  | [partial] | the repository listers are covered (`persistence/telemetry-d1.test.ts` "skips corrupt execution rows without blanking fossil-record pages", "…corrupt telemetry event rows…", "…corrupt operational audit event rows…"). **No test drives `GET /api/genome` itself with a planted corrupt row**, which is what this case describes |
| API-142 | `GET /api/genome/:id` / `GET /api/observations/archives[/:id]`               | 200 / 404     | [covered] | `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest" (genome detail, archive list and archive detail reads)  |
| API-143 | `POST /api/simulations` seed==`DARWIN_DEMO_SEED` → 201, deterministic        | correct       | [covered] | `simulation/simulate.test.ts` "returns the same summary and event stream for the same seed"; `index.test.ts` "creates and retrieves an exactly 10,000-event simulation summary" |
| API-144 | Wrong seed/variant → 403/400; rate-limited → 429 + `Retry-After: 60`; in-flight → 503 + `Retry-After: 5` | correct | [covered] | `index.test.ts` "rejects unconfigured simulation seeds and evolved variants", "rate limits simulations on the authenticated operator identity" (asserts `Retry-After: 60`), "admits only one simulation request at a time" (asserts `Retry-After: 5`) |
| API-145 | `GET /api/simulations/:id[/summary]` → 200 / 404                            | correct       | [covered] | `index.test.ts` "creates and retrieves an exactly 10,000-event simulation summary" and "expires simulation metadata and evicts the least-recently-used run" (404 paths) |
| API-146 | Body > 4 KB on `POST /api/simulations`                                      | 413           | [covered] | `index.test.ts` "rejects oversized simulation requests before parsing"                 |

### 5.11 Demo reset

| ID      | Case                                                                                    | Expected                                        | Status    | Evidence / what is missing                                                        |
| ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| API-160 | `GET /api/demo/reset` → 200 latest / 204 none                                            | correct                                         | [partial] | 200-with-data covered by `index.test.ts` "preserves state through reset workflow and deployment failures…". **The 204-when-none path is not asserted** |
| API-161 | `POST` correct confirmation + export ack → 201/200/202 by mode                           | correct                                         | [covered] | same test (queued → running → validating → deploying → complete)                    |
| API-162 | Wrong confirmation string → 400 `invalid_reset_confirmation`                             | correct                                         | [gap]     | `invalid_reset_confirmation` appears in no test file                                 |
| API-163 | Creds missing → 503; body > 16 KB → 413                                                  | correct                                         | [partial] | 413 covered by `security/bounded-body.test.ts`. **The missing-credentials 503 is not asserted** |
| API-164 | **M2: snapshot refresh fails during reconcile** → reset must not strand `deploying` with data gone | data preserved; completion idempotent | [covered] | `index.test.ts` "preserves state through reset workflow and deployment failures, then clears only after baseline verification" — plants a snapshot failure at the `deploying` transition, asserts 409 `invalid_transition` **and that the telemetry row count is still 1**, then clears to 0 only after verification succeeds (fixed in `930ee54`, 2026-07-22 — after Rev 2 was written) |
| API-165 | **L1: concurrent reset transitions** → no lost transition, no double reset               | CAS on the reset execution                      | [covered] | `persistence/reset-atomicity.test.ts` "rejects a stale or already-won compare-and-swap without destroying anything" (two racing `completeResetAtomically` calls, exactly one wins, a third stale caller destroys nothing) |
| API-166 | **NEW: destructive reset is one atomic commit** — a mid-transaction failure destroys nothing and a retry succeeds | all-or-nothing | [covered] | `persistence/reset-atomicity.test.ts` "leaves prior demo data and the reset execution untouched when the transaction fails between verification and commit, then recovers on retry" (Miniflare D1 + real migrations) and "restores prior telemetry and the reset execution when the attempt throws partway through, then recovers on retry" (in-memory backend) |

---

## 6. GitHub interaction tests (`GH`)

Against programmable `fetch` doubles; assert endpoint, method, payload and timeout.

| ID     | Case                                                                                     | Expected                        | Status    | Evidence / what is missing                                                        |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| GH-001 | Commit lookup (no `commitSha`) → `GET /repos/{full}/commits/{branch}`                     | `baseSha`                       | [covered] | `repository/github-source.test.ts` "captures target policy and source at an immutable GitHub commit" |
| GH-002 | Raw fetch for `darwin.target.json` + each `contextPath`                                   | correct URLs                    | [covered] | same test                                                                            |
| GH-003 | Malformed `darwin.target.json` (HTML / truncated body)                                    | handled, not a raw parse error  | [gap]     | "rejects malformed or over-broad target configuration" plants an **over-broad but well-formed** config (21 contextPaths + an unexpected key). **No test feeds HTML or truncated JSON** |
| GH-004a| contextPaths count bound (≤20 paths)                                                      | over-limit rejected             | [covered] | `github-source.test.ts` "rejects malformed or over-broad target configuration"        |
| GH-004b| Single-file size bound (≤128 KiB)                                                         | rejected before materialising   | [covered] | `github-source.test.ts` "caps streamed context files before materialising them"       |
| GH-004c| Concurrency bound (≤4 concurrent downloads)                                               | no subrequest storm             | [covered] | `github-source.test.ts` "limits concurrent context downloads"                         |
| GH-004d| Config size (≤64 KiB) and aggregate size (≤512 KiB) bounds                                 | rejected                        | [gap]     | neither bound has a test                                                              |
| GH-005 | Path traversal in a context path rejected; `baseSha` regex; branch encoded                | rejected                        | [covered] | `github-source.test.ts` "rejects prompt control characters in repository context" and "rejects malformed or over-broad target configuration" |
| GH-006 | GitHub fetch beyond the timeout is aborted                                                 | timeout signal                  | [covered] | `github-source.test.ts` "bounds GitHub request duration"                              |
| GH-020 | `dispatchEvolutionWorkflow` → `darwin-evolve.yml/dispatches` with all inputs               | correct payload, secret not leaked | [covered] | `repository/github-actions.test.ts` "dispatches the pinned manifest without exposing the callback secret" |
| GH-021 | `dispatchRollbackWorkflow` → `darwin-rollback.yml/dispatches`                              | correct workflow + inputs       | [covered] | `github-actions.test.ts` "dispatches and merges a separately reviewable rollback"     |
| GH-022 | `dispatchResetWorkflow` → `darwin-reset.yml/dispatches`                                    | correct workflow + inputs       | [covered] | `github-actions.test.ts` "merges only the reviewed execution head and dispatches reset" |
| GH-023 | `dispatchManagedRunner` (Darwin Labs) → `darwin-lab-runner.yml/dispatches`                 | correct workflow + inputs       | [gap]     | only the **failure** paths are tested (`lab/handler.test.ts` "keeps a queued experiment recoverable when managed dispatch fails" / "…when GitHub rejects the dispatch call"). No test asserts the successful dispatch's workflow name or inputs. *Rev 2 bundled GH-021/022/023 into one `[partial]` row; two of the three are in fact fully covered and one is a gap.* |
| GH-024 | Dispatch non-2xx → throws → caller 502, state consistent                                   | correct                         | [covered] | `lab/handler.test.ts` "keeps a queued experiment recoverable when GitHub rejects the dispatch call" (502 `managed_runner_dispatch_503`, experiment still `awaiting_runner`) |
| GH-040 | `mergeEvolutionPullRequest` / `mergeRollbackPullRequest` success → squash merge             | correct                         | [covered] | `github-actions.test.ts` "merges only the reviewed execution head and dispatches reset" and "dispatches and merges a separately reviewable rollback" |
| GH-041 | Merge 405 already-merged → reconcile via `GET /pulls/{n}`, treat as success                 | correct                         | [covered] | `github-actions.test.ts` "reconciles an ambiguous merge request from the GitHub pull request" |
| GH-042 | Merge 5xx/unreconcilable → `GitHubMergeStateUnknownError` → 502                             | correct                         | [covered] | `github-actions.test.ts` "reports an unknown merge state when GitHub cannot be reconciled" |
| GH-060 | `verifyProjectFlowDeployment` polls the study URL; bounded attempts; per-attempt abort      | correct                         | [covered] | `repository/deployment-verification.test.ts` "waits through a stale deployment and verifies the released commit", "returns bounded pending evidence without retaining response bodies", "parses the immutable commit and measured application version" |

---

## 7. Security matrix (`SEC`)

| ID      | Case                                                                                             | Expected                     | Status    | Evidence / what is missing                                                          |
| ------- | -------------------------------------------------------------------------------------------------- | ---------------------------- | --------- | -------------------------------------------------------------------------------------- |
| SEC-001 | Target canonical binds method + path + timestamp + targetId + sourceOrigin + clientKey + sha256(body) | tamper any field → rejected | [partial] | `security/auth.test.ts` "binds target HMACs to method, path, body, and deployment" actually tampers only **path** (cross-route) and **method** (cross-method); "rejects expired target signatures and wrong deployment origins" covers **timestamp** and **origin**. **Tampering `targetId`, `clientKey`, or the body while keeping the signature is never tested**, so the `sha256(body)` binding is unproven. Rev 2 claimed `[covered]` for "tamper any field" |
| SEC-002 | A signature for method A / path X is rejected when replayed on method B / path Y                  | rejected                     | [covered] | `security/auth.test.ts` "binds target HMACs to method, path, body, and deployment" — this is exactly the cross-route/cross-method replay case (Rev 2 under-stated it as `[partial]`) |
| SEC-003 | Constant-time comparison of operator tokens                                                        | no timing oracle             | [partial] | `constantTimeEqual` is used at `security/auth.ts:121,131`. **No test exercises it with a wrong token** — see API-023 |
| SEC-004 | Origin: exact `PROJECTFLOW_PRODUCTION_URL` / https subdomain allowed, else 403                     | correct                      | [covered] | `security/auth.test.ts` "rejects expired target signatures and wrong deployment origins" (`target_origin_forbidden`); `index.test.ts` "enforces production origins and telemetry rate limits" |
| SEC-020 | Callback canonical binds method + path + ts + nonce + executionId + repository + manifestHash + sha256(body) | correct              | [covered] | `security/callback.test.ts` "accepts one execution-bound signature and rejects its replay" (canonical built from exactly those eight fields) |
| SEC-021 | Wrong execution / wrong repository / expired credential                                            | rejected                     | [covered] | `security/callback.test.ts` "rejects wrong execution, wrong repository, and expired credentials" |
| SEC-022 | Callback replay                                                                                     | consumed once only           | [covered] | `security/callback.test.ts` "accepts one execution-bound signature and rejects its replay"; `index.test.ts` reset-callback replay within the reset lifecycle test |
| SEC-040 | Study-session valid round-trip; tampered / expired → rejected                                       | correct                      | [covered] | `security/study-session.test.ts` "issues stable anonymous subjects and short-lived verifiable sessions" and "rejects token tampering and wrong secrets" |
| SEC-041 | Workspace IDOR guard: token for participant A on participant B's path → 403                        | rejected                     | [covered] | `index.test.ts` "persists participant-specific ProjectFlow workspaces" (regression guard for prior S1) |
| SEC-042 | `anonymousStudyParticipantId` is deterministic **and** pseudonymous                                 | no PII                       | [partial] | determinism covered (`study-session.test.ts` "issues stable anonymous subjects…"). **Nothing asserts the subject contains no input-derived PII** |
| SEC-060 | Per-route body caps via bounded stream; chunked bypass closed                                       | 413 at each                  | [covered] | `security/bounded-body.test.ts` "rejects a chunked body before materialising bytes beyond the limit" and "rejects invalid UTF-8" |
| SEC-061 | SQL: no interpolated user value                                                                     | static/review test           | [gap]     | no custom lint rule in `eslint.config.js`, no test                                     |
| SEC-062 | No secret logged or returned; `observability.ts` logs only provider/op/duration/`error.name`        | assertion                    | [gap]     | no `observability` test file exists. *Partial adjacent evidence:* `index.test.ts` asserts audit records never contain operator/viewer tokens, and `telemetry-d1.test.ts` asserts corrupt-row warnings never contain row contents |
| SEC-063 | Prompt injection: only bounded identifiers reach the prompt; repo content is data-not-instructions  | constrained                  | [partial] | `github-source.test.ts` "rejects prompt control characters in repository context"; `reasoning/reasoning.test.ts` "rejects invented evidence and scope while grounding target labels". **No test asserts the full prompt-assembly boundary** |
| SEC-064 | Rate-limiter `clientKey` is IP-derived at the gateway and signed — not caller-choosable             | IP-pinned                    | [gap]     | the derivation lives in the ProjectFlow gateway (§11, different repository). On Rosalind's side `index.test.ts` "rate limits signed telemetry on the edge-derived target identity" shows the key **is used**, not that it cannot be chosen by the caller |
| SEC-065 | Upstream GitHub/OpenAI error text is not reflected verbatim to the client                           | generic message              | [gap]     | no test asserts substitution of upstream text                                          |
| SEC-066 | `local-development` bypass requires both tokens **and** the secret absent **and** a localhost host   | no bypass in prod            | [gap]     | see API-020/API-021 — neither half of the invariant is asserted                        |
| SEC-067 | Fail-open default: a non-public route missing from the contract denies rather than falling to `observe` | fail closed              | [covered] | `api-route-contract.test.ts` "resolves every declared route and requires capabilities on operator routes", "assigns a first-matching, independently-reasoned policy rule to every contract route", "matches the statically-detected set of handled routes exactly"; `index.test.ts` "returns a structured 404 for unknown routes" |

---

## 8. Web UI — views, controls, workflows (`UI`)

In test mode `App` renders `DarwinDashboard` directly with all capabilities, so the
`OperatorBoundary` token flow is **entirely untested**.

### 8.1 Operator boundary / auth gate

| ID     | Case                                                                             | Expected                 | Status | Evidence / what is missing                                          |
| ------ | ---------------------------------------------------------------------------------- | ------------------------ | ------ | ---------------------------------------------------------------------- |
| UI-001 | Empty token submit                                                                | inline error, no request | [gap]  | `OperatorBoundary` (`App.tsx:4539`) is referenced by **no test file** |
| UI-002 | Valid token incl. `observe` → `GET /api/auth/session` unlock with returned subset | render dashboard         | [gap]  | as above                                                              |
| UI-003 | Token lacking `observe` → error, stays locked                                     | correct                  | [gap]  | as above                                                              |
| UI-004 | `darwin:operator-unauthorized` mid-session → re-lock, token cleared               | correct                  | [gap]  | as above (`App.tsx:4588`)                                             |

### 8.2 Global chrome

| ID     | Case                                                                        | Expected     | Status    | Evidence / what is missing                                                  |
| ------ | ----------------------------------------------------------------------------- | ------------ | --------- | ------------------------------------------------------------------------------ |
| UI-010 | Nav links set `?view=` and mark `aria-current`                               | route switch | [covered] | `App.test.tsx` "keeps the control room as a concise operational overview", "connects, verifies, and disconnects ProjectFlow from the target view", "shows the Genome in its own workspace"; `tests/e2e/workspaces.spec.ts` "supports keyboard navigation between workspaces" |
| UI-011 | Mobile hamburger / scrim open + close                                        | toggles      | [partial] | 390px layouts are covered by `tests/e2e/workspaces.spec.ts` "asserts every workspace at desktop and 390px". **The open/close interaction itself is not asserted** |
| UI-012 | ThemeToggle sets `dataset.theme` + `localStorage` + meta colour              | correct      | [covered] | `App.test.tsx` "persists the light theme from the header control"             |
| UI-013 | Reset icon → `POST /api/demo/reset {confirmation:'RESET DARWIN DEMO', exportAcknowledged:true}` | correct | [covered] | `App.test.tsx` "keeps a visible reset failure and allows a clean retry" (asserts the exact request body) |
| UI-014 | Reset failure → aria flips to retry; status band per status                  | correct      | [partial] | same test covers the failure + retry affordance. **The per-status band and Workflow link are not asserted** |
| UI-015 | ErrorBoundary catches a render throw → fallback, not a white screen          | correct      | [covered] | `components/ErrorBoundary.test.tsx` "contains a view failure and offers diagnostics recovery" |
| UI-016 | **NEW — branding:** the shell presents Rosalind product branding while Darwin Labs keeps its own name | Rosalind in the shell, Darwin Labs in the Lab | [covered] | `App.test.tsx` "keeps the control room as a concise operational overview" (heading `Rosalind — Helping your software adapt.`) and "connects, verifies, and disconnects ProjectFlow from the target view" (`Rosalind API`); `views/dashboard-views.test.tsx` "renders the primary evolution message and measured-study action"; `LabView.test.tsx` retains the `Darwin Labs` hero and `Darwin Labs agent population` label |

### 8.3 Control Room

| ID     | Case                                                             | Expected    | Status    | Evidence / what is missing                                                |
| ------ | ------------------------------------------------------------------ | ----------- | --------- | ---------------------------------------------------------------------------- |
| UI-020 | Metric cards render derived values                                | correct     | [covered] | `views/dashboard-views.test.tsx` "renders the primary evolution message and measured-study action"; `App.test.tsx` "keeps the control room as a concise operational overview" |
| UI-021 | "Open measured study" href precedence; disabled when blocked      | correct     | [partial] | blocked state covered by `App.test.tsx` "locks measured study access while a baseline reset is incomplete". **The full precedence chain is not enumerated by a test** |
| UI-022 | Release-confidence derivation across its branches                 | each branch | [gap]     | no test enumerates the derivation branches                                  |
| UI-023 | Fitness-delta states (measured / insufficient / rolled_back / pending) | each label | [gap]  | the model layer is covered (`fitness/fitness.test.ts`); **the label mapping in the UI is not** |

### 8.4 Target Application view

| ID     | Case                                                              | Expected | Status    | Evidence / what is missing                                                     |
| ------ | ------------------------------------------------------------------- | -------- | --------- | --------------------------------------------------------------------------------- |
| UI-030 | Initial `GET /api/target-connection` 204 → empty state             | correct  | [covered] | `App.test.tsx` "connects, verifies, and disconnects ProjectFlow from the target view" |
| UI-031 | Fill form + Connect → `POST`; verification panel + checks          | correct  | [covered] | same test                                                                        |
| UI-032 | Connect failure → `connection-error` alert with the server message | correct  | [partial] | subsystem-failure surfacing is covered by `App.test.tsx` "reports named subsystem failures without discarding healthy state". **This specific alert is not asserted** |
| UI-033 | Disconnect → `POST /disconnect` → empty state                      | correct  | [covered] | `App.test.tsx` "connects, verifies, and disconnects ProjectFlow from the target view" |
| UI-034 | Paired external links track inputs; study link disabled when blocked | correct | [partial] | blocked-link half covered by "locks measured study access while a baseline reset is incomplete". **Link-tracking half is not** |

### 8.5 Observations — telemetry panel

| ID     | Case                                                        | Expected | Status    | Evidence / what is missing                                                       |
| ------ | ------------------------------------------------------------- | -------- | --------- | ----------------------------------------------------------------------------------- |
| UI-040 | Refresh live telemetry re-fetches; spinner + disabled while refreshing | correct  | [partial] | `App.test.tsx` "keeps detailed telemetry separate from the mutation workspace" clicks `Refresh live telemetry` and asserts the re-fetch. **The spinner and the disabled-while-refreshing state are not asserted** |
| UI-041 | Live-update indicator states (paused / stale / incremental)  | aria-live | [partial] | the hook states are covered (`telemetry/useLiveTelemetry.test.tsx` "marks failures stale and recovers with a jittered retry", "pauses hidden tabs and refreshes immediately when visible"). **The rendered indicator is not asserted** |
| UI-042 | Generate evidence gated on `count` + `canInspectEvidence`    | correct  | [gap]     | the control's label (`Generate evidence`, `App.tsx:2177`) appears in **no test file** |
| UI-043 | Also posts fitness when a retained released execution exists | second call | [gap]  | no test asserts the second call                                                     |
| UI-044 | Telemetry error band + Dismiss                               | correct  | [partial] | error surfacing covered by "reports named subsystem failures without discarding healthy state". **Dismiss is not asserted** |
| UI-045 | Session index filters the trace                              | toggles  | [gap]     | the session-index `is-active` toggle (`App.tsx:2260,2271`) is asserted by no test    |
| UI-046 | Event trace renders recent events with per-type detail       | correct  | [partial] | the per-signal `Canonical evidence trace` is asserted by the same test. **The per-type event-trace list is not** |
| UI-047 | Aggregate mode when `!canInspectEvidence` → summary endpoint | correct  | [partial] | the contract and API halves are covered (`shared/src/contracts.test.ts` "keeps the default telemetry summary aggregate-only"; `index.test.ts` viewer-summary assertion). **The UI branch that selects the summary endpoint is not exercised** |

### 8.6 Observations — evidence pack & signal inspector

| ID     | Case                                                                       | Expected                   | Status    | Evidence / what is missing                                                 |
| ------ | ---------------------------------------------------------------------------- | -------------------------- | --------- | ----------------------------------------------------------------------------- |
| UI-060 | Top-pressure buttons set filters + scroll                                   | focus the pressure group   | [covered] | `App.test.tsx` "shows live GPT pressure clusters, ranked mutations, and Codex handoff" |
| UI-061 | Signal anchor links open the exact signal                                   | row expands                | [covered] | `App.test.tsx` "reveals an exact signal on its correct page despite an active filter" |
| UI-062 | **M4: `revealExactSignal` from a filtered view still opens the target**     | target renders on its page | [covered] | `App.test.tsx` "reveals an exact signal on its correct page despite an active filter" (added `34162c8`; verified to fail against the pre-fix effect). Rev 2 said `[partial]` — "direct regression test remains" — which is now closed |
| UI-063 | Inspector filters reset the page and filter                                 | count updates              | [covered] | same test plus "shows live GPT pressure clusters, ranked mutations, and Codex handoff" |
| UI-064 | Pagination (prev/next, disabled at the ends)                                | correct                    | [covered] | `App.test.tsx` "reveals an exact signal on its correct page despite an active filter" (page-2 assertion) |
| UI-065 | Deep-link `#signal-<id>` on load opens the row                              | correct                    | [covered] | `App.test.tsx` "shows live GPT pressure clusters, ranked mutations, and Codex handoff" (asserts the `#signal-EV-001` href) and "hydrates a deep-linked observation outside the first archive page" |

### 8.7 Observation archive & genome

| ID     | Case                                                                        | Expected              | Status    | Evidence / what is missing                                                |
| ------ | ----------------------------------------------------------------------------- | --------------------- | --------- | ---------------------------------------------------------------------------- |
| UI-070 | Evidence-class filter                                                        | filter applies        | [covered] | `views/dashboard-views.test.tsx` "keeps the Genome evidence-class filter controlled by its parent" |
| UI-071 | Archive `<details>` lazy-loads once; deep link auto-opens                     | single fetch          | [covered] | `App.test.tsx` "hydrates a deep-linked observation outside the first archive page" |
| UI-072 | Detail load error → Retry re-fetches                                         | correct               | [gap]     | no test exercises the detail-retry path                                     |
| UI-073 | "Load older observation records" appends via cursor                          | correct               | [covered] | `telemetry/useLiveTelemetry.test.tsx` "keeps older paginated rows and the prior cursor when more is already loaded" and "survives a refresh after loading an older page" |
| UI-074 | **L6c: evidence-class filter applied only to the fetched page**              | filter reaches the query or loads more | [gap] | still client-side over loaded rows only; no test. *Note:* the related refresh-clobber bug **was** fixed (`636740c`) and is covered by `useLiveTelemetry.test.tsx` "replaces outright when nothing has been paginated beyond the fresh page" / "does not duplicate a row the fresh page and the older pages share" — that is a different defect from this one |
| UI-075 | Genome workspace: filter, baseline rows, load-older, fossil lazy-load, deep link, ARIA ids | correct | [covered] | `App.test.tsx` "shows the Genome in its own workspace" and "uses unique execution IDs and resolvable ARIA references in Genome"; `views/dashboard-views.test.tsx` "keeps the Genome evidence-class filter controlled by its parent" |

### 8.8 Mutations — reasoning & portfolio

| ID     | Case                                                                        | Expected                | Status    | Evidence / what is missing                                              |
| ------ | ----------------------------------------------------------------------------- | ----------------------- | --------- | -------------------------------------------------------------------------- |
| UI-080 | Ask model → `POST .../analyse-evidence`; disabled without signals            | correct                 | [covered] | `App.test.tsx` "shows live GPT pressure clusters, ranked mutations, and Codex handoff" (clicks `Ask gpt-5.6`) |
| UI-081 | Cached analysis → "Open cached reasoning", no duplicate paid call            | correct                 | [gap]     | the string `Open cached reasoning` (`App.tsx:2862`) appears in **no test**; only the fresh-ask branch is exercised. Rev 2 said `[partial]` |
| UI-082 | Portfolio rows ranked by scorecard total; expand shows scorecard/validation  | correct                 | [covered] | `App.test.tsx` same test (82% / 68% / 64% ordering, validation plan)      |
| UI-083 | "Implement" checkbox toggles selection                                       | correct                 | [covered] | same test (three checkboxes toggled and asserted)                         |
| UI-084 | Start controlled evolution → `POST .../codex-manifest` then `/execution`     | correct                 | [covered] | same test                                                                 |
| UI-085 | Matching non-failed execution → "View implementation" (no new dispatch)      | branch                  | [gap]     | no test exercises this branch                                             |
| UI-086 | Empty state without evidence                                                 | "Evidence is required…" | [covered] | `views/dashboard-views.test.tsx` "renders the primary evolution message and measured-study action" |
| UI-087 | **NEW:** an approved Darwin Lab mutation hydrates into the Mutations workspace with its provenance and dispatch affordance | handoff renders | [covered] | `App.test.tsx` "hydrates an approved Darwin Lab mutation into the Mutations workspace" |
| UI-088 | **NEW:** clicking "Prepare and dispatch ProjectFlow mutation" runs the Lab handoff dispatch (`/api/lab/experiments/:id/codex-manifest` → `/execution`) | dispatch fires | [gap] | UI-087 asserts only that the button renders **enabled**; `useLabMutationHandoff.startImplementation` / `release` / `startRollback` / `releaseRollback` (`telemetry/useLabMutationHandoff.ts`) have **no test that invokes them** |

### 8.9 Repository Execution Workspace (status-gated)

| ID     | Case                                                             | Expected by status         | Status    | Evidence / what is missing                                        |
| ------ | ------------------------------------------------------------------ | -------------------------- | --------- | -------------------------------------------------------------------- |
| UI-100 | `failed` → Retry repository run                                   | `startControlledEvolution` | [gap]     | `Retry repository run` (`App.tsx`) appears in no component or Playwright test        |
| UI-101 | `preview_ready` → Release reviewed mutation → `POST .../release`  | correct                    | [covered] | `App.test.tsx` "shows live GPT pressure clusters, ranked mutations, and Codex handoff" |
| UI-102 | `releasing` / `deployment_verifying` disabled labels              | correct                    | [partial] | the transitional states appear in the flow above. **The disabled labels are not asserted individually** |
| UI-103 | `released` → confirmation + RollbackWorkspace mounts              | correct                    | [covered] | `App.test.tsx` same test (rollback workspace becomes reachable)     |
| UI-104 | Progress steps; validation checks auto-open when failed           | correct                    | [partial] | progress rendering is exercised; **the auto-open-on-failure branch is not asserted** |
| UI-105 | On release→released: reset measurements + refresh genome/archives | side effects               | [covered] | `telemetry/useLiveTelemetry.test.tsx` "polls repository executions only while work remains non-terminal"; `App.test.tsx` genome refresh assertions |

### 8.10 Rollback Workspace

| ID     | Case                                                                  | Expected | Status    | Evidence / what is missing                                       |
| ------ | ----------------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------- |
| UI-120 | No rollback → Prepare controlled rollback → `POST .../rollback`        | correct  | [covered] | `e2e/demo.spec.ts` "@smoke completes the controlled evolution, archive, and rollback path" clicks the real button; `tests/e2e/demo.spec.ts` "@full completes the controlled evolution, archive, and rollback flow" repeats it. *Not covered by any component test* |
| UI-121 | `preview_ready` → Release reviewed rollback → `POST .../rollback/release` | correct | [covered] | same two Playwright tests; the `@smoke` one also polls `/api/genome` until `rollback.status === 'released'` |
| UI-122 | `released` → rollback confirmation shown after reload                 | correct  | [covered] | `e2e/demo.spec.ts` "@smoke completes the controlled evolution, archive, and rollback path" reloads and asserts the `ProjectFlow returned to…` confirmation. *The Control Room's REVERTED label specifically is still unasserted — tracked under UI-022* |

### 8.11 System status

| ID     | Case                                                                  | Expected | Status    | Evidence / what is missing                                                |
| ------ | ----------------------------------------------------------------------- | -------- | --------- | ---------------------------------------------------------------------------- |
| UI-160 | Status rows + genome table from `health` / build                       | content  | [partial] | `App.test.tsx` "shows redacted operational diagnostics in System status" covers the diagnostics half. **The health/build status rows are not asserted** |
| UI-161 | DiagnosticsPanel loads `GET /api/diagnostics`; Export JSON             | correct  | [partial] | same test asserts the panel renders provider latency + privileged transitions and that **Export JSON is enabled**. **The export click / Blob construction is not exercised.** Rev 2 said `[gap]` |
| UI-162 | Error / loading / ready states                                         | each     | [gap]     | only the ready state is asserted                                            |

### 8.12 Live / polling behaviour

| ID     | Case                                                                | Expected                | Status    | Evidence / what is missing                                            |
| ------ | --------------------------------------------------------------------- | ----------------------- | --------- | ------------------------------------------------------------------------ |
| UI-180 | Event poll cadence + backoff when empty + drain when `hasMore`       | scheduling              | [covered] | `telemetry/useLiveTelemetry.test.tsx` "uses cursored deltas and backs off after an empty update" |
| UI-181 | Poll pauses on hidden tab; failure → stale + jittered retry          | correct                 | [covered] | `useLiveTelemetry.test.tsx` "pauses hidden tabs and refreshes immediately when visible" and "marks failures stale and recovers with a jittered retry" |
| UI-182 | Generation guard discards stale in-flight responses                  | no resurrection         | [covered] | `useLiveTelemetry.test.tsx` "survives a refresh after loading an older page"; `LabView.test.tsx` "drops a stale poll response that resolves after a newer one" |
| UI-183 | Demo-reset poll until complete → reset state + refresh               | transition              | [partial] | `App.test.tsx` "locks measured study access while a baseline reset is incomplete" covers the locked state. **The poll-to-completion transition is not asserted in the UI** |
| UI-184 | Execution poll stops when terminal                                   | stop condition          | [covered] | `useLiveTelemetry.test.tsx` "polls repository executions only while work remains non-terminal" |
| UI-185 | Event window bounded and deduped by `eventId`                        | bounded                 | [covered] | `useLiveTelemetry.test.tsx` "does not duplicate a row the fresh page and the older pages share"; `index.test.ts` "ingests, deduplicates, and exposes ordered real telemetry" |
| UI-186 | GlobalExplainTooltip dismisses on scroll/resize                      | no orphaned tooltip     | [partial] | viewport containment is covered (`e2e/demo.spec.ts` "keeps keyboard tooltip inside the 390px viewport"; `tests/e2e/workspaces.spec.ts` "keeps edge tooltips inside the viewport"). **Scroll/resize dismissal is not asserted** |

---

## 9. Darwin Labs — UI + full workflow (`LAB`)

> **§9.1 was rewritten in this revision.** The Lab designer that Rev 2 described — a parameter form
> with success-criterion select, population/persona/action/duration/seed numeric inputs, and a row of
> status-gated Duplicate/Cancel/Force-fail/Retry/Archive/Promote-eval buttons — **no longer exists**.
> `LabView.tsx` is now a single free-text goal composer that creates and starts a population in one
> action, auto-analyses when evidence lands, and hands the chosen mutation to the Mutations workspace.
> Rev 2's LAB-001..009 statuses described that removed UI, so several `[covered]` claims could not
> have been true. Cases whose subject no longer exists are marked `[obsolete]` rather than deleted.

### 9.1 Lab UI controls (`LabView.tsx`)

| ID      | Case                                                                                   | Expected                      | Status     | Evidence / what is missing                                                    |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------------- | ---------- | -------------------------------------------------------------------------------- |
| LAB-001 | Goal composer → "Send agents" → `POST /api/lab/experiments {goal}` then `POST .../start` | one action creates and starts | [covered]  | `LabView.test.tsx` "sends a plain-English goal to the agents with one action" (asserts the exact `{goal}` body and the follow-on `/start`); `e2e/demo.spec.ts` "@smoke defines and completes a non-Apollo Darwin Lab population" drives the same composer in a real browser. **Rev 2's "≥20 `data-explain` labels" clause is false: `LabView.tsx` contains zero `data-explain` attributes** |
| LAB-002 | Success-criterion select swaps route/marker/workflow field                              | —                             | [obsolete] | the select does not exist; the server resolves the task from the goal (`shared/src/lab-contracts.test.ts` "accepts a bare goal and leaves task/target for the server to resolve") |
| LAB-003 | Numeric inputs (population/persona/actions/duration/seed) reject NaN                    | —                             | [obsolete] | those inputs do not exist; `LabView.test.tsx` explicitly asserts `Action budget` and `Seed` are **absent**. No NaN handling exists anywhere in `apps/web/src` or `packages/shared`. **Rev 2 claimed `[covered]` citing `LabView.test.tsx`** |
| LAB-004 | Composer is disabled while a create/start is in flight                                  | no double submit              | [gap]      | `composerDisabled` (`LabView.tsx:259`) is unasserted                             |
| LAB-005 | Status-gated lifecycle buttons (Duplicate/Cancel/Force-fail/Retry/Archive)               | —                             | [obsolete] | no such controls are rendered. These capabilities remain **API-only** — see LAB-038 |
| LAB-006 | Analysis is triggered automatically once a completed experiment has evidence            | no manual step                | [gap]      | the auto-analyse effect (`LabView.tsx:227-242`) has no test                       |
| LAB-007 | Behavioural CI promote / rerun-eval controls                                             | —                             | [obsolete] | not rendered in the Lab view; the routes still exist (§9.2)                       |
| LAB-008 | "Use this change" → `POST .../mutations/select` then navigate to Mutations               | single approval               | [gap]      | `selectMutation` (`LabView.tsx:244-252`) has no test; Rev 2 claimed `[covered]`   |
| LAB-009 | Dispatch after approval happens in the Mutations workspace via the handoff hook          | manifest → execution          | [partial]  | hydration covered by `App.test.tsx` "hydrates an approved Darwin Lab mutation into the Mutations workspace"; **the dispatch action itself is UI-088, a gap**. Rev 2 described an execution panel + PR link inside the Lab view, which does not exist |
| LAB-010 | **M3: 2 s experiment poll drops a stale response**                                       | latest-wins, no flicker       | [covered]  | `LabView.test.tsx` "drops a stale poll response that resolves after a newer one" (added `d753608`; verified to fail with the generation guard disabled). Rev 2 said `[partial]` |
| LAB-011 | **NEW:** population grid and single-run replay render for a finished experiment          | population + replay ordering  | [covered]  | `LabView.test.tsx` "shows the agent population and a replay for a finished run"   |
| LAB-012 | **NEW:** a failed latest run is not auto-focused; history falls back to the placeholder  | no failed run in focus        | [gap]      | behaviour added in `1619a0e` (`LabView.tsx:113-126`); no test asserts it          |

### 9.2 Lab HTTP state machine (`lab/handler.ts`, CAS)

| ID      | Case                                                                            | Expected                            | Status    | Evidence / what is missing                                              |
| ------- | --------------------------------------------------------------------------------- | ----------------------------------- | --------- | -------------------------------------------------------------------------- |
| LAB-030 | Create: target origin not allow-listed → 403; unexecutable oracle → 400          | correct                             | [covered] | `lab/handler.test.ts` "allows only explicitly configured remote target origins" and "rejects custom tasks whose success oracle is not executable by ProjectFlow" |
| LAB-031 | Edit a non-draft experiment → 409 `lab_state_conflict`                           | correct                             | [gap]     | **no `PUT` request appears anywhere in `lab/handler.test.ts`.** The only `lab_state_conflict` assertion belongs to LAB-041. Rev 2 claimed `[covered]` |
| LAB-032 | Single-winner experiment transition (CAS)                                        | one winner                          | [covered] | `lab/lab-repository.test.ts` "allows only one concurrent experiment transition" |
| LAB-033 | Run/action appends are atomic and idempotent                                     | no lost run                         | [covered] | `lab/lab-repository.test.ts` "enforces unique population slots and idempotent action appends" and "makes terminal run retries safe without overwriting the winner" |
| LAB-034 | Provenance / budget conflicts → 409                                              | correct                             | [partial] | the zero-action aggregate guard is covered (`handler.test.ts` "fails an infrastructure-only population that produced zero browser actions"). **The three named conflict codes are not asserted individually** |
| LAB-035 | `/finish` all-terminal → finalise evidence; evidence failure does not strand the run | correct                          | [covered] | `handler.test.ts` "runs a bounded population into separately labelled evidence"; `lab/evidence.test.ts` "builds a reproducible Darwin Lab evidence pack"; `lab-repository.test.ts` "fails closed on poisoned persisted JSON without echoing row contents" |
| LAB-036 | `/analyse` and `/mutations/select` preconditions                                 | 200 / 409 / 503                     | [covered] | `lab/reasoning.test.ts` "fails closed when a live API key is unavailable" and "accepts only mutations that cite records in the evidence pack" |
| LAB-037 | `/codex-manifest` requires evidence + analysis + selection → 201 lab provenance  | correct                             | [covered] | `lab-repository.test.ts` "rehydrates a durable selection when the experiment projection regresses"; `api-route-contract.test.ts` "Darwin Lab rebuild-evidence requires execute authority (not merely simulate)" pins its authority |
| LAB-038 | `/cancel` `/force-fail` `/archive` `/retry` `/duplicate` `/promote-eval` `/rerun-eval` preconditions | 200 or 409 per set  | [partial] | `/retry` is covered (`handler.test.ts` "retries under a new identity and dispatches only that experiment") and every route's **authority** is pinned by `api-route-contract.test.ts`. **The remaining six routes have no behavioural precondition test — and, since §9.1 removed their UI, no other coverage either** |
| LAB-039 | Agent-decision requires live model + a running run                               | 200 / 409 / 502                     | [covered] | `lab/reasoning.test.ts` "returns one bounded cheap-agent action and removes nullable target fields" and "fails closed when a live API key is unavailable" |
| LAB-040 | Start with managed-runner credentials absent                                     | 502, recoverable `awaiting_runner`  | [covered] | `handler.test.ts` "keeps a queued experiment recoverable when managed dispatch fails" |
| LAB-041 | Start a draft containing immutable run history                                   | 409, history never requeued         | [covered] | `handler.test.ts` "refuses to requeue a draft that contains immutable run history" |
| LAB-042 | Retry a failed/cancelled experiment                                              | new identity, derived state cleared | [covered] | `handler.test.ts` "retries under a new identity and dispatches only that experiment" |
| LAB-043 | **NEW: GitHub rejects the dispatch call** (non-2xx)                              | 502 `managed_runner_dispatch_<status>`, experiment stays recoverable | [covered] | `handler.test.ts` "keeps a queued experiment recoverable when GitHub rejects the dispatch call" (added `fc6f7a7`) |

### 9.3 Lab status → control availability

Rev 2 specified an exhaustive `{draft, awaiting_runner, running, completed, analysing, analysed,
cancelled, archived, failed}` × button matrix. **That matrix no longer has a subject:** the Lab view
renders no per-status lifecycle buttons (§9.1 LAB-005/007). The lifecycle capabilities survive only
as API routes, so the meaningful test is LAB-038's per-route precondition table, not a UI matrix.
**Status: [obsolete] as a UI matrix; tracked as LAB-038 `[partial]` at the API layer.**

### 9.4 Lab runner (`packages/lab-runner`, 21% gate)

| ID      | Case                                                                        | Expected                              | Status    | Evidence / what is missing                                                  |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| LAB-060 | Claim → run → actions → finish happy path                                    | population completes                  | [partial] | `runner.test.ts` "creates a deterministic allocated population and a provenance-bound target URL" and "retries terminal persistence without losing the eventual acknowledgement" cover the pieces; the full chain end-to-end is covered only through `e2e/demo.spec.ts`, which drives the API directly rather than the runner binary |
| LAB-061 | **L4: a transient `listSessionEventIds` failure must not reset `knownEventIds`** | no re-attribution                 | [covered] | `runner.test.ts` "preserves the telemetry high-water mark across a transient read failure" |
| LAB-062 | `finish` 409 mid-population                                                  | surfaced, context closed, others continue | [gap] | no test                                                                        |
| LAB-063 | Cross-origin `decision.destination` refused server-side                      | rejected                              | [partial] | bounded-route recording is covered (`runner.test.ts` "records only bounded target routes when the browser URL contains study credentials"). **Server-side refusal of a cross-origin destination is not asserted** |
| LAB-064 | Action/outcome mapping; ≤100 telemetry ids per action                        | correct shape                         | [partial] | mapping covered (`runner.test.ts` "derives bounded friction labels from semantic action outcomes"). **The ≤100 id cap is not asserted** |
| LAB-065 | Browser action locators time out well inside the task budget                 | runner cannot burn the whole duration | [covered] | `runner.test.ts` "bounds stale browser targets well below the experiment duration budget" and "keeps runner failures distinct and safe for the Lab record" |
| LAB-066 | **Managed GitHub runner against deployed ProjectFlow**                        | claim, real action, telemetry linkage, terminal run, evidence | [gap] | **A precise procedure now exists** — `docs/wiki/Operations-and-Deployment.md` §"Darwin Lab managed runner smoke check" (prerequisites, exact commands, pass criteria, runner-vs-agent failure triage, cleanup) — **but it has never been executed**, and the doc says so. Documented ≠ verified; this stays a gap until a run is recorded |
| LAB-067 | **NEW:** zero-action population is failed rather than reported as a success  | infra failure is visible              | [covered] | `handler.test.ts` "fails an infrastructure-only population that produced zero browser actions"; `runner.test.ts` "rejects an infrastructure-only population with no browser behavior" |

---

## 10. Telemetry client (`TEL`)

| ID      | Case                                                                                        | Expected                              | Status    | Evidence                                                                     |
| ------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| TEL-001 | **C1: a receipt with nonzero `sequenceConflicts`** is reconciled terminally, no infinite retry | outbox clears, no wedge             | [covered] | `telemetry-client.test.ts` "terminally reconciles sequence-conflicting events from a receipt" |
| TEL-002 | **L2: a re-instantiated client keeps a stable sequence** for the same caller session          | no self-inflicted conflict            | [covered] | `telemetry-client.test.ts` "continues a stable session sequence across client instances" |
| TEL-003 | **H1: non-secure context (`crypto.randomUUID` undefined)** still yields unique ids            | no eventId collision                  | [covered] | `telemetry-client.test.ts` "creates unique valid event IDs without crypto.randomUUID" |
| TEL-004 | Tracking methods enqueue correct, schema-valid event shapes                                  | schema-valid                          | [covered] | `telemetry-client.test.ts` "derives rich pointer evidence without capturing visible content", "captures semantic controls and unambiguous task attempts", "captures relative browser zoom increases" |
| TEL-005 | Delivery clears an acknowledged batch and retains a failed one                                | correct                               | [covered] | `telemetry-client.test.ts` "keeps failed deliveries and clears a successfully received batch" |
| TEL-006 | A receipt that does not account for every event retains the batch                              | no silent loss                        | [covered] | `telemetry-client.test.ts` "retains a batch when its receipt does not account for every event" |
| TEL-007 | Non-OK → backoff honouring `Retry-After`; no hot loop; no unhandled rejection                 | bounded                               | [covered] | `telemetry-client.test.ts` "honors Retry-After before retrying a rate-limited batch" and "contains timer-driven delivery failures without unhandled rejections" |
| TEL-008 | **M5: unload path does not double-send; beacon batches await a receipt; a bad batch cannot abort the flush** | no duplicates, no aborted flush | [covered] | `telemetry-client.test.ts` "beacons a page-hidden session once without starting a competing fetch", "retains Beacon batches until a server receipt acknowledges them", and "skips a batch that fails to serialize instead of aborting the beacon flush" (added `7288fd8`) |
| TEL-009 | **L3: transient `QuotaExceeded` does not latch persistence off**                              | later writes retry                    | [covered] | `telemetry-client.test.ts` "retries persistent outbox writes after a transient quota failure" |
| TEL-010 | Bounded outbox drops oldest and counts them                                                   | cap enforced                          | [covered] | `telemetry-client.test.ts` "reports every event dropped by the bounded outbox" |
| TEL-011 | Offline retry recovers acknowledged events                                                    | no loss                               | [covered] | `telemetry-client.test.ts` "recovers acknowledged events after an offline retry" |
| TEL-012 | **NEW: a hung delivery is aborted by the request timeout and retried**                        | no wedged delivery                    | [covered] | `telemetry-client.test.ts` "aborts a hung delivery once the request timeout elapses and retries" (added `9c42625`) |
| TEL-013 | `init()` idempotence and `destroy()` teardown                                                 | one session, clean teardown           | [partial] | `init()`/`destroy()` are exercised by every test above. **Neither idempotence of `init()` nor listener/timer removal on `destroy()` is asserted directly** |

---

## 11. Gateway (`GW`) — ProjectFlow `functions/api/darwin/[[path]].ts`

**This component is not in this repository.** Searching the tree for `functions/api/darwin` and
`[[path]]` returns nothing; `PROJECTFLOW_INGESTION_SECRET` appears here only as the shared secret
Rosalind's Worker verifies against (`security/auth.ts`). Every case below is therefore untestable
from Rosalind and unverified from here. They are retained because the gateway is a **trust boundary
for this system** — it derives the rate-limit `clientKey` that SEC-064 depends on.

| ID     | Case                                                                        | Status | Note                                             |
| ------ | ----------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| GW-001 | Only allow-listed routes pass; else 404                                      | [gap]  | out of repo; confirm whether ProjectFlow's CI runs it |
| GW-002 | Missing `PROJECTFLOW_INGESTION_SECRET` → 503, fail closed                    | [gap]  | out of repo                                        |
| GW-003 | `clientKey` is HMAC-derived from `CF-Connecting-IP` — not caller-choosable   | [gap]  | out of repo; **this is the missing half of SEC-064** |
| GW-004 | Signs a canonical identical to `security/auth.ts`                            | [gap]  | out of repo                                        |
| GW-005 | Workspace routes verify the session subject matches the path                 | [gap]  | out of repo; Rosalind's own half is covered (API-074) |
| GW-006 | Body cap → 413; non-JSON upstream → 502 passing through status/`Retry-After` | [gap]  | out of repo                                        |

---

## 12. End-to-end lifecycle scenarios (`LC`)

| ID     | Scenario                                                                             | Status    | Evidence / what is missing                                                    |
| ------ | -------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------- |
| LC-001 | Connect → ingest → evidence → analyse → manifest → dispatch → callbacks → release → fitness | [covered] | `index.test.ts` "caches evidence analysis and creates a bounded Codex manifest" runs the full chain against mocked GitHub/OpenAI; `e2e/demo.spec.ts` "@smoke completes the controlled evolution, archive, and rollback path" runs it in a real browser |
| LC-002 | Release → rollback → rollback release                                                 | [covered] | `e2e/demo.spec.ts` "@smoke completes the controlled evolution, archive, and rollback path" drives prepare → release-rollback in a real browser and polls `/api/genome` until `rollback.status === 'released'`; `tests/e2e/demo.spec.ts` "@full…" repeats it. **The Control Room's REVERTED label remains unasserted (UI-022)** |
| LC-003 | Failed execution → recovery force-fail → retry                                         | [covered] | `repository/recovery.test.ts` "waits for the recovery window and atomically force-fails one queued run"; `repository/execution.test.ts` "retries a failed workflow as a monotonic revision" |
| LC-004 | Callback replay at each stage                                                          | [covered] | `security/callback.test.ts` "accepts one execution-bound signature and rejects its replay"; `index.test.ts` reset-callback replay in the reset lifecycle test |
| LC-005 | Demo reset lifecycle, including a snapshot-refresh failure mid-flight                  | [covered] | `index.test.ts` "preserves state through reset workflow and deployment failures, then clears only after baseline verification"; `persistence/reset-atomicity.test.ts` (all three cases). Rev 2's "M2 failure path `[gap]`" is closed |
| LC-006 | Lab: goal → start → claim → runs + actions → finish → evidence                        | [partial] | `e2e/demo.spec.ts` "@smoke defines and completes a non-Apollo Darwin Lab population" drives the real composer, a real ProjectFlow browser session, real telemetry linkage, and asserts `status: completed` with `evidenceClass: automated` / `provenance.evidenceClass: darwin_lab` and `population.completed: 8`. **It stops at evidence — analyse → select → codex-manifest → dispatch is not exercised end-to-end** |
| LC-007 | Simulation run → summary → identical aggregates for the same seed                     | [covered] | `simulation/simulate.test.ts` "returns the same summary and event stream for the same seed" and "changes paths and fingerprint when the seed changes" |
| LC-008 | **Telemetry pipeline survival across a reload (C1/H1 end-to-end)**                     | [gap]     | every layer is covered in isolation (TEL-001..003, API-052/053); no test carries a stable `sessionId` across a client restart through the real ingestion route |
| LC-009 | Browser E2E `@smoke` + observations + workspaces specs                                | [covered] | `e2e/demo.spec.ts` (3 `@smoke` cases), `tests/e2e/demo.spec.ts`, `tests/e2e/workspaces.spec.ts`, `apps/web/e2e/observations.spec.ts` |

---

## 13. Regression cross-index

Historical finding IDs are retained as labels. `audit-report.md` is **not in the repository**, so the
original wording could not be consulted — rows say so where it matters.

| Finding                                  | Case(s)              | Status at this commit                                                                       |
| ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| C1 receipt omits `sequenceConflicts`     | TEL-001, API-053     | [covered] at both layers; **LC-008** (end-to-end) remains [gap]                              |
| H1 constant-UUID `createId` fallback     | TEL-003              | [covered]; LC-008 remains [gap]                                                              |
| M1 list 500 on one corrupt row           | API-141, NF-005      | repository listers [covered]; the `GET /api/genome` route-level case (API-141) [partial]     |
| M2 reset wipes before snapshot           | API-164, LC-005      | [covered] — fixed in `930ee54` (2026-07-22), **after Rev 2 was written**                     |
| M3 Lab stale-response poll               | LAB-010              | [covered] — direct race test added in `d753608`                                              |
| M4 `revealExactSignal` clobbered         | UI-062               | [covered] — direct filtered-view test added in `34162c8`                                     |
| M5 unload double-send / beacon           | TEL-008              | [covered], now also against a serialization failure (`7288fd8`)                              |
| L1 reset execution had no CAS            | API-165, API-166     | [covered] — `version` column (`0017_reset_execution_versioning.sql`) + `reset-atomicity.test.ts` |
| L2 sequence resets per instance          | TEL-002              | [covered]                                                                                     |
| L3 persistence latch                     | TEL-009              | [covered]                                                                                     |
| L4 runner resets `knownEventIds`         | LAB-061              | [covered]                                                                                     |
| L5 O(n·m) in-memory conflict scan        | —                    | [gap]; no case had been written. Tracked as hardening, not release-blocking                  |
| L6a no fetch timeout                     | NF-004, TEL-012      | [covered] — `apps/web/src/api.test.ts` + telemetry-client timeout test (`9c42625`)           |
| L6b NaN numeric inputs                   | LAB-003              | **[obsolete]** — the inputs were removed with the Lab redesign; there is nothing left to guard |
| L6c filter after pagination              | UI-074               | [gap] — distinct from the refresh-clobber bug that `636740c` fixed                           |
| L7 simulation metric edges               | API-144              | [covered] for seed/variant/rate-limit/in-flight edges                                        |
| A1 duplicate `retention_runs` table      | MIG-001              | [gap] — still created in both `0009_retention_controls.sql` and `0014_retention_and_storage_health.sql` |
| A2 dead `operational_audit_events` table | MIG-002              | [gap] — `0015_operational_audit_events.sql` creates it; **zero references in `workers/api/src`**. The live table is the differently-named `operational_events`; the new corrupt-row test covers **that** table, not this dead one |
| A3 colliding migration prefixes          | MIG-003              | [gap] — five files share prefix `0009`, three share `0010`                                   |
| A4 status columns lack CHECK             | MIG-004              | [gap] — `repository_executions`, `lab_experiments`, `lab_agent_runs`, `reset_executions` all use bare `TEXT NOT NULL` |
| A5 inconsistent retention constant       | API-033, NF-006      | [covered] for sweep behaviour; the constant itself is a code-review item, not a test          |
| A6 worker JSON lacked `nosniff`          | API-009              | [covered]                                                                                     |
| A7 `.gitignore` `.env*`                  | CI-007               | the ignore rule exists (`.gitignore:4-5`); **no test enforces it** → [gap]                    |
| A8 god-files                             | —                    | refactor, not a test. `index.ts` is ~4,150 lines; `telemetry-repository.ts` remains the largest untested module |
| sec-1 fail-open capability default       | SEC-067, API-008     | [covered], and now drift-guarded (API-011)                                                    |
| B5 scorecard rescale                     | API-089              | **[covered]** — Rev 2 listed this as unverified; the case exists and passes                   |
| B11 manifest re-post after dispatch      | API-101              | [gap] — the existing test re-posts **before** dispatch, not after                             |
| B3 "friction scale"                      | —                    | **Unverifiable.** No code, test, or commit in this repository matches this description, and `audit-report.md` is absent, so the original claim cannot be read. Rev 2 mapped it to API-085 (a CPU-budget case), which does not match the description. Do not mark it closed; re-derive the finding or drop it |
| Prior fixed — Lab `/claim` & `/runs` races | LAB-032, LAB-033   | [covered]                                                                                     |
| Prior fixed — non-atomic release (B10)   | API-122             | [partial] — the CAS primitive is covered; a concurrent-release test is still missing          |
| Prior fixed — workspace IDOR (S1)        | SEC-041, API-074    | [covered]                                                                                     |
| Prior fixed — unbounded body (S2)        | SEC-060, API-055    | [covered]                                                                                     |
| Prior fixed — target signing (M1)        | SEC-001, SEC-002    | SEC-002 [covered]; **SEC-001 is only [partial]** — the body/targetId/clientKey bindings are unproven |
| Prior fixed — rate-limit key bypass (S3) | SEC-064, GW-003     | [gap] both sides; the deciding logic is in the gateway repository                             |

---

## 14. Migrations & CI

| ID      | Case                                                                        | Status    | Evidence / what is missing                                                                  |
| ------- | ----------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| MIG-001 | Apply all migrations clean; `retention_runs` has one coherent shape          | [gap]     | duplicate `CREATE TABLE retention_runs` in `0009_retention_controls.sql:122` and `0014_retention_and_storage_health.sql:16`; no migration test exists anywhere |
| MIG-002 | No migration-created table is unreferenced by `src`                          | [gap]     | `operational_audit_events` (`0015`) has zero references in `workers/api/src`                 |
| MIG-003 | Migration filenames have unique, sequential numeric prefixes                  | [gap]     | five `0009_*`, three `0010_*`. (The two most recent migrations, `0016` and `0017`, are unique — the collisions are historical) |
| MIG-004 | Status columns reject out-of-model values                                     | [gap]     | no `CHECK` on any status column                                                               |
| MIG-005 | **NEW:** a migration-backed D1 database is exercised by tests, not just in-memory doubles | [covered] | `persistence/reset-atomicity.test.ts` and `persistence/telemetry-d1.test.ts` run against Miniflare-backed D1 with the real migration files |
| CI-001  | `test:coverage` gates hold per workspace                                     | [covered] | `.github/workflows/ci.yml` "Test with measured coverage gates"                                 |
| CI-002  | Playwright `@smoke` + visual against `demo-baseline-v3`                      | [covered] | `ci.yml` "Browser demo smoke" and "Browser visual regression", both against the checked-out ProjectFlow baseline |
| CI-003  | Lint / format / typecheck incl. contract, env and context drift guards       | [covered] | `ci.yml` runs `format:check`, `lint`, `typecheck`; `typecheck` chains `context:check`, `docs:check`, `env:check`. Since `ad2ba74` there is a **second, independent** drift mechanism at the test layer — API-011 |
| CI-004  | `npm audit --audit-level=high` + CodeQL + dependency-review                   | [covered] | `ci.yml` audit step, `codeql` job, `dependency-review` job (`fail-on-severity: high`)         |
| CI-005  | Deploy re-verifies CI green for the exact SHA; `concurrency: darwin-production` | [covered] | `.github/workflows/deploy.yml` "Require successful CI for this commit" + `concurrency.group: darwin-production` |
| CI-006  | Raise the `lab-runner` gate above 21% as LAB-060..064 land                    | [gap]     | still `lines=21 functions=29 statements=21 branches=65` in `packages/lab-runner/package.json`, unchanged by the runner work that landed this cycle |
| CI-007  | Assert no `.env*` file is committable                                        | [gap]     | `.gitignore:4-5` has the rule; nothing tests it                                               |
| CI-008  | Gateway (ProjectFlow repo) tests run somewhere                               | [gap]     | unverifiable from this repository; nothing here checks out or runs them                       |

---

## 15. Non-functional (`NF`)

| ID     | Area           | Case                                                                   | Status    | Evidence / what is missing                                                        |
| ------ | -------------- | ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------ |
| NF-001 | Performance    | Evidence generation at ~10k events within the CPU budget                | [covered] | `evidence/evidence.test.ts` "processes a deterministic 10,000-event study within a bounded budget" (Rev 2 said `[partial]`) |
| NF-002 | Performance    | Hot list queries indexed and bounded (no full scan / N+1)               | [partial] | indexes exist in the migrations and pagination is bounded (`persistence/pagination.test.ts`, `archive-pagination.test.ts`). **No test measures query shape or row counts at scale** |
| NF-003 | Resilience     | Pollers back off and pause; Lab loads are latest-wins                    | [covered] | `useLiveTelemetry.test.tsx` "uses cursored deltas and backs off after an empty update", "pauses hidden tabs and refreshes immediately when visible", "marks failures stale and recovers with a jittered retry"; `LabView.test.tsx` "drops a stale poll response that resolves after a newer one" (Rev 2 said `[partial]`) |
| NF-004 | Resilience     | Every client request is bounded by a timeout (L6a)                      | [covered] | `apps/web/src/api.test.ts` "aborts a hung request once the timeout elapses", "honours a caller-supplied signal without waiting for the timeout", "resolves normally well within the timeout window"; `telemetry-client.test.ts` "aborts a hung delivery once the request timeout elapses and retries". **Rev 2 said `[gap]`; fixed and tested in `9c42625`** |
| NF-005 | Resilience     | A corrupt D1 row does not 500 an entire list read (M1)                  | [covered] | `persistence/telemetry-d1.test.ts` "skips corrupt execution rows without blanking fossil-record pages", "skips corrupt telemetry event rows without leaking their contents or 500ing the page", "skips corrupt operational audit event rows without leaking their contents or 500ing the page". **Route-level coverage is still API-141 `[partial]`** |
| NF-006 | Data retention | Daily sweep prunes past-window rows; health reports retention            | [partial] | the sweep is covered (`persistence/retention.test.ts` "compacts large execution output before expiring the fossil record", "retains study lineage after analysis JSON expires"; `index.test.ts` "sweeps expired telemetry idempotently and records aggregate health"). **The `scheduled()` cron entry point is never invoked — see API-010** |
| NF-007 | Accessibility  | Nav `aria-current`, labelled controls, resolvable ARIA refs; axe per view | [partial] | ARIA assertions exist (`App.test.tsx` "uses unique execution IDs and resolvable ARIA references in Genome"; `tests/e2e/workspaces.spec.ts` "supports keyboard navigation between workspaces"; `visual/type-scale.spec.ts` WCAG-AA contrast cases). **No axe/`jest-axe`/`@axe-core` dependency exists — there is no automated a11y audit at all** |
| NF-008 | Visual         | Playwright visual + type-scale snapshots stable                          | [covered] | `apps/web/visual/type-scale.spec.ts` (5 cases incl. 100/125/200% reflow and AA contrast in both themes); `e2e/demo.spec.ts` `visual <workspace>` cases |
| NF-009 | Observability  | Structured logs + request id correlate the chain; audit trail persisted   | [partial] | audit-record shape and token redaction are asserted (`index.test.ts` "propagates request IDs and retains redacted privileged audit events"). **Nothing asserts correlation of one request id across the full execution chain** |
| NF-010 | Determinism    | `canonicalStringify` hash stability (codepoint sort)                     | [gap]     | the identifier appears in no test file                                                |

---

## 16. Release gate — P0 vs long-term hardening

This is the split the previous revision lacked. **P0 is the entire release-blocking set.** Anything
not listed here is hardening and must not be quoted as a release claim, however desirable it is.

### 16.1 P0 — release-blocking, must be green for the release SHA

**Gates (all must pass, per §3's commands):** `npm run lint` · `npm run typecheck` ·
`npm test` · `npm run test:coverage` (per-workspace thresholds) · `npm run test:e2e -- --grep "@smoke"` ·
`npx playwright test --grep visual` · `npm run build` · `npm audit --audit-level=high` ·
`npm run smoke:production` after deploy.

**Cases that must be `[covered]` and passing:**

- **Authorization and trust boundaries:** API-006, API-008, API-011, API-022, API-024, API-027,
  SEC-002, SEC-004, SEC-020, SEC-021, SEC-022, SEC-040, SEC-041, SEC-060, SEC-067.
- **Telemetry integrity:** API-052, API-053, API-056, API-057, API-058, API-060, TEL-001, TEL-002,
  TEL-003, TEL-005, TEL-006, TEL-007, TEL-008, TEL-009, TEL-010, TEL-012.
- **Evidence and reasoning integrity:** API-080, API-083, API-084, API-086, API-088, API-089.
- **Release / rollback correctness:** API-100, API-102, API-106, API-120, API-124, API-126, API-127,
  API-128, GH-020, GH-021, GH-022, GH-040, GH-041, GH-042, GH-060, LC-001, LC-002, LC-003, LC-004,
  UI-120, UI-121, UI-122.
- **Destructive-operation safety:** API-033, API-034, API-035, API-036, API-164, API-165, API-166,
  LC-005, NF-005, MIG-005.
- **Lab correctness at the API layer:** LAB-030, LAB-032, LAB-033, LAB-035, LAB-036, LAB-039,
  LAB-040, LAB-041, LAB-042, LAB-043, LAB-067.
- **Shell integrity:** UI-015, UI-016, LC-009, NF-008.

**P0 items that are NOT currently satisfied** — each is release-blocking work, not a tracked wish:

| ID      | Why it blocks                                                                                              | Status    |
| ------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| API-021 | An unauthenticated request to a deployed Worker with no tokens configured must fail closed. Untested.       | [gap]     |
| API-023 | A **wrong** operator token must be rejected. No test supplies one. This is the primary auth check.           | [gap]     |
| API-025 | Viewer tokens are only proven to be denied on `inspect_evidence` routes, not on `execute`/`release`/`delete_data`. | [partial] |
| SEC-001 | The `sha256(body)` / `targetId` / `clientKey` bindings of the ingestion HMAC are unproven.                    | [partial] |
| SEC-066 | The `local-development` full-capability bypass has no test pinning it to localhost-with-no-secrets.          | [gap]     |
| API-162 | A wrong confirmation string must not start a destructive reset.                                              | [gap]     |
| API-082 | An evidence pack must not be generated from too few events. `insufficient_evidence` has no test.              | [gap]     |

### 16.2 Long-term hardening (P1/P2) — tracked, never a release claim

Ordered by value:

1. **Runtime route exhaustiveness** — API-026 (drive all 68 routes with a valid operator token),
   API-037, API-001, API-003 (`Vary`), API-005 (invalid-format id), API-010 (`scheduled()`).
2. **Concurrency races still proven only at the primitive layer** — API-101 (B11), API-104, API-122.
3. **Lab surface left uncovered by the UI redesign** — LAB-004, LAB-006, LAB-008, LAB-012, UI-088,
   and LAB-038's six untested lifecycle routes, which now have neither UI nor behavioural tests.
4. **Lab runner** — LAB-060, LAB-062, LAB-063, LAB-064, then CI-006's ratchet; **LAB-066** stays P1
   only because it needs a real production dispatch — the procedure is written and ready to run.
5. **Untested trust surfaces** — GW-001..006 (must be answered in the ProjectFlow repository) and
   UI-001..004 (the operator auth gate).
6. **Defence in depth** — SEC-003, SEC-042, SEC-061, SEC-062, SEC-063, SEC-065.
7. **Migration hygiene** — MIG-001..004.
8. **Frontend detail** — the `[partial]`/`[gap]` rows in §8, particularly UI-074 (L6c), UI-081,
   UI-161, UI-162.
9. **Coverage ratchets** — a direct `persistence/telemetry-repository.ts` suite, `packages/shared`
   function/branch gates (currently 0 / 19), and `apps/web`'s `SystemStatusView.tsx`.
10. **Non-functional** — NF-002, NF-007 (adopt an axe harness), NF-009, NF-010, LC-002, LC-006,
    LC-008.

---

## 17. Revalidation ledger — where Rev 2 was wrong

Every row below was checked against a named test at `6513e43`. **46 status corrections across 44
cases.** The 19 rows marked ⚠ are where Rev 2 **claimed coverage that does not exist** — the
category this rebaseline was commissioned to find. (Eighteen are wrong statuses; the nineteenth,
LAB-001, keeps its status but carried a false sub-claim.)

| Case      | Rev 2       | Rev 3      | Why                                                                                             |
| --------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------- |
| API-002   | [partial]   | [covered]  | "enforces production origins and telemetry rate limits" asserts the 403 directly                  |
| API-003   | [gap]       | [partial]  | wildcard and matched-echo are both asserted; only `Vary: Origin` is not                           |
| API-004   | [gap]       | [covered]  | "rejects malformed path encoding before route parameters are decoded" exists and passes           |
| API-007   | [partial]   | [covered]  | "preserves JSON and CORS when an unexpected request error occurs" asserts 500 + `internal_error`  |
| ⚠ API-010 | [covered]   | [partial]  | the sweep is tested; the `scheduled()` cron entry point (`index.ts:4138`) is never invoked        |
| ⚠ API-020 | [covered]   | [partial]  | the bypass is used everywhere but its identity/capabilities are never asserted                    |
| ⚠ API-021 | [covered]   | [gap]      | `authentication_unavailable` appears in no test file                                              |
| ⚠ API-023 | [covered]   | [gap]      | no test ever supplies a wrong-but-present bearer token                                            |
| ⚠ API-025 | [covered]   | [partial]  | only `inspect_evidence` routes are denied to a viewer, not the other five capabilities            |
| API-035/036 | [gap]     | [covered]  | "deletes participant, study, and execution artifacts by explicit scope" covers all three scopes   |
| ⚠ API-082 | [covered]   | [gap]      | `insufficient_evidence` (`index.ts:2205`, `:2365`) appears in no test file                        |
| API-085   | [partial]   | [covered]  | "processes a deterministic 10,000-event study within a bounded budget"                            |
| API-089   | [gap]       | [covered]  | "keeps legitimate low percentage scores low when ranking candidates" is exactly the B5 case       |
| API-141   | [gap]       | [partial]  | repository listers now skip corrupt rows; the `/api/genome` route case remains unasserted         |
| API-144/145 | [partial] | [covered]  | seed/variant, `Retry-After: 60`, `Retry-After: 5`, and both 404 paths are all asserted            |
| API-164   | [gap]       | [covered]  | fixed in `930ee54` **after** Rev 2 was written; the reset test asserts data survives the failure  |
| API-165   | [gap]       | [covered]  | `reset-atomicity.test.ts` adds a real concurrent-CAS race                                         |
| ⚠ GH-021  | [partial] ×3 | split     | rollback and reset dispatch are **[covered]**; only `dispatchManagedRunner` (GH-023) is a gap     |
| ⚠ SEC-001 | [covered]   | [partial]  | only path and method are tampered; body/targetId/clientKey bindings are unproven                  |
| SEC-002   | [partial]   | [covered]  | the same test *is* the cross-method/cross-path replay case                                        |
| UI-062    | [partial]   | [covered]  | direct filtered-view reveal test added in `34162c8`                                               |
| ⚠ UI-081  | [partial]   | [gap]      | `Open cached reasoning` appears in no test; only the fresh-ask branch runs                        |
| UI-161    | [gap]       | [partial]  | the diagnostics panel and its enabled Export button are asserted                                  |
| ⚠ LAB-001 | [covered]   | [covered]* | the route assertion holds, but the "≥20 `data-explain` labels" clause is false — zero exist       |
| ⚠ LAB-003 | [covered]   | [obsolete] | the numeric inputs were removed; the cited test asserts their **absence**                          |
| LAB-002/005/007 | [partial] | [obsolete] | the controls they describe are not rendered anywhere                                        |
| ⚠ LAB-008 | [covered]   | [gap]      | `selectMutation` has no test                                                                      |
| LAB-010   | [partial]   | [covered]  | direct stale-poll race test added in `d753608`                                                    |
| ⚠ LAB-031 | [covered]   | [gap]      | no `PUT` request exists in `lab/handler.test.ts`; the cited 409 belongs to LAB-041                |
| ⚠ UI-040  | [covered]   | [partial]  | the refresh click is asserted; the spinner / disabled state is not                                |
| ⚠ UI-042  | [covered]   | [gap]      | `Generate evidence` appears in no test file                                                       |
| ⚠ UI-045  | [covered]   | [gap]      | the session-index `is-active` toggle is asserted by no test                                       |
| ⚠ UI-046  | [covered]   | [partial]  | the per-signal evidence trace is asserted; the per-type event-trace list is not                   |
| ⚠ UI-047  | [covered]   | [partial]  | contract and API halves only; the UI branch is not exercised                                      |
| ⚠ UI-100  | [covered]   | [gap]      | `Retry repository run` appears in no component or Playwright test                                 |
| UI-122    | [partial]   | [covered]  | the `@smoke` E2E reloads and asserts the post-rollback confirmation                                |
| LC-002    | [partial]   | [covered]  | the rollback path is driven end-to-end in a real browser by the `@smoke` E2E                      |
| NF-001/003/004/005 | mixed | [covered] | see §15 — NF-004 in particular went from `[gap]` to fully covered this cycle                    |
| B5 / B11 / B3 | "verify-and-close" | resolved individually | B5 [covered], B11 [gap], B3 **unverifiable** (no matching code, and `audit-report.md` is absent) |

**Structural repairs** made alongside the status changes: compound cells (`[covered] → … [partial]`)
split into separate IDs; `GH-021` split into GH-021/022/023 by workflow; `X-Darwin-Request-ID`
corrected to `X-Request-ID`; the §13 `B3 → API-085` mapping removed as unsupported; the §9.3 UI
matrix retired to LAB-038; the phantom `audit-report.md` dependency flagged; and the baseline
inventory (Rev 2: "37 files / 171 + 17 cases") corrected to the measured 35 files / 213 + 17 with the
commands that produce it.
