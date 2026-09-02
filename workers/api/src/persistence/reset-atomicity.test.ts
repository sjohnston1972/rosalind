import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { LabRepository } from '../lab/lab-repository';

import { D1LabRepository } from '../lab/lab-repository';
import {
  completeResetExecution,
  createResetExecution,
  resetPolicyHash,
  updateResetExecution,
} from '../repository/reset-execution';
import {
  D1TelemetryRepository,
  getTelemetryRepository,
  resetInMemoryTelemetry,
} from './telemetry-repository';

// This suite proves the demo-reset destructive path (workers/api/src/index.ts
// reconcileResetDeployment / the immediate reset branch, both funnelled
// through TelemetryRepository#completeResetAtomically) is a *real* atomic,
// compare-and-swap-gated transaction against D1 — not an in-process flag.
//
// Migrations are applied verbatim from workers/api/migrations so the schema
// under test is byte-for-byte what production runs, including the
// reset_executions.version column added for this fix.
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

const applyMigrations = async (database: D1Database) => {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8').replace(
      /\s*\n\s*/g,
      ' ',
    );
    await database.exec(sql);
  }
};

const studyEvent = {
  schemaVersion: 1,
  eventId: '49d13df2-8dce-4ad3-b20e-d8b4edc01b63',
  sessionId: 'session-atomic-test',
  participantId: 'participant-atomic-test',
  studyId: 'projectflow-baseline-study',
  appVersion: 'aaaaaaaaaaaa',
  source: 'real_user',
  occurredAt: '2026-07-19T08:00:00.000Z',
  sequence: 0,
  route: '/study/dashboard',
  viewport: 'desktop',
  eventType: 'page_view',
} as const;

const seedLabExperiment = async (database: D1Database, experimentId: string) => {
  await database
    .prepare(
      `INSERT INTO lab_experiments (
        experiment_id, status, created_at, updated_at, version, payload_json
      ) VALUES (?, 'completed', ?, ?, 0, ?)`,
    )
    .bind(
      experimentId,
      '2026-07-19T08:00:00.000Z',
      '2026-07-19T08:00:00.000Z',
      JSON.stringify({ marker: 'must-survive-a-failed-reset' }),
    )
    .run();
};

// A LabRepository whose reset leg is guaranteed to fail mid-batch: the
// statement targets a table that does not exist, so D1's batch (a single
// SQLite transaction) throws and rolls back *every* statement in the same
// batch — including the telemetry deletes that ran before it.
const brokenLabRepository = (database: D1Database): LabRepository =>
  ({
    resetStatements: () => [
      database.prepare('DELETE FROM lab_experiments_table_that_does_not_exist'),
    ],
  }) as unknown as LabRepository;

