import {
  CodexImplementationManifestSchema,
  DemoResetExecutionSchema,
  EvidenceAnalysisSchema,
  StoredEvidenceAnalysisSchema,
  StoredEvidencePackSchema,
  EvolutionCycleSchema,
  FitnessOutcomeSchema,
  OperationalEventSchema,
  ProjectFlowWorkspaceSchema,
  RepositoryMutationExecutionSchema,
  StudyTelemetryEventSchema,
  TargetApplicationConnectionSchema,
  type CodexImplementationManifest,
  type DemoResetExecution,
  type DemoResetStatus,
  type EvidenceAnalysis,
  type StoredEvidenceAnalysis,
  type EvidencePack,
  type EvolutionCycle,
  type FitnessOutcome,
  type OperationalEvent,
  type OperationalMetricSummary,
  type ProjectFlowWorkspace,
  type RepositoryMutationExecution,
  type RetentionDeletedCounts,
  type RetentionHealth,
  type RetentionPolicy,
  type RetentionSweepResult,
  type StoredTelemetryEvent,
  type StudyTelemetryEvent,
  type StoredEvidencePack,
  type TargetApplicationConnection,
} from '@darwin/shared';

interface StoredValueSchema<T> {
  parse(value: unknown): T;
}

const safeDiagnosticId = (value: string) =>
  value.replace(/[^a-zA-Z0-9._:-]/g, '?').slice(0, 128);

const parseStoredValue = <T>(
  schema: StoredValueSchema<T>,
  json: string,
  kind: string,
  recordId: string,
) => {
  try {
    return schema.parse(JSON.parse(json));
  } catch {
    throw new Error(
      `Stored ${kind} record ${safeDiagnosticId(recordId)} is corrupt.`,
    );
  }
};

const parseStoredValueOrNull = <T>(
  schema: StoredValueSchema<T>,
  json: string,
  kind: string,
  recordId: string,
) => {
  try {
    return parseStoredValue(schema, json, kind, recordId);
  } catch {
    console.warn(
      '[darwin:persistence]',
      JSON.stringify({
        event: 'corrupt_stored_record_skipped',
        kind,
        recordId: safeDiagnosticId(recordId),
      }),
    );
    return null;
  }
};

import {
  addDeletedCounts,
  emptyDeletedCounts,
  expiresAt,
  retentionPolicy,
} from './retention';
import type { LabRepository } from '../lab/lab-repository';

export interface AtomicDemoResetInput {
  resetId: string;
  expectedStatus: DemoResetStatus;
  expectedVersion: number;
  /** Fully computed, already-verified replacement execution (status 'complete'). */
  completed: DemoResetExecution;
  evolutionBoundary: Pick<
    EvolutionCycle,
    'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
  >;
  labRepository: LabRepository;
}

export interface TelemetryInsertResult {
  accepted: number;
  duplicates: number;
  sequenceConflicts: number;
  quotaRejected: number;
}

export interface TelemetryEventSummary {
  count: number;
  sessionCounts: Record<string, number>;
  participantCount: number;
  behaviorSignalCount: number;
}

export const operationalMetricNames = [
  'telemetryRequests',
  'acceptedEvents',
  'rejectedEvents',
  'duplicateEvents',
  'authenticationRejected',
  'replayRejected',
  'contextRejected',
  'rateLimited',
] as const;

export type OperationalMetricName = (typeof operationalMetricNames)[number];
export type OperationalMetricCounts = Record<OperationalMetricName, number>;

export interface OperationalMetricsSnapshot {
  updatedAt: string | null;
  counts: OperationalMetricCounts;
}

export interface EventPageCursor {
  receivedAt: string;
  eventId: string;
}

export interface TelemetryEventPage {
  events: StoredTelemetryEvent[];
  hasMore: boolean;
}

export interface ExecutionCallbackCredential {
  executionId: string;
  nonceHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface CursorPageOptions {
  limit: number;
  cursor?: string | null;
}

export interface RepositoryExecutionPage {
  executions: RepositoryMutationExecution[];
  nextCursor: string | null;
}

export interface ObservationArchiveRecord {
  execution: RepositoryMutationExecution;
  analysis: StoredEvidenceAnalysis;
  evidence: StoredEvidencePack;
}

export interface ObservationArchivePage {
  archives: ObservationArchiveRecord[];
  nextCursor: string | null;
}

export interface PersistenceOperationMetric {
  operation: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  errorCode: string | null;
}

export interface TelemetryRepository {
  insertEvents(
    events: StudyTelemetryEvent[],
    receivedAt: string,
    policy?: RetentionPolicy,
  ): Promise<TelemetryInsertResult>;
  listEvents(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    source?: StudyTelemetryEvent['source'],
  ): Promise<StoredTelemetryEvent[]>;
  listEventPage(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    cursor?: EventPageCursor | null,
  ): Promise<TelemetryEventPage>;
  summarizeEvents(
    studyId: string,
    receivedAfter?: string | null,
  ): Promise<TelemetryEventSummary>;
  listSession(
    studyId: string,
    sessionId: string,
    receivedAfter?: string | null,
  ): Promise<StoredTelemetryEvent[]>;
  getWorkspace(
    studyId: string,
    participantId: string,
  ): Promise<ProjectFlowWorkspace | null>;
  putWorkspace(
    studyId: string,
    participantId: string,
    workspace: ProjectFlowWorkspace,
  ): Promise<void>;
  saveEvidence(pack: EvidencePack): Promise<void>;
  getLatestEvidence(studyId: string): Promise<StoredEvidencePack | null>;
  getEvidence(evidenceId: string): Promise<StoredEvidencePack | null>;
  saveEvidenceAnalysis(
    studyId: string,
    analysis: EvidenceAnalysis,
  ): Promise<void>;
  getEvidenceAnalysisByCacheKey(
    cacheKey: string,
  ): Promise<EvidenceAnalysis | null>;
  getEvidenceAnalysis(analysisId: string): Promise<EvidenceAnalysis | null>;
  getLatestEvidenceAnalysis(
    studyId: string,
  ): Promise<StoredEvidenceAnalysis | null>;
  saveCodexManifest(manifest: CodexImplementationManifest): Promise<void>;
  getCodexManifest(
    analysisId: string,
  ): Promise<CodexImplementationManifest | null>;
  getCodexManifestById(
    manifestId: string,
  ): Promise<CodexImplementationManifest | null>;
  saveRepositoryExecution(
    execution: RepositoryMutationExecution,
    expected: RepositoryMutationExecution | null,
  ): Promise<boolean>;
  getRepositoryExecution(
    executionId: string,
  ): Promise<RepositoryMutationExecution | null>;
  getRepositoryExecutionByManifest(
    manifestId: string,
  ): Promise<RepositoryMutationExecution | null>;
  getRepositoryExecutionByAnalysis(
    analysisId: string,
  ): Promise<RepositoryMutationExecution | null>;
  listRepositoryExecutions(): Promise<RepositoryMutationExecution[]>;
  listRepositoryExecutionPage(
    options: CursorPageOptions,
    statuses?: ReadonlyArray<RepositoryMutationExecution['status']>,
  ): Promise<RepositoryExecutionPage>;
  getObservationArchive(
    executionId: string,
  ): Promise<ObservationArchiveRecord | null>;
  listObservationArchivePage(
    options: CursorPageOptions,
  ): Promise<ObservationArchivePage>;
  saveResetExecution(execution: DemoResetExecution): Promise<void>;
  getResetExecution(resetId: string): Promise<DemoResetExecution | null>;
  getLatestResetExecution(): Promise<DemoResetExecution | null>;
  /**
   * Commits the destructive demo reset (telemetry + lab data + the evolution
   * cycle boundary) together with the reset-execution status transition as a
   * single atomic, compare-and-swap-gated operation.
   *
   * The transition only applies when the persisted reset_executions row still
   * matches `expectedStatus`/`expectedVersion` exactly (a real DB-level CAS —
   * `UPDATE ... WHERE status = ? AND version = ?`, checked via the affected
   * row count — not an in-process flag). If the row has moved on (another
   * worker already completed it, or the state changed underneath us), this
   * returns `null` and destroys nothing.
   *
   * If the underlying transaction fails partway (D1 `.batch()` rolls back the
   * whole batch on error; the in-memory backend snapshots and restores on
   * throw), the prior demo data and reset-execution row are left exactly as
   * they were — recoverable by retrying the same call.
   */
  completeResetAtomically(
    input: AtomicDemoResetInput,
  ): Promise<DemoResetExecution | null>;
  saveFitnessOutcome(outcome: FitnessOutcome): Promise<void>;
  getFitnessOutcome(executionId: string): Promise<FitnessOutcome | null>;
  listFitnessOutcomes(): Promise<FitnessOutcome[]>;
  saveExecutionCallbackCredential(
    credential: ExecutionCallbackCredential,
  ): Promise<void>;
  getExecutionCallbackCredential(
    executionId: string,
  ): Promise<ExecutionCallbackCredential | null>;
  consumeExecutionCallbackSignature(
    executionId: string,
    signature: string,
    usedAt: string,
  ): Promise<boolean>;
  consumeTargetRequestSignature(
    signature: string,
    usedAt: string,
  ): Promise<boolean>;
  incrementOperationalMetrics(
    increments: Partial<OperationalMetricCounts>,
    updatedAt: string,
  ): Promise<void>;
  getOperationalMetrics(): Promise<OperationalMetricsSnapshot>;
  getEvolutionCycle(): Promise<EvolutionCycle>;
  advanceEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ): Promise<EvolutionCycle>;
  resetEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ): Promise<EvolutionCycle>;
  getTargetConnection(): Promise<TargetApplicationConnection | null>;
  saveTargetConnection(connection: TargetApplicationConnection): Promise<void>;
  deleteTargetConnection(): Promise<void>;
  getRetentionHealth(
    policy: RetentionPolicy,
    now: string,
  ): Promise<RetentionHealth>;
  runRetentionSweep(
    policy: RetentionPolicy,
    now: string,
  ): Promise<RetentionSweepResult>;
  deleteParticipant(
    studyId: string,
    participantId: string,
  ): Promise<RetentionDeletedCounts>;
  deleteStudy(studyId: string): Promise<RetentionDeletedCounts>;
  deleteExecutionArtifacts(
    executionId: string,
  ): Promise<RetentionDeletedCounts>;
  saveOperationalEvents(events: OperationalEvent[]): Promise<void>;
  listOperationalAuditEvents(limit: number): Promise<OperationalEvent[]>;
  summarizeOperationalMetrics(
    limit: number,
  ): Promise<OperationalMetricSummary[]>;
  reset(options?: { preserveResetExecutions?: boolean }): Promise<void>;
}

const eventStore = new Map<string, StoredTelemetryEvent>();
const workspaceStore = new Map<string, ProjectFlowWorkspace>();
const evidenceStore = new Map<string, StoredEvidencePack>();
const evidenceByIdStore = new Map<string, StoredEvidencePack>();
const evidenceAnalysisStore = new Map<
  string,
  { studyId: string; analysis: EvidenceAnalysis }
>();
const analysisStudyStore = new Map<
  string,
  { studyId: string; createdAt: string }
>();
const manifestStore = new Map<string, CodexImplementationManifest>();
const manifestStudyStore = new Map<string, string>();
const repositoryExecutionStore = new Map<string, RepositoryMutationExecution>();
const executionStudyStore = new Map<string, string>();
const resetExecutionStore = new Map<string, DemoResetExecution>();
const fitnessOutcomeStore = new Map<string, FitnessOutcome>();
const callbackCredentialStore = new Map<string, ExecutionCallbackCredential>();
const callbackSignatureStore = new Set<string>();
const targetRequestSignatureStore = new Map<string, string>();
const operationalMetricStore = new Map<OperationalMetricName, number>();
let operationalMetricsUpdatedAt: string | null = null;
const operationalEventStore = new Map<string, OperationalEvent>();
let targetConnectionStore: TargetApplicationConnection | null = null;
const baselineStudyId = 'projectflow-baseline-study';
const defaultEvolutionCycle = (): EvolutionCycle => ({
  studyId: baselineStudyId,
  startedAt: null,
  genomeEvolutionCount: 0,
  measuredCommit: null,
  appVersion: null,
  deploymentVerifiedAt: null,
});
const emptyOperationalMetricCounts = (): OperationalMetricCounts =>
  Object.fromEntries(
    operationalMetricNames.map((name) => [name, 0]),
  ) as OperationalMetricCounts;
