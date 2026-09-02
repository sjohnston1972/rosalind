import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DarwinLabView } from './LabView';

const timestamp = '2026-07-18T10:00:00.000Z';
const taskHash = 'a'.repeat(64);
const goalText = 'Find the task assigned to me and open it';

const draftExperiment = {
  experimentId: 'lab-exp-ui-test',
  studyId: 'projectflow-darwin-lab-ui-test',
  name: goalText,
  targetUrl: 'http://localhost:5174/',
  targetAppVersion: 'baseline',
  task: {
    taskDefinitionId: 'lab-task-ui-test',
    definitionVersion: 1,
    definitionHash: taskHash,
    taskId: 'freeform-find-the-task-assigned-to-me-and-open-it',
    name: goalText,
    instruction: goalText,
    successDescription: `Agents attempt this goal: ${goalText}`,
    startRoute: '/',
    successCriterion: { type: 'best_effort' },
  },
  populationSize: 8,
  personaAllocation: [{ persona: 'novice', count: 8 }],
  maxActions: 12,
  maxDurationMs: 180_000,
  seed: 1859,
  status: 'draft',
  runnerId: null,
  createdAt: timestamp,
  startedAt: null,
  completedAt: null,
  runs: [],
  evidence: null,
  analysis: null,
  selection: null,
  error: null,
  evidenceError: null,
  archivedAt: null,
  version: 0,
  provenance: {
    evidenceClass: 'darwin_lab',
    label: 'Darwin Lab',
    labExperimentId: 'lab-exp-ui-test',
    taskDefinitionId: 'lab-task-ui-test',
    taskDefinitionHash: taskHash,
    evidencePackId: null,
    evidenceHash: null,
    runIds: [],
  },
} as const;

const finishedExperiment = {
  ...draftExperiment,
  status: 'completed',
  runnerId: 'github-actions-123',
  startedAt: timestamp,
  completedAt: timestamp,
  runs: [
    {
      runId: 'lab-run-layout-test',
      experimentId: draftExperiment.experimentId,
      participantId: 'lab-agent-01',
      sessionId: 'lab-session-layout-test',
      persona: 'novice',
      viewport: { class: 'desktop', width: 1440, height: 960 },
      agentModel: 'gpt-5.6-luna',
      status: 'succeeded',
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: 4200,
      taskOutcome: 'success',
      frictionLabels: [],
      telemetryEventIds: [],
      actions: [
        {
          actionId: 'lab-action-1',
          ordinal: 1,
          occurredAt: timestamp,
          action: 'click',
          targetId: 'assigned-task-card',
          targetRole: 'button',
          inputLength: null,
          key: null,
          expectation: 'Opens the assigned task',
          fromUrl: 'http://localhost:5174/study/dashboard',
          toUrl: 'http://localhost:5174/study/my-work',
          durationMs: 320,
          outcome: 'changed',
          accessibilityNodeCount: 42,
          telemetryEventIds: [],
          error: null,
          provenance: {
            ...draftExperiment.provenance,
            runIds: ['lab-run-layout-test'],
          },
        },
      ],
      error: null,
      populationOrdinal: 1,
      studyId: draftExperiment.studyId,
      taskDefinitionId: draftExperiment.task.taskDefinitionId,
      taskDefinitionHash: draftExperiment.task.definitionHash,
      appVersion: draftExperiment.targetAppVersion,
      provenance: {
        ...draftExperiment.provenance,
        runIds: ['lab-run-layout-test'],
      },
    },
  ],
} as const;

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Darwin Lab view', () => {
  it('sends a plain-English goal to the agents with one action', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST' && url.endsWith('/start')) {
          return jsonResponse(
            { ...draftExperiment, status: 'awaiting_runner' },
            200,
          );
        }
        if (init?.method === 'POST' && url.endsWith('/api/lab/experiments')) {
          return jsonResponse(draftExperiment, 201);
        }
        return jsonResponse({ experiments: [] }, 200);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DarwinLabView apiBaseUrl="http://localhost:8787" liveReasoningAvailable />,
    );

    // The old parameter-heavy form is gone: no start route, seed, or budgets.
    expect(screen.queryByLabelText('Action budget')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Seed')).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(/Find the task assigned to me/i),
      { target: { value: goalText } },
    );
    fireEvent.click(screen.getByRole('button', { name: /Send agents/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8787/api/lab/experiments',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const createRequest = fetchMock.mock.calls.find(
      ([url, init]) =>
        init?.method === 'POST' &&
        String(url).endsWith('/api/lab/experiments'),
    );
    expect(JSON.parse(String(createRequest?.[1]?.body))).toEqual({
      goal: goalText,
    });

    // Create is immediately followed by starting the population — no extra click.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            init?.method === 'POST' && String(url).endsWith('/start'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole('heading', { name: goalText })).toBeVisible();
  });

  it('shows the agent population and a replay for a finished run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ experiments: [finishedExperiment] }, 200),
      ),
    );

    const { container } = render(
      <DarwinLabView
        apiBaseUrl="http://localhost:8787"
        liveReasoningAvailable={false}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Novice · success' }),
    ).toBeVisible();
    const population = screen.getByLabelText('Darwin Labs agent population');
    const populationWorkspace = container.querySelector(
      '.lab-population-workspace',
    );
    const replay = screen.getByText('What one agent did').closest('section');
    expect(populationWorkspace).toContainElement(population);
    expect(replay).not.toBeNull();
    expect(
      populationWorkspace!.compareDocumentPosition(replay!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('drops a stale poll response that resolves after a newer one', async () => {
    vi.useFakeTimers();
    const pending: Array<{ resolve: (value: Response) => void }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/lab/experiments')) {
        let resolve!: (value: Response) => void;
        const promise = new Promise<Response>((res) => {
          resolve = res;
        });
        pending.push({ resolve });
        return promise;
      }
      return Promise.resolve(jsonResponse({ experiments: [] }, 200));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DarwinLabView
        apiBaseUrl="http://localhost:8787"
        liveReasoningAvailable={false}
      />,
    );
    await flush();
    expect(pending).toHaveLength(1);

    // The initial (mount) load resolves with a non-terminal experiment, so
    // the 2s live poll starts.
    await act(async () => {
      pending[0]!.resolve(jsonResponse({ experiments: [draftExperiment] }, 200));
    });
    await flush();
    expect(screen.getByRole('heading', { name: goalText })).toBeVisible();

    // The poll fires on a fixed 2s cadence regardless of whether the prior
    // tick's request has resolved yet, so two ticks in a row here produce
    // two overlapping in-flight requests - the second poll (request #3)
    // starts before the first poll (request #2) has come back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(pending).toHaveLength(3);

    // The newer request (#3) resolves first with the finished run...
    await act(async () => {
      pending[2]!.resolve(
        jsonResponse({ experiments: [finishedExperiment] }, 200),
      );
    });
    await flush();
    expect(
      screen.getByRole('heading', { name: 'Novice · success' }),
    ).toBeVisible();

    // ...then the stale request (#2) resolves late with an outdated, empty
    // page. Its load generation no longer matches the latest load, so it
    // must be dropped rather than blanking the population the newer
    // response just rendered.
    await act(async () => {
      pending[1]!.resolve(jsonResponse({ experiments: [] }, 200));
    });
    await flush();

    expect(
      screen.getByRole('heading', { name: 'Novice · success' }),
    ).toBeVisible();
  });
});