describe('demo reset: atomic compare-and-swap against D1', () => {
  let miniflare: Miniflare;
  let database: D1Database;
  let telemetryRepository: D1TelemetryRepository;
  let labRepository: D1LabRepository;

  beforeEach(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: `export default { fetch() { return new Response('ok') } }`,
      d1Databases: { DB: crypto.randomUUID() },
    });
    database = (await miniflare.getD1Database('DB')) as unknown as D1Database;
    await applyMigrations(database);
    telemetryRepository = new D1TelemetryRepository(database);
    labRepository = new D1LabRepository(database);
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  const seedDeployingExecution = async () => {
    await telemetryRepository.insertEvents(
      [studyEvent],
      '2026-07-19T08:00:01.000Z',
    );
    await seedLabExperiment(database, 'experiment-atomic-test');

    let execution = createResetExecution({
      fullName: 'sjohnston1972/projectflow',
      branch: 'main',
      studyUrl: 'https://darwin-projectflow.pages.dev/?study=true',
    });
    await telemetryRepository.saveResetExecution(execution);
    execution = updateResetExecution(execution, { status: 'running' });
    await telemetryRepository.saveResetExecution(execution);
    execution = updateResetExecution(execution, { status: 'validating' });
    await telemetryRepository.saveResetExecution(execution);
    execution = updateResetExecution(execution, {
      status: 'deploying',
      baselineCommit: 'c'.repeat(40),
    });
    await telemetryRepository.saveResetExecution(execution);
    return execution;
  };

  it('leaves prior demo data and the reset execution untouched when the transaction fails between verification and commit, then recovers on retry', async () => {
    const execution = await seedDeployingExecution();
    expect(resetPolicyHash).toMatch(/^[a-f0-9]{64}$/);

    const completed = completeResetExecution(
      execution,
      {
        status: 'verified',
        expectedCommit: execution.baselineCommit!,
        expectedAppVersion: execution.baselineCommit!.slice(0, 12),
        observedCommit: execution.baselineCommit,
        observedAppVersion: execution.baselineCommit!.slice(0, 12),
        attempts: 1,
        verifiedAt: '2026-07-19T08:05:00.000Z',
        lastError: null,
      },
      '2026-07-19T08:05:00.000Z',
    );

    // Force a failure *inside* the same atomic batch that would otherwise
    // destroy the telemetry/lab data and flip the reset execution to
    // 'complete' — i.e. between "compute/verify replacement state" (already
    // done above) and "commit".
    await expect(
      telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary: {
          startedAt: '2026-07-19T08:05:00.000Z',
          measuredCommit: execution.baselineCommit,
          appVersion: execution.baselineCommit!.slice(0, 12),
          deploymentVerifiedAt: '2026-07-19T08:05:00.000Z',
        },
        labRepository: brokenLabRepository(database),
      }),
    ).rejects.toThrow();

    // The telemetry event, the lab experiment, and the reset execution row
    // must all still be exactly as they were before the failed attempt.
    const survivingEvents = await telemetryRepository.listEvents(
      'projectflow-baseline-study',
      10,
    );
    expect(survivingEvents.map((event) => event.eventId)).toEqual([
      studyEvent.eventId,
    ]);
    const survivingExperiment = await database
      .prepare('SELECT experiment_id FROM lab_experiments WHERE experiment_id = ?')
      .bind('experiment-atomic-test')
      .first();
    expect(survivingExperiment).not.toBeNull();
    const stillDeploying = await telemetryRepository.getResetExecution(
      execution.resetId,
    );
    expect(stillDeploying).toMatchObject({
      status: 'deploying',
      version: execution.version,
      baselineCommit: execution.baselineCommit,
    });

    // Retrying with a working lab reset now succeeds, atomically clearing
    // both the telemetry and lab data and flipping the execution to
    // 'complete' in the same transaction.
    const result = await telemetryRepository.completeResetAtomically({
      resetId: execution.resetId,
      expectedStatus: stillDeploying!.status,
      expectedVersion: stillDeploying!.version,
      completed,
      evolutionBoundary: {
        startedAt: '2026-07-19T08:05:00.000Z',
        measuredCommit: execution.baselineCommit,
        appVersion: execution.baselineCommit!.slice(0, 12),
        deploymentVerifiedAt: '2026-07-19T08:05:00.000Z',
      },
      labRepository,
    });
    expect(result).toMatchObject({ status: 'complete' });
    expect(
      await telemetryRepository.listEvents('projectflow-baseline-study', 10),
    ).toEqual([]);
    const clearedExperiment = await database
      .prepare('SELECT experiment_id FROM lab_experiments WHERE experiment_id = ?')
      .bind('experiment-atomic-test')
      .first();
    expect(clearedExperiment).toBeNull();
    const finalExecution = await telemetryRepository.getResetExecution(
      execution.resetId,
    );
    expect(finalExecution).toMatchObject({
      status: 'complete',
      version: execution.version + 1,
    });
  });

  it('rejects a stale or already-won compare-and-swap without destroying anything', async () => {
    const execution = await seedDeployingExecution();
    const completed = completeResetExecution(
      execution,
      {
        status: 'verified',
        expectedCommit: execution.baselineCommit!,
        expectedAppVersion: execution.baselineCommit!.slice(0, 12),
        observedCommit: execution.baselineCommit,
        observedAppVersion: execution.baselineCommit!.slice(0, 12),
        attempts: 1,
        verifiedAt: '2026-07-19T08:05:00.000Z',
        lastError: null,
      },
      '2026-07-19T08:05:00.000Z',
    );
    const evolutionBoundary = {
      startedAt: '2026-07-19T08:05:00.000Z',
      measuredCommit: execution.baselineCommit,
      appVersion: execution.baselineCommit!.slice(0, 12),
      deploymentVerifiedAt: '2026-07-19T08:05:00.000Z',
    };

    // Two workers race to reconcile the same reset. Both computed the same
    // verified replacement state, but only one may commit it.
    const [first, second] = await Promise.all([
      telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary,
        labRepository,
      }),
      telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary,
        labRepository,
      }),
    ]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);

    // A third, now-stale caller (still holding the pre-reset status/version)
    // must lose the CAS too — no re-destruction, no error, just null.
    const stale = await telemetryRepository.completeResetAtomically({
      resetId: execution.resetId,
      expectedStatus: execution.status,
      expectedVersion: execution.version,
      completed,
      evolutionBoundary,
      labRepository,
    });
    expect(stale).toBeNull();
  });
});