let evolutionCycleStore = defaultEvolutionCycle();
let latestRetentionSweep: RetentionSweepResult | null = null;

// Snapshot/restore pair backing InMemoryTelemetryRepository.completeResetAtomically.
// This is the in-memory equivalent of a rolled-back D1 transaction: everything
// the destructive demo reset can touch (except the reset-execution row itself,
// which is only ever written on success) is captured before mutation and
// restored verbatim if the attempt throws partway through.
interface ResetableStateSnapshot {
  eventStore: Map<string, StoredTelemetryEvent>;
  workspaceStore: Map<string, ProjectFlowWorkspace>;
  evidenceStore: Map<string, StoredEvidencePack>;
  evidenceByIdStore: Map<string, StoredEvidencePack>;
  evidenceAnalysisStore: Map<string, { studyId: string; analysis: EvidenceAnalysis }>;
  analysisStudyStore: Map<string, { studyId: string; createdAt: string }>;
  manifestStore: Map<string, CodexImplementationManifest>;
  manifestStudyStore: Map<string, string>;
  repositoryExecutionStore: Map<string, RepositoryMutationExecution>;
  executionStudyStore: Map<string, string>;
  fitnessOutcomeStore: Map<string, FitnessOutcome>;
  callbackCredentialStore: Map<string, ExecutionCallbackCredential>;
  callbackSignatureStore: Set<string>;
  targetRequestSignatureStore: Map<string, string>;
  operationalMetricStore: Map<OperationalMetricName, number>;
  operationalMetricsUpdatedAt: string | null;
  operationalEventStore: Map<string, OperationalEvent>;
  evolutionCycleStore: EvolutionCycle;
  latestRetentionSweep: RetentionSweepResult | null;
}

const snapshotResetableState = (): ResetableStateSnapshot => ({
  eventStore: new Map(eventStore),
  workspaceStore: new Map(workspaceStore),
  evidenceStore: new Map(evidenceStore),
  evidenceByIdStore: new Map(evidenceByIdStore),
  evidenceAnalysisStore: new Map(evidenceAnalysisStore),
  analysisStudyStore: new Map(analysisStudyStore),
  manifestStore: new Map(manifestStore),
  manifestStudyStore: new Map(manifestStudyStore),
  repositoryExecutionStore: new Map(repositoryExecutionStore),
  executionStudyStore: new Map(executionStudyStore),
  fitnessOutcomeStore: new Map(fitnessOutcomeStore),
  callbackCredentialStore: new Map(callbackCredentialStore),
  callbackSignatureStore: new Set(callbackSignatureStore),
  targetRequestSignatureStore: new Map(targetRequestSignatureStore),
  operationalMetricStore: new Map(operationalMetricStore),
  operationalMetricsUpdatedAt,
  operationalEventStore: new Map(operationalEventStore),
  evolutionCycleStore,
  latestRetentionSweep,
});

const replaceMapContents = <K, V>(target: Map<K, V>, source: Map<K, V>) => {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
};

const restoreResetableState = (snapshot: ResetableStateSnapshot) => {
  replaceMapContents(eventStore, snapshot.eventStore);
  replaceMapContents(workspaceStore, snapshot.workspaceStore);
  replaceMapContents(evidenceStore, snapshot.evidenceStore);
  replaceMapContents(evidenceByIdStore, snapshot.evidenceByIdStore);
  replaceMapContents(evidenceAnalysisStore, snapshot.evidenceAnalysisStore);
  replaceMapContents(analysisStudyStore, snapshot.analysisStudyStore);
  replaceMapContents(manifestStore, snapshot.manifestStore);
  replaceMapContents(manifestStudyStore, snapshot.manifestStudyStore);
  replaceMapContents(repositoryExecutionStore, snapshot.repositoryExecutionStore);
  replaceMapContents(executionStudyStore, snapshot.executionStudyStore);
  replaceMapContents(fitnessOutcomeStore, snapshot.fitnessOutcomeStore);
  replaceMapContents(callbackCredentialStore, snapshot.callbackCredentialStore);
  callbackSignatureStore.clear();
  for (const value of snapshot.callbackSignatureStore) {
    callbackSignatureStore.add(value);
  }
  replaceMapContents(targetRequestSignatureStore, snapshot.targetRequestSignatureStore);
  replaceMapContents(operationalMetricStore, snapshot.operationalMetricStore);
  operationalMetricsUpdatedAt = snapshot.operationalMetricsUpdatedAt;
  replaceMapContents(operationalEventStore, snapshot.operationalEventStore);
  evolutionCycleStore = snapshot.evolutionCycleStore;
  latestRetentionSweep = snapshot.latestRetentionSweep;
};

interface ExecutionCursor {
  updatedAt: string;
  executionId: string;
}

const encodeExecutionCursor = (execution: ExecutionCursor) =>
  btoa(`${execution.updatedAt}\n${execution.executionId}`)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const decodeExecutionCursor = (
  cursor?: string | null,
): ExecutionCursor | null => {
  if (!cursor) return null;
  try {
    const normalized = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const [updatedAt, executionId, ...extra] = atob(padded).split('\n');
    if (
      !updatedAt ||
      !executionId ||
      extra.length > 0 ||
      Number.isNaN(Date.parse(updatedAt))
    ) {
      throw new Error('invalid_cursor');
    }
    return { updatedAt, executionId };
  } catch {
    throw new Error('invalid_cursor');
  }
};

const executionPrecedesCursor = (
  execution: RepositoryMutationExecution,
  cursor: ExecutionCursor,
) =>
  execution.updatedAt < cursor.updatedAt ||
  (execution.updatedAt === cursor.updatedAt &&
    execution.executionId < cursor.executionId);

const paginateExecutions = (
  executions: RepositoryMutationExecution[],
  options: CursorPageOptions,
): RepositoryExecutionPage => {
  const cursor = decodeExecutionCursor(options.cursor);
  const eligible = cursor
    ? executions.filter((execution) =>
        executionPrecedesCursor(execution, cursor),
      )
    : executions;
  const page = eligible.slice(0, options.limit);
  return {
    executions: page,
    nextCursor:
      eligible.length > options.limit && page.length
        ? encodeExecutionCursor(page.at(-1)!)
        : null,
  };
};

const workspaceKey = (studyId: string, participantId: string) =>
  `${studyId}:${participantId}`;

const behaviorSignalEventTypes = new Set<StudyTelemetryEvent['eventType']>([
  'hover_ended',
  'interaction_signal',
  'drag_attempted',
  'touch_cancelled',
  'browser_navigation',
  'viewport_zoom_changed',
]);

const isExpired = (timestamp: string, days: number, now: string) =>
  expiresAt(timestamp, days) <= now;

const compactExecution = (
  execution: RepositoryMutationExecution,
): RepositoryMutationExecution => ({
  ...execution,
  patch: null,
  codex: { ...execution.codex, finalMessage: null },
  rollback: execution.rollback
    ? { ...execution.rollback, patch: null }
    : execution.rollback,
});

const executionHasLargeArtifacts = (execution: RepositoryMutationExecution) =>
  Boolean(
    execution.patch ||
    execution.codex.finalMessage ||
    execution.rollback?.patch,
  );

export class InMemoryTelemetryRepository implements TelemetryRepository {
  async insertEvents(
    events: StudyTelemetryEvent[],
    receivedAt: string,
    policy = retentionPolicy(),
  ) {
    let accepted = 0;
    let duplicates = 0;
    let sequenceConflicts = 0;
    let quotaRejected = 0;
    const studyCounts = new Map<string, number>();
    for (const stored of eventStore.values()) {
      studyCounts.set(
        stored.studyId,
        (studyCounts.get(stored.studyId) ?? 0) + 1,
      );
    }
    for (const event of events) {
      if (eventStore.has(event.eventId)) {
        duplicates += 1;
        continue;
      }
      const sequenceConflict = [...eventStore.values()].some(
        (stored) =>
          stored.studyId === event.studyId &&
          stored.participantId === event.participantId &&
          stored.sessionId === event.sessionId &&
          stored.sequence === event.sequence,
      );
      if (sequenceConflict) {
        sequenceConflicts += 1;
        continue;
      }
      const studyCount = studyCounts.get(event.studyId) ?? 0;
      if (
        eventStore.size >= policy.maxEventsPerTarget ||
        studyCount >= policy.maxEventsPerStudy
      ) {
        quotaRejected += 1;
        continue;
      }
      eventStore.set(event.eventId, { ...event, receivedAt });
      studyCounts.set(event.studyId, studyCount + 1);
      accepted += 1;
    }
    return { accepted, duplicates, sequenceConflicts, quotaRejected };
  }

  async listEvents(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    source?: StudyTelemetryEvent['source'],
  ) {
    return [...eventStore.values()]
      .filter(
        (event) =>
          event.studyId === studyId &&
          (!source || event.source === source) &&
          (!receivedAfter || event.receivedAt > receivedAfter),
      )
      .sort((left, right) =>
        left.receivedAt === right.receivedAt
          ? left.sequence - right.sequence
          : left.receivedAt.localeCompare(right.receivedAt),
      )
      .slice(-limit);
  }

  async listEventPage(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    cursor?: EventPageCursor | null,
  ) {
    const ordered = [...eventStore.values()]
      .filter(
        (event) =>
          event.studyId === studyId &&
          (!receivedAfter || event.receivedAt > receivedAfter),
      )
      .sort((left, right) =>
        left.receivedAt === right.receivedAt
          ? left.eventId.localeCompare(right.eventId)
          : left.receivedAt.localeCompare(right.receivedAt),
      );
    if (!cursor) return { events: ordered.slice(-limit), hasMore: false };
    const eligible = ordered.filter(
      (event) =>
        event.receivedAt > cursor.receivedAt ||
        (event.receivedAt === cursor.receivedAt &&
          event.eventId > cursor.eventId),
    );
    return {
      events: eligible.slice(0, limit),
      hasMore: eligible.length > limit,
    };
  }

  async listSession(
    studyId: string,
    sessionId: string,
    receivedAfter?: string | null,
  ) {
    return [...eventStore.values()]
      .filter(
        (event) =>
          event.studyId === studyId &&
          event.sessionId === sessionId &&
          (!receivedAfter || event.receivedAt > receivedAfter),
      )
      .sort((left, right) => left.sequence - right.sequence);
  }

