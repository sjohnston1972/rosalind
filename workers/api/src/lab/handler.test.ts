import {
  LabAgentRunSchema,
  LabExperimentSchema,
  LabExperimentsResponseSchema,
  TelemetryReceiptSchema,
} from '@darwin/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRequest } from '../index';
import { getLabRepository, resetInMemoryLab } from './lab-repository';

const request = (path: string, method = 'GET', body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(async () => {
  await resetInMemoryLab();
  vi.unstubAllGlobals();
});

describe('Darwin Lab API', () => {
  it('rejects custom tasks whose success oracle is not executable by ProjectFlow', async () => {
    const response = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        targetUrl: 'http://localhost:5174/',
        task: {
          taskId: 'mark-task-complete',
          name: 'Mark task complete',
          instruction: 'Mark an assigned task as complete.',
          startRoute: '/study/dashboard',
          successCriterion: {
            type: 'route_reached',
            route: '/study/my-work',
          },
          successDescription: 'The assigned-work route is visible.',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'lab_task_unsupported',
      message: expect.stringContaining('three verified ProjectFlow Lab tasks'),
    });
  });

  it('allows only explicitly configured remote target origins', async () => {
    const body = {
      name: 'Configured ProjectFlow target',
      targetUrl: 'https://darwin-projectflow.pages.dev/',
      populationSize: 8,
      maxActions: 12,
      maxDurationMs: 180_000,
      seed: 1859,
    };
    const forbidden = await handleRequest(
      request('/api/lab/experiments', 'POST', body),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await handleRequest(
      request('/api/lab/experiments', 'POST', body),
      {
        DARWIN_LAB_ALLOWED_ORIGINS:
          'https://darwin-projectflow.pages.dev,http://localhost:5174',
      },
    );
    expect(allowed.status).toBe(201);
    expect(LabExperimentSchema.parse(await allowed.json()).targetUrl).toBe(
      body.targetUrl,
    );

    const lookalike = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        ...body,
        targetUrl: 'https://darwin-projectflow.pages.dev.attacker.example/',
      }),
      {
        DARWIN_LAB_ALLOWED_ORIGINS:
          'https://darwin-projectflow.pages.dev,http://localhost:5174',
      },
    );
    expect(lookalike.status).toBe(403);
  });

  it('keeps a queued experiment recoverable when managed dispatch fails', async () => {
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'Runner dispatch boundary',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
        maxActions: 12,
        maxDurationMs: 180_000,
        seed: 1859,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());

    const unavailable = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/start`, 'POST'),
    );
    expect(unavailable.status).toBe(502);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: 'lab_request_failed',
      message: 'managed_runner_unavailable',
    });

    const queuedResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}`),
    );
    expect(
      LabExperimentSchema.parse(await queuedResponse.json()),
    ).toMatchObject({
      status: 'awaiting_runner',
      runnerId: null,
      runs: [],
    });
  });

  it('keeps a queued experiment recoverable when GitHub rejects the dispatch call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'GitHub dispatch failure boundary',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
        maxActions: 12,
        maxDurationMs: 180_000,
        seed: 1859,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());

    const failed = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/start`, 'POST'),
      { GITHUB_TOKEN: 'github-test-token' },
    );
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: 'lab_request_failed',
      message: 'managed_runner_dispatch_503',
    });

    const queuedResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}`),
    );
    expect(
      LabExperimentSchema.parse(await queuedResponse.json()),
    ).toMatchObject({
      status: 'awaiting_runner',
      runnerId: null,
      runs: [],
    });
  });

  it('fails an infrastructure-only population that produced zero browser actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    );
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'Infrastructure failure boundary',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());
    const startResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/start`, 'POST'),
      { GITHUB_TOKEN: 'github-test-token' },
    );
    expect(startResponse.status).toBe(200);
    const claimResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/claim`, 'POST', {
        runnerId: 'lab-runner-zero-actions',
      }),
    );
    expect(claimResponse.status).toBe(200);

    for (let index = 0; index < 8; index += 1) {
      const runId = `lab-run-zero-actions-${index + 1}`;
      const startedAt = new Date(
        Date.UTC(2026, 6, 21, 8, 0, index),
      ).toISOString();
      const runResponse = await handleRequest(
        request(`/api/lab/experiments/${created.experimentId}/runs`, 'POST', {
          runId,
          participantId: `lab-agent-zero-${index + 1}`,
          sessionId: `lab-session-zero-${index + 1}`,
          persona: 'novice',
          viewport: { class: 'desktop', width: 1440, height: 960 },
          agentModel: 'gpt-5.6-luna',
          startedAt,
          populationOrdinal: index + 1,
          studyId: created.studyId,
          taskDefinitionId: created.task.taskDefinitionId,
          taskDefinitionHash: created.task.definitionHash,
          appVersion: created.targetAppVersion,
        }),
      );
      expect(runResponse.status).toBe(201);
      const finishResponse = await handleRequest(
        request(
          `/api/lab/experiments/${created.experimentId}/runs/${runId}/finish`,
          'POST',
          {
            status: 'blocked',
            finishedAt: new Date(
              Date.UTC(2026, 6, 21, 8, 0, index, 500),
            ).toISOString(),
            durationMs: 500,
            taskOutcome: 'failed',
            frictionLabels: [],
            telemetryEventIds: [],
            error: 'Runner contract failed before the first browser action.',
          },
        ),
      );
      expect(finishResponse.status).toBe(200);
    }

    const failedResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}`),
    );
    expect(
      LabExperimentSchema.parse(await failedResponse.json()),
    ).toMatchObject({
      status: 'failed',
      evidence: null,
      error: expect.stringContaining('zero browser actions'),
    });
  });

  it('refuses to requeue a draft that contains immutable run history', async () => {
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'Immutable run boundary',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
        maxActions: 12,
        maxDurationMs: 180_000,
        seed: 1859,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());
    const runId = 'lab-run-immutable-history';
    const run = LabAgentRunSchema.parse({
      runId,
      experimentId: created.experimentId,
      participantId: 'lab-agent-01',
      sessionId: 'lab-session-immutable-history',
      persona: 'novice',
      viewport: { class: 'desktop', width: 1440, height: 960 },
      agentModel: 'gpt-5.6-luna',
      status: 'blocked',
      startedAt: '2026-07-20T10:00:00.000Z',
      finishedAt: '2026-07-20T10:01:00.000Z',
      durationMs: 60_000,
      taskOutcome: 'failed',
      frictionLabels: [],
      telemetryEventIds: [],
      actions: [],
      error: 'Historical observation',
      populationOrdinal: 1,
      studyId: created.studyId,
      taskDefinitionId: created.task.taskDefinitionId,
      taskDefinitionHash: created.task.definitionHash,
      appVersion: created.targetAppVersion,
      provenance: { ...created.provenance, runIds: [runId] },
    });
    await getLabRepository().saveExperiment({ ...created, runs: [run] });

    const response = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/start`, 'POST'),
      { GITHUB_TOKEN: 'must-not-be-used' },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'lab_state_conflict',
      message: expect.stringContaining('cannot be re-queued in place'),
    });
  });

  it('retries under a new identity and dispatches only that experiment', async () => {
    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', dispatch);
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'Retry identity boundary',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
        maxActions: 12,
        maxDurationMs: 180_000,
        seed: 1859,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());
    await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/cancel`, 'POST'),
    );

    const retryResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/retry`, 'POST'),
      {
        GITHUB_TOKEN: 'github-test-token',
      },
    );
    expect(retryResponse.status).toBe(201);
    const retry = LabExperimentSchema.parse(await retryResponse.json());
    expect(retry).toMatchObject({
      status: 'awaiting_runner',
      runs: [],
      evidence: null,
      analysis: null,
      selection: null,
    });
    expect(retry.experimentId).not.toBe(created.experimentId);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(dispatch.mock.calls[0]?.[1]?.body))).toEqual({
      ref: 'main',
      inputs: { experiment_id: retry.experimentId },
    });
  });

  it('runs a bounded population into separately labelled evidence', async () => {
    const createdResponse = await handleRequest(
      request('/api/lab/experiments', 'POST', {
        name: 'Apollo population',
        targetUrl: 'http://localhost:5174/',
        populationSize: 8,
        maxActions: 12,
        maxDurationMs: 180_000,
        seed: 1859,
      }),
    );
    const created = LabExperimentSchema.parse(await createdResponse.json());
    expect(createdResponse.status).toBe(201);
    expect(created.studyId).toMatch(/^projectflow-darwin-lab-/);

    const automatedEvent = {
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000901',
      sessionId: 'lab-session-telemetry',
      participantId: 'lab-agent-telemetry',
      studyId: created.studyId,
      appVersion: 'baseline',
      source: 'automated',
      provenance: created.provenance,
      occurredAt: '2026-07-18T10:00:00.000Z',
      sequence: 0,
      route: '/lab/dashboard',
      viewport: 'desktop',
      eventType: 'session_started',
    };
    const telemetryResponse = await handleRequest(
      request('/api/telemetry/events', 'POST', { events: [automatedEvent] }),
    );
    expect(
      TelemetryReceiptSchema.parse(await telemetryResponse.json()),
    ).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
    const crossedBoundary = await handleRequest(
      request(`/api/studies/${created.studyId}/evidence`, 'POST'),
    );
    expect(crossedBoundary.status).toBe(409);
    await expect(crossedBoundary.json()).resolves.toMatchObject({
      error: 'lab_evidence_boundary',
    });

    await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/start`, 'POST'),
    );
    await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}/claim`, 'POST', {
        runnerId: 'lab-runner-test',
      }),
    );

    for (let index = 1; index <= 8; index += 1) {
      const runId = `lab-run-${index}`;
      await handleRequest(
        request(`/api/lab/experiments/${created.experimentId}/runs`, 'POST', {
          runId,
          participantId: `lab-agent-${index}`,
          sessionId: `lab-session-${index}`,
          persona: index % 2 ? 'novice' : 'search_first',
          viewport: { class: 'desktop', width: 1440, height: 960 },
          agentModel: 'gpt-5.6-luna',
          startedAt: '2026-07-18T10:00:00.000Z',
          populationOrdinal: index,
          studyId: created.studyId,
          taskDefinitionId: created.task.taskDefinitionId,
          taskDefinitionHash: created.task.definitionHash,
          appVersion: created.targetAppVersion,
        }),
      );
      await handleRequest(
        request(
          `/api/lab/experiments/${created.experimentId}/runs/${runId}/actions`,
          'POST',
          {
            action: {
              actionId: `lab-action-${index}`,
              ordinal: 1,
              occurredAt: '2026-07-18T10:00:01.000Z',
              action: 'click',
              targetId: 'nav-projects',
              targetRole: 'button',
              inputLength: null,
              key: null,
              expectation: 'The projects directory should open.',
              fromUrl: 'http://localhost:5174/?lab=true',
              toUrl: 'http://localhost:5174/?lab=true',
              durationMs: 200,
              outcome: 'unchanged',
              accessibilityNodeCount: 80,
              telemetryEventIds: [],
              error: null,
              provenance: { ...created.provenance, runIds: [runId] },
            },
          },
        ),
      );
      await handleRequest(
        request(
          `/api/lab/experiments/${created.experimentId}/runs/${runId}/finish`,
          'POST',
          {
            status: 'abandoned',
            finishedAt: '2026-07-18T10:01:00.000Z',
            durationMs: 60_000,
            taskOutcome: 'abandoned',
            frictionLabels: ['abandonment'],
            telemetryEventIds: [],
            error: null,
          },
        ),
      );
    }

    const completedResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}`),
    );
    const completed = LabExperimentSchema.parse(await completedResponse.json());
    expect(completed.status).toBe('completed');
    expect(completed.evidence?.evidenceClass).toBe('automated');
    expect(completed.evidence?.provenance).toMatchObject({
      evidenceClass: 'darwin_lab',
      labExperimentId: created.experimentId,
      taskDefinitionHash: created.task.definitionHash,
    });
    expect(completed.evidence?.population.completed).toBe(8);
    expect(completed.evidence?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detector: 'abandonment' }),
        expect.objectContaining({ detector: 'dead_click' }),
      ]),
    );

    const promotedResponse = await handleRequest(
      request(
        `/api/lab/experiments/${created.experimentId}/promote-eval`,
        'POST',
      ),
    );
    const promoted = LabExperimentSchema.parse(await promotedResponse.json());
    expect(promotedResponse.status).toBe(201);
    expect(promoted.behaviouralEval).toMatchObject({
      evalId: 'BE-001',
      sourceExperimentId: created.experimentId,
      status: 'active',
      evidencePackId: promoted.evidence?.evidencePackId,
    });
    const evalsResponse = await handleRequest(
      request('/api/behavioural-evals'),
    );
    const evalPayload = (await evalsResponse.json()) as { evals: unknown[] };
    expect(evalPayload.evals).toHaveLength(1);

    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', dispatch);
    const rerunResponse = await handleRequest(
      request(
        `/api/lab/experiments/${created.experimentId}/rerun-eval`,
        'POST',
      ),
      { GITHUB_TOKEN: 'github-test-token' },
    );
    const rerun = LabExperimentSchema.parse(await rerunResponse.json());
    expect(rerunResponse.status).toBe(201);
    expect(rerun).toMatchObject({
      status: 'awaiting_runner',
      runs: [],
      evidence: null,
      analysis: null,
      selection: null,
      behaviouralEval: {
        sourceExperimentId: created.experimentId,
        status: 'active',
      },
    });
    expect(rerun.experimentId).not.toBe(created.experimentId);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(dispatch.mock.calls[0]?.[1]?.body))).toEqual({
      ref: 'main',
      inputs: { experiment_id: rerun.experimentId },
    });

    const preservedResponse = await handleRequest(
      request(`/api/lab/experiments/${created.experimentId}`),
    );
    const preserved = LabExperimentSchema.parse(await preservedResponse.json());
    expect(preserved.status).toBe('completed');
    expect(preserved.runs).toHaveLength(8);
    expect(preserved.evidence?.evidencePackId).toBe(
      promoted.evidence?.evidencePackId,
    );

    const listResponse = await handleRequest(request('/api/lab/experiments'));
    expect(
      LabExperimentsResponseSchema.parse(await listResponse.json()).experiments,
    ).toHaveLength(2);
  });
});
