import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mergeObservationArchivesPage,
  shouldPollRepositoryExecution,
  useLiveTelemetry,
} from './useLiveTelemetry';
import type { ObservationArchiveSummary } from '@darwin/shared';

const timestamp = '2026-07-18T10:00:00.000Z';
const event = {
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000001',
  sessionId: 'session-poll-test',
  participantId: 'participant-poll-test',
  studyId: 'projectflow-baseline-study',
  appVersion: '1.0.0',
  source: 'real_user',
  occurredAt: timestamp,
  sequence: 0,
  route: '/study/dashboard',
  viewport: 'desktop',
  eventType: 'page_view',
  receivedAt: timestamp,
} as const;

const eventResponse = (
  events: unknown[],
  cursor: string | null,
  count = events.length,
) => ({
  studyId: 'projectflow-baseline-study',
  events,
  cursor,
  hasMore: false,
  count,
  sessionCounts: count ? { 'session-poll-test': count } : {},
  participantCount: count ? 1 : 0,
  behaviorSignalCount: 0,
});

const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });

const installApi = (
  events: (call: number, url: string) => Promise<Response> | Response,
) => {
  let eventCalls = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/events/raw?limit=200')) {
      eventCalls += 1;
      return events(eventCalls, url);
    }
    if (url.includes('/api/genome?')) {
      return response({
        evolutionCycle: {
          studyId: 'projectflow-baseline-study',
          startedAt: null,
          genomeEvolutionCount: 0,
        },
        executions: [],
        page: { nextCursor: null },
      });
    }
    if (url.includes('/api/observations/archives?')) {
      return response({ archives: [], page: { nextCursor: null } });
    }
    if (url.includes('/evidence/latest')) return response(null, 204);
    return response(null, 204);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    eventCallCount: () => eventCalls,
    fetchMock,
  };
};

const archiveSummary = (archiveId: string): ObservationArchiveSummary => ({
  archiveId,
  evidence: {
    evidenceId: `evidence-${archiveId}`,
    evidenceHash: '1'.repeat(64),
    generatedAt: timestamp,
    evidenceClass: 'measured',
    study: {
      studyId: 'projectflow-baseline-study',
      appVersion: '1.0.0',
      measuredCommit: null,
      deploymentVerifiedAt: null,
      sourceEventCount: 0,
      participants: 3,
      sessions: 3,
      attempts: 3,
    },
    quality: { strength: 'substantial', score: 90 },
    signalCount: 0,
    fitness: {
      terminalAttemptCount: 0,
      completedAttemptCount: 0,
      medianInteractions: null,
    },
  },
  analysis: {
    analysisId: `analysis-${archiveId}`,
    model: 'gpt-test',
    createdAt: timestamp,
    selectedMutation: { id: 'mutation-1', title: 'Mutation' },
  },
  execution: {
    executionId: archiveId,
    manifestId: `manifest-${archiveId}`,
    status: 'released',
    createdAt: timestamp,
    completedAt: timestamp,
  },
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setVisibility = (visibility: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibility,
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setVisibility('visible');
});

describe('visibility-aware live telemetry', () => {
  it('polls repository executions only while work remains non-terminal', () => {
    expect(shouldPollRepositoryExecution(null)).toBe(false);
    expect(
      shouldPollRepositoryExecution({
        status: 'preview_ready',
        rollback: null,
      }),
    ).toBe(true);
    expect(
      shouldPollRepositoryExecution({ status: 'released', rollback: null }),
    ).toBe(false);
    expect(
      shouldPollRepositoryExecution({
        status: 'released',
        rollback: { status: 'validating' },
      } as Parameters<typeof shouldPollRepositoryExecution>[0]),
    ).toBe(true);
    expect(
      shouldPollRepositoryExecution({
        status: 'released',
        rollback: { status: 'released' },
      } as Parameters<typeof shouldPollRepositoryExecution>[0]),
    ).toBe(false);
  });

  it('starts and stops event polling with the active workspace', async () => {
    vi.useFakeTimers();
    const api = installApi(() => response(eventResponse([], null, 0)));
    const { rerender } = renderHook(
      ({ enabled }) =>
        useLiveTelemetry({
          eventPollingEnabled: enabled,
          executionPollingEnabled: false,
        }),
      { initialProps: { enabled: false } },
    );
    await settle();
    expect(api.eventCallCount()).toBe(0);

    rerender({ enabled: true });
    await settle();
    expect(api.eventCallCount()).toBe(1);

    rerender({ enabled: false });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.eventCallCount()).toBe(1);
  });

  it('pauses hidden tabs and refreshes immediately when visible', async () => {
    vi.useFakeTimers();
    setVisibility('hidden');
    const api = installApi(() => response(eventResponse([], null, 0)));
    const { result } = renderHook(() =>
      useLiveTelemetry({
        eventPollingEnabled: true,
        executionPollingEnabled: false,
      }),
    );
    await settle();
    expect(api.eventCallCount()).toBe(0);
    expect(result.current.pollingState).toBe('paused');

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(api.eventCallCount()).toBe(1);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.eventCallCount()).toBe(1);
    expect(result.current.pollingState).toBe('paused');
  });

  it('uses cursored deltas and backs off after an empty update', async () => {
    vi.useFakeTimers();
    const api = installApi((call, url) => {
      if (call === 1) return response(eventResponse([event], 'cursor-one'));
      expect(url).toContain('cursor=cursor-one');
      return response(eventResponse([], 'cursor-one', 1));
    });
    const { result } = renderHook(() =>
      useLiveTelemetry({
        eventPollingEnabled: true,
        executionPollingEnabled: false,
      }),
    );
    await settle();
    expect(result.current.events).toHaveLength(1);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await settle();
    expect(api.eventCallCount()).toBe(2);
    expect(result.current.events).toHaveLength(1);

    await act(async () => vi.advanceTimersByTimeAsync(3_999));
    expect(api.eventCallCount()).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await settle();
    expect(api.eventCallCount()).toBe(3);
  });

  it('marks failures stale and recovers with a jittered retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const api = installApi((call) => {
      if (call === 1) return response(eventResponse([event], 'cursor-one'));
      if (call === 2) throw new Error('network unavailable');
      return response(eventResponse([], 'cursor-one', 1));
    });
    const { result } = renderHook(() =>
      useLiveTelemetry({
        eventPollingEnabled: true,
        executionPollingEnabled: false,
      }),
    );
    await settle();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await settle();
    expect(api.eventCallCount()).toBe(2);
    expect(result.current.status).toBe('offline');
    expect(result.current.pollingState).toBe('stale');

    await act(async () => vi.advanceTimersByTimeAsync(2_249));
    expect(api.eventCallCount()).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await settle();
    expect(api.eventCallCount()).toBe(3);
    expect(result.current.status).toBe('live');
    expect(result.current.pollingState).toBe('fresh');
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });
});

