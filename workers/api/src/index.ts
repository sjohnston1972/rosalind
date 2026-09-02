import {
  CodexImplementationManifestSchema,
  CodexManifestRequestSchema,
  DemoResetCallbackSchema,
  DemoResetExecutionSchema,
  DemoResetRequestSchema,
  DemoResetResponseSchema,
  EvidenceAnalysisSchema,
  StoredEvidenceAnalysisSchema,
  EvidencePackSchema,
  FitnessOutcomeSchema,
  GenomeExecutionDetailResponseSchema,
  GenomeHistoryResponseSchema,
  LabExperimentSchema,
  ObservationArchiveDetailResponseSchema,
  ObservationArchivesResponseSchema,
  ParticipantWorkspaceResponseSchema,
  ProjectFlowWorkspaceSchema,
  RepositoryExecutionCallbackSchema,
  RepositoryMutationExecutionSchema,
  RepositoryRollbackCallbackSchema,
  SimulationRequestSchema,
  StudyEventsResponseSchema,
  StudySessionResponseSchema,
  StudySessionIssueRequestSchema,
  StudyTelemetrySummarySchema,
  StudyTelemetryEventSchema,
  TargetApplicationConnectionSchema,
  TargetConnectionRequestSchema,
  TelemetryReceiptSchema,
  type CodexImplementationManifest,
  type DemoResetExecution,
  type OperationalEvent,
  type OperationalProvider,
  type RepositoryMutationExecution,
  type SimulationResult,
  type StoredEvidenceAnalysis,
  type StoredEvidencePack,
  type TargetApplicationConnection,
} from '@darwin/shared';
import rootPackage from '../../../package.json';

import { simulate } from './simulation';
import {
  getTelemetryRepository,
  type EventPageCursor,
} from './persistence/telemetry-repository';
import { retentionPolicy } from './persistence/retention';
import { EvidenceVersionMismatchError, buildEvidencePack } from './evidence';
import { calculateFitnessOutcome, invalidateFitnessOutcome } from './fitness';
import {
  EvidenceReasoningError,
  analyseEvidence,
  analysisCacheKey,
  buildCodexManifest,
} from './reasoning';
import { captureRepositorySnapshot } from './repository/github-source';
import {
  attachRepositoryRollback,
  createRepositoryRollback,
  createRepositoryExecution,
  retryRepositoryExecution,
  updateRepositoryRollback,
  updateRepositoryExecution,
} from './repository/execution';
import { forceFailStrandedExecution } from './repository/recovery';
import {
  GitHubMergeStateUnknownError,
  dispatchRollbackWorkflow,
  dispatchEvolutionWorkflow,
  dispatchResetWorkflow,
  mergeRollbackPullRequest,
  mergeEvolutionPullRequest,
} from './repository/github-actions';
import {
  authorizeOperator,
  authorizeTargetRequest,
  type OperatorCapability,
  type OperatorIdentity,
} from './security/auth';
import {
  issueExecutionCallbackCredential,
  verifyExecutionCallback,
} from './security/callback';
import { findApiRoute } from './api-route-contract';
import {
  DeploymentVerificationPendingError,
  verifyProjectFlowDeployment,
} from './repository/deployment-verification';
import {
  completeImmediateResetExecution,
  completeResetExecution,
  createResetExecution,
  updateResetExecution,
} from './repository/reset-execution';
import {
  advanceE2EExecution,
  advanceE2ERollback,
  createE2EBoundaryFetch,
  e2eFixturesEnabled,
} from './testing/e2e-fixtures';
import { handleLabRequest } from './lab/handler';
import { handleOperationalRoutes } from './routes/operations';
import { getLabRepository } from './lab/lab-repository';
import {
  anonymousStudyParticipantId,
  issueStudySession,
  verifyStudySessionToken,
} from './security/study-session';
import { PayloadTooLargeError, readBoundedBody } from './security/bounded-body';

export interface Env {
  DB?: D1Database;
  INGESTION_RATE_LIMITER?: RateLimit;
  SIMULATION_RATE_LIMITER?: RateLimit;
  ALLOWED_ORIGINS: string;
  DARWIN_AI_MODE: string;
  DARWIN_DEMO_SEED: string;
  DARWIN_EVENT_COUNT: string;
  DARWIN_RELEASE?: string;
  DARWIN_COMMIT_SHA?: string;
  DARWIN_MAX_EVENTS_PER_STUDY?: string;
  DARWIN_MAX_EVENTS_PER_TARGET?: string;
  OPENAI_API_KEY?: string;
  OPENAI_API?: string;
  OPENAI_MODEL: string;
  OPENAI_LAB_AGENT_MODEL?: string;
  OPENAI_TIMEOUT_MS: string;
  PROJECTFLOW_REPOSITORY: string;
  PROJECTFLOW_BRANCH: string;
  PROJECTFLOW_PRODUCTION_URL: string;
  PROJECTFLOW_STUDY_URL: string;
  PROJECTFLOW_DEPLOYMENT_TIMEOUT_MS?: string;
  PROJECTFLOW_DEPLOYMENT_POLL_MS?: string;
  PROJECTFLOW_RESET_MAX_ATTEMPTS?: string;
  PROJECTFLOW_STUDY_ID?: string;
  PROJECTFLOW_AUTOMATED_STUDY_ID?: string;
  PROJECTFLOW_ALLOWED_APP_VERSIONS?: string;
  PROJECTFLOW_LAB_STUDY_ID?: string;
  DARWIN_LAB_ALLOWED_ORIGINS?: string;
  GITHUB_TOKEN?: string;
  DARWIN_CALLBACK_TOKEN?: string;
  DARWIN_OPERATOR_TOKEN?: string;
  DARWIN_VIEWER_TOKEN?: string;
  PROJECTFLOW_INGESTION_SECRET?: string;
  DARWIN_E2E_FIXTURES?: string;
}

const defaultCorsHeaders = {
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Request-ID, X-Darwin-Study-Session',
  'Access-Control-Expose-Headers': 'X-Request-ID',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const openAIKey = (env?: Partial<Env>) =>
  env?.OPENAI_API_KEY || env?.OPENAI_API;

const defaultArchivePageSize = 10;
const maximumArchivePageSize = 25;

const archivePageOptions = (url: URL) => {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? defaultArchivePageSize : Number(rawLimit);
  const cursor = url.searchParams.get('cursor');
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumArchivePageSize ||
    (cursor !== null &&
      (cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(cursor)))
  ) {
    throw new Error('invalid_archive_page');
  }
  return { limit, cursor };
};

const checkSummary = (checks: RepositoryMutationExecution['checks']) => ({
  total: checks.length,
  passed: checks.filter((check) => check.status === 'passed').length,
  failed: checks.filter((check) => check.status === 'failed').length,
});

const summarizeExecution = (execution: RepositoryMutationExecution) => ({
  ...(execution.provenance ? { provenance: execution.provenance } : {}),
  executionId: execution.executionId,
  manifestId: execution.manifestId,
  analysisId: execution.analysisId,
  repository: {
    fullName: execution.repository.fullName,
    url: execution.repository.url,
    branch: execution.repository.branch,
    baseSha: execution.repository.baseSha,
    sourceHash: execution.repository.sourceHash,
  },
  status: execution.status,
  branch: execution.branch,
  baseSha: execution.baseSha,
  headSha: execution.headSha,
  changedFileCount: execution.changedFiles.length,
  checkSummary: checkSummary(execution.checks),
  hasPatch: execution.patch !== null,
  hasCodexOutput: execution.codex.finalMessage !== null,
  hasError: execution.error !== null,
  rollback: execution.rollback
    ? {
        rollbackId: execution.rollback.rollbackId,
        status: execution.rollback.status,
        revertedSha: execution.rollback.revertedSha,
        headSha: execution.rollback.headSha,
        changedFileCount: execution.rollback.changedFiles.length,
        checkSummary: checkSummary(execution.rollback.checks),
        hasPatch: execution.rollback.patch !== null,
        hasError: execution.rollback.error !== null,
        createdAt: execution.rollback.createdAt,
        updatedAt: execution.rollback.updatedAt,
        completedAt: execution.rollback.completedAt,
      }
    : null,
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt,
  completedAt: execution.completedAt,
});

const manifestMatchesExecution = (
  manifest: CodexImplementationManifest,
  execution: RepositoryMutationExecution,
) =>
  manifest.manifestId === execution.manifestId &&
  (!execution.manifestHash ||
    manifest.manifestHash === execution.manifestHash) &&
  manifest.repository?.fullName === execution.repository.fullName &&
  manifest.repository?.baseSha === execution.baseSha &&
  JSON.stringify(manifest.provenance ?? null) ===
    JSON.stringify(execution.provenance ?? null);

const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[midpoint]!
    : (ordered[midpoint - 1]! + ordered[midpoint]!) / 2;
};

const summarizeObservationArchive = ({
  execution,
  analysis,
  evidence,
}: {
  execution: RepositoryMutationExecution;
  analysis: StoredEvidenceAnalysis;
  evidence: StoredEvidencePack;
}) => {
  const terminalAttempts = evidence.taskAttempts.filter(
    (attempt) => attempt.outcome !== 'open',
  );
  return {
    archiveId: execution.executionId,
    evidence: {
      ...(evidence.provenance ? { provenance: evidence.provenance } : {}),
      evidenceId: evidence.evidenceId,
      evidenceHash: evidence.evidenceHash,
      generatedAt: evidence.generatedAt,
      evidenceClass: evidence.evidenceClass,
      study: evidence.study,
      quality: {
        strength: evidence.quality.strength,
        score: evidence.quality.score,
      },
      signalCount: evidence.frictionSignals.length,
      fitness: {
        terminalAttemptCount: terminalAttempts.length,
        completedAttemptCount: terminalAttempts.filter(
          (attempt) => attempt.outcome === 'success',
        ).length,
        medianInteractions: median(
          terminalAttempts.map((attempt) => attempt.interactionCount),
        ),
      },
    },
    analysis: {
      ...(analysis.provenance ? { provenance: analysis.provenance } : {}),
      analysisId: analysis.analysisId,
      model: analysis.model,
      createdAt: analysis.createdAt,
      selectedMutation: {
        ...(analysis.selectedMutation.provenance
          ? { provenance: analysis.selectedMutation.provenance }
          : {}),
        id: analysis.selectedMutation.id,
        title: analysis.selectedMutation.title,
      },
    },
    execution: {
      ...(execution.provenance ? { provenance: execution.provenance } : {}),
      executionId: execution.executionId,
      manifestId: execution.manifestId,
      status: execution.status,
      createdAt: execution.createdAt,
      completedAt: execution.completedAt,
    },
  };
};

const encodeEventCursor = (cursor: EventPageCursor) =>
  btoa(`${cursor.receivedAt}\n${cursor.eventId}`)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const decodeEventCursor = (value: string): EventPageCursor => {
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('invalid_event_cursor');
  }
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const [receivedAt, eventId, ...extra] = atob(padded).split('\n');
    if (
      !receivedAt ||
      !eventId ||
      extra.length > 0 ||
      Number.isNaN(Date.parse(receivedAt)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        eventId,
      )
    ) {
      throw new Error('invalid_event_cursor');
    }
    return { receivedAt, eventId };
  } catch {
    throw new Error('invalid_event_cursor');
  }
};

const jsonResponse = (
  body: unknown,
  init: ResponseInit = {},
  corsHeaders: Record<string, string> = {
    ...defaultCorsHeaders,
    'Access-Control-Allow-Origin': '*',
  },
) => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  Object.entries(corsHeaders).forEach(([name, value]) =>
    headers.set(name, value),
  );

  return new Response(JSON.stringify(body), { ...init, headers });
};

const auditOperatorAuthorization = ({
  request,
  pathname,
  capability,
  identity,
  actor,
  outcome,
  reason,
}: {
  request: Request;
  pathname: string;
  capability: OperatorCapability;
  identity?: OperatorIdentity;
  actor?: OperatorIdentity['actor'] | 'anonymous';
  outcome: 'authorized' | 'denied';
  reason?: string;
}) => {
  console.info(
    '[darwin:audit]',
    JSON.stringify({
      event: 'operator_request_authorization',
      actor: actor ?? identity?.actor ?? 'anonymous',
      action: `${request.method} ${pathname}`,
      target: pathname,
      capability,
      outcome,
      ...(reason ? { reason } : {}),
    }),
  );
};