  async summarizeEvents(studyId: string, receivedAfter?: string | null) {
    const events = [...eventStore.values()].filter(
      (event) =>
        event.studyId === studyId &&
        (!receivedAfter || event.receivedAt > receivedAfter),
    );
    const sessionCounts = events.reduce<Record<string, number>>(
      (counts, event) => {
        counts[event.sessionId] = (counts[event.sessionId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    return {
      count: events.length,
      sessionCounts,
      participantCount: new Set(events.map((event) => event.participantId))
        .size,
      behaviorSignalCount: events.filter((event) =>
        behaviorSignalEventTypes.has(event.eventType),
      ).length,
    };
  }

  async getWorkspace(studyId: string, participantId: string) {
    return workspaceStore.get(workspaceKey(studyId, participantId)) ?? null;
  }

  async putWorkspace(
    studyId: string,
    participantId: string,
    workspace: ProjectFlowWorkspace,
  ) {
    workspaceStore.set(workspaceKey(studyId, participantId), workspace);
  }

  async saveEvidence(pack: EvidencePack) {
    evidenceStore.set(pack.study.studyId, pack);
    evidenceByIdStore.set(pack.evidenceId, pack);
  }

  async getLatestEvidence(studyId: string) {
    return evidenceStore.get(studyId) ?? null;
  }

  async getEvidence(evidenceId: string) {
    return evidenceByIdStore.get(evidenceId) ?? null;
  }

  async saveEvidenceAnalysis(studyId: string, analysis: EvidenceAnalysis) {
    evidenceAnalysisStore.set(analysis.cacheKey, { studyId, analysis });
    analysisStudyStore.set(analysis.analysisId, {
      studyId,
      createdAt: analysis.createdAt,
    });
  }

  async getEvidenceAnalysisByCacheKey(cacheKey: string) {
    return evidenceAnalysisStore.get(cacheKey)?.analysis ?? null;
  }

  async getEvidenceAnalysis(analysisId: string) {
    return (
      [...evidenceAnalysisStore.values()].find(
        (entry) => entry.analysis.analysisId === analysisId,
      )?.analysis ?? null
    );
  }

  async getLatestEvidenceAnalysis(studyId: string) {
    return (
      [...evidenceAnalysisStore.values()]
        .filter((entry) => entry.studyId === studyId)
        .sort((left, right) =>
          left.analysis.createdAt.localeCompare(right.analysis.createdAt),
        )
        .at(-1)?.analysis ?? null
    );
  }

  async saveCodexManifest(manifest: CodexImplementationManifest) {
    if (!manifestStore.has(manifest.manifestId)) {
      manifestStore.set(manifest.manifestId, manifest);
    }
    const lineage = analysisStudyStore.get(manifest.analysisId);
    if (lineage) manifestStudyStore.set(manifest.manifestId, lineage.studyId);
  }

  async getCodexManifest(analysisId: string) {
    return (
      [...manifestStore.values()]
        .filter((manifest) => manifest.analysisId === analysisId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1) ?? null
    );
  }

  async getCodexManifestById(manifestId: string) {
    return manifestStore.get(manifestId) ?? null;
  }

  async saveRepositoryExecution(
    execution: RepositoryMutationExecution,
    expected: RepositoryMutationExecution | null,
  ) {
    if (
      (expected === null && execution.revision !== 0) ||
      (expected !== null &&
        (execution.executionId !== expected.executionId ||
          execution.revision !== expected.revision + 1))
    ) {
      return false;
    }
    const current = repositoryExecutionStore.get(execution.executionId);
    if (expected === null) {
      if (current || execution.revision !== 0) return false;
      repositoryExecutionStore.set(execution.executionId, execution);
      const lineage = analysisStudyStore.get(execution.analysisId);
      if (lineage) {
        executionStudyStore.set(execution.executionId, lineage.studyId);
      }
      return true;
    }
    if (
      !current ||
      current.revision !== expected.revision ||
      current.status !== expected.status ||
      (current.rollback?.status ?? null) !== (expected.rollback?.status ?? null)
    ) {
      return false;
    }
    repositoryExecutionStore.set(execution.executionId, execution);
    const lineage = analysisStudyStore.get(execution.analysisId);
    if (lineage) {
      executionStudyStore.set(execution.executionId, lineage.studyId);
    }
    return true;
  }

  async getRepositoryExecution(executionId: string) {
    return repositoryExecutionStore.get(executionId) ?? null;
  }

  async getRepositoryExecutionByManifest(manifestId: string) {
    return (
      [...repositoryExecutionStore.values()].find(
        (execution) => execution.manifestId === manifestId,
      ) ?? null
    );
  }

  async getRepositoryExecutionByAnalysis(analysisId: string) {
    return (
      [...repositoryExecutionStore.values()].find(
        (execution) => execution.analysisId === analysisId,
      ) ?? null
    );
  }

  async listRepositoryExecutions() {
    return [...repositoryExecutionStore.values()].sort((left, right) =>
      right.updatedAt === left.updatedAt
        ? right.executionId.localeCompare(left.executionId)
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async listRepositoryExecutionPage(
    options: CursorPageOptions,
    statuses?: ReadonlyArray<RepositoryMutationExecution['status']>,
  ) {
    const executions = await this.listRepositoryExecutions();
    return paginateExecutions(
      statuses?.length
        ? executions.filter((execution) => statuses.includes(execution.status))
        : executions,
      options,
    );
  }

  async getObservationArchive(executionId: string) {
    const execution = await this.getRepositoryExecution(executionId);
    if (!execution || !['released', 'failed'].includes(execution.status)) {
      return null;
    }
    const analysis = await this.getEvidenceAnalysis(execution.analysisId);
    if (!analysis) return null;
    const evidence = await this.getEvidence(analysis.evidenceId);
    return evidence ? { execution, analysis, evidence } : null;
  }

  async listObservationArchivePage(options: CursorPageOptions) {
    const completed = (await this.listRepositoryExecutions()).filter(
      (execution) => ['released', 'failed'].includes(execution.status),
    );
    const page = paginateExecutions(completed, options);
    const analysisById = new Map(
      [...evidenceAnalysisStore.values()].map(({ analysis }) => [
        analysis.analysisId,
        analysis,
      ]),
    );
    const archives = page.executions.flatMap((execution) => {
      const analysis = analysisById.get(execution.analysisId);
      const evidence = analysis
        ? evidenceByIdStore.get(analysis.evidenceId)
        : undefined;
      return analysis && evidence ? [{ execution, analysis, evidence }] : [];
    });
    return { archives, nextCursor: page.nextCursor };
  }

  async saveResetExecution(execution: DemoResetExecution) {
    resetExecutionStore.set(execution.resetId, execution);
  }

  async getResetExecution(resetId: string) {
    return resetExecutionStore.get(resetId) ?? null;
  }

  async getLatestResetExecution() {
    return (
      [...resetExecutionStore.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1) ?? null
    );
  }

  async saveFitnessOutcome(outcome: FitnessOutcome) {
    fitnessOutcomeStore.set(outcome.executionId, outcome);
  }

  async getFitnessOutcome(executionId: string) {
    return fitnessOutcomeStore.get(executionId) ?? null;
  }

  async listFitnessOutcomes() {
    return [...fitnessOutcomeStore.values()].sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt),
    );
  }

  async saveExecutionCallbackCredential(
    credential: ExecutionCallbackCredential,
  ) {
    callbackCredentialStore.set(credential.executionId, credential);
    for (const key of callbackSignatureStore) {
      if (key.startsWith(`${credential.executionId}:`)) {
        callbackSignatureStore.delete(key);
      }
    }
  }

  async getExecutionCallbackCredential(executionId: string) {
    return callbackCredentialStore.get(executionId) ?? null;
  }

  async consumeExecutionCallbackSignature(
    executionId: string,
    signature: string,
    usedAt: string,
  ) {
    void usedAt;
    const key = `${executionId}:${signature}`;
    if (callbackSignatureStore.has(key)) return false;
    callbackSignatureStore.add(key);
    return true;
  }

  async consumeTargetRequestSignature(signature: string, usedAt: string) {
    const expiresBefore = Date.parse(usedAt) - 10 * 60 * 1_000;
    for (const [storedSignature, storedAt] of targetRequestSignatureStore) {
      if (Date.parse(storedAt) < expiresBefore) {
        targetRequestSignatureStore.delete(storedSignature);
      }
    }
    if (targetRequestSignatureStore.has(signature)) return false;
    targetRequestSignatureStore.set(signature, usedAt);
    return true;
  }

  async incrementOperationalMetrics(
    increments: Partial<OperationalMetricCounts>,
    updatedAt: string,
  ) {
    for (const name of operationalMetricNames) {
      const increment = increments[name] ?? 0;
      if (increment > 0) {
        operationalMetricStore.set(
          name,
          (operationalMetricStore.get(name) ?? 0) + increment,
        );
      }
    }
    operationalMetricsUpdatedAt = updatedAt;
  }

  async getOperationalMetrics(): Promise<OperationalMetricsSnapshot> {
    const counts = emptyOperationalMetricCounts();
    for (const name of operationalMetricNames) {
      counts[name] = operationalMetricStore.get(name) ?? 0;
    }
    return { updatedAt: operationalMetricsUpdatedAt, counts };
  }

  async getEvolutionCycle() {
    return {
      ...evolutionCycleStore,
      genomeEvolutionCount: [...repositoryExecutionStore.values()].filter(
        (execution) => execution.status === 'released',
      ).length,
    };
  }

  async advanceEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ) {
    const releasedCount = [...repositoryExecutionStore.values()].filter(
      (execution) => execution.status === 'released',
    ).length;
    evolutionCycleStore = {
      studyId: baselineStudyId,
      ...boundary,
      genomeEvolutionCount: releasedCount,
    };
    return evolutionCycleStore;
  }

  async resetEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ) {
    evolutionCycleStore = {
      studyId: baselineStudyId,
      ...boundary,
      genomeEvolutionCount: 0,
    };
    return evolutionCycleStore;
  }

  async getTargetConnection() {
    return targetConnectionStore;
  }

  async saveTargetConnection(connection: TargetApplicationConnection) {
    targetConnectionStore = connection;
  }

  async deleteTargetConnection() {
    targetConnectionStore = null;
  }

  async getRetentionHealth(
    policy: RetentionPolicy,
    now: string,
  ): Promise<RetentionHealth> {
    const studyCounts = new Map<string, number>();
    let expiredRecordCount = 0;
    for (const event of eventStore.values()) {
      studyCounts.set(event.studyId, (studyCounts.get(event.studyId) ?? 0) + 1);
      if (isExpired(event.receivedAt, policy.rawTelemetryDays, now)) {
        expiredRecordCount += 1;
      }
    }
    for (const workspace of workspaceStore.values()) {
      if (isExpired(workspace.updatedAt, policy.workspaceDays, now)) {
        expiredRecordCount += 1;
      }
    }
    for (const evidence of evidenceByIdStore.values()) {
      if (isExpired(evidence.generatedAt, policy.derivedEvidenceDays, now)) {
        expiredRecordCount += 1;
      }
    }
    for (const { analysis } of evidenceAnalysisStore.values()) {
      if (isExpired(analysis.createdAt, policy.derivedEvidenceDays, now)) {
        expiredRecordCount += 1;
      }
    }
    for (const manifest of manifestStore.values()) {
      if (isExpired(manifest.createdAt, policy.fossilRecordDays, now)) {
        expiredRecordCount += 1;
      }
    }
    for (const execution of repositoryExecutionStore.values()) {
      if (
        isExpired(execution.createdAt, policy.fossilRecordDays, now) ||
        (executionHasLargeArtifacts(execution) &&
          isExpired(execution.createdAt, policy.executionArtifactDays, now))
      ) {
        expiredRecordCount += 1;
      }
    }
    for (const credential of callbackCredentialStore.values()) {
      if (credential.expiresAt <= now) expiredRecordCount += 1;
    }
    const largestStudyEventCount = Math.max(0, ...studyCounts.values());
    const quotaAttention =
      eventStore.size >= policy.maxEventsPerTarget * 0.9 ||
      largestStudyEventCount >= policy.maxEventsPerStudy * 0.9;
    return {
      status:
        expiredRecordCount > 0 || quotaAttention ? 'attention' : 'healthy',
      policy,
      eventCount: eventStore.size,
      studyCount: studyCounts.size,
      largestStudyEventCount,
      expiredRecordCount,
      lastSweepAt: latestRetentionSweep?.completedAt ?? null,
    };
  }

  private deleteCallbackArtifacts(
    executionId: string,
    deleted: RetentionDeletedCounts,
  ) {
    if (callbackCredentialStore.delete(executionId)) {
      deleted.callbackArtifacts += 1;
    }
    for (const key of callbackSignatureStore) {
      if (key.startsWith(`${executionId}:`)) {
        callbackSignatureStore.delete(key);
        deleted.callbackArtifacts += 1;
      }
    }
  }

  async saveOperationalEvents(events: OperationalEvent[]) {
    for (const event of events) {
      operationalEventStore.set(event.eventId, event);
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    for (const [eventId, stored] of operationalEventStore) {
      if (Date.parse(stored.occurredAt) < cutoff) {
        operationalEventStore.delete(eventId);
      }
    }
  }

  private deleteDerivedStudyArtifacts(
    studyId: string,
    deleted: RetentionDeletedCounts,
  ) {
    const analysisIds = new Set(
      [...analysisStudyStore.entries()]
        .filter(([, lineage]) => lineage.studyId === studyId)
        .map(([analysisId]) => analysisId),
    );
    for (const [cacheKey, entry] of evidenceAnalysisStore) {
      if (entry.studyId !== studyId) continue;
      analysisIds.add(entry.analysis.analysisId);
      evidenceAnalysisStore.delete(cacheKey);
      deleted.analyses += 1;
    }
    for (const [manifestId, manifest] of manifestStore) {
      if (
        !analysisIds.has(manifest.analysisId) &&
        manifestStudyStore.get(manifestId) !== studyId
      ) {
        continue;
      }
      manifestStore.delete(manifestId);
      manifestStudyStore.delete(manifestId);
      deleted.manifests += 1;
    }
    for (const [executionId, execution] of repositoryExecutionStore) {
      if (
        !analysisIds.has(execution.analysisId) &&
        executionStudyStore.get(executionId) !== studyId
      ) {
        continue;
      }
      repositoryExecutionStore.delete(executionId);
      executionStudyStore.delete(executionId);
      deleted.executions += 1;
      this.deleteCallbackArtifacts(executionId, deleted);
    }
    for (const analysisId of analysisIds) {
      analysisStudyStore.delete(analysisId);
    }
    evidenceStore.delete(studyId);
    for (const [evidenceId, evidence] of evidenceByIdStore) {
      if (evidence.study.studyId !== studyId) continue;
      evidenceByIdStore.delete(evidenceId);
      deleted.evidencePacks += 1;
    }
  }

  async deleteParticipant(studyId: string, participantId: string) {
    const deleted = emptyDeletedCounts();
    for (const [eventId, event] of eventStore) {
      if (event.studyId === studyId && event.participantId === participantId) {
        eventStore.delete(eventId);
        deleted.telemetryEvents += 1;
      }
    }
    if (workspaceStore.delete(workspaceKey(studyId, participantId))) {
      deleted.workspaces += 1;
    }
    this.deleteDerivedStudyArtifacts(studyId, deleted);
    return deleted;
  }

  async deleteStudy(studyId: string) {
    const deleted = emptyDeletedCounts();
    for (const [eventId, event] of eventStore) {
      if (event.studyId === studyId) {
        eventStore.delete(eventId);
        deleted.telemetryEvents += 1;
      }
    }
    for (const key of workspaceStore.keys()) {
      if (key.startsWith(`${studyId}:`)) {
        workspaceStore.delete(key);
        deleted.workspaces += 1;
      }
    }
    this.deleteDerivedStudyArtifacts(studyId, deleted);
    return deleted;
  }

  async deleteExecutionArtifacts(executionId: string) {
    const deleted = emptyDeletedCounts();
    if (repositoryExecutionStore.delete(executionId)) {
      deleted.executions += 1;
    }
    executionStudyStore.delete(executionId);
    this.deleteCallbackArtifacts(executionId, deleted);
    return deleted;
  }

  async runRetentionSweep(policy: RetentionPolicy, now: string) {
    const deleted = emptyDeletedCounts();
    let compactedExecutions = 0;
    for (const [eventId, event] of eventStore) {
      if (isExpired(event.receivedAt, policy.rawTelemetryDays, now)) {
        eventStore.delete(eventId);
        deleted.telemetryEvents += 1;
      }
    }
    for (const [key, workspace] of workspaceStore) {
      if (isExpired(workspace.updatedAt, policy.workspaceDays, now)) {
        workspaceStore.delete(key);
        deleted.workspaces += 1;
      }
    }
    for (const [evidenceId, evidence] of evidenceByIdStore) {
      if (isExpired(evidence.generatedAt, policy.derivedEvidenceDays, now)) {
        evidenceByIdStore.delete(evidenceId);
        if (
          evidenceStore.get(evidence.study.studyId)?.evidenceId === evidenceId
        ) {
          evidenceStore.delete(evidence.study.studyId);
        }
        deleted.evidencePacks += 1;
      }
    }
    for (const [cacheKey, entry] of evidenceAnalysisStore) {
      if (
        isExpired(entry.analysis.createdAt, policy.derivedEvidenceDays, now)
      ) {
        evidenceAnalysisStore.delete(cacheKey);
        deleted.analyses += 1;
      }
    }
    for (const [manifestId, manifest] of manifestStore) {
      if (isExpired(manifest.createdAt, policy.fossilRecordDays, now)) {
        manifestStore.delete(manifestId);
        manifestStudyStore.delete(manifestId);
        deleted.manifests += 1;
      }
    }
    for (const [executionId, execution] of repositoryExecutionStore) {
      if (isExpired(execution.createdAt, policy.fossilRecordDays, now)) {
        repositoryExecutionStore.delete(executionId);
        executionStudyStore.delete(executionId);
        deleted.executions += 1;
        this.deleteCallbackArtifacts(executionId, deleted);
      } else if (
        executionHasLargeArtifacts(execution) &&
        isExpired(execution.createdAt, policy.executionArtifactDays, now)
      ) {
        repositoryExecutionStore.set(executionId, compactExecution(execution));
        compactedExecutions += 1;
      }
    }
    for (const [executionId, credential] of callbackCredentialStore) {
      if (credential.expiresAt <= now) {
        this.deleteCallbackArtifacts(executionId, deleted);
      }
    }
    for (const [analysisId, lineage] of analysisStudyStore) {
      if (isExpired(lineage.createdAt, policy.fossilRecordDays, now)) {
        analysisStudyStore.delete(analysisId);
      }
    }
    latestRetentionSweep = {
      status: 'completed',
      policyVersion: policy.version,
      completedAt: now,
      compactedExecutions,
      deleted,
    };
    return latestRetentionSweep;
  }

  async listOperationalAuditEvents(limit: number) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    return [...operationalEventStore.values()]
      .filter(
        (event) =>
          event.kind === 'audit' && Date.parse(event.occurredAt) >= cutoff,
      )
      .sort((left, right) =>
        right.occurredAt === left.occurredAt
          ? right.eventId.localeCompare(left.eventId)
          : right.occurredAt.localeCompare(left.occurredAt),
      )
      .slice(0, limit);
  }

  async summarizeOperationalMetrics(limit: number) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    const aggregates = new Map<
      string,
      OperationalMetricSummary & { totalDurationMs: number }
    >();
    for (const event of operationalEventStore.values()) {
      if (
        event.kind !== 'metric' ||
        !event.provider ||
        !event.operation ||
        Date.parse(event.occurredAt) < cutoff
      ) {
        continue;
      }
      const key = `${event.provider}:${event.operation}`;
      const aggregate = aggregates.get(key) ?? {
        provider: event.provider,
        operation: event.operation,
        count: 0,
        failureCount: 0,
        averageDurationMs: 0,
        maximumDurationMs: 0,
        totalDurationMs: 0,
      };
      aggregate.count += 1;
      aggregate.failureCount += event.outcome === 'failure' ? 1 : 0;
      aggregate.totalDurationMs += event.durationMs;
      aggregate.maximumDurationMs = Math.max(
        aggregate.maximumDurationMs,
        event.durationMs,
      );
      aggregates.set(key, aggregate);
    }
    return [...aggregates.values()]
      .sort((left, right) =>
        left.provider === right.provider
          ? left.operation.localeCompare(right.operation)
          : left.provider.localeCompare(right.provider),
      )
      .slice(0, limit)
      .map(({ totalDurationMs, ...aggregate }) => ({
        ...aggregate,
        averageDurationMs: Math.round(totalDurationMs / aggregate.count),
      }));
  }

  async reset(options?: { preserveResetExecutions?: boolean }) {
    eventStore.clear();
    workspaceStore.clear();
    evidenceStore.clear();
    evidenceByIdStore.clear();
    evidenceAnalysisStore.clear();
    analysisStudyStore.clear();
    manifestStore.clear();
    manifestStudyStore.clear();
    repositoryExecutionStore.clear();
    executionStudyStore.clear();
    fitnessOutcomeStore.clear();
    callbackCredentialStore.clear();
    callbackSignatureStore.clear();
    targetRequestSignatureStore.clear();
    operationalMetricStore.clear();
    operationalEventStore.clear();
    operationalMetricsUpdatedAt = null;
    if (!options?.preserveResetExecutions) resetExecutionStore.clear();
    evolutionCycleStore = defaultEvolutionCycle();
    latestRetentionSweep = null;
  }

  async completeResetAtomically(input: AtomicDemoResetInput) {
    const current = resetExecutionStore.get(input.resetId);
    if (
      !current ||
      current.status !== input.expectedStatus ||
      current.version !== input.expectedVersion
    ) {
      // Lost the compare-and-swap: another worker already advanced (or
      // failed) this reset, or the caller's view is stale. Destroy nothing.
      return null;
    }
    const snapshot = snapshotResetableState();
    try {
      eventStore.clear();
      workspaceStore.clear();
      evidenceStore.clear();
      evidenceByIdStore.clear();
      evidenceAnalysisStore.clear();
      analysisStudyStore.clear();
      manifestStore.clear();
      manifestStudyStore.clear();
      repositoryExecutionStore.clear();
      executionStudyStore.clear();
      fitnessOutcomeStore.clear();
      callbackCredentialStore.clear();
      callbackSignatureStore.clear();
      targetRequestSignatureStore.clear();
      operationalMetricStore.clear();
      operationalEventStore.clear();
      operationalMetricsUpdatedAt = null;
      latestRetentionSweep = null;
      evolutionCycleStore = {
        studyId: baselineStudyId,
        ...input.evolutionBoundary,
        genomeEvolutionCount: 0,
      };
      // Destroying the lab data is part of the same attempt: if it throws,
      // the catch below restores everything cleared above, and the
      // reset-execution row (set only on success, below) is never touched.
      await input.labRepository.reset();
      resetExecutionStore.set(input.resetId, input.completed);
      return input.completed;
    } catch (error) {
      restoreResetableState(snapshot);
      throw error;
    }
  }
}

export class D1TelemetryRepository implements TelemetryRepository {
  constructor(private readonly database: D1Database) {}

