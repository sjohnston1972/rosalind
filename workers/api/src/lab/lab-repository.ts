import {
  LabAgentActionRecordSchema,
  LabAgentRunSchema,
  LabExperimentSchema,
  type LabAgentActionRecord,
  type LabAgentRun,
  type LabExperiment,
  type LabExperimentStatus,
} from '@darwin/shared';

export interface LabRepository {
  saveExperiment(experiment: LabExperiment): Promise<void>;
  compareAndSwapExperiment(
    expected: LabExperiment,
    next: LabExperiment,
  ): Promise<LabExperiment | null>;
  createRun(
    experiment: LabExperiment,
    run: LabAgentRun,
  ): Promise<LabAgentRun | null>;
  appendAction(
    experimentId: string,
    runId: string,
    action: LabAgentActionRecord,
  ): Promise<'created' | 'existing' | 'conflict'>;
  finishRun(
    experimentId: string,
    expected: LabAgentRun,
    finished: LabAgentRun,
  ): Promise<LabAgentRun | null>;
  getExperiment(experimentId: string): Promise<LabExperiment | null>;
  listExperiments(status?: LabExperimentStatus): Promise<LabExperiment[]>;
  reset(): Promise<void>;
  /**
   * Raw DELETE statements equivalent to `reset()`, left unexecuted so a caller
   * (the demo-reset flow) can fold them into a single atomic D1 batch together
   * with the telemetry reset and the reset-execution CAS update. Only the
   * D1-backed implementation returns real statements; the in-memory
   * implementation returns an empty array since callers should invoke
   * `reset()` directly for that backend instead.
   */
  resetStatements(): D1PreparedStatement[];
}

const experimentStore = new Map<string, LabExperiment>();

const cloneExperiment = (experiment: LabExperiment) =>
  LabExperimentSchema.parse(structuredClone(experiment));
const cloneRun = (run: LabAgentRun) =>
  LabAgentRunSchema.parse(structuredClone(run));
const isSameTerminalRun = (left: LabAgentRun, right: LabAgentRun) =>
  left.status === right.status &&
  left.finishedAt === right.finishedAt &&
  left.taskOutcome === right.taskOutcome &&
  left.error === right.error;
const safeDiagnosticId = (value: string) =>
  value.replace(/[^a-zA-Z0-9._:-]/g, '?').slice(0, 128);
