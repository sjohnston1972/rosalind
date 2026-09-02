import {
  CodexImplementationManifestSchema,
  DemoResetResponseSchema,
  EvidenceAnalysisSchema,
  EvidencePackSchema,
  FitnessOutcomeSchema,
  GenomeExecutionDetailResponseSchema,
  GenomeHistoryResponseSchema,
  ObservationArchiveDetailResponseSchema,
  ObservationArchivesResponseSchema,
  RepositoryMutationExecutionSchema,
  StudyEventsResponseSchema,
  StudyTelemetrySummarySchema,
  type CodexImplementationManifest,
  type DemoResetExecution,
  type EvidenceAnalysis,
  type EvidencePack,
  type EvolutionCycle,
  type FitnessOutcome,
  type ObservationArchive,
  type ObservationArchiveSummary,
  type RepositoryMutationExecution,
  type RepositoryExecutionSummary,
  type StoredTelemetryEvent,
  type StudyEventsResponse,
} from '@darwin/shared';
import { apiFetch } from '../api';
import { useEffect, useRef, useState } from 'react';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const studyId = 'projectflow-baseline-study';
const eventWindowLimit = 200;
const eventPollBaseMs = 2_000;
const eventPollMaximumMs = 30_000;
const executionPollBaseMs = 3_000;
const retryJitterMs = 500;

/**
 * Merge a freshly fetched first page of observation archives against
 * whatever is already loaded, instead of always replacing it outright.
 *
 * A plain refresh (manual "Refresh" click, or the demo-reset-complete
 * poll) only ever re-fetches page one. If the operator had paginated
 * further back with "Load older observation records" - which is exactly
 * how a rare evidence-class filter surfaces enough matching rows to be
 * useful - replacing the array wholesale silently discarded every older
 * page and reset pagination back to page one, undoing the filtered view.
 * When more is already loaded than the fresh page contains, keep the
 * older, still-valid rows appended after the fresh ones and leave the
 * existing cursor alone so "Load older" can keep going from there.
 */
export const mergeObservationArchivesPage = (
  current: ObservationArchiveSummary[],
  currentNextCursor: string | null,
  freshPage: ObservationArchiveSummary[],
  freshNextCursor: string | null,
): { archives: ObservationArchiveSummary[]; nextCursor: string | null } => {
  if (current.length <= freshPage.length) {
    return { archives: freshPage, nextCursor: freshNextCursor };
  }
  const freshIds = new Set(freshPage.map((archive) => archive.archiveId));
  return {
    archives: [
      ...freshPage,
      ...current.filter((archive) => !freshIds.has(archive.archiveId)),
    ],
    nextCursor: currentNextCursor,
  };
};

export interface LiveTelemetryOptions {
  canInspectEvidence?: boolean;
  eventPollingEnabled?: boolean;
  executionPollingEnabled?: boolean;
}

type EventWindowResponse = StudyEventsResponse & { sessionCount?: number };

export const shouldPollRepositoryExecution = (
  execution: Pick<RepositoryMutationExecution, 'status' | 'rollback'> | null,
) => {
  if (!execution) return false;
  const rollbackComplete =
    !execution.rollback ||
    ['failed', 'released'].includes(execution.rollback.status);
  return !(
    ['failed', 'released'].includes(execution.status) && rollbackComplete
  );
};

interface HydratedWorkflow {
  evidence: EvidencePack | null;
  analysis: EvidenceAnalysis | null;
  manifest: CodexImplementationManifest | null;
  execution: RepositoryMutationExecution | null;
}

const emptyWorkflow = (): HydratedWorkflow => ({
  evidence: null,
  analysis: null,
  manifest: null,
  execution: null,
});

const failureDetail = (error: unknown) =>
  error instanceof Error ? error.message : 'request failed';

const artifactDeepLink = (kind: 'fossil' | 'observation') => {
  if (typeof window === 'undefined') return null;
  const prefix = `#${kind}-`;
  if (!window.location.hash.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(window.location.hash.slice(prefix.length));
  } catch {
    return null;
  }
};