describe('mergeObservationArchivesPage', () => {
  it('replaces outright when nothing has been paginated beyond the fresh page', () => {
    const fresh = [archiveSummary('a'), archiveSummary('b')];
    const merged = mergeObservationArchivesPage([], null, fresh, 'cursor-2');
    expect(merged).toEqual({ archives: fresh, nextCursor: 'cursor-2' });
  });

  it('keeps older paginated rows and the prior cursor when more is already loaded', () => {
    const current = [
      archiveSummary('a'),
      archiveSummary('b'),
      archiveSummary('c'),
      archiveSummary('d'),
    ];
    const fresh = [archiveSummary('a'), archiveSummary('b')];
    const merged = mergeObservationArchivesPage(
      current,
      null,
      fresh,
      'cursor-fresh',
    );
    expect(merged.archives.map((archive) => archive.archiveId)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    // The already-exhausted cursor is preserved rather than adopting the
    // fresh page's cursor, which would just re-offer already-loaded rows.
    expect(merged.nextCursor).toBeNull();
  });

  it('does not duplicate a row the fresh page and the older pages share', () => {
    const current = [
      archiveSummary('a'),
      archiveSummary('b'),
      archiveSummary('c'),
    ];
    const fresh = [archiveSummary('c'), archiveSummary('b')];
    const merged = mergeObservationArchivesPage(
      current,
      'cursor-old',
      fresh,
      'cursor-new',
    );
    expect(merged.archives.map((archive) => archive.archiveId)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(merged.nextCursor).toBe('cursor-old');
  });
});

describe('observation archive pagination', () => {
  it('survives a refresh after loading an older page', async () => {
    let archiveCall = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/events/raw?limit=200')) {
        return response(eventResponse([], null, 0));
      }
      if (url.includes('/api/genome?')) {
        return response({
          evolutionCycle: {
            studyId: 'projectflow-baseline-study',
            startedAt: null,
            genomeEvolutionCount: 0,
          },
          executions: [],
          page: { limit: 10, nextCursor: null },
        });
      }
      if (url.includes('/api/observations/archives?')) {
        archiveCall += 1;
        if (url.includes('cursor=cursor-1')) {
          return response({
            archives: [archiveSummary('c'), archiveSummary('d')],
            page: { limit: 10, nextCursor: null },
          });
        }
        return response({
          archives: [archiveSummary('a'), archiveSummary('b')],
          page: { limit: 10, nextCursor: 'cursor-1' },
        });
      }
      if (url.includes('/evidence/latest')) return response(null, 204);
      return response(null, 204);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useLiveTelemetry({
        eventPollingEnabled: false,
        executionPollingEnabled: false,
      }),
    );
    await waitFor(() =>
      expect(
        result.current.observationArchives.map((a) => a.archiveId),
      ).toEqual(['a', 'b']),
    );
    expect(result.current.observationArchivesNextCursor).toBe('cursor-1');

    await act(async () => {
      await result.current.loadMoreObservationArchives();
    });
    expect(result.current.observationArchives.map((a) => a.archiveId)).toEqual(
      ['a', 'b', 'c', 'd'],
    );
    expect(result.current.observationArchivesNextCursor).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });
    // A plain refresh only ever re-fetches page one; the older page loaded
    // via "Load older observation records" must not be discarded, and the
    // exhausted cursor must not be reset to page one's cursor.
    expect(result.current.observationArchives.map((a) => a.archiveId)).toEqual(
      ['a', 'b', 'c', 'd'],
    );
    expect(result.current.observationArchivesNextCursor).toBeNull();
    expect(archiveCall).toBeGreaterThanOrEqual(3);
  });
});