// Mirrors the D1 suite above for the in-memory backend, which is what
// backs almost every other test in this workspace (and local/dev usage
// without a D1 binding). The failure is injected via the same seam
// production code goes through — labRepository.reset() — so this proves
// the in-memory implementation of completeResetAtomically gives the same
// "destroy nothing on partial failure, recover on retry" guarantee as D1's
// real transaction.
describe('demo reset: atomic compare-and-swap in-memory', () => {
  beforeEach(async () => {
    await resetInMemoryTelemetry();
  });

  it('restores prior telemetry and the reset execution when the attempt throws partway through, then recovers on retry', async () => {
    const telemetryRepository = getTelemetryRepository();
    await telemetryRepository.insertEvents(
      [studyEvent],
      '2026-07-19T08:00:01.000Z',
    );

    let execution = createResetExecution({
      fullName: 'sjohnston1972/projectflow',
      branch: 'main',
      studyUrl: 'https://darwin-projectflow.pages.dev/?study=true',
    });
    await telemetryRepository.saveResetExecution(execution);
    execution = updateResetExecution(execution, { status: 'running' });
    execution = updateResetExecution(execution, { status: 'validating' });
    execution = updateResetExecution(execution, {
      status: 'deploying',
      baselineCommit: 'c'.repeat(40),
    });
    await telemetryRepository.saveResetExecution(execution);

    const completed = completeResetExecution(
      execution,
      {
        status: 'verified',
        expectedCommit: execution.baselineCommit!,
        expectedAppVersion: execution.baselineCommit!.slice(0, 12),
        observedCommit: execution.baselineCommit,
        observedAppVersion: execution.baselineCommit!.slice(0, 12),
        attempts: 1,
        verifiedAt: '2026-07-19T08:05:00.000Z',
        lastError: null,
      },
      '2026-07-19T08:05:00.000Z',
    );
    const evolutionBoundary = {
      startedAt: '2026-07-19T08:05:00.000Z',
      measuredCommit: execution.baselineCommit,
      appVersion: execution.baselineCommit!.slice(0, 12),
      deploymentVerifiedAt: '2026-07-19T08:05:00.000Z',
    };

    // The lab reset is the last destructive step before the reset-execution
    // row is written. Failing it simulates a crash strictly between
    // "compute/verify replacement state" (done above, before this call) and
    // "commit".
    const failingLabRepository = {
      reset: vi.fn().mockRejectedValueOnce(new Error('simulated mid-reset failure')),
      resetStatements: () => [],
    } as unknown as LabRepository;

    await expect(
      telemetryRepository.completeResetAtomically({
        resetId: execution.resetId,
        expectedStatus: execution.status,
        expectedVersion: execution.version,
        completed,
        evolutionBoundary,
        labRepository: failingLabRepository,
      }),
    ).rejects.toThrow('simulated mid-reset failure');

    const survivingEvents = await telemetryRepository.listEvents(
      'projectflow-baseline-study',
      10,
    );
    expect(survivingEvents.map((event) => event.eventId)).toEqual([
      studyEvent.eventId,
    ]);
    const stillDeploying = await telemetryRepository.getResetExecution(
      execution.resetId,
    );
    expect(stillDeploying).toMatchObject({
      status: 'deploying',
      version: execution.version,
      baselineCommit: execution.baselineCommit,
    });

    const workingLabRepository = {
      reset: vi.fn().mockResolvedValue(undefined),
      resetStatements: () => [],
    } as unknown as LabRepository;
    const result = await telemetryRepository.completeResetAtomically({
      resetId: execution.resetId,
      expectedStatus: stillDeploying!.status,
      expectedVersion: stillDeploying!.version,
      completed,
      evolutionBoundary,
      labRepository: workingLabRepository,
    });
    expect(result).toMatchObject({ status: 'complete' });
    expect(
      await telemetryRepository.listEvents('projectflow-baseline-study', 10),
    ).toEqual([]);
    expect(
      await telemetryRepository.getResetExecution(execution.resetId),
    ).toMatchObject({ status: 'complete', version: execution.version + 1 });
  });
});
