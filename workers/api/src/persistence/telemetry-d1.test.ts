import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type {
  CodexImplementationManifest,
  OperationalEvent,
  StudyTelemetryEvent,
} from '@darwin/shared';

import {
  createRepositoryExecution,
  updateRepositoryExecution,
} from '../repository/execution';
import { D1TelemetryRepository } from './telemetry-repository';

const schema = `
  CREATE TABLE telemetry_events (
    event_id TEXT PRIMARY KEY, study_id TEXT NOT NULL, participant_id TEXT NOT NULL,
    session_id TEXT NOT NULL, task_attempt_id TEXT, app_version TEXT NOT NULL,
    source TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
    sequence INTEGER NOT NULL, event_type TEXT NOT NULL, route TEXT NOT NULL,
    target_id TEXT, event_json TEXT NOT NULL, expires_at TEXT
  );
  CREATE TABLE repository_executions (
    execution_id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL UNIQUE,
    analysis_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
    execution_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT, artifact_expires_at TEXT, record_expires_at TEXT,
    study_id TEXT
  );
  CREATE TABLE evidence_analyses (
    analysis_id TEXT PRIMARY KEY, study_id TEXT NOT NULL
  );
  CREATE TABLE operational_events (
    event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
    target TEXT NOT NULL, outcome TEXT NOT NULL, before_state TEXT,
    after_state TEXT, provider TEXT, operation TEXT,
    duration_ms INTEGER NOT NULL, error_code TEXT, event_json TEXT NOT NULL
  );
`;

const studyEvent = (
  overrides: Partial<StudyTelemetryEvent> &
    Pick<StudyTelemetryEvent, 'eventId' | 'sequence'>,
): StudyTelemetryEvent =>
  ({
    schemaVersion: 1,
    sessionId: 'session-d1-test',
    participantId: 'participant-d1-test',
    studyId: 'study-d1-test',
    appVersion: '1.0.0',
    source: 'real_user',
    occurredAt: '2026-07-19T08:00:00.000Z',
    route: '/study/dashboard',
    viewport: 'desktop',
    eventType: 'page_view',
    ...overrides,
  }) as StudyTelemetryEvent;

const operationalEvent = (
  overrides: Partial<OperationalEvent> & Pick<OperationalEvent, 'eventId'>,
): OperationalEvent =>
  ({
    kind: 'audit',
    requestId: 'request-d1-test',
    occurredAt: new Date().toISOString(),
    actor: 'operator',
    action: 'demo.reset',
    target: 'projectflow-baseline-study',
    outcome: 'success',
    beforeState: null,
    afterState: null,
    provider: null,
    operation: null,
    durationMs: 12,
    errorCode: null,
    ...overrides,
  }) as OperationalEvent;

const manifest = {
  manifestId: 'manifest-d1-test',
  manifestHash: 'a'.repeat(64),
  analysisId: 'analysis-d1-test',
  mutationId: 'mutation-d1-test',
  evidenceHash: 'b'.repeat(64),
  promptVersion: '3.0.0',
  repositoryCommit: 'c'.repeat(40),
  repository: {
    owner: 'sjohnston1972',
    name: 'projectflow',
    fullName: 'sjohnston1972/projectflow',
    url: 'https://github.com/sjohnston1972/projectflow',
    branch: 'main',
    baseSha: 'c'.repeat(40),
    sourceHash: 'd'.repeat(64),
    capturedAt: '2026-07-19T08:00:00.000Z',
    mutablePaths: ['apps/projectflow/src/**'],
    protectedPaths: ['.github/**'],
    contextPaths: ['apps/projectflow/src/App.tsx'],
    validationCommands: ['npm run verify'],
    maximumChangedFiles: 8,
    maximumChangedLines: 700,
    productionUrl: 'https://darwin-projectflow.pages.dev/',
    studyUrl: 'https://darwin-projectflow.pages.dev/?study=true',
  },
  createdAt: '2026-07-19T08:01:00.000Z',
  brief: 'Implement mutation.',
  evidenceCitations: ['EV-001'],
  allowedPaths: ['apps/projectflow/src/**'],
  protectedPaths: ['.github/**'],
  acceptanceCriteria: ['Implemented.'],
  validationCommands: ['npm run verify'],
} satisfies CodexImplementationManifest;