const parseStoredLabValue = <T>(
  schema: { parse(value: unknown): T },
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

export class InMemoryLabRepository implements LabRepository {
  async saveExperiment(experiment: LabExperiment) {
    experimentStore.set(experiment.experimentId, cloneExperiment(experiment));
  }

  async getExperiment(experimentId: string) {
    const experiment = experimentStore.get(experimentId);
    return experiment ? cloneExperiment(experiment) : null;
  }

  async compareAndSwapExperiment(expected: LabExperiment, next: LabExperiment) {
    const current = experimentStore.get(expected.experimentId);
    if (
      !current ||
      current.status !== expected.status ||
      current.version !== expected.version
    ) {
      return null;
    }
    const persisted = LabExperimentSchema.parse({
      ...next,
      version: expected.version + 1,
    });
    experimentStore.set(expected.experimentId, cloneExperiment(persisted));
    return cloneExperiment(persisted);
  }

  async createRun(experiment: LabExperiment, run: LabAgentRun) {
    const current = experimentStore.get(experiment.experimentId);
    if (!current || current.status !== 'running') return null;
    if (
      current.runs.some(
        (candidate) =>
          candidate.runId === run.runId ||
          candidate.populationOrdinal === run.populationOrdinal,
      )
    ) {
      return null;
    }
    current.runs.push(LabAgentRunSchema.parse(structuredClone(run)));
    return LabAgentRunSchema.parse(structuredClone(run));
  }

  async appendAction(
    experimentId: string,
    runId: string,
    rawAction: LabAgentActionRecord,
  ) {
    const action = LabAgentActionRecordSchema.parse(rawAction);
    const run = experimentStore
      .get(experimentId)
      ?.runs.find((candidate) => candidate.runId === runId);
    if (!run || run.status !== 'running') return 'conflict' as const;
    const existing = run.actions.find(
      (candidate) =>
        candidate.actionId === action.actionId ||
        candidate.ordinal === action.ordinal,
    );
    if (existing) {
      return JSON.stringify(existing) === JSON.stringify(action)
        ? ('existing' as const)
        : ('conflict' as const);
    }
    run.actions.push(action);
    return 'created' as const;
  }

  async finishRun(
    experimentId: string,
    expected: LabAgentRun,
    finished: LabAgentRun,
  ) {
    const experiment = experimentStore.get(experimentId);
    const index = experiment?.runs.findIndex(
      (candidate) => candidate.runId === expected.runId,
    );
    if (!experiment || index === undefined || index < 0) return null;
    const current = experiment.runs[index]!;
    if (current.status !== expected.status) {
      return isSameTerminalRun(current, finished) ? cloneRun(current) : null;
    }
    const persisted = LabAgentRunSchema.parse(structuredClone(finished));
    experiment.runs[index] = persisted;
    return cloneRun(persisted);
  }

  async listExperiments(status?: LabExperimentStatus) {
    return [...experimentStore.values()]
      .filter((experiment) => !status || experiment.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneExperiment);
  }

  async reset() {
    experimentStore.clear();
  }

  resetStatements(): D1PreparedStatement[] {
    return [];
  }
}

export class D1LabRepository implements LabRepository {
  constructor(private readonly database: D1Database) {}

  async saveExperiment(experiment: LabExperiment) {
    const parsed = LabExperimentSchema.parse(experiment);
    const projection = LabExperimentSchema.parse({ ...parsed, runs: [] });
    const updatedAt = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT INTO lab_experiments (
          experiment_id, status, created_at, updated_at, version, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(experiment_id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          version = excluded.version,
          payload_json = excluded.payload_json`,
      )
      .bind(
        parsed.experimentId,
        parsed.status,
        parsed.createdAt,
        updatedAt,
        parsed.version,
        JSON.stringify(projection),
      )
      .run();

    if (parsed.evidence) {
      await this.database
        .prepare(
          `INSERT INTO lab_evidence_records (
            evidence_pack_id, experiment_id, evidence_hash, generated_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(evidence_pack_id) DO NOTHING`,
        )
        .bind(
          parsed.evidence.evidencePackId,
          parsed.experimentId,
          parsed.evidence.evidenceHash,
          parsed.evidence.generatedAt,
          JSON.stringify(parsed.evidence),
        )
        .run();
    }

    if (parsed.analysis) {
      await this.database
        .prepare(
          `INSERT INTO lab_analyses (
            analysis_id, experiment_id, evidence_pack_id, model, created_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(analysis_id) DO NOTHING`,
        )
        .bind(
          parsed.analysis.analysisId,
          parsed.experimentId,
          parsed.analysis.evidencePackId,
          parsed.analysis.model,
          parsed.analysis.createdAt,
          JSON.stringify(parsed.analysis),
        )
        .run();
    }

    if (parsed.selection) {
      await this.database
        .prepare(
          `INSERT INTO lab_selection_results (
            selection_id, experiment_id, mutation_id, selected_at, payload_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(selection_id) DO UPDATE SET
            mutation_id = excluded.mutation_id,
            selected_at = excluded.selected_at,
            payload_json = excluded.payload_json`,
        )
        .bind(
          parsed.selection.selectionId,
          parsed.experimentId,
          parsed.selection.mutationId,
          parsed.selection.selectedAt,
          JSON.stringify(parsed.selection),
        )
        .run();
    }
  }

  async compareAndSwapExperiment(expected: LabExperiment, next: LabExperiment) {
    const persisted = LabExperimentSchema.parse({
      ...next,
      version: expected.version + 1,
      runs: [],
    });
    const result = await this.database
      .prepare(
        `UPDATE lab_experiments
         SET status = ?, updated_at = ?, version = ?, payload_json = ?
         WHERE experiment_id = ? AND status = ? AND version = ?`,
      )
      .bind(
        persisted.status,
        new Date().toISOString(),
        persisted.version,
        JSON.stringify(persisted),
        expected.experimentId,
        expected.status,
        expected.version,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) return null;
    await this.saveArtifactRecords(persisted);
    return this.getExperiment(expected.experimentId);
  }

  private async saveArtifactRecords(experiment: LabExperiment) {
    if (experiment.evidence) {
      await this.database
        .prepare(
          `INSERT INTO lab_evidence_records (
            evidence_pack_id, experiment_id, evidence_hash, generated_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(evidence_pack_id) DO NOTHING`,
        )
        .bind(
          experiment.evidence.evidencePackId,
          experiment.experimentId,
          experiment.evidence.evidenceHash,
          experiment.evidence.generatedAt,
          JSON.stringify(experiment.evidence),
        )
        .run();
    }
    if (experiment.analysis) {
      await this.database
        .prepare(
          `INSERT INTO lab_analyses (
            analysis_id, experiment_id, evidence_pack_id, model, created_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(analysis_id) DO NOTHING`,
        )
        .bind(
          experiment.analysis.analysisId,
          experiment.experimentId,
          experiment.analysis.evidencePackId,
          experiment.analysis.model,
          experiment.analysis.createdAt,
          JSON.stringify(experiment.analysis),
        )
        .run();
    }
    if (experiment.selection) {
      await this.database
        .prepare(
          `INSERT INTO lab_selection_results (
            selection_id, experiment_id, mutation_id, selected_at, payload_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(selection_id) DO UPDATE SET
            mutation_id = excluded.mutation_id,
            selected_at = excluded.selected_at,
            payload_json = excluded.payload_json`,
        )
        .bind(
          experiment.selection.selectionId,
          experiment.experimentId,
          experiment.selection.mutationId,
          experiment.selection.selectedAt,
          JSON.stringify(experiment.selection),
        )
        .run();
    }
  }

  async createRun(experiment: LabExperiment, rawRun: LabAgentRun) {
    const run = LabAgentRunSchema.parse({ ...rawRun, actions: [] });
    const result = await this.database
      .prepare(
        `INSERT INTO lab_agent_runs (
          run_id, experiment_id, population_ordinal, status, persona,
          participant_id, session_id, started_at, finished_at, payload_json
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM lab_experiments
          WHERE experiment_id = ? AND status = 'running'
        )
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        run.runId,
        experiment.experimentId,
        run.populationOrdinal,
        run.status,
        run.persona,
        run.participantId,
        run.sessionId,
        run.startedAt,
        run.finishedAt,
        JSON.stringify(run),
        experiment.experimentId,
      )
      .run();
    return (result.meta.changes ?? 0) === 1 ? run : null;
  }

  async appendAction(
    experimentId: string,
    runId: string,
    rawAction: LabAgentActionRecord,
  ) {
    const action = LabAgentActionRecordSchema.parse(rawAction);
    const result = await this.database
      .prepare(
        `INSERT INTO lab_agent_actions (
          action_id, run_id, experiment_id, ordinal, occurred_at,
          action_type, outcome, payload_json
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM lab_agent_runs
          WHERE run_id = ? AND experiment_id = ? AND status = 'running'
        )
        ON CONFLICT DO NOTHING`,
      )
      .bind(
        action.actionId,
        runId,
        experimentId,
        action.ordinal,
        action.occurredAt,
        action.action,
        action.outcome,
        JSON.stringify(action),
        runId,
        experimentId,
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) return 'created' as const;
    const row = await this.database
      .prepare(
        `SELECT action_id, payload_json FROM lab_agent_actions
         WHERE run_id = ? AND (action_id = ? OR ordinal = ?) LIMIT 1`,
      )
      .bind(runId, action.actionId, action.ordinal)
      .first<{ action_id: string; payload_json: string }>();
    if (!row) return 'conflict' as const;
    const existing = parseStoredLabValue(
      LabAgentActionRecordSchema,
      row.payload_json,
      'Lab action',
      row.action_id,
    );
    return JSON.stringify(existing) === JSON.stringify(action)
      ? ('existing' as const)
      : ('conflict' as const);
  }

  async finishRun(
    experimentId: string,
    expected: LabAgentRun,
    rawFinished: LabAgentRun,
  ) {
    const finished = LabAgentRunSchema.parse({
      ...rawFinished,
      actions: [],
    });
    const result = await this.database
      .prepare(
        `UPDATE lab_agent_runs
         SET status = ?, finished_at = ?, payload_json = ?
         WHERE run_id = ? AND experiment_id = ? AND status = ?`,
      )
      .bind(
        finished.status,
        finished.finishedAt,
        JSON.stringify(finished),
        expected.runId,
        experimentId,
        expected.status,
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) {
      return this.getRun(expected.runId);
    }
    const current = await this.getRun(expected.runId);
    return current && isSameTerminalRun(current, finished) ? current : null;
  }

  private async getRun(runId: string) {
    const row = await this.database
      .prepare('SELECT payload_json FROM lab_agent_runs WHERE run_id = ?')
      .bind(runId)
      .first<{ payload_json: string }>();
    if (!row) return null;
    const run = parseStoredLabValue(
      LabAgentRunSchema,
      row.payload_json,
      'Lab run',
      runId,
    );
    const actions = await this.database
      .prepare(
        `SELECT action_id, payload_json FROM lab_agent_actions
         WHERE run_id = ? ORDER BY ordinal ASC`,
      )
      .bind(runId)
      .all<{ action_id: string; payload_json: string }>();
    return LabAgentRunSchema.parse({
      ...run,
      actions: actions.results.map((action) =>
        parseStoredLabValue(
          LabAgentActionRecordSchema,
          action.payload_json,
          'Lab action',
          action.action_id,
        ),
      ),
    });
  }

  async getExperiment(experimentId: string) {
    const row = await this.database
      .prepare(
        'SELECT payload_json FROM lab_experiments WHERE experiment_id = ?',
      )
      .bind(experimentId)
      .first<{ payload_json: string }>();
    if (!row) return null;
    const projection = parseStoredLabValue(
      LabExperimentSchema,
      row.payload_json,
      'Lab experiment',
      experimentId,
    );
    const [evidenceRow, analysisRow, selectionRow] = await Promise.all([
      this.database
        .prepare(
          `SELECT evidence_pack_id, payload_json FROM lab_evidence_records
           WHERE experiment_id = ? ORDER BY generated_at DESC LIMIT 1`,
        )
        .bind(experimentId)
        .first<{ evidence_pack_id: string; payload_json: string }>(),
      this.database
        .prepare(
          `SELECT analysis_id, payload_json FROM lab_analyses
           WHERE experiment_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(experimentId)
        .first<{ analysis_id: string; payload_json: string }>(),
      this.database
        .prepare(
          `SELECT selection_id, payload_json FROM lab_selection_results
           WHERE experiment_id = ? ORDER BY selected_at DESC LIMIT 1`,
        )
        .bind(experimentId)
        .first<{ selection_id: string; payload_json: string }>(),
    ]);
    const evidence =
      projection.evidence ??
      (evidenceRow
        ? parseStoredLabValue(
            LabExperimentSchema.shape.evidence.unwrap(),
            evidenceRow.payload_json,
            'Lab evidence',
            evidenceRow.evidence_pack_id,
          )
        : null);
    const analysis =
      projection.analysis ??
      (analysisRow
        ? parseStoredLabValue(
            LabExperimentSchema.shape.analysis.unwrap(),
            analysisRow.payload_json,
            'Lab analysis',
            analysisRow.analysis_id,
          )
        : null);
    const selection =
      projection.selection ??
      (selectionRow
        ? parseStoredLabValue(
            LabExperimentSchema.shape.selection.unwrap(),
            selectionRow.payload_json,
            'Lab selection',
            selectionRow.selection_id,
          )
        : null);
    const runRows = await this.database
      .prepare(
        `SELECT run_id FROM lab_agent_runs
         WHERE experiment_id = ? ORDER BY population_ordinal ASC`,
      )
      .bind(experimentId)
      .all<{ run_id: string }>();
    const runs = await Promise.all(
      runRows.results.map((run) => this.getRun(run.run_id)),
    );
    return LabExperimentSchema.parse({
      ...projection,
      evidence,
      analysis,
      selection,
      runs: runs.filter((run): run is LabAgentRun => Boolean(run)),
    });
  }

  async listExperiments(status?: LabExperimentStatus) {
    const statement = status
      ? this.database
          .prepare(
            `SELECT experiment_id FROM lab_experiments
             WHERE status = ? ORDER BY created_at DESC`,
          )
          .bind(status)
      : this.database.prepare(
          'SELECT experiment_id FROM lab_experiments ORDER BY created_at DESC',
        );
    const result = await statement.all<{ experiment_id: string }>();
    const experiments = await Promise.all(
      result.results.map((row) => this.getExperiment(row.experiment_id)),
    );
    return experiments.filter((experiment): experiment is LabExperiment =>
      Boolean(experiment),
    );
  }

  async reset() {
    await this.database.batch(this.resetStatements());
  }

  resetStatements(): D1PreparedStatement[] {
    return [
      this.database.prepare('DELETE FROM lab_selection_results'),
      this.database.prepare('DELETE FROM lab_analyses'),
      this.database.prepare('DELETE FROM lab_evidence_records'),
      this.database.prepare('DELETE FROM lab_agent_actions'),
      this.database.prepare('DELETE FROM lab_agent_runs'),
      this.database.prepare('DELETE FROM lab_experiments'),
    ];
  }
}

const inMemoryLabRepository = new InMemoryLabRepository();

export const getLabRepository = (database?: D1Database): LabRepository =>
  database ? new D1LabRepository(database) : inMemoryLabRepository;

export const resetInMemoryLab = () => inMemoryLabRepository.reset();