  async insertEvents(
    events: StudyTelemetryEvent[],
    receivedAt: string,
    policy = retentionPolicy(),
  ) {
    if (!events.length) {
      return {
        accepted: 0,
        duplicates: 0,
        sequenceConflicts: 0,
        quotaRejected: 0,
      };
    }
    const placeholders = events.map(() => '?').join(', ');
    const existing = await this.database
      .prepare(
        `SELECT event_id FROM telemetry_events WHERE event_id IN (${placeholders})`,
      )
      .bind(...events.map((event) => event.eventId))
      .all<{ event_id: string }>();
    const existingIds = new Set(existing.results.map((row) => row.event_id));
    const seenIds = new Set<string>();
    let duplicates = 0;
    const novelEvents = events.filter((event) => {
      if (existingIds.has(event.eventId) || seenIds.has(event.eventId)) {
        duplicates += 1;
        return false;
      }
      seenIds.add(event.eventId);
      return true;
    });
    if (!novelEvents.length) {
      return {
        accepted: 0,
        duplicates,
        sequenceConflicts: 0,
        quotaRejected: 0,
      };
    }
    const eventExpiry = expiresAt(receivedAt, policy.rawTelemetryDays);
    const statements = novelEvents.map((event) =>
      this.database
        .prepare(
          `INSERT OR IGNORE INTO telemetry_events (
            event_id, study_id, participant_id, session_id, task_attempt_id,
            app_version, source, occurred_at, received_at, sequence,
            event_type, route, target_id, event_json, expires_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM telemetry_events) < ?
            AND (
              SELECT COUNT(*) FROM telemetry_events WHERE study_id = ?
            ) < ?`,
        )
        .bind(
          event.eventId,
          event.studyId,
          event.participantId,
          event.sessionId,
          'taskAttemptId' in event ? (event.taskAttemptId ?? null) : null,
          event.appVersion,
          event.source,
          event.occurredAt,
          receivedAt,
          event.sequence,
          event.eventType,
          event.route,
          'targetId' in event ? event.targetId : null,
          JSON.stringify(event),
          eventExpiry,
          policy.maxEventsPerTarget,
          event.studyId,
          policy.maxEventsPerStudy,
        ),
    );
    const results = await this.database.batch(statements);
    const accepted = results.reduce(
      (count, result) => count + (result.meta.changes > 0 ? 1 : 0),
      0,
    );
    const ignoredEvents = novelEvents.filter(
      (_, index) => results[index]?.meta.changes === 0,
    );
    if (!ignoredEvents.length) {
      return { accepted, duplicates, sequenceConflicts: 0, quotaRejected: 0 };
    }
    const sequenceChecks = await this.database.batch(
      ignoredEvents.map((event) =>
        this.database
          .prepare(
            `SELECT event_id
             FROM telemetry_events
             WHERE study_id = ?
               AND participant_id = ?
               AND session_id = ?
               AND sequence = ?
             LIMIT 1`,
          )
          .bind(
            event.studyId,
            event.participantId,
            event.sessionId,
            event.sequence,
          ),
      ),
    );
    const sequenceConflicts = sequenceChecks.filter(
      (result) => result.results.length > 0,
    ).length;
    return {
      accepted,
      duplicates,
      sequenceConflicts,
      quotaRejected: ignoredEvents.length - sequenceConflicts,
    };
  }