const corsForRequest = (request: Request, env?: Partial<Env>) => {
  const configuredOrigins = (env?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get('Origin');
  const originAllowed =
    configuredOrigins.length === 0 ||
    requestOrigin === null ||
    configuredOrigins.includes(requestOrigin);
  const corsHeaders = {
    ...defaultCorsHeaders,
    ...(configuredOrigins.length === 0
      ? { 'Access-Control-Allow-Origin': '*' }
      : originAllowed && requestOrigin
        ? {
            'Access-Control-Allow-Origin': requestOrigin,
            Vary: 'Origin',
          }
        : {}),
  };
  return { corsHeaders, originAllowed };
};

interface StoredSimulation {
  run: SimulationResult['run'];
  summary: SimulationResult['summary'];
  expiresAt: number;
}

const simulationStore = new Map<string, StoredSimulation>();
const simulationTtlMs = 15 * 60 * 1_000;
const maximumStoredSimulations = 4;
let simulationInFlight = false;

const getStoredSimulation = (id: string) => {
  const now = Date.now();
  for (const [storedId, stored] of simulationStore) {
    if (stored.expiresAt <= now) simulationStore.delete(storedId);
  }
  const stored = simulationStore.get(id) ?? null;
  if (stored) {
    simulationStore.delete(id);
    simulationStore.set(id, stored);
  }
  return stored;
};

const storeSimulation = (result: SimulationResult) => {
  simulationStore.set(result.run.id, {
    run: result.run,
    summary: result.summary,
    expiresAt: Date.now() + simulationTtlMs,
  });
  while (simulationStore.size > maximumStoredSimulations) {
    const oldest = simulationStore.keys().next().value as string | undefined;
    if (!oldest) break;
    simulationStore.delete(oldest);
  }
};

const configuredTarget = (env?: Partial<Env>) =>
  TargetConnectionRequestSchema.parse({
    fullName: env?.PROJECTFLOW_REPOSITORY || 'sjohnston1972/projectflow',
    branch: env?.PROJECTFLOW_BRANCH || 'main',
    productionUrl:
      env?.PROJECTFLOW_PRODUCTION_URL ||
      'https://darwin-projectflow.pages.dev/',
    studyUrl:
      env?.PROJECTFLOW_STUDY_URL ||
      'https://darwin-projectflow.pages.dev/?study=true',
  });

const allowedTargetStudies = (env?: Partial<Env>) =>
  new Set([
    env?.PROJECTFLOW_STUDY_ID || 'projectflow-baseline-study',
    env?.PROJECTFLOW_AUTOMATED_STUDY_ID ||
      'projectflow-baseline-automated-study',
    env?.PROJECTFLOW_LAB_STUDY_ID || 'projectflow-darwin-lab',
  ]);

const targetStudyAllowed = (studyId: string, env?: Partial<Env>) => {
  const labStudy = env?.PROJECTFLOW_LAB_STUDY_ID || 'projectflow-darwin-lab';
  return (
    allowedTargetStudies(env).has(studyId) || studyId.startsWith(`${labStudy}-`)
  );
};

const isLabStudy = (studyId: string, env?: Partial<Env>) => {
  const labStudy = env?.PROJECTFLOW_LAB_STUDY_ID || 'projectflow-darwin-lab';
  return studyId === labStudy || studyId.startsWith(`${labStudy}-`);
};

const targetProvenanceAllowed = (
  event: { studyId: string; source: string },
  env?: Partial<Env>,
) => {
  const measuredStudy =
    env?.PROJECTFLOW_STUDY_ID || 'projectflow-baseline-study';
  const automatedStudy =
    env?.PROJECTFLOW_AUTOMATED_STUDY_ID ||
    'projectflow-baseline-automated-study';
  const labStudy = env?.PROJECTFLOW_LAB_STUDY_ID || 'projectflow-darwin-lab';
  return (
    (event.studyId === measuredStudy && event.source === 'real_user') ||
    (event.studyId === automatedStudy && event.source === 'automated') ||
    (event.studyId.startsWith(`${labStudy}-`) && event.source === 'automated')
  );
};

export const selectMeasurementBoundary = (
  cycleStartedAt: string | null | undefined,
  targetConnectedAt: string | null | undefined,
) => {
  if (
    targetConnectedAt &&
    (!cycleStartedAt ||
      Date.parse(targetConnectedAt) > Date.parse(cycleStartedAt))
  ) {
    return {
      startedAt: targetConnectedAt,
      source: 'target_connection' as const,
    };
  }
  if (cycleStartedAt) {
    return {
      startedAt: cycleStartedAt,
      source: 'evolution_cycle' as const,
    };
  }
  return { startedAt: null, source: null };
};

const isAllowedTargetVersion = (
  appVersion: string,
  env: Partial<Env> | undefined,
  connection: TargetApplicationConnection | null,
  executions: RepositoryMutationExecution[],
) => {
  const configuredVersions = new Set(
    (env?.PROJECTFLOW_ALLOWED_APP_VERSIONS || 'baseline,1.0.0')
      .split(',')
      .map((version) => version.trim())
      .filter(Boolean),
  );
  if (configuredVersions.has(appVersion)) return true;

  const match = appVersion.match(
    /^([a-f0-9]{7,40})(?:-(candidate|rollback))?$/,
  );
  if (!match) return false;
  const [, prefix, variant] = match;
  const matches = (sha: string | null | undefined) =>
    Boolean(sha?.startsWith(prefix!));

  if (variant === 'candidate') {
    return executions.some((execution) => matches(execution.headSha));
  }
  if (variant === 'rollback') {
    return executions.some((execution) => matches(execution.rollback?.headSha));
  }
  return (
    matches(connection?.repository.baseSha) ||
    executions.some(
      (execution) =>
        matches(execution.baseSha) ||
        (execution.status === 'released' && matches(execution.headSha)),
    )
  );
};

const targetOriginInScope = (
  sourceOrigin: string,
  allowedOrigins: string[],
) => {
  const source = new URL(sourceOrigin);
  return allowedOrigins.some((allowedOrigin) => {
    const allowed = new URL(allowedOrigin);
    return (
      source.origin === allowed.origin ||
      (source.protocol === 'https:' &&
        source.hostname.endsWith(`.${allowed.hostname}`))
    );
  });
};

const versionMatchesCommit = (appVersion: string, commitSha: string) =>
  /^[a-f0-9]{7,40}$/.test(appVersion) && commitSha.startsWith(appVersion);

type OperationalActor = OperationalEvent['actor'];

interface ProviderTrace {
  provider: OperationalProvider;
  operation: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  errorCode: string | null;
}

interface RequestTrace {
  requestId: string;
  startedAt: number;
  actor: OperationalActor;
  action: string;
  target: string;
  beforeState: string | null;
  afterState: string | null;
  metrics: ProviderTrace[];
}

const requestIdPattern = /^[A-Za-z0-9._:-]{1,80}$/;

const createRequestTrace = (request: Request): RequestTrace => {
  const supplied = request.headers.get('X-Request-ID');
  const pathname = new URL(request.url).pathname;
  const routeAccess = findApiRoute(request.method, pathname)?.access;
  return {
    requestId:
      supplied && requestIdPattern.test(supplied)
        ? supplied
        : crypto.randomUUID(),
    startedAt: performance.now(),
    actor:
      routeAccess === 'callback'
        ? 'repository-callback'
        : routeAccess === 'target'
          ? 'projectflow'
          : 'anonymous',
    action: `${request.method} ${pathname}`.slice(0, 120),
    target: pathname.slice(0, 240),
    beforeState: null,
    afterState: null,
    metrics: [],
  };
};

const providerErrorCode = (error: unknown) =>
  error instanceof Error ? error.name : 'UnknownError';

const logAuthorizationDecision = (
  trace: RequestTrace,
  boundary: 'operator' | 'target' | 'repository_callback',
  allowed: boolean,
  errorCode: string | null = null,
) => {
  const payload = JSON.stringify({
    event: `${boundary}_request_${allowed ? 'authorized' : 'rejected'}`,
    requestId: trace.requestId,
    actor: trace.actor,
    action: trace.action,
    target: trace.target,
    outcome: allowed ? 'success' : 'failure',
    errorCode,
  });
  if (allowed) console.info('[darwin:audit]', payload);
  else console.warn('[darwin:audit]', payload);
};

const observeProvider = async <Result>(
  trace: RequestTrace,
  provider: OperationalProvider,
  operation: string,
  perform: () => Promise<Result>,
): Promise<Result> => {
  const startedAt = performance.now();
  try {
    const result = await perform();
    trace.metrics.push({
      provider,
      operation,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      outcome: 'success',
      errorCode: null,
    });
    return result;
  } catch (error) {
    trace.metrics.push({
      provider,
      operation,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      outcome: 'failure',
      errorCode: providerErrorCode(error),
    });
    throw error;
  }
};

const auditedAction = (method: string, pathname: string) => {
  if (method !== 'POST') return null;
  if (pathname === '/api/target-connection') return 'target.connect';
  if (pathname === '/api/target-connection/disconnect') {
    return 'target.disconnect';
  }
  if (pathname === '/api/demo/reset') return 'demo.reset';
  if (/^\/api\/studies\/[^/]+\/evidence$/.test(pathname)) {
    return 'evidence.generate';
  }
  if (/^\/api\/studies\/[^/]+\/analyse-evidence$/.test(pathname)) {
    return 'gpt.analyse';
  }
  if (/^\/api\/evidence-analyses\/[^/]+\/codex-manifest$/.test(pathname)) {
    return 'manifest.create';
  }
  if (/^\/api\/lab\/experiments\/[^/]+\/promote-eval$/.test(pathname)) {
    return 'behavioural_eval.create';
  }
  if (/^\/api\/lab\/experiments\/[^/]+\/rerun-eval$/.test(pathname)) {
    return 'behavioural_eval.run';
  }
  if (
    /^\/api\/evidence-analyses\/[^/]+\/codex-manifest\/execution$/.test(
      pathname,
    )
  ) {
    return 'workflow.dispatch';
  }
  if (/^\/api\/repository-executions\/[^/]+\/rollback$/.test(pathname)) {
    return 'rollback.dispatch';
  }
  if (/\/rollback\/callback$/.test(pathname)) return 'rollback.callback';
  if (/\/callback$/.test(pathname)) return 'repository.callback';
  if (/\/rollback\/release$/.test(pathname)) return 'rollback.release';
  if (/\/release$/.test(pathname)) return 'mutation.release';
  return null;
};

const responseState = async (response: Response) => {
  if (response.status === 204) return 'no_content';
  try {
    const payload = (await response.clone().json()) as Record<string, unknown>;
    if (typeof payload.status === 'string') return payload.status.slice(0, 120);
    if (payload.rollback && typeof payload.rollback === 'object') {
      const status = (payload.rollback as { status?: unknown }).status;
      if (typeof status === 'string') return `rollback:${status}`.slice(0, 120);
    }
    if (typeof payload.error === 'string') {
      return `error:${payload.error}`.slice(0, 120);
    }
  } catch {
    // Responses without JSON are represented only by their HTTP status.
  }
  return response.ok ? 'completed' : `http_${response.status}`;
};

export const resetSimulationStore = () => {
  simulationStore.clear();
  simulationInFlight = false;
};

export const handleRequest = async (
  request: Request,
  env?: Partial<Env>,
  suppliedTrace?: RequestTrace,
): Promise<Response> => {
  const trace = suppliedTrace ?? createRequestTrace(request);
  const url = new URL(request.url);
  const { pathname } = url;
  const requestCors = corsForRequest(request, env);
  const corsHeaders = {
    ...requestCors.corsHeaders,
    'X-Request-ID': trace.requestId,
  };
  const { originAllowed } = requestCors;
  const json = (body: unknown, init: ResponseInit = {}) =>
    jsonResponse(body, init, corsHeaders);
  const useE2EFixtures = e2eFixturesEnabled(
    env?.DARWIN_E2E_FIXTURES,
    url.hostname,
  );
  const providerFetch = (
    pack?: Parameters<typeof createE2EBoundaryFetch>[0],
  ) => (useE2EFixtures ? createE2EBoundaryFetch(pack) : undefined);

  try {
    decodeURI(pathname);
  } catch {
    return json(
      {
        error: 'invalid_path_encoding',
        message: 'The request path contains invalid percent encoding.',
      },
      { status: 400 },
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: originAllowed ? 204 : 403,
      headers: corsHeaders,
    });
  }

  if (!originAllowed) {
    return json(
      { error: 'origin_forbidden', message: 'Request origin is not allowed.' },
      { status: 403 },
    );
  }

  const routeDefinition = findApiRoute(request.method, pathname);
  if (!routeDefinition) {
    return json(
      { error: 'not_found', message: 'The requested route was not found.' },
      { status: 404 },
    );
  }

  if (request.method === 'GET' && pathname === '/api/auth/session') {
    const authorization = await authorizeOperator(request, env, 'observe');
    auditOperatorAuthorization({
      request,
      pathname,
      capability: 'observe',
      ...(authorization.ok
        ? { identity: authorization.identity, outcome: 'authorized' as const }
        : {
            actor: authorization.error === 'forbidden' ? 'viewer' : 'anonymous',
            outcome: 'denied' as const,
            reason: authorization.error,
          }),
    });
    trace.actor = authorization.ok ? authorization.identity.actor : 'anonymous';
    logAuthorizationDecision(
      trace,
      'operator',
      authorization.ok,
      authorization.ok ? null : authorization.error,
    );
    return authorization.ok
      ? json({
          authenticated: true,
          actor: authorization.identity.actor,
          capabilities: authorization.identity.capabilities,
        })
      : json(
          {
            error: authorization.error,
            message: authorization.message,
          },
          { status: authorization.status },
        );
  }

  let operatorIdentity: OperatorIdentity | null = null;
  const routeAccess = routeDefinition.access;
  if (
    routeAccess !== 'public' &&
    routeAccess !== 'target' &&
    routeAccess !== 'callback'
  ) {
    const capability = routeDefinition.capability;
    if (!capability) {
      return json(
        {
          error: 'route_contract_invalid',
          message: 'The route is missing its required capability boundary.',
        },
        { status: 500 },
      );
    }
    const authorization = await authorizeOperator(request, env, capability);
    if (!authorization.ok) {
      auditOperatorAuthorization({
        request,
        pathname,
        capability,
        actor: authorization.error === 'forbidden' ? 'viewer' : 'anonymous',
        outcome: 'denied',
        reason: authorization.error,
      });
      logAuthorizationDecision(trace, 'operator', false, authorization.error);
      return json(
        { error: authorization.error, message: authorization.message },
        { status: authorization.status },
      );
    }
    operatorIdentity = authorization.identity;
    auditOperatorAuthorization({
      request,
      pathname,
      capability,
      identity: operatorIdentity,
      outcome: 'authorized',
    });
    trace.actor = operatorIdentity.actor;
    logAuthorizationDecision(trace, 'operator', true);
  }

  const telemetryRepository = getTelemetryRepository(env?.DB, (metric) => {
    trace.metrics.push({ provider: 'd1', ...metric });
  });
  const currentExecutionAfterConflict = async (executionId: string) => {
    const current =
      await telemetryRepository.getRepositoryExecution(executionId);
    return current
      ? json(
          {
            error: 'concurrent_update',
            message:
              'Repository execution changed while this request was running.',
            execution: RepositoryMutationExecutionSchema.parse(current),
          },
          { status: 409 },
        )
      : json(
          {
            error: 'not_found',
            message: 'Repository execution no longer exists.',
          },
          { status: 404 },
        );
  };
  const currentReleaseAfterConflict = async (
    executionId: string,
    rollback = false,
  ) => {
    const current =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!current) {
      return json(
        {
          error: 'not_found',
          message: 'Repository execution no longer exists.',
        },
        { status: 404 },
      );
    }
    const released = rollback
      ? current.rollback?.status === 'released'
      : current.status === 'released';
    return json(RepositoryMutationExecutionSchema.parse(current), {
      status: released ? 200 : 202,
    });
  };
  const activeRetentionPolicy = retentionPolicy(env);
  const currentCycleStart = async (studyId: string) => {
    const cycle = await telemetryRepository.getEvolutionCycle();
    if (cycle.studyId !== studyId) return null;
    const targetConnection = await telemetryRepository.getTargetConnection();
    return selectMeasurementBoundary(
      cycle.startedAt,
      targetConnection?.connectedAt,
    ).startedAt;
  };
  const refreshVerifiedTargetSnapshot = async ({
    commitSha,
    verifiedAt,
  }: {
    commitSha: string;
    verifiedAt: string;
  }) => {
    const current = await telemetryRepository.getTargetConnection();
    if (!current) return;
    const snapshot = await observeProvider(
      trace,
      'github',
      'capture_deployed_snapshot',
      () =>
        captureRepositorySnapshot({
          fullName: current.repository.fullName,
          branch: current.repository.branch,
          commitSha,
          githubToken: env?.GITHUB_TOKEN,
          productionUrl: current.repository.productionUrl,
          studyUrl: current.repository.studyUrl,
          fetch: providerFetch(),
        }),
    );
    await telemetryRepository.saveTargetConnection(
      TargetApplicationConnectionSchema.parse({
        ...current,
        connectionId: `target-${commitSha.slice(0, 12)}`,
        verifiedAt,
        target: snapshot.target,
        repository: snapshot.context,
        applicationMap: snapshot.applicationMap,
        checks: current.checks.map((check) =>
          check.id === 'repository'
            ? {
                ...check,
                detail: `${snapshot.context.fullName} at ${commitSha.slice(0, 12)}`,
              }
            : check.id === 'contract'
              ? {
                  ...check,
                  detail: `${snapshot.context.mutablePaths.length} mutable paths, ${snapshot.context.validationCommands.length} validation commands`,
                }
              : check,
        ),
      }),
    );
  };
  const reconcileResetDeployment = async (rawExecution: DemoResetExecution) => {
    let execution = DemoResetExecutionSchema.parse(rawExecution);
    if (execution.status !== 'deploying' || !execution.baselineCommit) {
      return execution;
    }
    const deployment = execution.deploymentVerification ?? {
      status: 'verifying' as const,
      expectedCommit: execution.baselineCommit,
      expectedAppVersion: execution.baselineCommit.slice(0, 12),
      observedCommit: null,
      observedAppVersion: null,
      attempts: 0,
      verifiedAt: null,
      lastError: null,
    };
    try {
      const verified = await verifyProjectFlowDeployment({
        studyUrl: execution.repository.studyUrl,
        expectedCommit: execution.baselineCommit,
        expectedAppVersion: execution.baselineCommit.slice(0, 12),
        timeoutMs: 500,
        pollIntervalMs: 0,
        fetcher: providerFetch() ?? fetch,
      });
      const verifiedDeployment = {
        ...deployment,
        status: 'verified' as const,
        observedCommit: verified.commitSha,
        observedAppVersion: verified.appVersion,
        attempts: deployment.attempts + verified.attempts,
        verifiedAt: verified.verifiedAt,
        lastError: null,
      };
      // Compute and verify the full replacement state before anything is
      // destroyed: `verified` above already confirms ProjectFlow production
      // is serving the restored baseline commit, and `completed` is the
      // fully-formed replacement reset-execution record.
      const completed = completeResetExecution(
        execution,
        verifiedDeployment,
        verified.verifiedAt,
      );
      // Capture and persist the verified baseline snapshot before clearing any
      // evidence. A transient GitHub failure must leave the current demo state
      // intact so the deploying reset can be reconciled safely on a later poll.
      await refreshVerifiedTargetSnapshot({
        commitSha: verified.commitSha,
        verifiedAt: verified.verifiedAt,
      });
      // Commit the destructive reset (telemetry, lab data, evolution cycle)
      // together with the deploying -> complete transition as a single
      // atomic, DB-level compare-and-swap. Nothing is destroyed unless the
      // reset_executions row still matches (status, version) exactly, and a
      // failure partway through this call leaves the prior demo data and the
      // execution row untouched, so a later poll can safely retry.
      const result = await telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary: {
          startedAt: verified.verifiedAt,
          measuredCommit: verified.commitSha,
          appVersion: verified.appVersion,
          deploymentVerifiedAt: verified.verifiedAt,
        },
        labRepository: getLabRepository(env?.DB),
      });
      if (!result) {
        // Lost the compare-and-swap: another worker already reconciled this
        // reset (or it moved on) between our read and this attempt. Return
        // the execution as it now stands instead of re-running the reset.
        return (
          (await telemetryRepository.getResetExecution(execution.resetId)) ??
          execution
        );
      }
      resetSimulationStore();
      return result;
    } catch (error) {
      if (!(error instanceof DeploymentVerificationPendingError)) throw error;
      const pending = DemoResetExecutionSchema.parse({
        ...execution,
        deploymentVerification: {
          ...deployment,
          observedCommit: error.observed?.commitSha ?? null,
          observedAppVersion: error.observed?.appVersion ?? null,
          attempts: deployment.attempts + error.attempts,
          lastError: error.errorCode,
        },
        updatedAt: new Date().toISOString(),
      });
      const configuredMaximum = Number(
        env?.PROJECTFLOW_RESET_MAX_ATTEMPTS ?? 60,
      );
      const maximumAttempts = Number.isFinite(configuredMaximum)
        ? Math.max(2, Math.min(600, Math.trunc(configuredMaximum)))
        : 60;
      execution =
        pending.deploymentVerification!.attempts >= maximumAttempts
          ? updateResetExecution(pending, {
              status: 'failed',
              error:
                'ProjectFlow production did not report the restored baseline before the verification limit.',
            })
          : pending;
      await telemetryRepository.saveResetExecution(execution);
      return execution;
    }
  };

  const operationalResponse = await handleOperationalRoutes({
    request,
    url,
    repository: telemetryRepository,
    json,
    requestId: trace.requestId,
    retentionPolicy: activeRetentionPolicy,
    release: env?.DARWIN_RELEASE || rootPackage.version,
    commitSha: env?.DARWIN_COMMIT_SHA || 'local',
    model: env?.OPENAI_MODEL || 'gpt-5.6',
    liveModelAvailable:
      env?.DARWIN_AI_MODE === 'live' && Boolean(openAIKey(env)),
  });
  if (operationalResponse) return operationalResponse;

  if (request.method === 'POST' && pathname === '/api/study-sessions') {
    let body: string;
    try {
      body = await readBoundedBody(request, 16_384);
    } catch (error) {
      return json(
        error instanceof PayloadTooLargeError
          ? {
              error: 'payload_too_large',
              message: 'Study-session request is too large.',
            }
          : {
              error: 'invalid_request_body',
              message: 'Study-session request could not be read.',
            },
        { status: error instanceof PayloadTooLargeError ? 413 : 400 },
      );
    }
    const targetAuthorization = await authorizeTargetRequest(
      request,
      body,
      env,
    );
    if (!targetAuthorization.ok) {
      logAuthorizationDecision(
        trace,
        'target',
        false,
        targetAuthorization.error,
      );
      return json(
        {
          error: targetAuthorization.error,
          message: targetAuthorization.message,
        },
        { status: targetAuthorization.status },
      );
    }
    logAuthorizationDecision(trace, 'target', true);
    const targetSignature = request.headers.get('X-Darwin-Signature');
    if (
      targetSignature &&
      !(await telemetryRepository.consumeTargetRequestSignature(
        targetSignature.toLowerCase(),
        new Date().toISOString(),
      ))
    ) {
      return json(
        {
          error: 'target_request_replayed',
          message: 'Study-session request replay rejected.',
        },
        { status: 409 },
      );
    }
    let input: ReturnType<typeof StudySessionIssueRequestSchema.parse>;
    try {
      input = StudySessionIssueRequestSchema.parse(JSON.parse(body));
    } catch {
      return json(
        {
          error: 'invalid_request',
          message: 'Study-session context is invalid.',
        },
        { status: 400 },
      );
    }
    const measuredStudy =
      env?.PROJECTFLOW_STUDY_ID || 'projectflow-baseline-study';
    const automatedStudy =
      env?.PROJECTFLOW_AUTOMATED_STUDY_ID ||
      'projectflow-baseline-automated-study';
    let participantId: string;
    let sessionId: string | undefined;
    if (input.evidenceClass === 'human_study') {
      if (input.studyId !== measuredStudy) {
        return json(
          {
            error: 'study_session_context_forbidden',
            message: 'Human study context is not configured.',
          },
          { status: 403 },
        );
      }
      participantId = await anonymousStudyParticipantId(
        targetAuthorization.identity.clientKey,
        input.studyId,
        input.appVersion,
        input.evidenceClass,
      );
    } else if (input.evidenceClass === 'automated_study') {
      if (input.studyId !== automatedStudy) {
        return json(
          {
            error: 'study_session_context_forbidden',
            message: 'Automated study context is not configured.',
          },
          { status: 403 },
        );
      }
      participantId = await anonymousStudyParticipantId(
        targetAuthorization.identity.clientKey,
        input.studyId,
        input.appVersion,
        input.evidenceClass,
      );
    } else {
      const experiment = input.labExperimentId
        ? await getLabRepository(env?.DB).getExperiment(input.labExperimentId)
        : null;
      const run = experiment?.runs.find(
        (candidate) => candidate.runId === input.runId,
      );
      if (
        !experiment ||
        !run ||
        experiment.studyId !== input.studyId ||
        experiment.targetAppVersion !== input.appVersion ||
        new URL(experiment.targetUrl).origin !==
          targetAuthorization.identity.sourceOrigin
      ) {
        return json(
          {
            error: 'study_session_context_forbidden',
            message:
              'Darwin Lab session does not match an active immutable run.',
          },
          { status: 403 },
        );
      }
      participantId = run.participantId;
      sessionId = run.sessionId;
    }
    const localRequest = ['localhost', '127.0.0.1', '::1'].includes(
      url.hostname,
    );
    const secret =
      env?.PROJECTFLOW_INGESTION_SECRET ||
      (localRequest ? 'darwin-local-study-session' : undefined);
    if (!secret) {
      return json(
        {
          error: 'study_session_unavailable',
          message: 'Study-session signing is not configured.',
        },
        { status: 503 },
      );
    }
    const issued = await issueStudySession(secret, {
      studyId: input.studyId,
      participantId,
      sessionId,
      appVersion: input.appVersion,
      evidenceClass: input.evidenceClass,
      deploymentOrigin: targetAuthorization.identity.sourceOrigin,
      labExperimentId: input.labExperimentId,
      runId: input.runId,
    });
    return json(issued, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const labResponse = await handleLabRequest(
    request,
    env,
    json,
    operatorIdentity,
  );
  if (labResponse) return labResponse;

  if (request.method === 'GET' && pathname === '/api/genome') {
    try {
      const options = archivePageOptions(url);
      const page = await telemetryRepository.listRepositoryExecutionPage(
        options,
        ['released'],
      );
      return json(
        GenomeHistoryResponseSchema.parse({
          evolutionCycle: await telemetryRepository.getEvolutionCycle(),
          executions: page.executions.map(summarizeExecution),
          fitnessOutcomes: await telemetryRepository.listFitnessOutcomes(),
          page: { limit: options.limit, nextCursor: page.nextCursor },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_archive_page') {
        return json(
          {
            error: 'invalid_pagination',
            message: 'Limit or cursor is invalid.',
          },
          { status: 400 },
        );
      }
      if (error instanceof Error && error.message === 'invalid_cursor') {
        return json(
          { error: 'invalid_pagination', message: 'Cursor is invalid.' },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  if (request.method === 'GET' && pathname === '/api/observations/archives') {
    try {
      const options = archivePageOptions(url);
      const page =
        await telemetryRepository.listObservationArchivePage(options);
      return json(
        ObservationArchivesResponseSchema.parse({
          archives: page.archives.map(summarizeObservationArchive),
          page: { limit: options.limit, nextCursor: page.nextCursor },
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        ['invalid_archive_page', 'invalid_cursor'].includes(error.message)
      ) {
        return json(
          {
            error: 'invalid_pagination',
            message: 'Limit or cursor is invalid.',
          },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  const genomeDetailMatch = pathname.match(/^\/api\/genome\/([^/]+)$/);
  if (request.method === 'GET' && genomeDetailMatch) {
    const execution = await telemetryRepository.getRepositoryExecution(
      decodeURIComponent(genomeDetailMatch[1]!),
    );
    return execution?.status === 'released'
      ? json(
          GenomeExecutionDetailResponseSchema.parse({
            execution,
            summary: summarizeExecution(execution),
          }),
        )
      : json(
          { error: 'execution_not_found', message: 'Execution was not found.' },
          { status: 404 },
        );
  }

  const observationArchiveDetailMatch = pathname.match(
    /^\/api\/observations\/archives\/([^/]+)$/,
  );
  if (request.method === 'GET' && observationArchiveDetailMatch) {
    const record = await telemetryRepository.getObservationArchive(
      decodeURIComponent(observationArchiveDetailMatch[1]!),
    );
    return record
      ? json(
          ObservationArchiveDetailResponseSchema.parse({
            archive: {
              archiveId: record.execution.executionId,
              evidence: record.evidence,
              analysis: record.analysis,
              execution: {
                executionId: record.execution.executionId,
                manifestId: record.execution.manifestId,
                status: record.execution.status,
                createdAt: record.execution.createdAt,
                completedAt: record.execution.completedAt,
              },
            },
            summary: summarizeObservationArchive(record),
          }),
        )
      : json(
          { error: 'archive_not_found', message: 'Archive was not found.' },
          { status: 404 },
        );
  }

  if (request.method === 'GET' && pathname === '/api/target-connection') {
    const connection = await telemetryRepository.getTargetConnection();
    return connection
      ? json(TargetApplicationConnectionSchema.parse(connection))
      : new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === 'POST' && pathname === '/api/target-connection') {
    trace.beforeState = 'disconnected';
    let input: unknown;
    try {
      input = JSON.parse(await readBoundedBody(request, 16_000));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json(
          {
            error: 'payload_too_large',
            message: 'Target request is too large.',
          },
          { status: 413 },
        );
      }
      return json(
        { error: 'invalid_request', message: 'Request body must be JSON.' },
        { status: 400 },
      );
    }
    const parsed = TargetConnectionRequestSchema.safeParse(input);
    if (!parsed.success) {
      return json(
        {
          error: 'invalid_target',
          message: 'Repository, branch and deployment URLs are required.',
        },
        { status: 400 },
      );
    }
    const allowed = configuredTarget(env);
    const requested = parsed.data;
    if (
      requested.fullName !== allowed.fullName ||
      requested.branch !== allowed.branch ||
      new URL(requested.productionUrl).href !==
        new URL(allowed.productionUrl).href ||
      new URL(requested.studyUrl).href !== new URL(allowed.studyUrl).href
    ) {
      return json(
        {
          error: 'target_not_allowed',
          message:
            'This controlled Darwin environment accepts only its configured ProjectFlow target.',
        },
        { status: 403 },
      );
    }

    try {
      const snapshot = await observeProvider(
        trace,
        'github',
        'capture_repository_snapshot',
        () =>
          captureRepositorySnapshot({
            ...requested,
            githubToken: env?.GITHUB_TOKEN,
            fetch: providerFetch(),
          }),
      );
      const runtimeResponse = await observeProvider(
        trace,
        'target',
        'verify_study_runtime',
        async () => {
          const response = await fetch(requested.studyUrl, {
            headers: { Accept: 'text/html' },
          });
          if (!response.ok) {
            const error = new Error(
              `Target deployment returned ${response.status}.`,
            );
            error.name = `TargetHttp${response.status}`;
            throw error;
          }
          const runtimeHtml = await response.text();
          if (!runtimeHtml.includes('<title>ProjectFlow</title>')) {
            const error = new Error(
              'Target deployment identity could not be verified.',
            );
            error.name = 'TargetIdentityError';
            throw error;
          }
          return response;
        },
      );
      const timestamp = new Date().toISOString();
      const connection = TargetApplicationConnectionSchema.parse({
        connectionId: `target-${snapshot.context.baseSha.slice(0, 12)}`,
        status: 'connected',
        connectedAt: timestamp,
        verifiedAt: timestamp,
        target: snapshot.target,
        repository: snapshot.context,
        ingestion: {
          credentialId: `ingestion-${snapshot.context.baseSha.slice(0, 12)}`,
          targetId: snapshot.target.targetId,
          studyIds: [...allowedTargetStudies(env)],
          allowedOrigins: [
            ...new Set(
              [requested.productionUrl, requested.studyUrl].map(
                (deploymentUrl) => new URL(deploymentUrl).origin,
              ),
            ),
          ],
          signatureAlgorithm: 'hmac-sha256',
          issuedAt: timestamp,
        },
        applicationMap: snapshot.applicationMap,
        checks: [
          {
            id: 'repository',
            label: 'GitHub repository',
            status: 'passed',
            detail: `${snapshot.context.fullName} at ${snapshot.context.baseSha.slice(0, 12)}`,
          },
          {
            id: 'contract',
            label: 'Darwin target contract',
            status: 'passed',
            detail: `${snapshot.context.mutablePaths.length} mutable paths, ${snapshot.context.validationCommands.length} validation commands`,
          },
          {
            id: 'runtime',
            label: 'Cloudflare runtime',
            status: 'passed',
            detail: `${new URL(requested.productionUrl).host} returned ${runtimeResponse.status}`,
          },
          {
            id: 'telemetry',
            label: 'Measured study',
            status: 'passed',
            detail: 'Privacy-safe semantic telemetry endpoint configured',
          },
        ],
      });
      await telemetryRepository.saveTargetConnection(connection);
      return json(connection, { status: 201 });
    } catch (error) {
      return json(
        {
          error: 'target_verification_failed',
          message:
            error instanceof Error
              ? error.message
              : 'Target verification failed.',
        },
        { status: 502 },
      );
    }
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/target-connection/disconnect'
  ) {
    trace.beforeState = 'connected';
    await telemetryRepository.deleteTargetConnection();
    trace.afterState = 'disconnected';
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === 'GET' && pathname === '/api/demo/reset') {
    const latest = await telemetryRepository.getLatestResetExecution();
    if (!latest)
      return new Response(null, { status: 204, headers: corsHeaders });
    const reconciled = await reconcileResetDeployment(latest);
    return json(DemoResetResponseSchema.parse(reconciled));
  }

  const resetCallbackMatch = pathname.match(
    /^\/api\/demo\/reset\/([^/]+)\/callback$/,
  );
  if (request.method === 'POST' && resetCallbackMatch) {
    const resetId = decodeURIComponent(resetCallbackMatch[1]!);
    const execution = await telemetryRepository.getResetExecution(resetId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Reset execution not found.' },
        { status: 404 },
      );
    }
    let body: string;
    try {
      body = await readBoundedBody(request, 32_000);
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) {
        return json(
          { error: 'invalid_callback', message: 'Callback body is invalid.' },
          { status: 400 },
        );
      }
      return json(
        { error: 'payload_too_large', message: 'Callback body is too large.' },
        { status: 413 },
      );
    }
    const verification = await verifyExecutionCallback({
      request,
      body,
      callbackSecret: env?.DARWIN_CALLBACK_TOKEN,
      credential:
        await telemetryRepository.getExecutionCallbackCredential(resetId),
      executionId: resetId,
      repository: execution.repository.fullName,
      manifestHash: execution.policyHash,
    });
    if (!verification.ok) {
      return json(
        { error: verification.error, message: verification.message },
        { status: verification.status },
      );
    }
    const parsed = DemoResetCallbackSchema.safeParse(
      (() => {
        try {
          return JSON.parse(body);
        } catch {
          return null;
        }
      })(),
    );
    if (!parsed.success) {
      return json(
        { error: 'invalid_callback', message: 'Callback payload is invalid.' },
        { status: 400 },
      );
    }
    try {
      const signatureAccepted =
        await telemetryRepository.consumeExecutionCallbackSignature(
          resetId,
          verification.signature,
          new Date().toISOString(),
        );
      if (!signatureAccepted) {
        return json(
          { error: 'callback_replayed', message: 'Callback replay rejected.' },
          { status: 409 },
        );
      }
      let updated = updateResetExecution(execution, parsed.data);
      await telemetryRepository.saveResetExecution(updated);
      if (updated.status === 'deploying') {
        updated = await reconcileResetDeployment(updated);
      }
      return json(DemoResetResponseSchema.parse(updated), {
        status: updated.status === 'deploying' ? 202 : 200,
      });
    } catch (error) {
      return json(
        {
          error: 'invalid_transition',
          message:
            error instanceof Error
              ? error.message
              : 'Reset execution transition is invalid.',
        },
        { status: 409 },
      );
    }
  }

  if (request.method === 'POST' && pathname === '/api/demo/reset') {
    trace.beforeState = 'active_cycle';
    let resetRequest: unknown;
    try {
      resetRequest = JSON.parse(await readBoundedBody(request, 16_000));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json(
          {
            error: 'payload_too_large',
            message: 'Reset request is too large.',
          },
          { status: 413 },
        );
      }
      return json(
        {
          error: 'invalid_reset_confirmation',
          message:
            'Reset requires the exact confirmation and export acknowledgement.',
        },
        { status: 400 },
      );
    }
    if (!DemoResetRequestSchema.safeParse(resetRequest).success) {
      return json(
        {
          error: 'invalid_reset_confirmation',
          message:
            'Reset requires the exact confirmation and export acknowledgement.',
        },
        { status: 400 },
      );
    }
    const active = await telemetryRepository.getLatestResetExecution();
    if (active && !['complete', 'failed'].includes(active.status)) {
      trace.afterState = active.status;
      return json(DemoResetResponseSchema.parse(active), { status: 202 });
    }
    const targetConnection = await telemetryRepository.getTargetConnection();
    const target = targetConnection?.repository ?? configuredTarget(env);
    let execution = createResetExecution({
      fullName: target.fullName,
      branch: target.branch,
      studyUrl: target.studyUrl,
    });
    await telemetryRepository.saveResetExecution(execution);
    if (useE2EFixtures || (!env?.GITHUB_TOKEN && !env?.DARWIN_CALLBACK_TOKEN)) {
      // No repository-driven baseline to verify in this mode: the replacement
      // state (an empty demo cycle) is computed up front, then committed
      // atomically together with the queued -> complete transition below.
      const completed = completeImmediateResetExecution(execution);
      const result = await telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary: {
          startedAt: null,
          measuredCommit: null,
          appVersion: null,
          deploymentVerifiedAt: null,
        },
        labRepository: getLabRepository(env?.DB),
      });
      execution =
        result ??
        ((await telemetryRepository.getResetExecution(execution.resetId)) ??
          execution);
      if (result) resetSimulationStore();
      trace.afterState = execution.status;
      return json(DemoResetResponseSchema.parse(execution));
    }
    if (!env?.GITHUB_TOKEN || !env.DARWIN_CALLBACK_TOKEN) {
      execution = updateResetExecution(execution, {
        status: 'failed',
        error:
          'GitHub dispatch and callback credentials must both be configured.',
      });
      await telemetryRepository.saveResetExecution(execution);
      trace.afterState = execution.status;
      return json(DemoResetResponseSchema.parse(execution), { status: 503 });
    }
    try {
      const callbackCredential = await issueExecutionCallbackCredential(
        execution.resetId,
      );
      await telemetryRepository.saveExecutionCallbackCredential(
        callbackCredential.credential,
      );
      await dispatchResetWorkflow({
        token: env.GITHUB_TOKEN,
        fullName: execution.repository.fullName,
        branch: execution.repository.branch,
        resetId: execution.resetId,
        callbackUrl: `${url.origin}/api/demo/reset/${execution.resetId}/callback`,
        callbackNonce: callbackCredential.nonce,
        policyHash: execution.policyHash,
        fetch: providerFetch(),
      });
      execution = DemoResetExecutionSchema.parse({
        ...execution,
        repositoryResetDispatched: true,
        updatedAt: new Date().toISOString(),
      });
      await telemetryRepository.saveResetExecution(execution);
      trace.afterState = execution.status;
      return json(DemoResetResponseSchema.parse(execution), { status: 201 });
    } catch (error) {
      try {
        execution = updateResetExecution(execution, {
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'ProjectFlow reset dispatch failed.',
        });
        await telemetryRepository.saveResetExecution(execution);
      } catch {
        // Preserve the original dispatch error when state persistence also fails.
      }
      trace.afterState = execution.status;
      return json(DemoResetResponseSchema.parse(execution), { status: 502 });
    }
  }

  if (request.method === 'POST' && pathname === '/api/telemetry/events') {
    let body: string;
    try {
      body = await readBoundedBody(request, 256_000);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json(
          {
            error: 'payload_too_large',
            message: 'Telemetry batch is too large.',
          },
          { status: 413 },
        );
      }
      return json(
        {
          error: 'invalid_request_body',
          message: 'Telemetry request body could not be read.',
        },
        { status: 400 },
      );
    }

    await telemetryRepository.incrementOperationalMetrics(
      { telemetryRequests: 1 },
      new Date().toISOString(),
    );

    const targetAuthorization = await authorizeTargetRequest(
      request,
      body,
      env,
    );
    if (!targetAuthorization.ok) {
      await telemetryRepository.incrementOperationalMetrics(
        { authenticationRejected: 1 },
        new Date().toISOString(),
      );
      console.warn(
        '[darwin:security]',
        JSON.stringify({
          event: 'telemetry_authentication_rejected',
          reason: targetAuthorization.error,
          path: pathname,
        }),
      );
      logAuthorizationDecision(
        trace,
        'target',
        false,
        targetAuthorization.error,
      );
      return json(
        {
          error: targetAuthorization.error,
          message: targetAuthorization.message,
        },
        { status: targetAuthorization.status },
      );
    }
    logAuthorizationDecision(trace, 'target', true);

    const targetSignature = request.headers.get('X-Darwin-Signature');
    if (
      targetSignature &&
      !(await telemetryRepository.consumeTargetRequestSignature(
        targetSignature.toLowerCase(),
        new Date().toISOString(),
      ))
    ) {
      await telemetryRepository.incrementOperationalMetrics(
        { replayRejected: 1 },
        new Date().toISOString(),
      );
      return json(
        {
          error: 'target_request_replayed',
          message: 'Telemetry request replay rejected.',
        },
        { status: 409 },
      );
    }

    const suppliedStudySession = request.headers.get('X-Darwin-Study-Session');
    const localRequest = ['localhost', '127.0.0.1', '::1'].includes(
      url.hostname,
    );
    const studySessionSecret =
      env?.PROJECTFLOW_INGESTION_SECRET ||
      (suppliedStudySession && localRequest
        ? 'darwin-local-study-session'
        : undefined);
    const studySessionVerification = studySessionSecret
      ? await verifyStudySessionToken(suppliedStudySession, studySessionSecret)
      : null;
    if (studySessionVerification && !studySessionVerification.ok) {
      await telemetryRepository.incrementOperationalMetrics(
        { contextRejected: 1 },
        new Date().toISOString(),
      );
      return json(
        {
          error: studySessionVerification.error,
          message: studySessionVerification.message,
        },
        { status: 401 },
      );
    }
    const studySessionClaims =
      studySessionVerification?.ok === true
        ? studySessionVerification.claims
        : null;

    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      await telemetryRepository.incrementOperationalMetrics(
        { rejectedEvents: 1 },
        new Date().toISOString(),
      );
      return json(
        {
          error: 'invalid_request',
          message: 'Request body must be valid JSON.',
        },
        { status: 400 },
      );
    }

    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== 'events') ||
      !Array.isArray((input as { events?: unknown }).events) ||
      (input as { events: unknown[] }).events.length < 1 ||
      (input as { events: unknown[] }).events.length > 50
    ) {
      await telemetryRepository.incrementOperationalMetrics(
        { rejectedEvents: 1 },
        new Date().toISOString(),
      );
      return json(
        {
          error: 'invalid_request',
          message: 'Telemetry batches require between 1 and 50 events.',
        },
        { status: 400 },
      );
    }

    const candidates = (input as { events: unknown[] }).events;
    const parsedEvents = candidates.flatMap((candidate) => {
      const parsed = StudyTelemetryEventSchema.safeParse(candidate);
      if (!parsed.success) return [];
      return [parsed.data];
    });
    const [targetConnection, repositoryExecutions] = await Promise.all([
      telemetryRepository.getTargetConnection(),
      telemetryRepository.listRepositoryExecutions(),
    ]);
    const scopedStudies = new Set(
      targetConnection?.ingestion?.studyIds ?? [...allowedTargetStudies(env)],
    );
    const scopedOriginAllowed =
      !targetConnection?.ingestion ||
      (targetConnection.ingestion.targetId ===
        targetAuthorization.identity.targetId &&
        targetOriginInScope(
          targetAuthorization.identity.sourceOrigin,
          targetConnection.ingestion.allowedOrigins,
        ));
    let labSessionExperiment = null as Awaited<
      ReturnType<ReturnType<typeof getLabRepository>['getExperiment']>
    >;
    if (
      studySessionClaims?.evidenceClass === 'darwin_lab' &&
      studySessionClaims.labExperimentId
    ) {
      labSessionExperiment = await getLabRepository(env?.DB).getExperiment(
        studySessionClaims.labExperimentId,
      );
    }
    const sessionContextAllowed = (event: (typeof parsedEvents)[number]) => {
      if (!studySessionClaims) return true;
      const expectedProvenanceClass =
        studySessionClaims.evidenceClass === 'human_study'
          ? 'human_study'
          : studySessionClaims.evidenceClass === 'automated_study'
            ? 'automated_study'
            : 'darwin_lab';
      if (
        event.studyId !== studySessionClaims.studyId ||
        event.participantId !== studySessionClaims.participantId ||
        event.sessionId !== studySessionClaims.sessionId ||
        event.appVersion !== studySessionClaims.appVersion ||
        event.source !== studySessionClaims.source ||
        targetAuthorization.identity.targetId !== studySessionClaims.targetId ||
        targetAuthorization.identity.sourceOrigin !==
          studySessionClaims.deploymentOrigin ||
        (event.provenance !== undefined &&
          event.provenance.evidenceClass !== expectedProvenanceClass)
      ) {
        return false;
      }
      if (studySessionClaims.evidenceClass !== 'darwin_lab') return true;
      const run = labSessionExperiment?.runs.find(
        (candidate) => candidate.runId === studySessionClaims.runId,
      );
      return Boolean(
        labSessionExperiment &&
        run &&
        event.provenance?.labExperimentId ===
          labSessionExperiment.experimentId &&
        event.provenance?.taskDefinitionId ===
          labSessionExperiment.task.taskDefinitionId &&
        event.provenance?.taskDefinitionHash ===
          labSessionExperiment.task.definitionHash &&
        event.provenance?.runIds.includes(run.runId),
      );
    };
    const events = parsedEvents.filter(
      (event) =>
        scopedOriginAllowed &&
        sessionContextAllowed(event) &&
        targetProvenanceAllowed(event, env) &&
        (scopedStudies.has(event.studyId) || isLabStudy(event.studyId, env)) &&
        isAllowedTargetVersion(
          event.appVersion,
          env,
          targetConnection,
          repositoryExecutions,
        ),
    );
    if (events.length !== parsedEvents.length) {
      await telemetryRepository.incrementOperationalMetrics(
        {
          contextRejected: 1,
          rejectedEvents: candidates.length,
        },
        new Date().toISOString(),
      );
      return json(
        {
          error: 'target_context_forbidden',
          message:
            'Telemetry provenance, study, or application version is not configured.',
        },
        { status: 403 },
      );
    }
    if (env?.INGESTION_RATE_LIMITER) {
      const outcome = await env.INGESTION_RATE_LIMITER.limit({
        key: `${targetAuthorization.identity.targetId}:${targetAuthorization.identity.clientKey}`,
      });
      if (!outcome.success) {
        await telemetryRepository.incrementOperationalMetrics(
          { rateLimited: 1 },
          new Date().toISOString(),
        );
        return json(
          {
            error: 'rate_limited',
            message: 'Telemetry ingestion rate exceeded. Retry shortly.',
          },
          { status: 429, headers: { 'Retry-After': '60' } },
        );
      }
    }
    const stored = await telemetryRepository.insertEvents(
      events,
      new Date().toISOString(),
      activeRetentionPolicy,
    );
    await telemetryRepository.incrementOperationalMetrics(
      {
        acceptedEvents: stored.accepted,
        rejectedEvents: candidates.length - events.length,
        duplicateEvents: stored.duplicates,
      },
      new Date().toISOString(),
    );
    return json(
      TelemetryReceiptSchema.parse({
        accepted: stored.accepted,
        rejected: candidates.length - events.length + stored.quotaRejected,
        duplicates: stored.duplicates,
        sequenceConflicts: stored.sequenceConflicts,
      }),
      { status: 202 },
    );
  }

  const studyEventsMatch = pathname.match(/^\/api\/studies\/([^/]+)\/events$/);
  if (request.method === 'GET' && studyEventsMatch) {
    const studyId = decodeURIComponent(studyEventsMatch[1]!);
    const receivedAfter = await currentCycleStart(studyId);
    const summary = await telemetryRepository.summarizeEvents(
      studyId,
      receivedAfter,
    );
    return json(
      StudyTelemetrySummarySchema.parse({
        studyId,
        count: summary.count,
        sessionCount: Object.keys(summary.sessionCounts).length,
        participantCount: summary.participantCount,
        behaviorSignalCount: summary.behaviorSignalCount,
      }),
    );
  }

  const rawStudyEventsMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/events\/raw$/,
  );
  if (request.method === 'GET' && rawStudyEventsMatch) {
    const studyId = decodeURIComponent(rawStudyEventsMatch[1]!);
    const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
      : 50;
    let cursor: EventPageCursor | null = null;
    const rawCursor = url.searchParams.get('cursor');
    try {
      cursor = rawCursor ? decodeEventCursor(rawCursor) : null;
    } catch {
      return json(
        { error: 'invalid_cursor', message: 'Event cursor is invalid.' },
        { status: 400 },
      );
    }
    const receivedAfter = await currentCycleStart(studyId);
    const page = await telemetryRepository.listEventPage(
      studyId,
      limit,
      receivedAfter,
      cursor,
    );
    const summary = await telemetryRepository.summarizeEvents(
      studyId,
      receivedAfter,
    );
    const latest = page.events.at(-1);
    return json(
      StudyEventsResponseSchema.parse({
        studyId,
        events: page.events,
        cursor: latest
          ? encodeEventCursor({
              receivedAt: latest.receivedAt,
              eventId: latest.eventId,
            })
          : rawCursor,
        hasMore: page.hasMore,
        ...summary,
      }),
    );
  }

  const studyEvidenceMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/evidence$/,
  );
  if (request.method === 'POST' && studyEvidenceMatch) {
    trace.beforeState = 'telemetry_ready';
    const studyId = decodeURIComponent(studyEvidenceMatch[1]!);
    if (isLabStudy(studyId, env)) {
      return json(
        {
          error: 'lab_evidence_boundary',
          message:
            'Darwin Lab observations can be analysed only through their automated Lab evidence pack.',
        },
        { status: 409 },
      );
    }
    const source = url.searchParams.get('source') ?? 'real_user';
    if (source !== 'real_user' && source !== 'automated') {
      return json(
        { error: 'invalid_request', message: 'Unsupported evidence source.' },
        { status: 400 },
      );
    }
    const [cycle, targetConnection] = await Promise.all([
      telemetryRepository.getEvolutionCycle(),
      telemetryRepository.getTargetConnection(),
    ]);
    if (!targetConnection) {
      return json(
        {
          error: 'target_connection_required',
          message:
            'Connect and verify the ProjectFlow repository before generating evidence.',
        },
        { status: 409 },
      );
    }
    const measurementBoundary =
      cycle.studyId === studyId
        ? selectMeasurementBoundary(
            cycle.startedAt,
            targetConnection.connectedAt,
          )
        : { startedAt: null, source: null };
    const events = await telemetryRepository.listEvents(
      studyId,
      10_000,
      measurementBoundary.startedAt,
      source,
    );
    if (!events.length) {
      return json(
        {
          error: 'insufficient_evidence',
          message: 'At least one real telemetry event is required.',
        },
        { status: 409 },
      );
    }
    const appVersions = [...new Set(events.map((event) => event.appVersion))];
    if (appVersions.length !== 1) {
      return json(
        {
          error: 'mixed_app_versions',
          message:
            'Evidence must contain telemetry from exactly one application version.',
          appVersions: appVersions.sort(),
        },
        { status: 409 },
      );
    }
    const [appVersion] = appVersions;
    if (
      !appVersion ||
      !versionMatchesCommit(appVersion, targetConnection.repository.baseSha) ||
      targetConnection.applicationMap.source.repositorySha !==
        targetConnection.repository.baseSha ||
      targetConnection.applicationMap.source.sourceHash !==
        targetConnection.repository.sourceHash
    ) {
      return json(
        {
          error: 'telemetry_version_mismatch',
          message:
            'Telemetry version does not match the connected repository snapshot.',
          appVersion: appVersion ?? null,
          repositorySha: targetConnection.repository.baseSha,
        },
        { status: 409 },
      );
    }
    try {
      const pack = await buildEvidencePack(
        studyId,
        events,
        targetConnection.applicationMap,
        undefined,
        cycle.studyId === studyId
          ? measurementBoundary.source === 'evolution_cycle'
            ? {
                appVersion:
                  cycle.appVersion ??
                  targetConnection.repository.baseSha.slice(0, 12),
                measuredCommit:
                  cycle.measuredCommit ?? targetConnection.repository.baseSha,
                deploymentVerifiedAt: cycle.deploymentVerifiedAt,
              }
            : {
                appVersion: targetConnection.repository.baseSha.slice(0, 12),
                measuredCommit: targetConnection.repository.baseSha,
                deploymentVerifiedAt: null,
              }
          : undefined,
      );
      await telemetryRepository.saveEvidence(pack);
      trace.afterState = 'evidence_ready';
      return json(EvidencePackSchema.parse(pack), { status: 201 });
    } catch (error) {
      if (error instanceof EvidenceVersionMismatchError) {
        return json(
          {
            error: 'mixed_application_versions',
            message:
              'Evidence must contain exactly one application version matching the verified deployment.',
            appVersions: error.appVersions,
          },
          { status: 409 },
        );
      }
      if (
        error &&
        typeof error === 'object' &&
        'issues' in error &&
        Array.isArray(error.issues)
      ) {
        return json(
          {
            error: 'evidence_validation_failed',
            message:
              'Stored telemetry could not be summarized into a valid evidence pack.',
          },
          { status: 422 },
        );
      }
      throw error;
    }
  }

  const latestEvidenceMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/evidence\/latest$/,
  );
  if (request.method === 'GET' && latestEvidenceMatch) {
    const studyId = decodeURIComponent(latestEvidenceMatch[1]!);
    const cycleStart = await currentCycleStart(studyId);
    const storedPack = await telemetryRepository.getLatestEvidence(studyId);
    const pack =
      storedPack && (!cycleStart || storedPack.generatedAt > cycleStart)
        ? storedPack
        : null;
    if (!pack) {
      if (url.searchParams.get('optional') === 'true') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      return json(
        {
          error: 'not_found',
          message: 'No evidence pack exists for this study.',
        },
        { status: 404 },
      );
    }
    const currentPack = EvidencePackSchema.safeParse(pack);
    if (!currentPack.success) {
      if (url.searchParams.get('optional') === 'true') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      return json(
        {
          error: 'evidence_invalid',
          message:
            'The stored evidence pack is no longer compatible with the current schema.',
        },
        { status: 422 },
      );
    }
    return json(currentPack.data);
  }

  const analyseEvidenceMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/analyse-evidence$/,
  );
  if (request.method === 'POST' && analyseEvidenceMatch) {
    trace.beforeState = 'evidence_ready';
    const studyId = decodeURIComponent(analyseEvidenceMatch[1]!);
    if (isLabStudy(studyId, env)) {
      return json(
        {
          error: 'lab_evidence_boundary',
          message:
            'Darwin Lab telemetry cannot enter the measured reasoning workflow.',
        },
        { status: 409 },
      );
    }
    const cycleStart = await currentCycleStart(studyId);
    const storedPack = await telemetryRepository.getLatestEvidence(studyId);
    const pack =
      storedPack && (!cycleStart || storedPack.generatedAt > cycleStart)
        ? storedPack
        : null;
    if (!pack || !pack.frictionSignals.length) {
      return json(
        {
          error: 'insufficient_evidence',
          message: 'A friction-bearing evidence pack is required.',
        },
        { status: 409 },
      );
    }
    const currentPack = EvidencePackSchema.safeParse(pack);
    if (!currentPack.success) {
      return json(
        {
          error: 'evidence_source_unattested',
          message:
            'Generate a new evidence pack from the verified ProjectFlow repository before requesting live reasoning.',
        },
        { status: 409 },
      );
    }
    const evidencePack = currentPack.data;
    const evidenceSource = evidencePack.applicationMap.source;
    const model = env?.OPENAI_MODEL || 'gpt-5.6';
    const targetConnection = await telemetryRepository.getTargetConnection();
    let repositorySnapshot: Awaited<
      ReturnType<typeof captureRepositorySnapshot>
    >;
    try {
      repositorySnapshot = await observeProvider(
        trace,
        'github',
        'capture_reasoning_snapshot',
        () =>
          captureRepositorySnapshot({
            fullName:
              targetConnection?.repository.fullName ||
              configuredTarget(env).fullName,
            branch:
              targetConnection?.repository.branch ||
              configuredTarget(env).branch,
            commitSha: evidenceSource.repositorySha,
            githubToken: env?.GITHUB_TOKEN,
            productionUrl:
              targetConnection?.repository.productionUrl ||
              configuredTarget(env).productionUrl,
            studyUrl:
              targetConnection?.repository.studyUrl ||
              configuredTarget(env).studyUrl,
            fetch: providerFetch(),
          }),
      );
    } catch {
      return json(
        {
          error: 'repository_unavailable',
          message:
            'Darwin could not snapshot the current ProjectFlow repository.',
        },
        { status: 502 },
      );
    }
    const cacheKey = await analysisCacheKey(
      evidencePack.evidenceHash,
      model,
      repositorySnapshot.context.sourceHash,
      repositorySnapshot.context.baseSha,
    );
    const cached =
      await telemetryRepository.getEvidenceAnalysisByCacheKey(cacheKey);
    console.info(
      '[darwin:reasoning]',
      JSON.stringify({
        event: cached ? 'gpt_cache_hit' : 'gpt_cache_miss',
        requestId: trace.requestId,
        actor: trace.actor,
        action: 'gpt.analyse',
        target: studyId,
        outcome: 'success',
      }),
    );
    if (cached) {
      trace.afterState = 'analysis_cached';
      return json(EvidenceAnalysisSchema.parse(cached));
    }

    try {
      const configuredTimeout = Number(env?.OPENAI_TIMEOUT_MS ?? 12_000);
      const analysis = await observeProvider(
        trace,
        'openai',
        'analyse_evidence',
        () =>
          analyseEvidence(evidencePack, {
            requestedMode: env?.DARWIN_AI_MODE,
            apiKey: openAIKey(env),
            model,
            timeoutMs: Number.isFinite(configuredTimeout)
              ? Math.min(90_000, Math.max(1_000, configuredTimeout))
              : 12_000,
            repositorySnapshot,
            fetch: providerFetch(evidencePack),
          }),
      );
      console.info(
        '[darwin:reasoning]',
        JSON.stringify({
          event: 'gpt_call_completed',
          requestId: trace.requestId,
          actor: trace.actor,
          action: 'gpt.analyse',
          target: studyId,
          outcome: 'success',
        }),
      );
      await telemetryRepository.saveEvidenceAnalysis(studyId, analysis);
      trace.afterState = 'analysis_ready';
      return json(EvidenceAnalysisSchema.parse(analysis), { status: 201 });
    } catch (error) {
      console.warn(
        '[darwin:reasoning]',
        JSON.stringify({
          event: 'gpt_call_completed',
          requestId: trace.requestId,
          actor: trace.actor,
          action: 'gpt.analyse',
          target: studyId,
          outcome: 'failure',
          errorCode: providerErrorCode(error),
        }),
      );
      if (error instanceof EvidenceReasoningError) {
        return json(
          { error: error.code, message: error.message },
          { status: 422 },
        );
      }
      throw error;
    }
  }

  const latestEvidenceAnalysisMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/evidence-analysis\/latest$/,
  );
  if (request.method === 'GET' && latestEvidenceAnalysisMatch) {
    const studyId = decodeURIComponent(latestEvidenceAnalysisMatch[1]!);
    const cycleStart = await currentCycleStart(studyId);
    const storedAnalysis =
      await telemetryRepository.getLatestEvidenceAnalysis(studyId);
    const analysis =
      storedAnalysis && (!cycleStart || storedAnalysis.createdAt > cycleStart)
        ? storedAnalysis
        : null;
    if (!analysis) {
      if (url.searchParams.get('optional') === 'true') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      return json(
        { error: 'not_found', message: 'No evidence analysis exists.' },
        { status: 404 },
      );
    }
    return json(StoredEvidenceAnalysisSchema.parse(analysis));
  }

  const codexManifestMatch = pathname.match(
    /^\/api\/evidence-analyses\/([^/]+)\/codex-manifest$/,
  );
  if (codexManifestMatch) {
    const analysisId = decodeURIComponent(codexManifestMatch[1]!);
    const existing = await telemetryRepository.getCodexManifest(analysisId);
    if (request.method === 'GET') {
      if (!existing) {
        return json(
          { error: 'not_found', message: 'Codex manifest was not found.' },
          { status: 404 },
        );
      }
      return json(CodexImplementationManifestSchema.parse(existing));
    }
    if (request.method === 'POST') {
      trace.beforeState = 'analysis_ready';
      const analysis =
        await telemetryRepository.getEvidenceAnalysis(analysisId);
      if (!analysis) {
        return json(
          { error: 'not_found', message: 'Evidence analysis was not found.' },
          { status: 404 },
        );
      }
      let input: unknown = {};
      try {
        const text = await readBoundedBody(request, 16_000);
        input = text ? JSON.parse(text) : {};
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          return json(
            {
              error: 'payload_too_large',
              message: 'Manifest request is too large.',
            },
            { status: 413 },
          );
        }
        return json(
          { error: 'invalid_request', message: 'Manifest request is invalid.' },
          { status: 400 },
        );
      }
      const parsed = CodexManifestRequestSchema.safeParse(input);
      if (!parsed.success) {
        return json(
          { error: 'invalid_request', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const candidates = [analysis.selectedMutation, ...analysis.alternatives];
      const requestedMutationIds =
        parsed.data.mutationIds ??
        (parsed.data.mutationId
          ? [parsed.data.mutationId]
          : [analysis.selectedMutation.id]);
      const mutations = candidates.filter((candidate) =>
        requestedMutationIds.includes(candidate.id),
      );
      if (mutations.length !== requestedMutationIds.length) {
        return json(
          {
            error: 'invalid_mutation',
            message: 'The selected mutation is not part of this analysis.',
          },
          { status: 400 },
        );
      }
      const existingMutationIds = existing
        ? (existing.mutationIds ?? [existing.mutationId])
        : [];
      if (
        existing &&
        existingMutationIds.length === mutations.length &&
        mutations.every(
          (mutation, index) => mutation.id === existingMutationIds[index],
        )
      ) {
        return json(CodexImplementationManifestSchema.parse(existing));
      }
      const dispatchedExecution =
        await telemetryRepository.getRepositoryExecutionByAnalysis(analysisId);
      if (
        existing &&
        dispatchedExecution &&
        dispatchedExecution.status !== 'failed'
      ) {
        return json(
          {
            error: 'manifest_locked',
            message:
              'This analysis already has a dispatched immutable manifest.',
          },
          { status: 409 },
        );
      }
      const manifest = await buildCodexManifest(
        analysis,
        'repository-bound',
        undefined,
        mutations,
      );
      await telemetryRepository.saveCodexManifest(manifest);
      const persisted =
        (await telemetryRepository.getCodexManifestById(manifest.manifestId)) ??
        manifest;
      trace.afterState = 'manifest_created';
      return json(CodexImplementationManifestSchema.parse(persisted), {
        status: 201,
      });
    }
  }

  const manifestExecutionMatch = pathname.match(
    /^\/api\/evidence-analyses\/([^/]+)\/codex-manifest\/execution$/,
  );
  if (
    manifestExecutionMatch &&
    (request.method === 'GET' || request.method === 'POST')
  ) {
    const analysisId = decodeURIComponent(manifestExecutionMatch[1]!);
    const manifest = await telemetryRepository.getCodexManifest(analysisId);
    if (!manifest) {
      return json(
        {
          error: 'not_found',
          message: 'A prepared repository manifest is required.',
        },
        { status: 404 },
      );
    }
    const existing = await telemetryRepository.getRepositoryExecutionByManifest(
      manifest.manifestId,
    );
    const linkDarwinLabExecution = async (
      execution: RepositoryMutationExecution,
    ) => {
      const experimentId = manifest.provenance?.labExperimentId;
      if (
        manifest.provenance?.evidenceClass !== 'darwin_lab' ||
        !experimentId
      ) {
        return;
      }
      const labRepository = getLabRepository(env?.DB);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const experiment = await labRepository.getExperiment(experimentId);
        if (
          !experiment?.selection ||
          experiment.selection.manifestId !== manifest.manifestId ||
          experiment.selection.executionId === execution.executionId
        ) {
          return;
        }
        const linked = LabExperimentSchema.parse({
          ...experiment,
          selection: {
            ...experiment.selection,
            executionId: execution.executionId,
          },
        });
        if (await labRepository.compareAndSwapExperiment(experiment, linked)) {
          return;
        }
      }
    };
    if (request.method === 'GET') {
      if (!existing) {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      await linkDarwinLabExecution(existing);
      return json(RepositoryMutationExecutionSchema.parse(existing));
    }
    if (existing && existing.status !== 'failed') {
      await linkDarwinLabExecution(existing);
      return json(RepositoryMutationExecutionSchema.parse(existing));
    }
    trace.beforeState = existing?.status ?? 'not_started';
    if (!env?.GITHUB_TOKEN || !env.DARWIN_CALLBACK_TOKEN) {
      return json(
        {
          error: 'repository_execution_unavailable',
          message:
            'GitHub dispatch and callback credentials must be configured.',
        },
        { status: 503 },
      );
    }
    let execution: RepositoryMutationExecution;
    try {
      execution = existing
        ? retryRepositoryExecution(existing, manifest)
        : createRepositoryExecution(manifest);
    } catch (error) {
      return json(
        {
          error: 'repository_manifest_required',
          message:
            error instanceof Error
              ? error.message
              : 'The manifest is not repository-bound.',
        },
        { status: 409 },
      );
    }
    if (
      !(await telemetryRepository.saveRepositoryExecution(execution, existing))
    ) {
      return currentExecutionAfterConflict(execution.executionId);
    }
    await linkDarwinLabExecution(execution);
    try {
      const callbackCredential = await issueExecutionCallbackCredential(
        execution.executionId,
      );
      await telemetryRepository.saveExecutionCallbackCredential(
        callbackCredential.credential,
      );
      const dispatchExecution = execution;
      await observeProvider(
        trace,
        'github',
        'dispatch_evolution_workflow',
        () =>
          dispatchEvolutionWorkflow({
            token: env.GITHUB_TOKEN!,
            execution: dispatchExecution,
            callbackNonce: callbackCredential.nonce,
            manifestHash: manifest.manifestHash,
            callbackUrl: `${url.origin}/api/repository-executions/${dispatchExecution.executionId}/callback`,
            fetch: providerFetch(),
          }),
      );
      const queued = updateRepositoryExecution(execution, {
        status: 'queued',
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(queued, execution))
      ) {
        return currentExecutionAfterConflict(execution.executionId);
      }
      execution = queued;
      return json(RepositoryMutationExecutionSchema.parse(execution), {
        status: 201,
      });
    } catch (error) {
      const failed = updateRepositoryExecution(execution, {
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'GitHub workflow dispatch failed.',
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(failed, execution))
      ) {
        return currentExecutionAfterConflict(execution.executionId);
      }
      execution = failed;
      return json(RepositoryMutationExecutionSchema.parse(execution), {
        status: 502,
      });
    }
  }

  const repositoryRollbackMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/rollback$/,
  );
  if (request.method === 'POST' && repositoryRollbackMatch) {
    const executionId = decodeURIComponent(repositoryRollbackMatch[1]!);
    let execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    trace.beforeState = execution.rollback?.status ?? execution.status;
    if (execution.rollback && execution.rollback.status !== 'failed') {
      return json(RepositoryMutationExecutionSchema.parse(execution));
    }
    if (execution.status !== 'released') {
      return json(
        {
          error: 'not_rollbackable',
          message: 'Only a released mutation can be prepared for rollback.',
        },
        { status: 409 },
      );
    }
    if (!env?.GITHUB_TOKEN || !env.DARWIN_CALLBACK_TOKEN) {
      return json(
        {
          error: 'repository_rollback_unavailable',
          message:
            'GitHub dispatch and callback credentials must be configured.',
        },
        { status: 503 },
      );
    }
    try {
      const rollback = createRepositoryRollback(execution);
      const manifest = await telemetryRepository.getCodexManifestById(
        execution.manifestId,
      );
      if (!manifest) {
        throw new Error('The retained execution manifest could not be loaded.');
      }
      if (!manifestMatchesExecution(manifest, execution)) {
        throw new Error('The retained execution manifest identity is invalid.');
      }
      const withRollback = attachRepositoryRollback(execution, rollback);
      if (
        !(await telemetryRepository.saveRepositoryExecution(
          withRollback,
          execution,
        ))
      ) {
        return currentExecutionAfterConflict(execution.executionId);
      }
      execution = withRollback;
      const callbackCredential = await issueExecutionCallbackCredential(
        execution.executionId,
      );
      await telemetryRepository.saveExecutionCallbackCredential(
        callbackCredential.credential,
      );
      const dispatchExecution = execution;
      await observeProvider(trace, 'github', 'dispatch_rollback_workflow', () =>
        dispatchRollbackWorkflow({
          token: env.GITHUB_TOKEN!,
          execution: dispatchExecution,
          rollback,
          callbackNonce: callbackCredential.nonce,
          manifestHash: manifest.manifestHash,
          callbackUrl: `${url.origin}/api/repository-executions/${dispatchExecution.executionId}/rollback/callback`,
          fetch: providerFetch(),
        }),
      );
      const queued = updateRepositoryRollback(execution, {
        status: 'queued',
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(queued, execution))
      ) {
        return currentExecutionAfterConflict(execution.executionId);
      }
      execution = queued;
      trace.afterState = 'rollback:queued';
      return json(RepositoryMutationExecutionSchema.parse(execution), {
        status: 201,
      });
    } catch (error) {
      if (execution.rollback && execution.rollback.status !== 'failed') {
        const failed = updateRepositoryRollback(execution, {
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'GitHub rollback workflow dispatch failed.',
        });
        if (
          !(await telemetryRepository.saveRepositoryExecution(
            failed,
            execution,
          ))
        ) {
          return currentExecutionAfterConflict(execution.executionId);
        }
        execution = failed;
        trace.afterState = 'rollback:failed';
      }
      return json(RepositoryMutationExecutionSchema.parse(execution), {
        status: 502,
      });
    }
  }

  const repositoryExecutionMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)$/,
  );
  if (request.method === 'GET' && repositoryExecutionMatch) {
    const executionId = decodeURIComponent(repositoryExecutionMatch[1]!);
    let execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (execution && useE2EFixtures) {
      const current = execution;
      const advanced = current.rollback
        ? advanceE2ERollback(current)
        : advanceE2EExecution(current);
      if (
        advanced !== current &&
        (await telemetryRepository.saveRepositoryExecution(advanced, current))
      ) {
        execution = advanced;
      }
    }
    return execution
      ? json(RepositoryMutationExecutionSchema.parse(execution))
      : json(
          { error: 'not_found', message: 'Repository execution not found.' },
          { status: 404 },
        );
  }

  const repositoryRecoveryMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/recovery\/force-fail$/,
  );
  if (request.method === 'POST' && repositoryRecoveryMatch) {
    let input: unknown;
    try {
      input = JSON.parse(await readBoundedBody(request, 1_024));
    } catch (error) {
      return json(
        {
          error:
            error instanceof PayloadTooLargeError
              ? 'payload_too_large'
              : 'confirmation_required',
          message: 'A bounded recovery confirmation is required.',
        },
        { status: error instanceof PayloadTooLargeError ? 413 : 400 },
      );
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).length !== 1 ||
      (input as { confirmation?: unknown }).confirmation !==
        'FAIL STRANDED EXECUTION'
    ) {
      return json(
        {
          error: 'confirmation_required',
          message: 'Type FAIL STRANDED EXECUTION to use recovery.',
        },
        { status: 400 },
      );
    }
    const executionId = decodeURIComponent(repositoryRecoveryMatch[1]!);
    const recovery = await forceFailStrandedExecution(
      telemetryRepository,
      executionId,
    );
    if (recovery.outcome === 'not_found') {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    if (recovery.outcome === 'too_recent') {
      return json(
        {
          error: 'recovery_window_active',
          message: 'The workflow is still inside its bounded recovery window.',
          eligibleAt: recovery.eligibleAt,
        },
        { status: 409 },
      );
    }
    return json(RepositoryMutationExecutionSchema.parse(recovery.execution), {
      status: recovery.outcome === 'recovered' ? 200 : 409,
    });
  }

  const repositoryFitnessMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/fitness$/,
  );
  if (
    (request.method === 'GET' || request.method === 'POST') &&
    repositoryFitnessMatch
  ) {
    const executionId = decodeURIComponent(repositoryFitnessMatch[1]!);
    const execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    const existing = await telemetryRepository.getFitnessOutcome(executionId);
    if (request.method === 'GET') {
      return existing
        ? json(FitnessOutcomeSchema.parse(existing))
        : new Response(null, { status: 204, headers: corsHeaders });
    }
    if (execution.rollback?.status === 'released' && existing) {
      const invalidated = invalidateFitnessOutcome(existing);
      await telemetryRepository.saveFitnessOutcome(invalidated);
      return json(FitnessOutcomeSchema.parse(invalidated));
    }
    const analysis = await telemetryRepository.getEvidenceAnalysis(
      execution.analysisId,
    );
    const storedBaselinePack = analysis
      ? await telemetryRepository.getEvidence(analysis.evidenceId)
      : null;
    const storedEvolvedPack = storedBaselinePack
      ? await telemetryRepository.getLatestEvidence(
          storedBaselinePack.study.studyId,
        )
      : null;
    const baselineResult = EvidencePackSchema.safeParse(storedBaselinePack);
    const evolvedResult = EvidencePackSchema.safeParse(storedEvolvedPack);
    const baselinePack = baselineResult.success ? baselineResult.data : null;
    const evolvedPack = evolvedResult.success ? evolvedResult.data : null;
    if (
      !baselinePack ||
      !evolvedPack ||
      evolvedPack.evidenceHash === baselinePack.evidenceHash
    ) {
      return json(
        {
          error: 'fitness_cohort_unavailable',
          message:
            'A distinct post-release evidence pack is required for fitness validation.',
        },
        { status: 409 },
      );
    }
    if (
      existing &&
      existing.evolved.evidenceHash === evolvedPack.evidenceHash &&
      existing.status !== 'rolled_back'
    ) {
      return json(FitnessOutcomeSchema.parse(existing));
    }
    const outcome = calculateFitnessOutcome({
      execution,
      baselinePack,
      evolvedPack,
    });
    await telemetryRepository.saveFitnessOutcome(outcome);
    return json(FitnessOutcomeSchema.parse(outcome), { status: 201 });
  }

  const repositoryManifestMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/manifest$/,
  );
  if (request.method === 'GET' && repositoryManifestMatch) {
    const executionId = decodeURIComponent(repositoryManifestMatch[1]!);
    const execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    const manifest = execution
      ? await telemetryRepository.getCodexManifestById(execution.manifestId)
      : null;
    if (!execution || !manifest) {
      return json(
        { error: 'not_found', message: 'Repository manifest not found.' },
        { status: 404 },
      );
    }
    if (!manifestMatchesExecution(manifest, execution)) {
      return json(
        {
          error: 'manifest_identity_mismatch',
          message: 'Execution manifest identity does not match dispatch.',
        },
        { status: 409 },
      );
    }
    const verification = await verifyExecutionCallback({
      request,
      body: '',
      callbackSecret: env?.DARWIN_CALLBACK_TOKEN,
      credential:
        await telemetryRepository.getExecutionCallbackCredential(executionId),
      executionId,
      repository: execution.repository.fullName,
      manifestHash: manifest.manifestHash,
    });
    if (!verification.ok) {
      logAuthorizationDecision(
        trace,
        'repository_callback',
        false,
        verification.error,
      );
      return json(
        { error: verification.error, message: verification.message },
        { status: verification.status },
      );
    }
    logAuthorizationDecision(trace, 'repository_callback', true);
    return json({ execution, manifest });
  }

  const repositoryRollbackCallbackMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/rollback\/callback$/,
  );
  if (request.method === 'POST' && repositoryRollbackCallbackMatch) {
    const executionId = decodeURIComponent(repositoryRollbackCallbackMatch[1]!);
    const execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    trace.beforeState = execution.rollback?.status ?? execution.status;
    let body: string;
    try {
      body = await readBoundedBody(request, 750_000);
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) {
        return json(
          { error: 'invalid_callback', message: 'Callback body is invalid.' },
          { status: 400 },
        );
      }
      return json(
        { error: 'payload_too_large', message: 'Callback body is too large.' },
        { status: 413 },
      );
    }
    const manifest = await telemetryRepository.getCodexManifestById(
      execution.manifestId,
    );
    if (!manifest) {
      return json(
        { error: 'not_found', message: 'Repository manifest not found.' },
        { status: 404 },
      );
    }
    if (!manifestMatchesExecution(manifest, execution)) {
      return json(
        {
          error: 'manifest_identity_mismatch',
          message: 'Execution manifest identity does not match dispatch.',
        },
        { status: 409 },
      );
    }
    const verification = await verifyExecutionCallback({
      request,
      body,
      callbackSecret: env?.DARWIN_CALLBACK_TOKEN,
      credential:
        await telemetryRepository.getExecutionCallbackCredential(executionId),
      executionId,
      repository: execution.repository.fullName,
      manifestHash: execution.manifestHash ?? manifest.manifestHash,
    });
    if (!verification.ok) {
      logAuthorizationDecision(
        trace,
        'repository_callback',
        false,
        verification.error,
      );
      return json(
        { error: verification.error, message: verification.message },
        { status: verification.status },
      );
    }
    logAuthorizationDecision(trace, 'repository_callback', true);
    let callback;
    try {
      callback = RepositoryRollbackCallbackSchema.parse(JSON.parse(body));
    } catch {
      return json(
        { error: 'invalid_callback', message: 'Callback payload is invalid.' },
        { status: 400 },
      );
    }
    try {
      const signatureAccepted =
        await telemetryRepository.consumeExecutionCallbackSignature(
          executionId,
          verification.signature,
          new Date().toISOString(),
        );
      if (!signatureAccepted) {
        return json(
          { error: 'callback_replayed', message: 'Callback replay rejected.' },
          { status: 409 },
        );
      }
      const updated = updateRepositoryRollback(execution, callback);
      if (
        !(await telemetryRepository.saveRepositoryExecution(updated, execution))
      ) {
        return currentExecutionAfterConflict(executionId);
      }
      trace.afterState = `rollback:${updated.rollback?.status ?? 'unknown'}`;
      return json(RepositoryMutationExecutionSchema.parse(updated));
    } catch (error) {
      return json(
        {
          error: 'invalid_transition',
          message:
            error instanceof Error
              ? error.message
              : 'Repository rollback transition is invalid.',
        },
        { status: 409 },
      );
    }
  }

  const repositoryCallbackMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/callback$/,
  );
  if (request.method === 'POST' && repositoryCallbackMatch) {
    const executionId = decodeURIComponent(repositoryCallbackMatch[1]!);
    const execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    trace.beforeState = execution.status;
    let body: string;
    try {
      body = await readBoundedBody(request, 750_000);
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) {
        return json(
          { error: 'invalid_callback', message: 'Callback body is invalid.' },
          { status: 400 },
        );
      }
      return json(
        { error: 'payload_too_large', message: 'Callback body is too large.' },
        { status: 413 },
      );
    }
    const manifest = await telemetryRepository.getCodexManifestById(
      execution.manifestId,
    );
    if (!manifest) {
      return json(
        { error: 'not_found', message: 'Repository manifest not found.' },
        { status: 404 },
      );
    }
    if (!manifestMatchesExecution(manifest, execution)) {
      return json(
        {
          error: 'manifest_identity_mismatch',
          message: 'Execution manifest identity does not match dispatch.',
        },
        { status: 409 },
      );
    }
    const verification = await verifyExecutionCallback({
      request,
      body,
      callbackSecret: env?.DARWIN_CALLBACK_TOKEN,
      credential:
        await telemetryRepository.getExecutionCallbackCredential(executionId),
      executionId,
      repository: execution.repository.fullName,
      manifestHash: execution.manifestHash ?? manifest.manifestHash,
    });
    if (!verification.ok) {
      logAuthorizationDecision(
        trace,
        'repository_callback',
        false,
        verification.error,
      );
      return json(
        { error: verification.error, message: verification.message },
        { status: verification.status },
      );
    }
    logAuthorizationDecision(trace, 'repository_callback', true);
    let callback;
    try {
      callback = RepositoryExecutionCallbackSchema.parse(JSON.parse(body));
    } catch {
      return json(
        { error: 'invalid_callback', message: 'Callback payload is invalid.' },
        { status: 400 },
      );
    }
    try {
      const signatureAccepted =
        await telemetryRepository.consumeExecutionCallbackSignature(
          executionId,
          verification.signature,
          new Date().toISOString(),
        );
      if (!signatureAccepted) {
        return json(
          { error: 'callback_replayed', message: 'Callback replay rejected.' },
          { status: 409 },
        );
      }
      const updated = updateRepositoryExecution(execution, callback);
      if (
        !(await telemetryRepository.saveRepositoryExecution(updated, execution))
      ) {
        return currentExecutionAfterConflict(executionId);
      }
      trace.afterState = updated.status;
      return json(RepositoryMutationExecutionSchema.parse(updated));
    } catch (error) {
      return json(
        {
          error: 'invalid_transition',
          message:
            error instanceof Error
              ? error.message
              : 'Repository execution transition is invalid.',
        },
        { status: 409 },
      );
    }
  }

  const repositoryRollbackReleaseMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/rollback\/release$/,
  );
  if (request.method === 'POST' && repositoryRollbackReleaseMatch) {
    const executionId = decodeURIComponent(repositoryRollbackReleaseMatch[1]!);
    let execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    trace.beforeState = execution.rollback?.status ?? execution.status;
    if (execution.rollback?.status === 'released') {
      trace.afterState = 'rollback:released';
      return json(RepositoryMutationExecutionSchema.parse(execution));
    }
    if (
      execution.rollback?.status !== 'preview_ready' &&
      execution.rollback?.status !== 'releasing'
    ) {
      return json(
        {
          error: 'not_releasable',
          message: 'A validated rollback preview is required for release.',
        },
        { status: 409 },
      );
    }
    if (!env?.GITHUB_TOKEN) {
      return json(
        {
          error: 'repository_rollback_unavailable',
          message: 'GitHub release credentials are not configured.',
        },
        { status: 503 },
      );
    }
    if (execution.rollback.status === 'preview_ready') {
      const releasing = updateRepositoryRollback(execution, {
        status: 'releasing',
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(
          releasing,
          execution,
        ))
      ) {
        return currentReleaseAfterConflict(executionId, true);
      }
      execution = releasing;
    }
    try {
      const releasingExecution = execution;
      const releasedSha = await observeProvider(
        trace,
        'github',
        'merge_rollback_pull_request',
        () =>
          mergeRollbackPullRequest({
            token: env.GITHUB_TOKEN!,
            execution: releasingExecution,
            rollback: releasingExecution.rollback!,
            fetch: providerFetch(),
          }),
      );
      const released = updateRepositoryRollback(execution, {
        status: 'released',
        headSha: releasedSha,
        previewUrl: execution.repository.studyUrl,
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(
          released,
          execution,
        ))
      ) {
        return currentReleaseAfterConflict(executionId, true);
      }
      execution = released;
      trace.afterState = 'rollback:released';
      const fitnessOutcome = await telemetryRepository.getFitnessOutcome(
        execution.executionId,
      );
      if (fitnessOutcome) {
        await telemetryRepository.saveFitnessOutcome(
          invalidateFitnessOutcome(fitnessOutcome),
        );
      }
      return json(RepositoryMutationExecutionSchema.parse(execution));
    } catch (error) {
      return json(
        {
          error:
            error instanceof GitHubMergeStateUnknownError
              ? 'repository_rollback_merge_state_unknown'
              : 'repository_rollback_release_failed',
          message:
            error instanceof Error
              ? error.message
              : 'GitHub rollback pull request release failed.',
          execution: RepositoryMutationExecutionSchema.parse(execution),
        },
        { status: 502 },
      );
    }
  }

  const repositoryReleaseMatch = pathname.match(
    /^\/api\/repository-executions\/([^/]+)\/release$/,
  );
  if (request.method === 'POST' && repositoryReleaseMatch) {
    const executionId = decodeURIComponent(repositoryReleaseMatch[1]!);
    let execution =
      await telemetryRepository.getRepositoryExecution(executionId);
    if (!execution) {
      return json(
        { error: 'not_found', message: 'Repository execution not found.' },
        { status: 404 },
      );
    }
    trace.beforeState = execution.status;
    if (execution.status === 'released') {
      return json(RepositoryMutationExecutionSchema.parse(execution));
    }
    if (
      execution.status !== 'preview_ready' &&
      execution.status !== 'releasing' &&
      execution.status !== 'deployment_verifying'
    ) {
      return json(
        {
          error: 'not_releasable',
          message:
            'A validated preview or merged deployment awaiting verification is required for release.',
        },
        { status: 409 },
      );
    }
    if (execution.status === 'preview_ready') {
      if (!env?.GITHUB_TOKEN) {
        return json(
          {
            error: 'repository_release_unavailable',
            message: 'GitHub release credentials are not configured.',
          },
          { status: 503 },
        );
      }
      const releasing = updateRepositoryExecution(execution, {
        status: 'releasing',
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(
          releasing,
          execution,
        ))
      ) {
        return currentReleaseAfterConflict(executionId);
      }
      execution = releasing;
    }
    if (execution.status === 'releasing') {
      if (!env?.GITHUB_TOKEN) {
        return json(
          {
            error: 'repository_release_unavailable',
            message: 'GitHub release credentials are not configured.',
          },
          { status: 503 },
        );
      }
      try {
        const releasingExecution = execution;
        const releasedSha = await observeProvider(
          trace,
          'github',
          'merge_evolution_pull_request',
          () =>
            mergeEvolutionPullRequest({
              token: env.GITHUB_TOKEN!,
              execution: releasingExecution,
              fetch: providerFetch(),
            }),
        );
        const deploymentVerifying = updateRepositoryExecution(execution, {
          status: 'deployment_verifying',
          headSha: releasedSha,
          deploymentVerification: {
            status: 'verifying',
            expectedCommit: releasedSha,
            expectedAppVersion: releasedSha.slice(0, 12),
            observedCommit: null,
            observedAppVersion: null,
            attempts: 0,
            verifiedAt: null,
            lastError: null,
          },
        });
        if (
          !(await telemetryRepository.saveRepositoryExecution(
            deploymentVerifying,
            execution,
          ))
        ) {
          return currentReleaseAfterConflict(executionId);
        }
        execution = deploymentVerifying;
      } catch (error) {
        return json(
          {
            error:
              error instanceof GitHubMergeStateUnknownError
                ? 'repository_merge_state_unknown'
                : 'repository_release_failed',
            message:
              error instanceof Error
                ? error.message
                : 'GitHub pull request release failed.',
            execution: RepositoryMutationExecutionSchema.parse(execution),
          },
          { status: 502 },
        );
      }
    }

    const deployment = execution.deploymentVerification;
    if (!execution.headSha || !deployment) {
      return json(
        {
          error: 'deployment_verification_unavailable',
          message: 'The merged deployment identity was not retained.',
        },
        { status: 409 },
      );
    }
    try {
      const configuredTimeout = Number(
        env?.PROJECTFLOW_DEPLOYMENT_TIMEOUT_MS ?? 90_000,
      );
      const configuredPoll = Number(
        env?.PROJECTFLOW_DEPLOYMENT_POLL_MS ?? 5_000,
      );
      const deploymentExecution = execution;
      const verified = await observeProvider(
        trace,
        'target',
        'verify_deployment',
        () =>
          verifyProjectFlowDeployment({
            studyUrl: deploymentExecution.repository.studyUrl,
            expectedCommit: deployment.expectedCommit,
            expectedAppVersion: deployment.expectedAppVersion,
            timeoutMs: Number.isFinite(configuredTimeout)
              ? configuredTimeout
              : 90_000,
            pollIntervalMs: Number.isFinite(configuredPoll)
              ? configuredPoll
              : 5_000,
            fetcher: providerFetch() ?? fetch,
          }),
      );
      await refreshVerifiedTargetSnapshot({
        commitSha: verified.commitSha,
        verifiedAt: verified.verifiedAt,
      });
      const released = updateRepositoryExecution(execution, {
        status: 'released',
        previewUrl: execution.repository.studyUrl,
        deploymentVerification: {
          ...deployment,
          status: 'verified',
          observedCommit: verified.commitSha,
          observedAppVersion: verified.appVersion,
          attempts: deployment.attempts + verified.attempts,
          verifiedAt: verified.verifiedAt,
          lastError: null,
        },
      });
      if (
        !(await telemetryRepository.saveRepositoryExecution(
          released,
          execution,
        ))
      ) {
        return currentReleaseAfterConflict(executionId);
      }
      execution = released;
      await telemetryRepository.advanceEvolutionCycle({
        startedAt: verified.verifiedAt,
        measuredCommit: verified.commitSha,
        appVersion: verified.appVersion,
        deploymentVerifiedAt: verified.verifiedAt,
      });
      trace.afterState = 'released';
      return json(RepositoryMutationExecutionSchema.parse(execution));
    } catch (error) {
      if (error instanceof DeploymentVerificationPendingError) {
        const pending = RepositoryMutationExecutionSchema.parse({
          ...execution,
          deploymentVerification: {
            ...deployment,
            observedCommit: error.observed?.commitSha ?? null,
            observedAppVersion: error.observed?.appVersion ?? null,
            attempts: deployment.attempts + error.attempts,
            lastError: error.errorCode,
          },
          updatedAt: new Date().toISOString(),
        });
        if (
          !(await telemetryRepository.saveRepositoryExecution(
            pending,
            execution,
          ))
        ) {
          return currentReleaseAfterConflict(executionId);
        }
        execution = pending;
        trace.afterState = 'deployment_verifying';
        return json(RepositoryMutationExecutionSchema.parse(execution), {
          status: 202,
        });
      }
      throw error;
    }
  }

  const studySessionMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/sessions\/([^/]+)$/,
  );
  if (request.method === 'GET' && studySessionMatch) {
    const studyId = decodeURIComponent(studySessionMatch[1]!);
    const sessionId = decodeURIComponent(studySessionMatch[2]!);
    const events = await telemetryRepository.listSession(
      studyId,
      sessionId,
      await currentCycleStart(studyId),
    );
    return json(
      StudySessionResponseSchema.parse({ studyId, sessionId, events }),
    );
  }

  const participantWorkspaceMatch = pathname.match(
    /^\/api\/studies\/([^/]+)\/participants\/([^/]+)\/workspace$/,
  );
  if (participantWorkspaceMatch) {
    const studyId = decodeURIComponent(participantWorkspaceMatch[1]!);
    const participantId = decodeURIComponent(participantWorkspaceMatch[2]!);
    let workspaceBody = '';
    if (request.method === 'PUT') {
      try {
        workspaceBody = await readBoundedBody(request, 256_000);
      } catch (error) {
        if (!(error instanceof PayloadTooLargeError)) {
          return json(
            { error: 'invalid_request', message: 'Workspace body is invalid.' },
            { status: 400 },
          );
        }
        return json(
          {
            error: 'payload_too_large',
            message: 'Workspace body is too large.',
          },
          { status: 413 },
        );
      }
    }
    const targetAuthorization = await authorizeTargetRequest(
      request,
      workspaceBody,
      env,
    );
    if (!targetAuthorization.ok) {
      logAuthorizationDecision(
        trace,
        'target',
        false,
        targetAuthorization.error,
      );
      return json(
        {
          error: targetAuthorization.error,
          message: targetAuthorization.message,
        },
        { status: targetAuthorization.status },
      );
    }
    logAuthorizationDecision(trace, 'target', true);
    const targetSignature = request.headers.get('X-Darwin-Signature');
    if (
      targetSignature &&
      !(await telemetryRepository.consumeTargetRequestSignature(
        targetSignature.toLowerCase(),
        new Date().toISOString(),
      ))
    ) {
      return json(
        {
          error: 'target_request_replayed',
          message: 'Workspace request replay rejected.',
        },
        { status: 409 },
      );
    }
    const suppliedStudySession = request.headers.get('X-Darwin-Study-Session');
    const localRequest = ['localhost', '127.0.0.1', '::1'].includes(
      url.hostname,
    );
    const studySessionSecret =
      env?.PROJECTFLOW_INGESTION_SECRET ||
      (suppliedStudySession && localRequest
        ? 'darwin-local-study-session'
        : undefined);
    if (studySessionSecret) {
      const verification = await verifyStudySessionToken(
        suppliedStudySession,
        studySessionSecret,
      );
      if (
        !verification.ok ||
        verification.claims.studyId !== studyId ||
        verification.claims.participantId !== participantId ||
        verification.claims.deploymentOrigin !==
          targetAuthorization.identity.sourceOrigin
      ) {
        return json(
          {
            error: verification.ok
              ? 'study_session_subject_mismatch'
              : verification.error,
            message: verification.ok
              ? 'Workspace path does not match the study session.'
              : verification.message,
          },
          { status: 403 },
        );
      }
    }
    if (!targetStudyAllowed(studyId, env)) {
      return json(
        { error: 'study_forbidden', message: 'The study is not configured.' },
        { status: 403 },
      );
    }
    if (request.method === 'GET') {
      const workspace = await telemetryRepository.getWorkspace(
        studyId,
        participantId,
      );
      return json(
        ParticipantWorkspaceResponseSchema.parse({
          studyId,
          participantId,
          workspace,
        }),
      );
    }
    if (request.method === 'PUT') {
      let input: unknown;
      try {
        input = JSON.parse(workspaceBody);
      } catch {
        return json(
          {
            error: 'invalid_request',
            message: 'Workspace body must be valid JSON.',
          },
          { status: 400 },
        );
      }
      const workspace = ProjectFlowWorkspaceSchema.safeParse(input);
      if (!workspace.success) {
        return json(
          {
            error: 'invalid_request',
            message: 'Workspace failed validation.',
          },
          { status: 400 },
        );
      }
      await telemetryRepository.putWorkspace(
        studyId,
        participantId,
        workspace.data,
      );
      return json(
        ParticipantWorkspaceResponseSchema.parse({
          studyId,
          participantId,
          workspace: workspace.data,
        }),
      );
    }
  }

  if (request.method === 'POST' && pathname === '/api/simulations') {
    if (env?.SIMULATION_RATE_LIMITER) {
      const outcome = await env.SIMULATION_RATE_LIMITER.limit({
        key: operatorIdentity?.actor ?? 'operator',
      });
      if (!outcome.success) {
        return json(
          {
            error: 'rate_limited',
            message: 'Simulation rate exceeded. Retry shortly.',
          },
          { status: 429, headers: { 'Retry-After': '60' } },
        );
      }
    }
    if (simulationInFlight) {
      return json(
        {
          error: 'simulation_busy',
          message: 'A deterministic simulation is already running.',
        },
        { status: 503, headers: { 'Retry-After': '5' } },
      );
    }
    simulationInFlight = true;
    try {
      const maximumSimulationBodyBytes = 4_096;
      let input: unknown;
      try {
        const body = await readBoundedBody(request, maximumSimulationBodyBytes);
        input = JSON.parse(body);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          return json(
            {
              error: 'payload_too_large',
              message: 'Simulation request body is too large.',
            },
            { status: 413 },
          );
        }
        return json(
          {
            error: 'invalid_request',
            message: 'Request body must be valid JSON.',
          },
          { status: 400 },
        );
      }

      const parsed = SimulationRequestSchema.safeParse(input);
      if (!parsed.success) {
        return json(
          {
            error: 'invalid_request',
            message: 'Simulation input failed validation.',
            issues: parsed.error.issues,
          },
          { status: 400 },
        );
      }

      const configuredSeed = Number(env?.DARWIN_DEMO_SEED ?? 1859);
      if (
        parsed.data.seed !== configuredSeed ||
        parsed.data.variant !== 'baseline'
      ) {
        return json(
          {
            error: 'simulation_not_allowed',
            message:
              'Only the configured baseline deterministic demo replay is allowed.',
          },
          { status: 403 },
        );
      }

      const configuredEventCount = Number(env?.DARWIN_EVENT_COUNT ?? 10_000);
      const eventCount =
        configuredEventCount === 10_000 ? configuredEventCount : 10_000;
      const result: SimulationResult = simulate({
        ...parsed.data,
        eventCount,
      });
      storeSimulation(result);

      return json(
        { run: result.run, summary: result.summary },
        {
          status: 201,
          headers: { Location: `/api/simulations/${result.run.id}` },
        },
      );
    } finally {
      simulationInFlight = false;
    }
  }

  const summaryMatch = pathname.match(/^\/api\/simulations\/([^/]+)\/summary$/);
  if (request.method === 'GET' && summaryMatch) {
    const id = decodeURIComponent(summaryMatch[1]!);
    const result = getStoredSimulation(id);
    if (!result) {
      return json(
        { error: 'not_found', message: 'Simulation run was not found.' },
        { status: 404 },
      );
    }

    return json(result.summary);
  }

  const simulationMatch = pathname.match(/^\/api\/simulations\/([^/]+)$/);
  if (request.method === 'GET' && simulationMatch) {
    const id = decodeURIComponent(simulationMatch[1]!);
    const result = getStoredSimulation(id);
    if (!result) {
      return json(
        { error: 'not_found', message: 'Simulation run was not found.' },
        { status: 404 },
      );
    }

    return json({ run: result.run });
  }

  return json(
    {
      error: 'not_found',
      message: 'The requested Darwin API route does not exist.',
    },
    { status: 404 },
  );
};