export interface LiveTelemetryState {
  behaviorSignalCount: number;
  canInspectEvidence: boolean;
  count: number;
  clearError: () => void;
  analysis: EvidenceAnalysis | null;
  analyseEvidence: () => Promise<void>;
  analysing: boolean;
  evidence: EvidencePack | null;
  evolutionCycle: EvolutionCycle;
  error: string | null;
  events: StoredTelemetryEvent[];
  genomeEvolutionCount: number;
  genomeExecutions: RepositoryExecutionSummary[];
  genomeNextCursor: string | null;
  loadGenomeExecution: (
    executionId: string,
  ) => Promise<RepositoryMutationExecution>;
  loadMoreGenome: () => Promise<void>;
  fitnessOutcomes: FitnessOutcome[];
  generateEvidence: () => Promise<void>;
  generating: boolean;
  manifest: CodexImplementationManifest | null;
  observationArchives: ObservationArchiveSummary[];
  observationArchivesNextCursor: string | null;
  loadObservationArchive: (archiveId: string) => Promise<ObservationArchive>;
  loadMoreObservationArchives: () => Promise<void>;
  execution: RepositoryMutationExecution | null;
  implementing: boolean;
  lastUpdatedAt: string | null;
  pollingState: 'fresh' | 'stale' | 'paused';
  preparingManifest: boolean;
  releasingExecution: boolean;
  releasingRollback: boolean;
  rollingBack: boolean;
  participantCount: number;
  sessionCount: number;
  resetState: () => void;
  resetEvolution: () => Promise<boolean>;
  resetExecution: DemoResetExecution | null;
  resetting: boolean;
  sessionCounts: Record<string, number>;
  startControlledEvolution: (
    mutationIds: string[],
  ) => Promise<RepositoryMutationExecution | null>;
  status: 'loading' | 'live' | 'offline';
  releaseExecution: (executionId?: string) => Promise<void>;
  releaseRollback: (executionId?: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshing: boolean;
  startRollback: (executionId?: string) => Promise<void>;
}

export function useLiveTelemetry({
  canInspectEvidence = true,
  eventPollingEnabled = true,
  executionPollingEnabled = true,
}: LiveTelemetryOptions = {}): LiveTelemetryState {
  const [events, setEvents] = useState<StoredTelemetryEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>(
    {},
  );
  const [sessionCount, setSessionCount] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [behaviorSignalCount, setBehaviorSignalCount] = useState(0);
  const [analysing, setAnalysing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [workflow, setWorkflow] = useState<HydratedWorkflow>(emptyWorkflow);
  const { analysis, evidence, execution, manifest } = workflow;
  const [preparingManifest, setPreparingManifest] = useState(false);
  const [genomeEvolutionCount, setGenomeEvolutionCount] = useState(0);
  const [evolutionCycle, setEvolutionCycle] = useState<EvolutionCycle>({
    studyId,
    startedAt: null,
    genomeEvolutionCount: 0,
    measuredCommit: null,
    appVersion: null,
    deploymentVerifiedAt: null,
  });
  const [genomeExecutions, setGenomeExecutions] = useState<
    RepositoryExecutionSummary[]
  >([]);
  const [fitnessOutcomes, setFitnessOutcomes] = useState<FitnessOutcome[]>([]);
  const [observationArchives, setObservationArchives] = useState<
    ObservationArchiveSummary[]
  >([]);
  const [genomeNextCursor, setGenomeNextCursor] = useState<string | null>(null);
  const [observationArchivesNextCursor, setObservationArchivesNextCursor] =
    useState<string | null>(null);
  const genomeDetailCache = useRef(
    new Map<string, RepositoryMutationExecution>(),
  );
  const genomeDetailSummaryCache = useRef(
    new Map<string, RepositoryExecutionSummary>(),
  );
  const observationArchiveDetailCache = useRef(
    new Map<string, ObservationArchive>(),
  );
  const observationArchiveDetailSummaryCache = useRef(
    new Map<string, ObservationArchiveSummary>(),
  );
  const pendingGenomeDetails = useRef(
    new Map<string, Promise<RepositoryMutationExecution>>(),
  );
  const pendingObservationArchiveDetails = useRef(
    new Map<string, Promise<ObservationArchive>>(),
  );
  const [implementing, setImplementing] = useState(false);
  const [releasingExecution, setReleasingExecution] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [releasingRollback, setReleasingRollback] = useState(false);
  const [resetExecution, setResetExecution] =
    useState<DemoResetExecution | null>(null);
  const [resetRequesting, setResetRequesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<LiveTelemetryState['status']>('loading');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [pollingState, setPollingState] =
    useState<LiveTelemetryState['pollingState']>('stale');
  const resetGeneration = useRef(0);
  const hydrationGeneration = useRef(0);
  const eventCursor = useRef<string | null>(null);

  const loadGenome = async () => {
    const response = await apiFetch(`${apiBaseUrl}/api/genome?limit=10`);
    if (!response.ok) throw new Error(`request returned ${response.status}`);
    return GenomeHistoryResponseSchema.parse(await response.json());
  };

  const applyEventResponse = (
    result: EventWindowResponse,
    incremental: boolean,
  ) => {
    setEvents((current) => {
      if (!incremental) return result.events;
      const known = new Set(current.map((event) => event.eventId));
      return [
        ...current,
        ...result.events.filter((event) => !known.has(event.eventId)),
      ].slice(-eventWindowLimit);
    });
    eventCursor.current = result.cursor;
    setCount(result.count);
    setSessionCounts(result.sessionCounts);
    setSessionCount(
      result.sessionCount ?? Object.keys(result.sessionCounts).length,
    );
    setParticipantCount(result.participantCount);
    setBehaviorSignalCount(result.behaviorSignalCount);
    setLastUpdatedAt(new Date().toISOString());
    setPollingState('fresh');
    setStatus('live');
  };

  const refreshGenome = async () => {
    const history = await loadGenome();
    setEvolutionCycle(history.evolutionCycle);
    setGenomeEvolutionCount(history.evolutionCycle.genomeEvolutionCount);
    setGenomeExecutions(history.executions);
    setFitnessOutcomes(history.fitnessOutcomes);
    setGenomeNextCursor(history.page.nextCursor);
    const deepLinkedId = artifactDeepLink('fossil');
    if (
      deepLinkedId &&
      !history.executions.some(
        (execution) => execution.executionId === deepLinkedId,
      )
    ) {
      await loadGenomeExecution(deepLinkedId);
    }
  };

  const loadObservationArchives = async () => {
    const response = await apiFetch(
      `${apiBaseUrl}/api/observations/archives?limit=10`,
    );
    if (!response.ok) throw new Error(`request returned ${response.status}`);
    return ObservationArchivesResponseSchema.parse(await response.json());
  };

  const refreshObservationArchives = async () => {
    const result = await loadObservationArchives();
    const merged = mergeObservationArchivesPage(
      observationArchives,
      observationArchivesNextCursor,
      result.archives,
      result.page.nextCursor,
    );
    setObservationArchives(merged.archives);
    setObservationArchivesNextCursor(merged.nextCursor);
    const deepLinkedId = artifactDeepLink('observation');
    if (
      deepLinkedId &&
      !merged.archives.some((archive) => archive.archiveId === deepLinkedId)
    ) {
      await loadObservationArchive(deepLinkedId);
    }
  };

  const loadMoreGenome = async () => {
    if (!genomeNextCursor) return;
    const response = await apiFetch(
      `${apiBaseUrl}/api/genome?limit=10&cursor=${encodeURIComponent(genomeNextCursor)}`,
    );
    if (!response.ok) throw new Error('Genome page request failed.');
    const history = GenomeHistoryResponseSchema.parse(await response.json());
    setGenomeExecutions((current) => {
      const known = new Set(current.map((item) => item.executionId));
      return [
        ...current,
        ...history.executions.filter((item) => !known.has(item.executionId)),
      ];
    });
    setGenomeNextCursor(history.page.nextCursor);
  };

  const loadMoreObservationArchives = async () => {
    if (!observationArchivesNextCursor) return;
    const response = await apiFetch(
      `${apiBaseUrl}/api/observations/archives?limit=10&cursor=${encodeURIComponent(observationArchivesNextCursor)}`,
    );
    if (!response.ok)
      throw new Error('Observation archive page request failed.');
    const result = ObservationArchivesResponseSchema.parse(
      await response.json(),
    );
    setObservationArchives((current) => {
      const known = new Set(current.map((item) => item.archiveId));
      return [
        ...current,
        ...result.archives.filter((item) => !known.has(item.archiveId)),
      ];
    });
    setObservationArchivesNextCursor(result.page.nextCursor);
  };

  const loadGenomeExecution = async (executionId: string) => {
    const cached = genomeDetailCache.current.get(executionId);
    const cachedSummary = genomeDetailSummaryCache.current.get(executionId);
    if (cached && cachedSummary) {
      setGenomeExecutions((current) =>
        current.some((item) => item.executionId === executionId)
          ? current
          : [cachedSummary, ...current],
      );
      return cached;
    }
    const pending = pendingGenomeDetails.current.get(executionId);
    if (pending) return pending;
    const request = (async () => {
      const response = await apiFetch(
        `${apiBaseUrl}/api/genome/${encodeURIComponent(executionId)}`,
      );
      if (!response.ok) throw new Error('Genome artifact request failed.');
      const result = GenomeExecutionDetailResponseSchema.parse(
        await response.json(),
      );
      genomeDetailCache.current.set(executionId, result.execution);
      genomeDetailSummaryCache.current.set(executionId, result.summary);
      setGenomeExecutions((current) =>
        current.some((item) => item.executionId === executionId)
          ? current
          : [result.summary, ...current],
      );
      return result.execution;
    })().finally(() => pendingGenomeDetails.current.delete(executionId));
    pendingGenomeDetails.current.set(executionId, request);
    return request;
  };

  const loadObservationArchive = async (archiveId: string) => {
    const cached = observationArchiveDetailCache.current.get(archiveId);
    const cachedSummary =
      observationArchiveDetailSummaryCache.current.get(archiveId);
    if (cached && cachedSummary) {
      setObservationArchives((current) =>
        current.some((item) => item.archiveId === archiveId)
          ? current
          : [cachedSummary, ...current],
      );
      return cached;
    }
    const pending = pendingObservationArchiveDetails.current.get(archiveId);
    if (pending) return pending;
    const request = (async () => {
      const response = await apiFetch(
        `${apiBaseUrl}/api/observations/archives/${encodeURIComponent(archiveId)}`,
      );
      if (!response.ok) throw new Error('Observation archive request failed.');
      const result = ObservationArchiveDetailResponseSchema.parse(
        await response.json(),
      );
      observationArchiveDetailCache.current.set(archiveId, result.archive);
      observationArchiveDetailSummaryCache.current.set(
        archiveId,
        result.summary,
      );
      setObservationArchives((current) =>
        current.some((item) => item.archiveId === archiveId)
          ? current
          : [result.summary, ...current],
      );
      return result.archive;
    })().finally(() =>
      pendingObservationArchiveDetails.current.delete(archiveId),
    );
    pendingObservationArchiveDetails.current.set(archiveId, request);
    return request;
  };

  const loadEventWindow = async (cursor: string | null = null) => {
    if (!canInspectEvidence) {
      const summaryResponse = await apiFetch(
        `${apiBaseUrl}/api/studies/${studyId}/events`,
      );
      if (!summaryResponse.ok) {
        throw new Error(`request returned ${summaryResponse.status}`);
      }
      const summary = StudyTelemetrySummarySchema.parse(
        await summaryResponse.json(),
      );
      return {
        ...summary,
        events: [] as StoredTelemetryEvent[],
        sessionCounts: {} as Record<string, number>,
        cursor: null,
        hasMore: false,
      };
    }
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const traceResponse = await apiFetch(
      `${apiBaseUrl}/api/studies/${studyId}/events/raw?limit=${eventWindowLimit}${cursorQuery}`,
    );
    if (!traceResponse.ok) {
      throw new Error(`request returned ${traceResponse.status}`);
    }
    return StudyEventsResponseSchema.parse(await traceResponse.json());
  };

  const loadWorkflow = async (): Promise<{
    workflow: HydratedWorkflow;
    failures: string[];
  }> => {
    const workflow = emptyWorkflow();
    const failures: string[] = [];
    let evidenceResponse: Response;
    try {
      evidenceResponse = await apiFetch(
        `${apiBaseUrl}/api/studies/${studyId}/evidence/latest?optional=true`,
      );
      if (evidenceResponse.status === 204) return { workflow, failures };
      if (!evidenceResponse.ok) {
        throw new Error(`request returned ${evidenceResponse.status}`);
      }
      workflow.evidence = EvidencePackSchema.parse(
        await evidenceResponse.json(),
      );
    } catch (error) {
      failures.push(`Evidence: ${failureDetail(error)}`);
      return { workflow, failures };
    }

    let analysisResponse: Response;
    try {
      analysisResponse = await apiFetch(
        `${apiBaseUrl}/api/studies/${studyId}/evidence-analysis/latest?optional=true`,
      );
      if (analysisResponse.status === 204) return { workflow, failures };
      if (!analysisResponse.ok) {
        throw new Error(`request returned ${analysisResponse.status}`);
      }
      const latestAnalysis = EvidenceAnalysisSchema.parse(
        await analysisResponse.json(),
      );
      if (
        latestAnalysis.evidenceId !== workflow.evidence.evidenceId ||
        latestAnalysis.evidenceHash !== workflow.evidence.evidenceHash
      ) {
        failures.push('Analysis: latest result does not match latest evidence');
        return { workflow, failures };
      }
      workflow.analysis = latestAnalysis;
    } catch (error) {
      failures.push(`Analysis: ${failureDetail(error)}`);
      return { workflow, failures };
    }

    try {
      const manifestResponse = await apiFetch(
        `${apiBaseUrl}/api/evidence-analyses/${workflow.analysis.analysisId}/codex-manifest`,
      );
      if (manifestResponse.status === 404) return { workflow, failures };
      if (!manifestResponse.ok) {
        throw new Error(`request returned ${manifestResponse.status}`);
      }
      const latestManifest = CodexImplementationManifestSchema.parse(
        await manifestResponse.json(),
      );
      if (
        latestManifest.analysisId !== workflow.analysis.analysisId ||
        latestManifest.evidenceHash !== workflow.evidence.evidenceHash
      ) {
        failures.push('Manifest: result does not match the active analysis');
        return { workflow, failures };
      }
      workflow.manifest = latestManifest;
    } catch (error) {
      failures.push(`Manifest: ${failureDetail(error)}`);
      return { workflow, failures };
    }

    try {
      const executionResponse = await apiFetch(
        `${apiBaseUrl}/api/evidence-analyses/${workflow.analysis.analysisId}/codex-manifest/execution`,
      );
      if (executionResponse.status === 204) return { workflow, failures };
      if (!executionResponse.ok) {
        throw new Error(`request returned ${executionResponse.status}`);
      }
      const latestExecution = RepositoryMutationExecutionSchema.parse(
        await executionResponse.json(),
      );
      if (
        latestExecution.analysisId !== workflow.analysis.analysisId ||
        latestExecution.manifestId !== workflow.manifest.manifestId
      ) {
        failures.push('Execution: result does not match the active manifest');
        return { workflow, failures };
      }
      workflow.execution = latestExecution;
    } catch (error) {
      failures.push(`Execution: ${failureDetail(error)}`);
    }
    return { workflow, failures };
  };

  const resetCurrentCycleMeasurements = () => {
    resetGeneration.current += 1;
    eventCursor.current = null;
    setEvents([]);
    setCount(0);
    setSessionCounts({});
    setSessionCount(0);
    setParticipantCount(0);
    setBehaviorSignalCount(0);
    setWorkflow(emptyWorkflow());
    setLastUpdatedAt(null);
    setPollingState(
      eventPollingEnabled && document.visibilityState === 'visible'
        ? 'stale'
        : 'paused',
    );
  };

  const hydrate = async (manual = false, includeEvents = true) => {
    const hydration = ++hydrationGeneration.current;
    const reset = resetGeneration.current;
    if (manual) setRefreshing(true);
    setError(null);
    const eventRequest = includeEvents
      ? loadEventWindow()
      : Promise.resolve(null);
    const workflowRequest = canInspectEvidence
      ? loadWorkflow()
      : Promise.resolve({ workflow: emptyWorkflow(), failures: [] });
    const genomeRequest = canInspectEvidence
      ? loadGenome()
      : Promise.resolve(null);
    const archiveRequest = canInspectEvidence
      ? loadObservationArchives()
      : Promise.resolve(null);
    const [eventResult, workflowResult, genomeResult, archiveResult] =
      await Promise.allSettled([
        eventRequest,
        workflowRequest,
        genomeRequest,
        archiveRequest,
      ] as const);
    if (
      hydration !== hydrationGeneration.current ||
      reset !== resetGeneration.current
    ) {
      if (manual) setRefreshing(false);
      return;
    }

    const failures: string[] = [];
    if (eventResult.status === 'fulfilled' && eventResult.value) {
      applyEventResponse(eventResult.value, false);
    } else {
      if (eventResult.status === 'rejected') {
        failures.push(`Events: ${failureDetail(eventResult.reason)}`);
        setStatus('offline');
        setPollingState('stale');
      }
    }

    if (workflowResult.status === 'fulfilled') {
      const next = workflowResult.value.workflow;
      setWorkflow(next);
      failures.push(...workflowResult.value.failures);
    } else {
      setWorkflow(emptyWorkflow());
      failures.push(`Evidence: ${failureDetail(workflowResult.reason)}`);
    }

    if (genomeResult.status === 'fulfilled' && genomeResult.value) {
      setGenomeEvolutionCount(
        genomeResult.value.evolutionCycle.genomeEvolutionCount,
      );
      setGenomeExecutions(genomeResult.value.executions);
      setGenomeNextCursor(genomeResult.value.page.nextCursor);
      const deepLinkedId = artifactDeepLink('fossil');
      if (
        deepLinkedId &&
        !genomeResult.value.executions.some(
          (execution) => execution.executionId === deepLinkedId,
        )
      ) {
        try {
          await loadGenomeExecution(deepLinkedId);
        } catch (reason) {
          failures.push(`Genome detail: ${failureDetail(reason)}`);
        }
      }
    } else if (genomeResult.status === 'rejected') {
      failures.push(`Genome: ${failureDetail(genomeResult.reason)}`);
    }

    if (archiveResult.status === 'fulfilled' && archiveResult.value) {
      const merged = mergeObservationArchivesPage(
        observationArchives,
        observationArchivesNextCursor,
        archiveResult.value.archives,
        archiveResult.value.page.nextCursor,
      );
      setObservationArchives(merged.archives);
      setObservationArchivesNextCursor(merged.nextCursor);
      const deepLinkedId = artifactDeepLink('observation');
      if (
        deepLinkedId &&
        !merged.archives.some((archive) => archive.archiveId === deepLinkedId)
      ) {
        try {
          await loadObservationArchive(deepLinkedId);
        } catch (reason) {
          failures.push(`Archive detail: ${failureDetail(reason)}`);
        }
      }
    } else if (archiveResult.status === 'rejected') {
      failures.push(`Archives: ${failureDetail(archiveResult.reason)}`);
    }

    setError(
      failures.length
        ? `Live refresh incomplete · ${failures.join(' · ')}`
        : null,
    );
    if (manual) setRefreshing(false);
  };

  const refresh = () => hydrate(true);

  useEffect(() => {
    let active = true;
    void hydrate(false, false);
    void apiFetch(`${apiBaseUrl}/api/demo/reset`)
      .then(async (response) => {
        if (response.status === 204 || !response.ok) return;
        const latest = DemoResetResponseSchema.parse(await response.json());
        if (active) setResetExecution(latest);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      hydrationGeneration.current += 1;
    };
  }, [canInspectEvidence]);

  useEffect(() => {
    let active = true;
    let timeout: number | null = null;
    let emptyPollCount = 0;
    let failureCount = 0;

    const clearScheduled = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    const schedule = (delayMs: number) => {
      clearScheduled();
      if (!active || !eventPollingEnabled) return;
      timeout = window.setTimeout(() => void poll(), delayMs);
    };
    const poll = async () => {
      if (
        !active ||
        !eventPollingEnabled ||
        document.visibilityState !== 'visible'
      ) {
        setPollingState('paused');
        return;
      }
      const generation = resetGeneration.current;
      const cursor = eventCursor.current;
      try {
        const result = await loadEventWindow(cursor);
        if (!active) return;
        if (generation !== resetGeneration.current) {
          schedule(0);
          return;
        }
        applyEventResponse(result, cursor !== null);
        failureCount = 0;
        emptyPollCount = result.events.length
          ? 0
          : Math.min(emptyPollCount + 1, 4);
        schedule(
          result.hasMore
            ? 50
            : Math.min(
                eventPollMaximumMs,
                eventPollBaseMs * 2 ** emptyPollCount,
              ),
        );
      } catch {
        if (!active) return;
        if (generation !== resetGeneration.current) {
          schedule(0);
          return;
        }
        failureCount = Math.min(failureCount + 1, 5);
        setStatus('offline');
        setPollingState('stale');
        schedule(
          Math.min(
            eventPollMaximumMs,
            eventPollBaseMs * 2 ** (failureCount - 1),
          ) + Math.round(Math.random() * retryJitterMs),
        );
      }
    };
    const handleVisibility = () => {
      clearScheduled();
      if (document.visibilityState === 'visible') {
        void poll();
      } else {
        setPollingState('paused');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    if (eventPollingEnabled && document.visibilityState === 'visible') {
      void poll();
    } else {
      setPollingState('paused');
    }
    return () => {
      active = false;
      clearScheduled();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canInspectEvidence, eventPollingEnabled]);

  useEffect(() => {
    if (
      !resetExecution ||
      ['complete', 'failed'].includes(resetExecution.status)
    ) {
      return;
    }
    let active = true;
    const priorStatus = resetExecution.status;
    const poll = async () => {
      try {
        const response = await apiFetch(`${apiBaseUrl}/api/demo/reset`);
        if (!response.ok) return;
        const latest = DemoResetResponseSchema.parse(await response.json());
        if (!active) return;
        if (latest.status === 'complete' && priorStatus !== 'complete') {
          resetState();
          setResetExecution(latest);
          await Promise.all([refreshGenome(), refreshObservationArchives()]);
          return;
        }
        setResetExecution(latest);
      } catch {
        // Broad API availability remains visible through the telemetry poll.
      }
    };
    const interval = window.setInterval(() => void poll(), 3_000);
    void poll();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [resetExecution?.resetId, resetExecution?.status]);

  useEffect(() => {
    if (
      !execution ||
      !executionPollingEnabled ||
      !shouldPollRepositoryExecution(execution)
    ) {
      return;
    }
    let active = true;
    let timeout: number | null = null;
    let failureCount = 0;
    const clearScheduled = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    const schedule = (delayMs: number) => {
      clearScheduled();
      if (!active) return;
      timeout = window.setTimeout(() => void poll(), delayMs);
    };
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await apiFetch(
          `${apiBaseUrl}/api/repository-executions/${execution.executionId}`,
        );
        if (!response.ok) return;
        const latest = RepositoryMutationExecutionSchema.parse(
          await response.json(),
        );
        if (!active) return;
        setWorkflow((current) => ({ ...current, execution: latest }));
        genomeDetailCache.current.set(latest.executionId, latest);
        failureCount = 0;
        if (shouldPollRepositoryExecution(latest)) {
          schedule(executionPollBaseMs);
        }
      } catch {
        if (!active) return;
        failureCount = Math.min(failureCount + 1, 5);
        schedule(
          Math.min(
            eventPollMaximumMs,
            executionPollBaseMs * 2 ** (failureCount - 1),
          ) + Math.round(Math.random() * retryJitterMs),
        );
      }
    };
    const handleVisibility = () => {
      clearScheduled();
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    if (document.visibilityState === 'visible') void poll();
    return () => {
      active = false;
      clearScheduled();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    execution?.executionId,
    execution?.status,
    execution?.rollback?.status,
    executionPollingEnabled,
  ]);

  const generateEvidence = async () => {
    setGenerating(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/studies/${studyId}/evidence`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Evidence generation failed.');
      }
      const nextEvidence = EvidencePackSchema.parse(payload);
      setWorkflow({
        evidence: nextEvidence,
        analysis: null,
        manifest: null,
        execution: null,
      });
      const retainedExecution = genomeExecutions.find(
        (item) =>
          item.status === 'released' && item.rollback?.status !== 'released',
      );
      if (retainedExecution) {
        const fitnessResponse = await apiFetch(
          `${apiBaseUrl}/api/repository-executions/${retainedExecution.executionId}/fitness`,
          { method: 'POST' },
        );
        if (fitnessResponse.ok) {
          const outcome = FitnessOutcomeSchema.parse(
            await fitnessResponse.json(),
          );
          setFitnessOutcomes((current) => [
            outcome,
            ...current.filter(
              (item) => item.executionId !== outcome.executionId,
            ),
          ]);
        }
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Evidence generation failed. Check the API and retry.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const analyseEvidence = async () => {
    setAnalysing(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/studies/${studyId}/analyse-evidence`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Live evidence analysis failed.');
      }
      setWorkflow((current) => ({
        ...current,
        analysis: EvidenceAnalysisSchema.parse(payload),
        manifest: null,
        execution: null,
      }));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Live reasoning failed. No recommendation was generated.',
      );
    } finally {
      setAnalysing(false);
    }
  };

  const startControlledEvolution = async (mutationIds: string[]) => {
    if (!analysis) return null;
    setPreparingManifest(true);
    setError(null);
    try {
      const manifestResponse = await apiFetch(
        `${apiBaseUrl}/api/evidence-analyses/${analysis.analysisId}/codex-manifest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutationIds }),
        },
      );
      const manifestPayload = (await manifestResponse.json()) as {
        message?: string;
      };
      if (!manifestResponse.ok) {
        throw new Error(
          manifestPayload.message ?? 'Codex manifest generation failed.',
        );
      }
      setWorkflow((current) => ({
        ...current,
        manifest: CodexImplementationManifestSchema.parse(manifestPayload),
      }));
      setPreparingManifest(false);
      setImplementing(true);

      const executionResponse = await apiFetch(
        `${apiBaseUrl}/api/evidence-analyses/${analysis.analysisId}/codex-manifest/execution`,
        { method: 'POST' },
      );
      const executionPayload = (await executionResponse.json()) as {
        message?: string;
      };
      const parsedExecution =
        RepositoryMutationExecutionSchema.safeParse(executionPayload);
      if (parsedExecution.success) {
        setWorkflow((current) => ({
          ...current,
          execution: parsedExecution.data,
        }));
      }
      if (!executionResponse.ok) {
        throw new Error(
          parsedExecution.success
            ? (parsedExecution.data.error ?? 'Repository execution failed.')
            : (executionPayload.message ?? 'Controlled implementation failed.'),
        );
      }
      if (!parsedExecution.success) {
        throw new Error('Repository execution returned an invalid payload.');
      }
      return parsedExecution.data;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Controlled evolution failed. Retry the handoff.',
      );
      return null;
    } finally {
      setPreparingManifest(false);
      setImplementing(false);
    }
  };

  const releaseExecution = async (executionId?: string) => {
    const targetExecutionId = executionId ?? execution?.executionId;
    if (!targetExecutionId) return;
    setReleasingExecution(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/repository-executions/${targetExecutionId}/release`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { message?: string };
      const parsedExecution =
        RepositoryMutationExecutionSchema.safeParse(payload);
      if (parsedExecution.success) {
        setWorkflow((current) => ({
          ...current,
          execution: parsedExecution.data,
        }));
        genomeDetailCache.current.set(
          parsedExecution.data.executionId,
          parsedExecution.data,
        );
        if (parsedExecution.data.status === 'released') {
          resetCurrentCycleMeasurements();
          await refreshGenome();
          await refreshObservationArchives();
        }
      }
      if (!response.ok) {
        throw new Error(
          parsedExecution.success
            ? (parsedExecution.data.error ?? 'Mutation release failed.')
            : (payload.message ?? 'Mutation release failed.'),
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Mutation release failed.',
      );
    } finally {
      setReleasingExecution(false);
    }
  };

  const startRollback = async (executionId?: string) => {
    const targetExecutionId = executionId ?? execution?.executionId;
    if (!targetExecutionId) return;
    setRollingBack(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/repository-executions/${targetExecutionId}/rollback`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { message?: string };
      const parsedExecution =
        RepositoryMutationExecutionSchema.safeParse(payload);
      if (parsedExecution.success) {
        setWorkflow((current) => ({
          ...current,
          execution: parsedExecution.data,
        }));
        genomeDetailCache.current.set(
          parsedExecution.data.executionId,
          parsedExecution.data,
        );
        await refreshGenome();
      }
      if (!response.ok) {
        throw new Error(
          parsedExecution.success
            ? (parsedExecution.data.rollback?.error ??
                'Rollback preparation failed.')
            : (payload.message ?? 'Rollback preparation failed.'),
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Rollback preparation failed.',
      );
    } finally {
      setRollingBack(false);
    }
  };

  const releaseRollback = async (executionId?: string) => {
    const targetExecutionId = executionId ?? execution?.executionId;
    if (!targetExecutionId) return;
    setReleasingRollback(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/repository-executions/${targetExecutionId}/rollback/release`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { message?: string };
      const parsedExecution =
        RepositoryMutationExecutionSchema.safeParse(payload);
      if (parsedExecution.success) {
        setWorkflow((current) => ({
          ...current,
          execution: parsedExecution.data,
        }));
        genomeDetailCache.current.set(
          parsedExecution.data.executionId,
          parsedExecution.data,
        );
        await refreshGenome();
      }
      if (!response.ok) {
        throw new Error(
          parsedExecution.success
            ? (parsedExecution.data.rollback?.error ??
                'Rollback release failed.')
            : (payload.message ?? 'Rollback release failed.'),
        );
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Rollback release failed.',
      );
    } finally {
      setReleasingRollback(false);
    }
  };

  const resetState = () => {
    resetGeneration.current += 1;
    eventCursor.current = null;
    setEvents([]);
    setCount(0);
    setSessionCounts({});
    setSessionCount(0);
    setParticipantCount(0);
    setBehaviorSignalCount(0);
    setWorkflow(emptyWorkflow());
    setGenomeEvolutionCount(0);
    setEvolutionCycle({
      studyId,
      startedAt: null,
      genomeEvolutionCount: 0,
      measuredCommit: null,
      appVersion: null,
      deploymentVerifiedAt: null,
    });
    setGenomeExecutions([]);
    setFitnessOutcomes([]);
    setObservationArchives([]);
    setGenomeNextCursor(null);
    setObservationArchivesNextCursor(null);
    genomeDetailCache.current.clear();
    genomeDetailSummaryCache.current.clear();
    observationArchiveDetailCache.current.clear();
    observationArchiveDetailSummaryCache.current.clear();
    pendingGenomeDetails.current.clear();
    pendingObservationArchiveDetails.current.clear();
    setLastUpdatedAt(null);
    setPollingState(
      eventPollingEnabled && document.visibilityState === 'visible'
        ? 'stale'
        : 'paused',
    );
    setError(null);
    setGenerating(false);
    setAnalysing(false);
    setPreparingManifest(false);
    setImplementing(false);
    setReleasingExecution(false);
    setRollingBack(false);
    setReleasingRollback(false);
    setStatus('live');
  };

  const resetEvolution = async () => {
    setResetRequesting(true);
    setError(null);
    try {
      const response = await apiFetch(`${apiBaseUrl}/api/demo/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: 'RESET DARWIN DEMO',
          exportAcknowledged: true,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      const parsed = DemoResetResponseSchema.safeParse(payload);
      if (parsed.success) setResetExecution(parsed.data);
      if (!response.ok) {
        throw new Error(
          parsed.success
            ? (parsed.data.error ?? 'Evolution reset failed.')
            : (payload.message ?? 'Evolution reset failed.'),
        );
      }
      if (!parsed.success) {
        throw new Error('Reset returned an invalid execution record.');
      }
      if (parsed.data.status === 'complete') {
        resetState();
        setResetExecution(parsed.data);
      }
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Evolution reset failed.',
      );
      return false;
    } finally {
      setResetRequesting(false);
    }
  };

  return {
    analysis,
    analyseEvidence,
    analysing,
    behaviorSignalCount,
    canInspectEvidence,
    clearError: () => setError(null),
    count,
    evidence,
    evolutionCycle,
    error,
    events,
    execution,
    fitnessOutcomes,
    generateEvidence,
    generating,
    genomeEvolutionCount,
    genomeExecutions,
    genomeNextCursor,
    implementing,
    lastUpdatedAt,
    manifest,
    loadGenomeExecution,
    loadMoreGenome,
    loadMoreObservationArchives,
    loadObservationArchive,
    observationArchives,
    observationArchivesNextCursor,
    participantCount,
    preparingManifest,
    pollingState,
    releaseExecution,
    releasingExecution,
    releaseRollback,
    releasingRollback,
    refresh,
    refreshing,
    resetEvolution,
    resetExecution,
    resetting:
      resetRequesting ||
      Boolean(
        resetExecution &&
        !['complete', 'failed'].includes(resetExecution.status),
      ),
    resetState,
    sessionCount,
    sessionCounts,
    startControlledEvolution,
    startRollback,
    status,
    rollingBack,
  };
}