  async listEvents(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    source?: StudyTelemetryEvent['source'],
  ) {
    const result = await this.database
      .prepare(
        `SELECT event_id, event_json, received_at
         FROM telemetry_events
         WHERE study_id = ?
           AND (? IS NULL OR source = ?)
           AND (? IS NULL OR received_at > ?)
         ORDER BY received_at DESC, sequence DESC
         LIMIT ?`,
      )
      .bind(
        studyId,
        source ?? null,
        source ?? null,
        receivedAfter ?? null,
        receivedAfter ?? null,
        limit,
      )
      .all<{ event_id: string; event_json: string; received_at: string }>();

    return result.results
      .flatMap((row) => {
        const event = parseStoredValueOrNull(
          StudyTelemetryEventSchema,
          row.event_json,
          'telemetry event',
          row.event_id,
        );
        return event ? [{ ...event, receivedAt: row.received_at }] : [];
      })
      .reverse();
  }

  async listEventPage(
    studyId: string,
    limit: number,
    receivedAfter?: string | null,
    cursor?: EventPageCursor | null,
  ) {
    const statement = cursor
      ? this.database.prepare(
          `SELECT event_id, event_json, received_at
           FROM telemetry_events
           WHERE study_id = ?
             AND (? IS NULL OR received_at > ?)
             AND (received_at > ? OR (received_at = ? AND event_id > ?))
           ORDER BY received_at ASC, event_id ASC
           LIMIT ?`,
        )
      : this.database.prepare(
          `SELECT event_id, event_json, received_at
           FROM telemetry_events
           WHERE study_id = ? AND (? IS NULL OR received_at > ?)
           ORDER BY received_at DESC, event_id DESC
           LIMIT ?`,
        );
    const result = cursor
      ? await statement
          .bind(
            studyId,
            receivedAfter ?? null,
            receivedAfter ?? null,
            cursor.receivedAt,
            cursor.receivedAt,
            cursor.eventId,
            limit + 1,
          )
          .all<{
            event_id: string;
            event_json: string;
            received_at: string;
          }>()
      : await statement
          .bind(studyId, receivedAfter ?? null, receivedAfter ?? null, limit)
          .all<{
            event_id: string;
            event_json: string;
            received_at: string;
          }>();
    const mapped = result.results.flatMap((row) => {
      const event = parseStoredValueOrNull(
        StudyTelemetryEventSchema,
        row.event_json,
        'telemetry event',
        row.event_id,
      );
      return event ? [{ ...event, receivedAt: row.received_at }] : [];
    });
    return {
      events: cursor ? mapped.slice(0, limit) : mapped.reverse(),
      hasMore: Boolean(cursor && mapped.length > limit),
    };
  }

  async listSession(
    studyId: string,
    sessionId: string,
    receivedAfter?: string | null,
  ) {
    const result = await this.database
      .prepare(
        `SELECT event_id, event_json, received_at
         FROM telemetry_events
         WHERE study_id = ? AND session_id = ?
           AND (? IS NULL OR received_at > ?)
         ORDER BY sequence ASC`,
      )
      .bind(studyId, sessionId, receivedAfter ?? null, receivedAfter ?? null)
      .all<{ event_id: string; event_json: string; received_at: string }>();

    return result.results.flatMap((row) => {
      const event = parseStoredValueOrNull(
        StudyTelemetryEventSchema,
        row.event_json,
        'telemetry event',
        row.event_id,
      );
      return event ? [{ ...event, receivedAt: row.received_at }] : [];
    });
  }

  async summarizeEvents(studyId: string, receivedAfter?: string | null) {
    const [totals, sessions] = await Promise.all([
      this.database
        .prepare(
          `SELECT COUNT(*) AS count,
                COUNT(DISTINCT participant_id) AS participant_count,
                SUM(CASE WHEN event_type IN (
                  'hover_ended', 'interaction_signal', 'drag_attempted',
                  'touch_cancelled', 'browser_navigation', 'viewport_zoom_changed'
                ) THEN 1 ELSE 0 END) AS behavior_signal_count
         FROM telemetry_events
         WHERE study_id = ? AND (? IS NULL OR received_at > ?)`,
        )
        .bind(studyId, receivedAfter ?? null, receivedAfter ?? null)
        .first<{
          count: number;
          participant_count: number;
          behavior_signal_count: number;
        }>(),
      this.database
        .prepare(
          `SELECT session_id, COUNT(*) AS count
           FROM telemetry_events
           WHERE study_id = ? AND (? IS NULL OR received_at > ?)
           GROUP BY session_id`,
        )
        .bind(studyId, receivedAfter ?? null, receivedAfter ?? null)
        .all<{ session_id: string; count: number }>(),
    ]);
    return {
      count: totals?.count ?? 0,
      sessionCounts: Object.fromEntries(
        sessions.results.map((row) => [row.session_id, row.count]),
      ),
      participantCount: totals?.participant_count ?? 0,
      behaviorSignalCount: totals?.behavior_signal_count ?? 0,
    };
  }

  async getWorkspace(studyId: string, participantId: string) {
    const row = await this.database
      .prepare(
        `SELECT workspace_json
         FROM participant_workspaces
         WHERE study_id = ? AND participant_id = ?`,
      )
      .bind(studyId, participantId)
      .first<{ workspace_json: string }>();
    return row
      ? parseStoredValue(
          ProjectFlowWorkspaceSchema,
          row.workspace_json,
          'participant workspace',
          `${studyId}:${participantId}`,
        )
      : null;
  }

  async putWorkspace(
    studyId: string,
    participantId: string,
    workspace: ProjectFlowWorkspace,
  ) {
    await this.database
      .prepare(
        `INSERT INTO participant_workspaces (
          study_id, participant_id, workspace_json, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(study_id, participant_id) DO UPDATE SET
          workspace_json = excluded.workspace_json,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at`,
      )
      .bind(
        studyId,
        participantId,
        JSON.stringify(workspace),
        workspace.updatedAt,
        expiresAt(workspace.updatedAt, retentionPolicy().workspaceDays),
      )
      .run();
  }

  async saveEvidence(pack: EvidencePack) {
    await this.database
      .prepare(
        `INSERT INTO analysis_runs (
          evidence_id, study_id, app_version, generated_at,
          source_event_count, evidence_hash, evidence_pack_json, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(evidence_hash) DO UPDATE SET
          generated_at = excluded.generated_at,
          evidence_pack_json = excluded.evidence_pack_json,
          expires_at = excluded.expires_at`,
      )
      .bind(
        pack.evidenceId,
        pack.study.studyId,
        pack.study.appVersion,
        pack.generatedAt,
        pack.study.sourceEventCount,
        pack.evidenceHash,
        JSON.stringify(pack),
        expiresAt(pack.generatedAt, retentionPolicy().derivedEvidenceDays),
      )
      .run();
  }

  async getLatestEvidence(studyId: string) {
    const row = await this.database
      .prepare(
        `SELECT evidence_pack_json
         FROM analysis_runs
         WHERE study_id = ?
         ORDER BY generated_at DESC
         LIMIT 1`,
      )
      .bind(studyId)
      .first<{ evidence_pack_json: string }>();
    return row
      ? parseStoredValue(
          StoredEvidencePackSchema,
          row.evidence_pack_json,
          'evidence pack',
          studyId,
        )
      : null;
  }

  async getEvidence(evidenceId: string) {
    const row = await this.database
      .prepare(
        `SELECT evidence_pack_json FROM analysis_runs WHERE evidence_id = ? LIMIT 1`,
      )
      .bind(evidenceId)
      .first<{ evidence_pack_json: string }>();
    return row
      ? parseStoredValue(
          StoredEvidencePackSchema,
          row.evidence_pack_json,
          'evidence pack',
          evidenceId,
        )
      : null;
  }

  async saveEvidenceAnalysis(studyId: string, analysis: EvidenceAnalysis) {
    await this.database
      .prepare(
        `INSERT INTO evidence_analyses (
          analysis_id, study_id, evidence_id, evidence_hash, cache_key,
          prompt_version, model, mode, created_at, analysis_json, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          analysis_json = excluded.analysis_json,
          expires_at = excluded.expires_at`,
      )
      .bind(
        analysis.analysisId,
        studyId,
        analysis.evidenceId,
        analysis.evidenceHash,
        analysis.cacheKey,
        analysis.promptVersion,
        analysis.model,
        analysis.mode,
        analysis.createdAt,
        JSON.stringify(analysis),
        expiresAt(analysis.createdAt, retentionPolicy().derivedEvidenceDays),
      )
      .run();
  }

  async getEvidenceAnalysisByCacheKey(cacheKey: string) {
    const row = await this.database
      .prepare(
        `SELECT analysis_json FROM evidence_analyses WHERE cache_key = ?`,
      )
      .bind(cacheKey)
      .first<{ analysis_json: string }>();
    return row
      ? parseStoredValue(
          EvidenceAnalysisSchema,
          row.analysis_json,
          'evidence analysis',
          cacheKey,
        )
      : null;
  }

  async getEvidenceAnalysis(analysisId: string) {
    const row = await this.database
      .prepare(
        `SELECT analysis_json FROM evidence_analyses WHERE analysis_id = ?`,
      )
      .bind(analysisId)
      .first<{ analysis_json: string }>();
    return row
      ? parseStoredValue(
          EvidenceAnalysisSchema,
          row.analysis_json,
          'evidence analysis',
          analysisId,
        )
      : null;
  }