const recordOperationalTrace = async (
  request: Request,
  env: Partial<Env>,
  trace: RequestTrace,
  response: Response,
) => {
  trace.afterState = trace.afterState ?? (await responseState(response));
  const outcome = response.ok ? 'success' : 'failure';
  const errorCode = trace.afterState.startsWith('error:')
    ? trace.afterState.slice('error:'.length)
    : response.ok
      ? null
      : `http_${response.status}`;
  const durationMs = Math.max(
    0,
    Math.round(performance.now() - trace.startedAt),
  );
  const action = auditedAction(request.method, new URL(request.url).pathname);

  console.info(
    '[darwin:request]',
    JSON.stringify({
      event: 'request_completed',
      requestId: trace.requestId,
      actor: trace.actor,
      action: action ?? trace.action,
      target: trace.target,
      outcome,
      status: response.status,
      durationMs,
      beforeState: trace.beforeState,
      afterState: trace.afterState,
      errorCode,
    }),
  );
  for (const metric of trace.metrics) {
    console.info(
      '[darwin:metric]',
      JSON.stringify({
        event: 'provider_operation',
        requestId: trace.requestId,
        actor: trace.actor,
        action: `${metric.provider}.${metric.operation}`,
        target: trace.target,
        outcome: metric.outcome,
        provider: metric.provider,
        operation: metric.operation,
        durationMs: metric.durationMs,
        errorCode: metric.errorCode,
      }),
    );
  }

  if (!action && trace.metrics.length === 0) return;
  try {
    const repository = getTelemetryRepository(env.DB);
    const occurredAt = new Date().toISOString();
    const events: OperationalEvent[] = trace.metrics.map((metric) => ({
      eventId: crypto.randomUUID(),
      kind: 'metric',
      requestId: trace.requestId,
      occurredAt,
      actor: trace.actor,
      action: `${metric.provider}.${metric.operation}`,
      target: trace.target,
      outcome: metric.outcome,
      beforeState: null,
      afterState: null,
      provider: metric.provider,
      operation: metric.operation,
      durationMs: metric.durationMs,
      errorCode: metric.errorCode,
    }));
    if (action) {
      events.unshift({
        eventId: crypto.randomUUID(),
        kind: 'audit',
        requestId: trace.requestId,
        occurredAt,
        actor: trace.actor,
        action,
        target: trace.target,
        outcome,
        beforeState: trace.beforeState ?? 'requested',
        afterState: trace.afterState,
        provider: null,
        operation: null,
        durationMs,
        errorCode,
      });
    }
    await repository.saveOperationalEvents(events);
  } catch (error) {
    console.error(
      '[darwin:audit]',
      JSON.stringify({
        event: 'operational_trace_persistence_failed',
        requestId: trace.requestId,
        actor: 'system',
        action: 'audit.persist',
        target: 'operational_events',
        outcome: 'failure',
        errorCode: providerErrorCode(error),
      }),
    );
  }
};