describe('D1 telemetry repository boundaries', () => {
  let miniflare: Miniflare;
  let database: D1Database;
  let repository: D1TelemetryRepository;

  beforeEach(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: `export default { fetch() { return new Response('ok') } }`,
      d1Databases: { DB: crypto.randomUUID() },
    });
    database = (await miniflare.getD1Database('DB')) as unknown as D1Database;
    await database.exec(schema.replace(/\s*\n\s*/g, ' '));
    repository = new D1TelemetryRepository(database);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await miniflare.dispose();
  });

  it('permits exactly one compare-and-swap execution transition', async () => {
    const prepared = createRepositoryExecution(
      manifest,
      '2026-07-19T08:02:00.000Z',
    );
    expect(await repository.saveRepositoryExecution(prepared, null)).toBe(true);
    const queued = updateRepositoryExecution(prepared, { status: 'queued' });
    const failed = updateRepositoryExecution(prepared, {
      status: 'failed',
      error: 'dispatch failed',
    });
    const results = await Promise.all([
      repository.saveRepositoryExecution(queued, prepared),
      repository.saveRepositoryExecution(failed, prepared),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      (await repository.getRepositoryExecution(prepared.executionId))?.revision,
    ).toBe(1);
  });

  it('skips corrupt execution rows without blanking fossil-record pages', async () => {
    const valid = createRepositoryExecution(
      manifest,
      '2026-07-19T08:02:00.000Z',
    );
    expect(await repository.saveRepositoryExecution(valid, null)).toBe(true);
    const corruptId = 'execution-corrupt-d1';
    await database
      .prepare(
        `INSERT INTO repository_executions (
          execution_id, manifest_id, analysis_id, status, updated_at,
          execution_json, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        corruptId,
        'manifest-corrupt-d1',
        'analysis-corrupt-d1',
        'failed',
        '2026-07-19T08:03:00.000Z',
        '{"private":"must-not-leak"}',
        0,
      )
      .run();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(repository.listRepositoryExecutions()).resolves.toEqual([
      valid,
    ]);
    await expect(
      repository.listRepositoryExecutionPage({ limit: 1 }),
    ).resolves.toMatchObject({ executions: [valid] });
    expect(warning).toHaveBeenCalledWith(
      '[darwin:persistence]',
      expect.stringContaining(corruptId),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('must-not-leak');
  });

  it('skips corrupt telemetry event rows without leaking their contents or 500ing the page', async () => {
    const valid = studyEvent({
      eventId: '49d13df2-8dce-4ad3-b20e-d8b4edc01b63',
      sequence: 0,
    });
    await repository.insertEvents([valid], '2026-07-19T08:00:01.000Z');
    const recordId = '00000000-0000-4000-a000-000000000001';
    await database
      .prepare(
        `INSERT INTO telemetry_events VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .bind(
        recordId,
        'study-d1-test',
        'participant-d1-test',
        'session-d1-test',
        '1.0.0',
        'real_user',
        '2026-07-19T08:00:00.000Z',
        '2026-07-19T08:00:02.000Z',
        1,
        'page_view',
        '/dashboard',
        '{"private":"must-not-leak"}',
      )
      .run();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const events = await repository.listEvents('study-d1-test', 10);
    expect(events.map((event) => event.eventId)).toEqual([valid.eventId]);

    const page = await repository.listEventPage('study-d1-test', 10);
    expect(page.events.map((event) => event.eventId)).toEqual([
      valid.eventId,
    ]);

    const session = await repository.listSession(
      'study-d1-test',
      'session-d1-test',
    );
    expect(session.map((event) => event.eventId)).toEqual([valid.eventId]);

    expect(warning).toHaveBeenCalledWith(
      '[darwin:persistence]',
      expect.stringContaining(recordId),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('must-not-leak');
  });

  it('skips corrupt operational audit event rows without leaking their contents or 500ing the page', async () => {
    const valid = operationalEvent({
      eventId: '11111111-1111-4111-8111-111111111111',
    });
    await repository.saveOperationalEvents([valid]);
    const corruptId = '22222222-2222-4222-8222-222222222222';
    await database
      .prepare(
        `INSERT INTO operational_events (
           event_id, kind, request_id, occurred_at, actor, action, target,
           outcome, before_state, after_state, provider, operation,
           duration_ms, error_code, event_json
         ) VALUES (?, 'audit', ?, ?, 'operator', 'demo.reset', 'target', 'success', NULL, NULL, NULL, NULL, 5, NULL, ?)`,
      )
      .bind(
        corruptId,
        'request-corrupt-d1',
        new Date().toISOString(),
        '{"private":"must-not-leak"}',
      )
      .run();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const events = await repository.listOperationalAuditEvents(10);
    expect(events.map((event) => event.eventId)).toEqual([valid.eventId]);
    expect(warning).toHaveBeenCalledWith(
      '[darwin:persistence]',
      expect.stringContaining(corruptId),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain('must-not-leak');
  });
});