  async getLatestEvidenceAnalysis(studyId: string) {
    const row = await this.database
      .prepare(
        `SELECT analysis_json
         FROM evidence_analyses
         WHERE study_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(studyId)
      .first<{ analysis_json: string }>();
    return row
      ? parseStoredValue(
          StoredEvidenceAnalysisSchema,
          row.analysis_json,
          'evidence analysis',
          studyId,
        )
      : null;
  }

  async saveCodexManifest(manifest: CodexImplementationManifest) {
    await this.database
      .prepare(
        `INSERT INTO codex_manifest_versions (
          manifest_id, analysis_id, mutation_id, evidence_hash,
          manifest_hash, repository_commit, created_at, manifest_json,
          expires_at, study_id
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?,
           (SELECT study_id FROM evidence_analyses WHERE analysis_id = ?)
         )
         ON CONFLICT(manifest_id) DO NOTHING`,
      )
      .bind(
        manifest.manifestId,
        manifest.analysisId,
        manifest.mutationId,
        manifest.evidenceHash,
        manifest.manifestHash,
        manifest.repositoryCommit,
        manifest.createdAt,
        JSON.stringify(manifest),
        expiresAt(manifest.createdAt, retentionPolicy().fossilRecordDays),
        manifest.analysisId,
      )
      .run();
  }

  async getCodexManifest(analysisId: string) {
    const versioned = await this.database
      .prepare(
        `SELECT manifest_json FROM codex_manifest_versions
         WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(analysisId)
      .first<{ manifest_json: string }>();
    if (versioned) {
      return parseStoredValue(
        CodexImplementationManifestSchema,
        versioned.manifest_json,
        'Codex manifest',
        analysisId,
      );
    }
    const legacy = await this.database
      .prepare(
        `SELECT manifest_json FROM codex_manifests WHERE analysis_id = ?`,
      )
      .bind(analysisId)
      .first<{ manifest_json: string }>();
    return legacy
      ? parseStoredValue(
          CodexImplementationManifestSchema,
          legacy.manifest_json,
          'Codex manifest',
          analysisId,
        )
      : null;
  }

  async getCodexManifestById(manifestId: string) {
    const versioned = await this.database
      .prepare(
        `SELECT manifest_json FROM codex_manifest_versions WHERE manifest_id = ?`,
      )
      .bind(manifestId)
      .first<{ manifest_json: string }>();
    if (versioned) {
      return parseStoredValue(
        CodexImplementationManifestSchema,
        versioned.manifest_json,
        'Codex manifest',
        manifestId,
      );
    }
    const legacy = await this.database
      .prepare(
        `SELECT manifest_json FROM codex_manifests WHERE manifest_id = ?`,
      )
      .bind(manifestId)
      .first<{ manifest_json: string }>();
    return legacy
      ? parseStoredValue(
          CodexImplementationManifestSchema,
          legacy.manifest_json,
          'Codex manifest',
          manifestId,
        )
      : null;
  }

  async saveRepositoryExecution(
    execution: RepositoryMutationExecution,
    expected: RepositoryMutationExecution | null,
  ) {
    if (
      (expected === null && execution.revision !== 0) ||
      (expected !== null &&
        (execution.executionId !== expected.executionId ||
          execution.revision !== expected.revision + 1))
    ) {
      return false;
    }
    const statement =
      expected === null
        ? this.database
            .prepare(
              `INSERT OR IGNORE INTO repository_executions (
                execution_id, manifest_id, analysis_id, status, updated_at,
                execution_json, revision, created_at, artifact_expires_at,
                record_expires_at, study_id
              ) VALUES (
                ?, ?, ?, ?, ?, ?, 0, ?, ?, ?,
                (SELECT study_id FROM evidence_analyses WHERE analysis_id = ?)
              )`,
            )
            .bind(
              execution.executionId,
              execution.manifestId,
              execution.analysisId,
              execution.status,
              execution.updatedAt,
              JSON.stringify(execution),
              execution.createdAt,
              expiresAt(
                execution.createdAt,
                retentionPolicy().executionArtifactDays,
              ),
              expiresAt(
                execution.createdAt,
                retentionPolicy().fossilRecordDays,
              ),
              execution.analysisId,
            )
        : this.database
            .prepare(
              `UPDATE repository_executions
               SET status = ?,
                   updated_at = ?,
                   execution_json = ?,
                   revision = ?,
                   artifact_expires_at = ?,
                   record_expires_at = ?,
                   study_id = COALESCE(
                     (SELECT study_id FROM evidence_analyses WHERE analysis_id = ?),
                     study_id
                   )
               WHERE execution_id = ?
                 AND revision = ?
                 AND status = ?
                 AND (
                   (? IS NULL AND json_extract(execution_json, '$.rollback.status') IS NULL)
                   OR json_extract(execution_json, '$.rollback.status') = ?
                 )`,
            )
            .bind(
              execution.status,
              execution.updatedAt,
              JSON.stringify(execution),
              execution.revision,
              expiresAt(
                execution.createdAt,
                retentionPolicy().executionArtifactDays,
              ),
              expiresAt(
                execution.createdAt,
                retentionPolicy().fossilRecordDays,
              ),
              execution.analysisId,
              execution.executionId,
              expected.revision,
              expected.status,
              expected.rollback?.status ?? null,
              expected.rollback?.status ?? null,
            );
    const result = await statement.run();
    return (result.meta.changes ?? 0) === 1;
  }

  private async findRepositoryExecution(where: string, value: string) {
    const row = await this.database
      .prepare(
        `SELECT execution_json, revision FROM repository_executions WHERE ${where} = ? LIMIT 1`,
      )
      .bind(value)
      .first<{ execution_json: string; revision: number }>();
    return row
      ? RepositoryMutationExecutionSchema.parse({
          ...parseStoredValue(
            RepositoryMutationExecutionSchema,
            row.execution_json,
            'repository execution',
            value,
          ),
          revision: row.revision,
        })
      : null;
  }

  async getRepositoryExecution(executionId: string) {
    return this.findRepositoryExecution('execution_id', executionId);
  }

  async getRepositoryExecutionByManifest(manifestId: string) {
    return this.findRepositoryExecution('manifest_id', manifestId);
  }

  async getRepositoryExecutionByAnalysis(analysisId: string) {
    return this.findRepositoryExecution('analysis_id', analysisId);
  }

  async listRepositoryExecutions() {
    const result = await this.database
      .prepare(
        `SELECT execution_id, execution_json, revision
         FROM repository_executions
         ORDER BY updated_at DESC`,
      )
      .all<{
        execution_id: string;
        execution_json: string;
        revision: number;
      }>();
    return result.results.flatMap((row) => {
      const execution = parseStoredValueOrNull(
        RepositoryMutationExecutionSchema,
        row.execution_json,
        'repository execution',
        row.execution_id,
      );
      return execution
        ? [
            RepositoryMutationExecutionSchema.parse({
              ...execution,
              revision: row.revision,
            }),
          ]
        : [];
    });
  }

  async listRepositoryExecutionPage(
    options: CursorPageOptions,
    statuses?: ReadonlyArray<RepositoryMutationExecution['status']>,
  ) {
    const cursor = decodeExecutionCursor(options.cursor);
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];
    if (statuses?.length) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      bindings.push(...statuses);
    }
    if (cursor) {
      clauses.push('(updated_at < ? OR (updated_at = ? AND execution_id < ?))');
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.executionId);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const statement = this.database.prepare(
      `SELECT execution_id, updated_at, execution_json
       FROM repository_executions
       ${whereClause}
       ORDER BY updated_at DESC, execution_id DESC
       LIMIT ?`,
    );
    const bound = statement.bind(...bindings, options.limit + 1);
    const result = await bound.all<{
      execution_id: string;
      updated_at: string;
      execution_json: string;
    }>();
    const parsed = result.results.flatMap((row) => {
      const execution = parseStoredValueOrNull(
        RepositoryMutationExecutionSchema,
        row.execution_json,
        'repository execution',
        row.execution_id,
      );
      return execution ? [{ execution, row }] : [];
    });
    const page = parsed.slice(0, options.limit);
    const scanCursor = result.results.at(-1);
    return {
      executions: page.map(({ execution }) => execution),
      nextCursor:
        parsed.length > options.limit && page.length
          ? encodeExecutionCursor(page.at(-1)!.execution)
          : result.results.length > options.limit && scanCursor
            ? encodeExecutionCursor({
                updatedAt: scanCursor.updated_at,
                executionId: scanCursor.execution_id,
              })
            : null,
    };
  }

  async getObservationArchive(executionId: string) {
    const row = await this.database
      .prepare(
        `SELECT r.execution_id, r.execution_json, a.analysis_id,
                a.analysis_json, e.evidence_id, e.evidence_pack_json
         FROM repository_executions r
         JOIN evidence_analyses a ON a.analysis_id = r.analysis_id
         JOIN analysis_runs e ON e.evidence_id = a.evidence_id
         WHERE r.execution_id = ? AND r.status IN ('released', 'failed')
         LIMIT 1`,
      )
      .bind(executionId)
      .first<{
        execution_id: string;
        execution_json: string;
        analysis_id: string;
        analysis_json: string;
        evidence_id: string;
        evidence_pack_json: string;
      }>();
    return row
      ? {
          execution: parseStoredValue(
            RepositoryMutationExecutionSchema,
            row.execution_json,
            'repository execution',
            row.execution_id,
          ),
          analysis: parseStoredValue(
            StoredEvidenceAnalysisSchema,
            row.analysis_json,
            'evidence analysis',
            row.analysis_id,
          ),
          evidence: parseStoredValue(
            StoredEvidencePackSchema,
            row.evidence_pack_json,
            'evidence pack',
            row.evidence_id,
          ),
        }
      : null;
  }

  async listObservationArchivePage(options: CursorPageOptions) {
    const cursor = decodeExecutionCursor(options.cursor);
    const cursorClause = cursor
      ? `AND (r.updated_at < ? OR (r.updated_at = ? AND r.execution_id < ?))`
      : '';
    const statement = this.database.prepare(
      `SELECT r.execution_id, r.updated_at, r.execution_json, a.analysis_id,
              a.analysis_json, e.evidence_id, e.evidence_pack_json
       FROM repository_executions r
       JOIN evidence_analyses a ON a.analysis_id = r.analysis_id
       JOIN analysis_runs e ON e.evidence_id = a.evidence_id
       WHERE r.status IN ('released', 'failed') ${cursorClause}
       ORDER BY r.updated_at DESC, r.execution_id DESC
       LIMIT ?`,
    );
    const bound = cursor
      ? statement.bind(
          cursor.updatedAt,
          cursor.updatedAt,
          cursor.executionId,
          options.limit + 1,
        )
      : statement.bind(options.limit + 1);
    const result = await bound.all<{
      execution_id: string;
      updated_at: string;
      execution_json: string;
      analysis_id: string;
      analysis_json: string;
      evidence_id: string;
      evidence_pack_json: string;
    }>();
    const parsed = result.results.flatMap((row) => {
      const execution = parseStoredValueOrNull(
        RepositoryMutationExecutionSchema,
        row.execution_json,
        'repository execution',
        row.execution_id,
      );
      const analysis = parseStoredValueOrNull(
        StoredEvidenceAnalysisSchema,
        row.analysis_json,
        'evidence analysis',
        row.analysis_id,
      );
      const evidence = parseStoredValueOrNull(
        StoredEvidencePackSchema,
        row.evidence_pack_json,
        'evidence pack',
        row.evidence_id,
      );
      return execution && analysis && evidence
        ? [{ archive: { execution, analysis, evidence }, row }]
        : [];
    });
    const archives = parsed.slice(0, options.limit);
    const scanCursor = result.results.at(-1);
    return {
      archives: archives.map(({ archive }) => archive),
      nextCursor:
        parsed.length > options.limit && archives.length
          ? encodeExecutionCursor(archives.at(-1)!.archive.execution)
          : result.results.length > options.limit && scanCursor
            ? encodeExecutionCursor({
                updatedAt: scanCursor.updated_at,
                executionId: scanCursor.execution_id,
              })
            : null,
    };
  }

  async saveResetExecution(execution: DemoResetExecution) {
    await this.database
      .prepare(
        `INSERT INTO reset_executions (
          reset_id, status, updated_at, execution_json, version
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(reset_id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          execution_json = excluded.execution_json,
          version = excluded.version`,
      )
      .bind(
        execution.resetId,
        execution.status,
        execution.updatedAt,
        JSON.stringify(execution),
        execution.version,
      )
      .run();
  }

  async getResetExecution(resetId: string) {
    const row = await this.database
      .prepare(
        'SELECT execution_json FROM reset_executions WHERE reset_id = ? LIMIT 1',
      )
      .bind(resetId)
      .first<{ execution_json: string }>();
    return row
      ? parseStoredValue(
          DemoResetExecutionSchema,
          row.execution_json,
          'reset execution',
          resetId,
        )
      : null;
  }

  async getLatestResetExecution() {
    const row = await this.database
      .prepare(
        'SELECT reset_id, execution_json FROM reset_executions ORDER BY updated_at DESC, rowid DESC LIMIT 1',
      )
      .first<{ reset_id: string; execution_json: string }>();
    return row
      ? parseStoredValue(
          DemoResetExecutionSchema,
          row.execution_json,
          'reset execution',
          row.reset_id,
        )
      : null;
  }

  async saveFitnessOutcome(outcome: FitnessOutcome) {
    await this.database
      .prepare(
        `INSERT INTO outcome_validations (
          validation_id, generated_at, baseline_evidence_hash,
          evolved_evidence_hash, validation_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(validation_id) DO UPDATE SET
          generated_at = excluded.generated_at,
          baseline_evidence_hash = excluded.baseline_evidence_hash,
          evolved_evidence_hash = excluded.evolved_evidence_hash,
          validation_json = excluded.validation_json`,
      )
      .bind(
        outcome.outcomeId,
        outcome.generatedAt,
        outcome.baseline.evidenceHash,
        outcome.evolved.evidenceHash,
        JSON.stringify(outcome),
      )
      .run();
  }