export const handleWorkerRequest = async (
  request: Request,
  env: Partial<Env>,
) => {
  const trace = createRequestTrace(request);
  let response: Response;
  try {
    response = await handleRequest(request, env, trace);
  } catch (error) {
    console.error(
      '[darwin:api]',
      JSON.stringify({
        event: 'unhandled_request_error',
        requestId: trace.requestId,
        actor: trace.actor,
        action: trace.action,
        target: trace.target,
        outcome: 'failure',
        method: request.method,
        path: new URL(request.url).pathname,
        errorCode: providerErrorCode(error),
      }),
    );
    response = jsonResponse(
      {
        error: 'internal_error',
        message: 'Darwin API could not complete the request.',
        ...(e2eFixturesEnabled(
          env.DARWIN_E2E_FIXTURES,
          new URL(request.url).hostname,
        ) && error instanceof Error
          ? { fixtureDiagnostic: error.message.slice(0, 500) }
          : {}),
      },
      {
        status: 500,
        headers: { 'X-Request-ID': trace.requestId },
      },
      corsForRequest(request, env).corsHeaders,
    );
  }
  await recordOperationalTrace(request, env, trace, response);
  return response;
};

export const runRetentionMaintenance = async (
  env: Partial<Env>,
  now = new Date().toISOString(),
) =>
  getTelemetryRepository(env.DB).runRetentionSweep(retentionPolicy(env), now);

const worker: ExportedHandler<Env> = {
  fetch: handleWorkerRequest,
  scheduled(_controller, env, context) {
    context.waitUntil(
      runRetentionMaintenance(env).then((result) => {
        console.info(
          '[darwin:retention]',
          JSON.stringify({
            event: 'retention_sweep_completed',
            ...result,
          }),
        );
      }),
    );
  },
};

export default worker;