  async getFitnessOutcome(executionId: string) {
    const row = await this.database
      .prepare(
        'SELECT validation_json FROM outcome_validations WHERE validation_id = ? LIMIT 1',
      )
      .bind(`fitness-${executionId}`)
      .first<{ validation_json: string }>();
    return row
      ? parseStoredValue(
          FitnessOutcomeSchema,
          row.validation_json,
          'fitness outcome',
          `fitness-${executionId}`,
        )
      : null;
  }

  async listFitnessOutcomes() {
    const result = await this.database
      .prepare(
        'SELECT validation_id, validation_json FROM outcome_validations ORDER BY generated_at DESC',
      )
      .all<{ validation_id: string; validation_json: string }>();
    return result.results.flatMap((row) => {
      const outcome = parseStoredValueOrNull(
        FitnessOutcomeSchema,
        row.validation_json,
        'fitness outcome',
        row.validation_id,
      );
      return outcome ? [outcome] : [];
    });
  }

  async saveExecutionCallbackCredential(
    credential: ExecutionCallbackCredential,
  ) {
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO execution_callback_credentials (
            execution_id, nonce_hash, expires_at, created_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(execution_id) DO UPDATE SET
             nonce_hash = excluded.nonce_hash,
             expires_at = excluded.expires_at,
             created_at = excluded.created_at`,
        )
        .bind(
          credential.executionId,
          credential.nonceHash,
          credential.expiresAt,
          credential.createdAt,
        ),
      this.database
        .prepare(
          `DELETE FROM execution_callback_signatures WHERE execution_id = ?`,
        )
        .bind(credential.executionId),
    ]);
  }

  async getExecutionCallbackCredential(executionId: string) {
    const row = await this.database
      .prepare(
        `SELECT execution_id, nonce_hash, expires_at, created_at
         FROM execution_callback_credentials
         WHERE execution_id = ?`,
      )
      .bind(executionId)
      .first<{
        execution_id: string;
        nonce_hash: string;
        expires_at: string;
        created_at: string;
      }>();
    return row
      ? {
          executionId: row.execution_id,
          nonceHash: row.nonce_hash,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        }
      : null;
  }

  async consumeExecutionCallbackSignature(
    executionId: string,
    signature: string,
    usedAt: string,
  ) {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO execution_callback_signatures (
          execution_id, signature, used_at
         ) VALUES (?, ?, ?)`,
      )
      .bind(executionId, signature, usedAt)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async consumeTargetRequestSignature(signature: string, usedAt: string) {
    const expiresBefore = new Date(
      Date.parse(usedAt) - 10 * 60 * 1_000,
    ).toISOString();
    const results = await this.database.batch([
      this.database
        .prepare(`DELETE FROM target_request_signatures WHERE used_at < ?`)
        .bind(expiresBefore),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO target_request_signatures (signature, used_at)
           VALUES (?, ?)`,
        )
        .bind(signature, usedAt),
    ]);
    return (results[1]?.meta.changes ?? 0) === 1;
  }

  async incrementOperationalMetrics(
    increments: Partial<OperationalMetricCounts>,
    updatedAt: string,
  ) {
    const statements = operationalMetricNames.flatMap((name) => {
      const increment = increments[name] ?? 0;
      return increment > 0
        ? [
            this.database
              .prepare(
                `INSERT INTO operational_metrics (
                   metric_name, metric_value, updated_at
                 ) VALUES (?, ?, ?)
                 ON CONFLICT(metric_name) DO UPDATE SET
                   metric_value = metric_value + excluded.metric_value,
                   updated_at = excluded.updated_at`,
              )
              .bind(name, increment, updatedAt),
          ]
        : [];
    });
    if (statements.length) await this.database.batch(statements);
  }

  async getOperationalMetrics(): Promise<OperationalMetricsSnapshot> {
    const result = await this.database
      .prepare(
        `SELECT metric_name, metric_value, updated_at
         FROM operational_metrics`,
      )
      .all<{
        metric_name: OperationalMetricName;
        metric_value: number;
        updated_at: string;
      }>();
    const counts = emptyOperationalMetricCounts();
    let updatedAt: string | null = null;
    for (const row of result.results) {
      if (operationalMetricNames.includes(row.metric_name)) {
        counts[row.metric_name] = row.metric_value;
      }
      if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    return { updatedAt, counts };
  }

  async getEvolutionCycle() {
    const [stateResult, countResult] = await this.database.batch([
      this.database
        .prepare('SELECT state_json FROM demo_state WHERE state_key = ?')
        .bind('evolution-cycle'),
      this.database.prepare(
        `SELECT COUNT(*) AS released_count
         FROM repository_executions
         WHERE status = 'released'`,
      ),
    ]);
    const row = stateResult?.results[0] as { state_json: string } | undefined;
    const releasedCount = Number(
      (countResult?.results[0] as { released_count?: number } | undefined)
        ?.released_count ?? 0,
    );
    if (row) {
      const stored = parseStoredValue(
        EvolutionCycleSchema,
        row.state_json,
        'evolution cycle',
        'evolution-cycle',
      );
      return { ...stored, genomeEvolutionCount: releasedCount };
    }
    if (!releasedCount) return defaultEvolutionCycle();
    const latestRow = await this.database
      .prepare(
        `SELECT execution_id, execution_json, revision
         FROM repository_executions
         WHERE status = 'released'
         ORDER BY updated_at DESC, execution_id DESC
         LIMIT 1`,
      )
      .first<{
        execution_id: string;
        execution_json: string;
        revision: number;
      }>();
    if (!latestRow) return defaultEvolutionCycle();
    const latest = RepositoryMutationExecutionSchema.parse({
      ...parseStoredValue(
        RepositoryMutationExecutionSchema,
        latestRow.execution_json,
        'repository execution',
        latestRow.execution_id,
      ),
      revision: latestRow.revision,
    });
    return {
      studyId: baselineStudyId,
      startedAt: latest.updatedAt,
      genomeEvolutionCount: releasedCount,
      measuredCommit: latest.headSha ?? null,
      appVersion: latest.deploymentVerification?.expectedAppVersion ?? null,
      deploymentVerifiedAt: latest.deploymentVerification?.verifiedAt ?? null,
    };
  }

  async advanceEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ) {
    const current = await this.getEvolutionCycle();
    const countRow = await this.database
      .prepare(
        `SELECT COUNT(*) AS released_count
         FROM repository_executions
         WHERE status = 'released'`,
      )
      .first<{ released_count: number }>();
    const next: EvolutionCycle = {
      studyId: baselineStudyId,
      ...boundary,
      genomeEvolutionCount: Number(
        countRow?.released_count ?? current.genomeEvolutionCount,
      ),
    };
    await this.database
      .prepare(
        `INSERT INTO demo_state (state_key, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .bind('evolution-cycle', JSON.stringify(next), next.startedAt)
      .run();
    return next;
  }

  async resetEvolutionCycle(
    boundary: Pick<
      EvolutionCycle,
      'startedAt' | 'measuredCommit' | 'appVersion' | 'deploymentVerifiedAt'
    >,
  ) {
    const next: EvolutionCycle = {
      studyId: baselineStudyId,
      ...boundary,
      genomeEvolutionCount: 0,
    };
    await this.database
      .prepare(
        `INSERT INTO demo_state (state_key, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .bind('evolution-cycle', JSON.stringify(next), next.startedAt)
      .run();
    return next;
  }

  async getTargetConnection() {
    const row = await this.database
      .prepare(
        `SELECT connection_id, connection_json
         FROM target_connections
         ORDER BY connected_at DESC
         LIMIT 1`,
      )
      .first<{ connection_id: string; connection_json: string }>();
    if (!row) return null;
    return parseStoredValue(
      TargetApplicationConnectionSchema,
      row.connection_json,
      'target connection',
      row.connection_id,
    );
  }

  async saveTargetConnection(connection: TargetApplicationConnection) {
    await this.database.batch([
      this.database.prepare('DELETE FROM target_connections'),
      this.database
        .prepare(
          `INSERT INTO target_connections (
            connection_id, connected_at, connection_json
          ) VALUES (?, ?, ?)`,
        )
        .bind(
          connection.connectionId,
          connection.connectedAt,
          JSON.stringify(connection),
        ),
    ]);
  }

  async deleteTargetConnection() {
    await this.database.prepare('DELETE FROM target_connections').run();
  }

  async getRetentionHealth(
    policy: RetentionPolicy,
    now: string,
  ): Promise<RetentionHealth> {
    const [usage, expired, latestSweep] = await Promise.all([
      this.database
        .prepare(
          `SELECT
             COALESCE(SUM(study_event_count), 0) AS event_count,
             COUNT(*) AS study_count,
             COALESCE(MAX(study_event_count), 0) AS largest_study_event_count
           FROM (
             SELECT study_id, COUNT(*) AS study_event_count
             FROM telemetry_events
             GROUP BY study_id
           )`,
        )
        .first<{
          event_count: number;
          study_count: number;
          largest_study_event_count: number;
        }>(),
      this.database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM telemetry_events WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM participant_workspaces WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM analysis_runs WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM evidence_analyses WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM codex_manifests WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM codex_manifest_versions WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM outcome_validations WHERE expires_at <= ?) +
             (SELECT COUNT(*) FROM repository_executions
                WHERE record_expires_at <= ?
                   OR (artifact_expires_at IS NOT NULL AND artifact_expires_at <= ?)) +
             (SELECT COUNT(*) FROM execution_callback_credentials WHERE expires_at <= ?)
             AS expired_record_count`,
        )
        .bind(now, now, now, now, now, now, now, now, now, now)
        .first<{ expired_record_count: number }>(),
      this.database
        .prepare(
          `SELECT completed_at
           FROM retention_runs
           ORDER BY completed_at DESC
           LIMIT 1`,
        )
        .first<{ completed_at: string }>(),
    ]);
    const eventCount = usage?.event_count ?? 0;
    const largestStudyEventCount = usage?.largest_study_event_count ?? 0;
    const expiredRecordCount = expired?.expired_record_count ?? 0;
    return {
      status:
        expiredRecordCount > 0 ||
        eventCount >= policy.maxEventsPerTarget * 0.9 ||
        largestStudyEventCount >= policy.maxEventsPerStudy * 0.9
          ? 'attention'
          : 'healthy',
      policy,
      eventCount,
      studyCount: usage?.study_count ?? 0,
      largestStudyEventCount,
      expiredRecordCount,
      lastSweepAt: latestSweep?.completed_at ?? null,
    };
  }

  private async deleteDerivedStudyArtifacts(studyId: string) {
    const results = await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM execution_callback_signatures
           WHERE execution_id IN (
             SELECT execution_id FROM repository_executions
             WHERE study_id = ?
           )`,
        )
        .bind(studyId),
      this.database
        .prepare(
          `DELETE FROM execution_callback_credentials
           WHERE execution_id IN (
             SELECT execution_id FROM repository_executions
             WHERE study_id = ?
           )`,
        )
        .bind(studyId),
      this.database
        .prepare(
          `DELETE FROM repository_executions
           WHERE study_id = ?`,
        )
        .bind(studyId),
      this.database
        .prepare(
          `DELETE FROM codex_manifests
           WHERE study_id = ?`,
        )
        .bind(studyId),
      this.database
        .prepare(
          `DELETE FROM codex_manifest_versions
           WHERE study_id = ?`,
        )
        .bind(studyId),
      this.database
        .prepare(
          `DELETE FROM outcome_validations
           WHERE study_id = ? OR baseline_evidence_hash IN (
             SELECT evidence_hash FROM analysis_runs WHERE study_id = ?
           ) OR evolved_evidence_hash IN (
             SELECT evidence_hash FROM analysis_runs WHERE study_id = ?
           )`,
        )
        .bind(studyId, studyId, studyId),
      this.database
        .prepare('DELETE FROM evidence_analyses WHERE study_id = ?')
        .bind(studyId),
      this.database
        .prepare('DELETE FROM analysis_runs WHERE study_id = ?')
        .bind(studyId),
    ]);
    return addDeletedCounts(emptyDeletedCounts(), {
      callbackArtifacts:
        (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0),
      executions: results[2]?.meta.changes ?? 0,
      manifests:
        (results[3]?.meta.changes ?? 0) + (results[4]?.meta.changes ?? 0),
      validations: results[5]?.meta.changes ?? 0,
      analyses: results[6]?.meta.changes ?? 0,
      evidencePacks: results[7]?.meta.changes ?? 0,
    });
  }

  async deleteParticipant(studyId: string, participantId: string) {
    const derived = await this.deleteDerivedStudyArtifacts(studyId);
    const results = await this.database.batch([
      this.database
        .prepare(
          'DELETE FROM telemetry_events WHERE study_id = ? AND participant_id = ?',
        )
        .bind(studyId, participantId),
      this.database
        .prepare(
          'DELETE FROM participant_workspaces WHERE study_id = ? AND participant_id = ?',
        )
        .bind(studyId, participantId),
    ]);
    return addDeletedCounts(derived, {
      telemetryEvents: results[0]?.meta.changes ?? 0,
      workspaces: results[1]?.meta.changes ?? 0,
    });
  }

  async deleteStudy(studyId: string) {
    const derived = await this.deleteDerivedStudyArtifacts(studyId);
    const results = await this.database.batch([
      this.database
        .prepare('DELETE FROM telemetry_events WHERE study_id = ?')
        .bind(studyId),
      this.database
        .prepare('DELETE FROM participant_workspaces WHERE study_id = ?')
        .bind(studyId),
    ]);
    return addDeletedCounts(derived, {
      telemetryEvents: results[0]?.meta.changes ?? 0,
      workspaces: results[1]?.meta.changes ?? 0,
    });
  }

  async deleteExecutionArtifacts(executionId: string) {
    const results = await this.database.batch([
      this.database
        .prepare(
          'DELETE FROM execution_callback_signatures WHERE execution_id = ?',
        )
        .bind(executionId),
      this.database
        .prepare(
          'DELETE FROM execution_callback_credentials WHERE execution_id = ?',
        )
        .bind(executionId),
      this.database
        .prepare('DELETE FROM repository_executions WHERE execution_id = ?')
        .bind(executionId),
    ]);
    return addDeletedCounts(emptyDeletedCounts(), {
      callbackArtifacts:
        (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0),
      executions: results[2]?.meta.changes ?? 0,
    });
  }

  async runRetentionSweep(policy: RetentionPolicy, now: string) {
    const compactable = await this.database
      .prepare(
        `SELECT execution_id, execution_json
         FROM repository_executions
         WHERE artifact_expires_at IS NOT NULL
           AND artifact_expires_at <= ?
           AND record_expires_at > ?`,
      )
      .bind(now, now)
      .all<{ execution_id: string; execution_json: string }>();
    let compactedExecutions = 0;
    const compactionStatements = compactable.results.map((row) => {
      const execution = parseStoredValue(
        RepositoryMutationExecutionSchema,
        row.execution_json,
        'repository execution',
        row.execution_id,
      );
      if (executionHasLargeArtifacts(execution)) compactedExecutions += 1;
      return this.database
        .prepare(
          `UPDATE repository_executions
           SET execution_json = ?, artifact_expires_at = NULL
           WHERE execution_id = ?`,
        )
        .bind(JSON.stringify(compactExecution(execution)), row.execution_id);
    });
    if (compactionStatements.length) {
      await this.database.batch(compactionStatements);
    }

    const results = await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM execution_callback_signatures
           WHERE execution_id IN (
             SELECT execution_id FROM repository_executions
             WHERE record_expires_at <= ?
           ) OR execution_id IN (
             SELECT execution_id FROM execution_callback_credentials
             WHERE expires_at <= ?
           )`,
        )
        .bind(now, now),
      this.database
        .prepare(
          `DELETE FROM execution_callback_credentials
           WHERE expires_at <= ? OR execution_id IN (
             SELECT execution_id FROM repository_executions
             WHERE record_expires_at <= ?
           )`,
        )
        .bind(now, now),
      this.database
        .prepare(
          'DELETE FROM repository_executions WHERE record_expires_at <= ?',
        )
        .bind(now),
      this.database
        .prepare('DELETE FROM codex_manifests WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM codex_manifest_versions WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM evidence_analyses WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM analysis_runs WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM outcome_validations WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM participant_workspaces WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM telemetry_events WHERE expires_at <= ?')
        .bind(now),
      this.database
        .prepare('DELETE FROM retention_runs WHERE expires_at <= ?')
        .bind(now),
    ]);
    const deleted = addDeletedCounts(emptyDeletedCounts(), {
      callbackArtifacts:
        (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0),
      executions: results[2]?.meta.changes ?? 0,
      manifests:
        (results[3]?.meta.changes ?? 0) + (results[4]?.meta.changes ?? 0),
      analyses: results[5]?.meta.changes ?? 0,
      evidencePacks: results[6]?.meta.changes ?? 0,
      validations: results[7]?.meta.changes ?? 0,
      workspaces: results[8]?.meta.changes ?? 0,
      telemetryEvents: results[9]?.meta.changes ?? 0,
    });
    const result: RetentionSweepResult = {
      status: 'completed',
      policyVersion: policy.version,
      completedAt: now,
      compactedExecutions,
      deleted,
    };
    await this.database
      .prepare(
        `INSERT INTO retention_runs (
          run_id, policy_version, completed_at, expires_at, deleted_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        policy.version,
        now,
        expiresAt(now, policy.operationalAuditDays),
        JSON.stringify(result),
      )
      .run();
    return result;
  }

  async saveOperationalEvents(events: OperationalEvent[]) {
    await this.database.batch([
      ...events.map((event) =>
        this.database
          .prepare(
            `INSERT INTO operational_events (
               event_id, kind, request_id, occurred_at, actor, action, target,
               outcome, before_state, after_state, provider, operation,
               duration_ms, error_code, event_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.eventId,
            event.kind,
            event.requestId,
            event.occurredAt,
            event.actor,
            event.action,
            event.target,
            event.outcome,
            event.beforeState,
            event.afterState,
            event.provider,
            event.operation,
            event.durationMs,
            event.errorCode,
            JSON.stringify(event),
          ),
      ),
      this.database.prepare(
        `DELETE FROM operational_events
         WHERE datetime(occurred_at) < datetime('now', '-30 days')`,
      ),
    ]);
  }

  async listOperationalAuditEvents(limit: number) {
    const result = await this.database
      .prepare(
        `SELECT event_id, event_json
         FROM operational_events
         WHERE kind = 'audit'
           AND datetime(occurred_at) >= datetime('now', '-30 days')
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<{ event_id: string; event_json: string }>();
    return result.results.flatMap((row) => {
      const event = parseStoredValueOrNull(
        OperationalEventSchema,
        row.event_json,
        'operational event',
        row.event_id,
      );
      return event ? [event] : [];
    });
  }

  async summarizeOperationalMetrics(limit: number) {
    const result = await this.database
      .prepare(
        `SELECT provider, operation,
                COUNT(*) AS count,
                SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failure_count,
                ROUND(AVG(duration_ms)) AS average_duration_ms,
                MAX(duration_ms) AS maximum_duration_ms
         FROM operational_events
         WHERE kind = 'metric'
           AND datetime(occurred_at) >= datetime('now', '-30 days')
           AND provider IS NOT NULL
           AND operation IS NOT NULL
         GROUP BY provider, operation
         ORDER BY provider ASC, operation ASC
         LIMIT ?`,
      )
      .bind(limit)
      .all<{
        provider: OperationalMetricSummary['provider'];
        operation: string;
        count: number;
        failure_count: number;
        average_duration_ms: number;
        maximum_duration_ms: number;
      }>();
    return result.results.map((row) => ({
      provider: row.provider,
      operation: row.operation,
      count: row.count,
      failureCount: row.failure_count,
      averageDurationMs: row.average_duration_ms,
      maximumDurationMs: row.maximum_duration_ms,
    }));
  }

  private demoDataResetStatements(options?: {
    preserveResetExecutions?: boolean;
  }): D1PreparedStatement[] {
    const statements = [
      this.database.prepare('DELETE FROM telemetry_events'),
      this.database.prepare('DELETE FROM participant_workspaces'),
      this.database.prepare('DELETE FROM analysis_runs'),
      this.database.prepare('DELETE FROM evidence_analyses'),
      this.database.prepare('DELETE FROM codex_manifests'),
      this.database.prepare('DELETE FROM codex_manifest_versions'),
      this.database.prepare('DELETE FROM repository_executions'),
      this.database.prepare('DELETE FROM execution_callback_signatures'),
      this.database.prepare('DELETE FROM execution_callback_credentials'),
      this.database.prepare('DELETE FROM target_request_signatures'),
      this.database.prepare('DELETE FROM operational_metrics'),
      this.database.prepare('DELETE FROM outcome_validations'),
      this.database.prepare('DELETE FROM demo_state'),
      this.database.prepare('DELETE FROM retention_runs'),
      this.database.prepare('DELETE FROM operational_events'),
    ];
    if (!options?.preserveResetExecutions) {
      statements.push(this.database.prepare('DELETE FROM reset_executions'));
    }
    return statements;
  }

  async reset(options?: { preserveResetExecutions?: boolean }) {
    await this.database.batch(this.demoDataResetStatements(options));
  }

  async completeResetAtomically(input: AtomicDemoResetInput) {
    // Everything below is a single D1 batch, i.e. one real SQLite
    // transaction: the telemetry deletes, the lab deletes, the evolution
    // cycle boundary write, and the reset-execution CAS update all commit
    // together or not at all. If any statement fails, D1 rolls back the
    // entire batch, so the demo data and the reset_executions row are left
    // exactly as they were before this call — recoverable by retrying.
    const evolutionCycleStatement = this.database
      .prepare(
        `INSERT INTO demo_state (state_key, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        'evolution-cycle',
        JSON.stringify({
          studyId: baselineStudyId,
          ...input.evolutionBoundary,
          genomeEvolutionCount: 0,
        }),
        input.completed.updatedAt,
      );
    // The real compare-and-swap: this only matches (changes === 1) when the
    // row is still exactly where we last observed it. A second worker racing
    // the same reset, or a resumed/stale caller, gets 0 rows affected instead
    // of clobbering a newer transition.
    const casStatement = this.database
      .prepare(
        `UPDATE reset_executions
         SET status = ?, updated_at = ?, execution_json = ?, version = ?
         WHERE reset_id = ? AND status = ? AND version = ?`,
      )
      .bind(
        input.completed.status,
        input.completed.updatedAt,
        JSON.stringify(input.completed),
        input.completed.version,
        input.resetId,
        input.expectedStatus,
        input.expectedVersion,
      );
    const statements = [
      ...this.demoDataResetStatements({ preserveResetExecutions: true }),
      ...input.labRepository.resetStatements(),
      evolutionCycleStatement,
      casStatement,
    ];
    const results = await this.database.batch(statements);
    const cas = results[results.length - 1];
    return (cas?.meta.changes ?? 0) === 1 ? input.completed : null;
  }
}

const inMemoryRepository = new InMemoryTelemetryRepository();

export const getTelemetryRepository = (
  database?: D1Database,
  observe?: (metric: PersistenceOperationMetric) => void,
) => {
  const repository: TelemetryRepository = database
    ? new D1TelemetryRepository(database)
    : inMemoryRepository;
  if (!observe) return repository;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const startedAt = performance.now();
        try {
          const result = await value.apply(target, args);
          observe({
            operation: String(property),
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            outcome: 'success',
            errorCode: null,
          });
          return result;
        } catch (error) {
          observe({
            operation: String(property),
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            outcome: 'failure',
            errorCode: error instanceof Error ? error.name : 'UnknownError',
          });
          throw error;
        }
      };
    },
  });
};

export const resetInMemoryTelemetry = async () => {
  await inMemoryRepository.reset();
  await inMemoryRepository.deleteTargetConnection();
  operationalEventStore.clear();
};
