import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import rootPackage from '../../../package.json';

const timestamp = '2026-07-16T12:00:00.000Z';
const webBuildRelease =
  import.meta.env.VITE_DARWIN_RELEASE || rootPackage.version;
const webBuildCommit = import.meta.env.VITE_DARWIN_COMMIT_SHA || 'local';
const expectedWebBuild = `v${webBuildRelease} · ${
  webBuildCommit === 'local' ? webBuildCommit : webBuildCommit.slice(0, 7)
}`;
const repository = {
  owner: 'sjohnston1972',
  name: 'projectflow',
  fullName: 'sjohnston1972/projectflow',
  url: 'https://github.com/sjohnston1972/projectflow',
  branch: 'main',
  baseSha: 'd'.repeat(40),
  sourceHash: 'e'.repeat(64),
  capturedAt: timestamp,
  mutablePaths: ['apps/projectflow/src/App.tsx'],
  protectedPaths: ['.github/**'],
  contextPaths: ['apps/projectflow/src/App.tsx'],
  validationCommands: ['npm run verify'],
  maximumChangedFiles: 4,
  maximumChangedLines: 1200,
  productionUrl: 'https://darwin-projectflow.pages.dev/',
  studyUrl: 'https://darwin-projectflow.pages.dev/?study=true',
} as const;
const applicationMap = {
  source: {
    repositorySha: 'd'.repeat(40),
    sourceHash: 'e'.repeat(64),
  },
  product: {
    name: 'ProjectFlow',
    purpose: 'Project management workspace.',
    primaryUser: 'Knowledge worker.',
    domainEntities: ['project', 'task', 'user'],
    primaryGoals: ['find assigned work'],
  },
  activeGenome: {
    version: 'dddddddddddd',
    navigation: ['Dashboard', 'Projects', 'Reports', 'Settings'],
    capabilities: ['project-scoped task search'],
  },
  interfaceInventory: [
    {
      area: 'dashboard-capacity',
      purpose: 'Inspect workload allocation.',
      primaryActions: ['open capacity report'],
    },
  ],
  routes: ['/study/dashboard'],
  mutableAreas: ['navigation', 'dashboard-capacity'],
  protectedAreas: ['telemetry-history'],
} as const;
const targetConnection = {
  connectionId: 'target-test',
  status: 'connected',
  connectedAt: timestamp,
  verifiedAt: timestamp,
  target: {
    targetId: 'projectflow',
    name: 'ProjectFlow',
    purpose:
      'Task management for creating projects, assigning work, and coordinating delivery.',
    defaultBranch: 'main',
  },
  repository,
  applicationMap,
  checks: [
    {
      id: 'repository',
      label: 'GitHub repository',
      status: 'passed',
      detail: 'sjohnston1972/projectflow at dddddddddddd',
    },
    {
      id: 'contract',
      label: 'Darwin target contract',
      status: 'passed',
      detail: '1 mutable paths, 1 validation commands',
    },
    {
      id: 'runtime',
      label: 'Cloudflare runtime',
      status: 'passed',
      detail: 'darwin-projectflow.pages.dev returned 200',
    },
    {
      id: 'telemetry',
      label: 'Measured study',
      status: 'passed',
      detail: 'Privacy-safe semantic telemetry endpoint configured',
    },
  ],
} as const;
const evidence = {
  evidenceId: 'evidence-measured-test',
  evidenceHash: 'a'.repeat(64),
  generatedAt: timestamp,
  parserVersion: '1.2.0',
  evidenceClass: 'measured',
  study: {
    studyId: 'projectflow-baseline-study',
    appVersion: '1.0.0',
    measuredCommit: repository.baseSha,
    deploymentVerifiedAt: timestamp,
    sourceEventCount: 993,
    participants: 3,
    sessions: 4,
    attempts: 1,
  },
  quality: {
    strength: 'directional',
    score: 60,
    eventCount: 993,
    sessionCount: 4,
    participantCount: 3,
    completedAttemptCount: 1,
    terminalAttemptCount: 1,
    dimensions: {
      volume: { score: 28, observedEvents: 14, minimumEvents: 50 },
      diversity: {
        score: 33,
        observedParticipants: 1,
        minimumParticipants: 3,
        observedSessions: 1,
        minimumSessions: 3,
      },
      completion: {
        score: 33,
        terminalAttempts: 1,
        minimumTerminalAttempts: 3,
      },
      recency: { score: 100, latestEventAt: timestamp, maximumAgeDays: 7 },
      weakestScore: 28,
    },
    limitations: ['Fewer than three independent sessions were observed.'],
  },
  journeys: [
    {
      journeyId: 'J-001',
      appVersion: '1.0.0',
      source: 'real_user',
      viewport: 'desktop',
      eventCount: 2,
      events: [
        {
          eventRef: 'E-001',
          sequence: 1,
          offsetMs: 0,
          eventType: 'hover_intent',
          route: '/study/dashboard',
          targetId: 'capacity-member-1',
          attributes: { durationMs: 1800 },
        },
        {
          eventRef: 'E-002',
          sequence: 2,
          offsetMs: 1900,
          eventType: 'element_clicked',
          route: '/study/dashboard',
          targetId: 'capacity-member-1',
          attributes: { pointerType: 'mouse' },
        },
      ],
    },
  ],
  taskAttempts: [],
  tasks: [],
  frictionSignals: [
    {
      evidenceId: 'EV-001',
      ruleId: 'hover_hesitation',
      ruleVersion: '1.2.0',
      severity: 'medium',
      summary: 'Capacity required a long hover before selection.',
      affectedAttemptIds: [],
      supportingEventIds: ['00000000-0000-4000-8000-000000000001'],
      trace: [
        {
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'hover_intent',
          route: '/study/dashboard',
          targetId: 'capacity-member-1',
        },
      ],
      support: { events: 1, attempts: 0, sessions: 1, participants: 1 },
    },
  ],
  applicationMap: {
    source: applicationMap.source,
    product: {
      name: 'ProjectFlow',
      purpose: 'Project management workspace.',
      primaryUser: 'Knowledge worker.',
      domainEntities: ['project', 'task', 'user'],
      primaryGoals: ['find assigned work'],
    },
    activeGenome: {
      version: 'dddddddddddd',
      navigation: ['Dashboard', 'Projects', 'Reports', 'Settings'],
      capabilities: ['project-scoped task search'],
    },
    interfaceInventory: [
      {
        area: 'dashboard-capacity',
        purpose: 'Inspect workload allocation.',
        primaryActions: ['open capacity report'],
      },
    ],
    routes: ['/study/dashboard'],
    mutableAreas: ['navigation', 'dashboard-capacity'],
    protectedAreas: ['telemetry-history'],
  },
} as const;

const observationRules = [
  'task_abandonment',
  'navigation_loop',
  'hover_hesitation',
  'drag_expectation',
] as const;
const observationEvidence = {
  ...evidence,
  study: { ...evidence.study, sourceEventCount: 84, attempts: 1 },
  taskAttempts: [
    {
      attemptId: 'attempt-observation-test',
      taskId: 'find-assigned-task',
      participantId: 'participant-observation-test',
      sessionId: 'session-observation-test',
      appVersion: '1.0.0',
      source: 'real_user',
      outcome: 'abandoned',
      startedAt: timestamp,
      endedAt: timestamp,
      durationMs: 42_000,
      interactionCount: 9,
      routePath: ['/study/dashboard', '/study/projects'],
      eventIds: ['00000000-0000-4000-8000-000000000001'],
    },
  ],
  frictionSignals: Array.from({ length: 10 }, (_, index) => {
    const sequence = index + 1;
    const eventId = `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
    const ruleId = observationRules[index % observationRules.length]!;
    const targetId = index % 2 === 0 ? 'nav-projects' : 'capacity-member-1';
    return {
      evidenceId: `EV-${sequence.toString().padStart(3, '0')}`,
      ruleId,
      ruleVersion: '1.2.0',
      severity: index < 3 ? 'high' : index < 7 ? 'medium' : 'low',
      taskId: 'find-assigned-task',
      summary: `${ruleId.replaceAll('_', ' ')} recurred on ${targetId}.`,
      affectedAttemptIds: ['attempt-observation-test'],
      supportingEventIds: [eventId],
      trace: [
        {
          eventId,
          sequence,
          eventType: index % 2 === 0 ? 'element_clicked' : 'hover_ended',
          route: '/study/dashboard',
          targetId,
        },
      ],
      support: {
        events: 8 - (index % 4),
        attempts: 1,
        sessions: 1,
        participants: 1,
      },
    };
  }),
};

const makeCandidate = (
  id: string,
  title: string,
  total: number,
  pressureClusterId = 'capacity-clarity',
) => ({
  id,
  title,
  problem: 'Capacity values are not clear before selection.',
  evidenceIds: ['EV-001'],
  pressureClusterIds: [pressureClusterId],
  hypothesis: 'Visible capacity details will reduce hesitation.',
  change: 'Expose allocation details on the capacity control itself.',
  predictedImpact: {
    metric: 'hover hesitation',
    direction: 'decrease',
    rationale: 'The value becomes understandable without exploration.',
  },
  confidence: 0.6,
  scorecard: {
    evidenceStrength: 60,
    userImpact: total,
    feasibility: total,
    validationClarity: total,
    total,
  },
  scope: ['dashboard-capacity'],
  tradeoffs: ['Adds information density to a compact chart.'],
  acceptanceCriteria: ['Allocation is visible on focus and hover.'],
  validationPlan: {
    primaryMetric: 'Median hover duration on capacity controls',
    baseline: '1.8 seconds in the measured journey',
    successThreshold: 'Below 1 second across three sessions',
    guardrails: ['Capacity report opens successfully.'],
  },
  codexBrief: 'Add accessible allocation detail to capacity controls.',
});

const analysis = {
  analysisId: 'analysis-measured-test',
  evidenceId: evidence.evidenceId,
  evidenceHash: evidence.evidenceHash,
  cacheKey: 'b'.repeat(64),
  promptVersion: '3.0.0',
  mode: 'live',
  model: 'gpt-5.6',
  createdAt: timestamp,
  repository,
  evidenceAssessment: {
    summary: 'One measured journey suggests capacity labels need clarity.',
    quality: evidence.quality,
    pressureClusters: [
      {
        id: 'capacity-clarity',
        title: 'Capacity controls require interpretation',
        interpretation: 'The compact bars conceal their allocation values.',
        evidenceIds: ['EV-001'],
        affectedTargets: ['capacity-member-1'],
        userConsequence: 'The user hesitates before opening the report.',
        competingExplanations: ['The user may have been distracted.'],
        mutationOpportunity: 'Reveal allocation values before activation.',
      },
      {
        id: 'capacity-density',
        title: 'Capacity presentation is too dense',
        interpretation: 'The chart makes comparison unnecessarily difficult.',
        evidenceIds: ['EV-001'],
        affectedTargets: ['capacity-member-1'],
        userConsequence: 'The user cannot compare allocations quickly.',
        competingExplanations: ['The labels may simply be too small.'],
        mutationOpportunity: 'Use a more scannable tabular presentation.',
      },
      {
        id: 'capacity-preview-pressure',
        title: 'Capacity lacks progressive disclosure',
        interpretation: 'Useful details are hidden until navigation.',
        evidenceIds: ['EV-001'],
        affectedTargets: ['capacity-member-1'],
        userConsequence: 'The user must leave the dashboard for basic context.',
        competingExplanations: [
          'The dashboard may not be the expected source.',
        ],
        mutationOpportunity: 'Add an inline capacity preview.',
      },
    ],
    selectionRationale: 'This change directly addresses the observed target.',
  },
  selectedMutation: makeCandidate(
    'capacity-context',
    'Reveal capacity context',
    82,
  ),
  alternatives: [
    makeCandidate(
      'capacity-table',
      'Replace bars with a table',
      68,
      'capacity-density',
    ),
    makeCandidate(
      'capacity-preview',
      'Add a capacity preview',
      64,
      'capacity-preview-pressure',
    ),
  ],
  unsupportedIdeasRejected: [],
} as const;

const manifest = {
  manifestId: 'manifest-measured-test',
  manifestHash: 'c'.repeat(64),
  analysisId: analysis.analysisId,
  mutationId: analysis.selectedMutation.id,
  mutationIds: [analysis.selectedMutation.id],
  evidenceHash: evidence.evidenceHash,
  promptVersion: '3.0.0',
  repositoryCommit: repository.baseSha,
  repository,
  createdAt: timestamp,
  brief: analysis.selectedMutation.codexBrief,
  evidenceCitations: ['EV-001'],
  allowedPaths: ['apps/projectflow/src/App.tsx'],
  protectedPaths: ['.github/**'],
  acceptanceCriteria: analysis.selectedMutation.acceptanceCriteria,
  validationCommands: ['npm run verify'],
} as const;

const makeExecution = () => ({
  executionId: 'execution-measured-test',
  manifestId: manifest.manifestId,
  analysisId: analysis.analysisId,
  repository,
  status: 'preview_ready',
  branch: 'darwin/evolution-measured-test',
  baseSha: repository.baseSha,
  headSha: 'f'.repeat(40),
  workflowRunId: 123,
  workflowUrl: 'https://github.com/sjohnston1972/projectflow/actions/runs/123',
  pullRequestNumber: 7,
  pullRequestUrl: 'https://github.com/sjohnston1972/projectflow/pull/7',
  previewUrl:
    'https://darwin-evolution-test.darwin-projectflow.pages.dev/?study=true',
  patch: '@@ live repository patch @@\n-old behavior\n+measured behavior',
  changedFiles: ['apps/projectflow/src/App.tsx'],
  checks: [
    {
      name: 'npm run verify',
      status: 'passed',
      durationMs: 1200,
      output: 'Typecheck, tests, and build passed.',
    },
  ],
  codex: {
    threadId: null,
    finalMessage: 'Implemented the approved measured mutation.',
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
  },
  error: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
});

const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });

const makeArchivedExecution = (executionId: string, shaCharacter: string) => ({
  executionId,
  manifestId: `${manifest.manifestId}-${executionId}`,
  analysisId: analysis.analysisId,
  repository,
  status: 'released',
  branch: `darwin/${executionId}`,
  baseSha: repository.baseSha,
  headSha: shaCharacter.repeat(40),
  workflowRunId: 123,
  workflowUrl: 'https://github.com/sjohnston1972/projectflow/actions/runs/123',
  pullRequestNumber: 7,
  pullRequestUrl: 'https://github.com/sjohnston1972/projectflow/pull/7',
  previewUrl: repository.studyUrl,
  patch: '@@ archived patch @@\n-old behavior\n+measured behavior',
  changedFiles: ['apps/projectflow/src/App.tsx'],
  checks: [
    {
      name: 'npm run verify',
      status: 'passed',
      durationMs: 1200,
      output: 'Typecheck, tests, and build passed.',
    },
  ],
  codex: {
    threadId: null,
    finalMessage: 'Implemented the approved measured mutation.',
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
  },
  error: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp,
});

interface RemoteWorkflow {
  evidence: unknown | null;
  analysis: unknown | null;
  manifest: unknown | null;
  execution: unknown | null;
  failures?: Set<string>;
}

const executionSummary = (execution: Record<string, unknown>) => ({
  executionId: execution.executionId,
  manifestId: execution.manifestId,
  analysisId: execution.analysisId,
  repository: {
    fullName: repository.fullName,
    url: repository.url,
    branch: repository.branch,
    baseSha: repository.baseSha,
    sourceHash: repository.sourceHash,
  },
  status: execution.status,
  branch: execution.branch,
  baseSha: execution.baseSha,
  headSha: execution.headSha,
  changedFileCount: Array.isArray(execution.changedFiles)
    ? execution.changedFiles.length
    : 0,
  checkSummary: {
    total: Array.isArray(execution.checks) ? execution.checks.length : 0,
    passed: Array.isArray(execution.checks)
      ? execution.checks.filter(
          (check) =>
            typeof check === 'object' &&
            check !== null &&
            'status' in check &&
            check.status === 'passed',
        ).length
      : 0,
    failed: Array.isArray(execution.checks)
      ? execution.checks.filter(
          (check) =>
            typeof check === 'object' &&
            check !== null &&
            'status' in check &&
            check.status === 'failed',
        ).length
      : 0,
  },
  hasPatch: typeof execution.patch === 'string',
  hasCodexOutput: execution.codex !== null && execution.codex !== undefined,
  hasError: execution.error !== null && execution.error !== undefined,
  rollback: null,
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt,
  completedAt: execution.completedAt,
});

const observationArchiveSummary = () => ({
  archiveId: 'execution-measured-test',
  evidence: {
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
      terminalAttemptCount: 0,
      completedAttemptCount: 0,
      medianInteractions: null,
    },
  },
  analysis: {
    analysisId: analysis.analysisId,
    model: analysis.model,
    createdAt: analysis.createdAt,
    selectedMutation: {
      id: analysis.selectedMutation.id,
      title: analysis.selectedMutation.title,
    },
  },
  execution: {
    executionId: 'execution-measured-test',
    manifestId: manifest.manifestId,
    status: 'released',
    createdAt: timestamp,
    completedAt: timestamp,
  },
});

const resetExecution = (status: 'queued' | 'failed' | 'complete') => ({
  resetId: `reset-${status}`,
  status,
  repository: {
    fullName: repository.fullName,
    branch: repository.branch,
    studyUrl: repository.studyUrl,
  },
  baselineTag: 'demo-baseline-v3',
  policyHash: 'a'.repeat(64),
  repositoryResetDispatched: status !== 'complete',
  workflowRunId: status === 'complete' ? null : 901,
  workflowUrl:
    status === 'complete'
      ? null
      : 'https://github.com/sjohnston1972/projectflow/actions/runs/901',
  baselineCommit: status === 'complete' ? '1'.repeat(40) : null,
  deploymentVerification: null,
  error: status === 'failed' ? 'Baseline validation failed.' : null,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: status === 'queued' ? null : timestamp,
});

const measuredFitnessOutcome = {
  outcomeId: 'fitness-execution-measured-test',
  executionId: 'execution-measured-test',
  studyId: 'projectflow-baseline-study',
  formulaVersion: '1.0.0',
  status: 'measured',
  generatedAt: timestamp,
  invalidatedAt: null,
  baseline: {
    evidenceId: evidence.evidenceId,
    evidenceHash: evidence.evidenceHash,
    appVersion: '1.0.0',
    measuredCommit: repository.baseSha,
    participants: 3,
    sessions: 3,
    terminalAttempts: 3,
    taskIds: ['find-assigned-task', 'create-project', 'create-assigned-task'],
  },
  evolved: {
    evidenceId: 'evidence-evolved-test',
    evidenceHash: '9'.repeat(64),
    appVersion: '1'.repeat(12),
    measuredCommit: '1'.repeat(40),
    participants: 3,
    sessions: 3,
    terminalAttempts: 3,
    taskIds: ['find-assigned-task', 'create-project', 'create-assigned-task'],
  },
  minimumSample: {
    terminalAttempts: 3,
    sessions: 3,
    participants: 3,
    tasks: 3,
    matchingTaskSet: true,
  },
  components: [
    ['task_completion', 30, 67, 100],
    ['navigation_efficiency', 25, 60, 88],
    ['error_rate', 15, 75, 100],
    ['feature_discovery', 15, 100, 100],
    ['median_duration', 15, 70, 90],
  ].map(([metric, weight, baselineScore, evolvedScore]) => ({
    metric,
    weight,
    baselineScore,
    evolvedScore,
    delta: Number(evolvedScore) - Number(baselineScore),
  })),
  baselineScore: 73,
  evolvedScore: 94,
  delta: 21,
  limitations: [],
};

const labExperiment = {
  experimentId: 'lab-exp-handoff-test',
  studyId: 'projectflow-darwin-lab-handoff-test',
  name: 'Assigned work discovery',
  targetUrl: repository.studyUrl,
  targetAppVersion: '1.0.0',
  task: {
    taskDefinitionId: 'lab-task-handoff-test',
    definitionVersion: 1,
    definitionHash: '7'.repeat(64),
    taskId: 'find-assigned-work',
    name: 'Find assigned work',
    instruction: 'Find and open the work assigned to you.',
    successDescription: 'The assigned work route is reached.',
    startRoute: '/study/dashboard',
    successCriterion: { type: 'route_reached', route: '/study/my-work' },
  },
  populationSize: 8,
  personaAllocation: [{ persona: 'novice', count: 8 }],
  maxActions: 12,
  maxDurationMs: 180_000,
  seed: 1859,
  status: 'analysed',
  runnerId: 'github-actions-test',
  createdAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  runs: [],
  evidence: null,
  analysis: {
    provenance: {
      evidenceClass: 'darwin_lab',
      label: 'Darwin Lab',
      labExperimentId: 'lab-exp-handoff-test',
      taskDefinitionId: 'lab-task-handoff-test',
      taskDefinitionHash: '7'.repeat(64),
      evidencePackId: 'lab-pack-handoff-test',
      evidenceHash: '8'.repeat(64),
      runIds: [],
    },
    analysisId: 'lab-analysis-handoff-test',
    experimentId: 'lab-exp-handoff-test',
    evidencePackId: 'lab-pack-handoff-test',
    evidenceHash: '8'.repeat(64),
    model: 'gpt-5.6',
    promptVersion: '1.0.0',
    createdAt: timestamp,
    summary: 'Assigned work discovery is the dominant selection pressure.',
    selectedMutationId: 'PF-MUT-001',
    mutations: [
      {
        provenance: {
          evidenceClass: 'darwin_lab',
          label: 'Darwin Lab',
          labExperimentId: 'lab-exp-handoff-test',
          taskDefinitionId: 'lab-task-handoff-test',
          taskDefinitionHash: '7'.repeat(64),
          evidencePackId: 'lab-pack-handoff-test',
          evidenceHash: '8'.repeat(64),
          runIds: [],
        },
        mutationId: 'PF-MUT-001',
        title: 'Expose assigned work in primary navigation',
        problem: 'Agents cannot find their assigned tasks from the dashboard.',
        evidenceIds: ['L-EV-001'],
        hypothesis: 'A direct destination will reduce failed discovery paths.',
        implementationBrief: 'Add a bounded My Work navigation destination.',
        tradeoffs: ['Adds one primary navigation item.'],
        validationPlan: 'Rerun the immutable assigned-work behavioural eval.',
        confidence: 0.91,
      },
    ],
  },
  selection: {
    provenance: {
      evidenceClass: 'darwin_lab',
      label: 'Darwin Lab',
      labExperimentId: 'lab-exp-handoff-test',
      taskDefinitionId: 'lab-task-handoff-test',
      taskDefinitionHash: '7'.repeat(64),
      evidencePackId: 'lab-pack-handoff-test',
      evidenceHash: '8'.repeat(64),
      runIds: [],
    },
    selectionId: 'lab-selection-handoff-test',
    experimentId: 'lab-exp-handoff-test',
    mutationId: 'PF-MUT-001',
    selectedAt: timestamp,
    selectedBy: 'operator',
    status: 'approved_for_controlled_implementation',
    manifestId: null,
    executionId: null,
  },
  behaviouralEval: null,
  error: null,
  evidenceError: null,
  archivedAt: null,
  version: 6,
  provenance: {
    evidenceClass: 'darwin_lab',
    label: 'Darwin Lab',
    labExperimentId: 'lab-exp-handoff-test',
    taskDefinitionId: 'lab-task-handoff-test',
    taskDefinitionHash: '7'.repeat(64),
    evidencePackId: null,
    evidenceHash: null,
    runIds: [],
  },
} as const;

const installApi = (
  latestAnalysis: unknown = null,
  initialConnection: unknown = null,
  initialGenomeExecutionsOrReset: Record<string, unknown>[] | unknown = [],
  remoteWorkflow?: RemoteWorkflow,
  latestEvidence: unknown = evidence,
  labExperiments: unknown[] = [],
) => {
  const initialGenomeExecutions = Array.isArray(initialGenomeExecutionsOrReset)
    ? initialGenomeExecutionsOrReset
    : [];
  const initialReset = Array.isArray(initialGenomeExecutionsOrReset)
    ? null
    : initialGenomeExecutionsOrReset;
  let liveExecution: Record<string, unknown> | null = null;
  let liveConnection: unknown = initialConnection;
  let liveReset: unknown = initialReset;
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/lab/experiments')) {
        return response({ experiments: labExperiments });
      }
      if (url.includes('/events/raw?limit=200')) {
        if (remoteWorkflow?.failures?.has('events')) return response({}, 503);
        return response({
          studyId: 'projectflow-baseline-study',
          events: [],
          cursor: 'cursor-test',
          hasMore: false,
          count: 993,
          sessionCounts: {
            'session-one': 320,
            'session-two': 280,
            'session-three': 210,
            'session-four': 183,
          },
          participantCount: 3,
          behaviorSignalCount: 8,
        });
      }
      if (url.endsWith('/events')) {
        return response({
          studyId: 'projectflow-baseline-study',
          count: 14,
          sessionCount: 1,
          participantCount: 1,
          behaviorSignalCount: 8,
        });
      }
      if (url.includes('/api/genome?')) {
        if (remoteWorkflow?.failures?.has('genome')) return response({}, 503);
        const released = liveExecution?.status === 'released';
        return response({
          evolutionCycle: {
            studyId: 'projectflow-baseline-study',
            startedAt: released ? timestamp : null,
            genomeEvolutionCount: released ? 1 : 0,
            measuredCommit: released ? '1'.repeat(40) : null,
            appVersion: released ? '1'.repeat(12) : null,
            deploymentVerifiedAt: released ? timestamp : null,
          },
          executions: liveExecution
            ? [executionSummary(liveExecution)]
            : initialGenomeExecutions.map(executionSummary),
          fitnessOutcomes: released ? [measuredFitnessOutcome] : [],
          page: { limit: 10, nextCursor: null },
        });
      }
      if (url.includes('/api/observations/archives?')) {
        if (remoteWorkflow?.failures?.has('archives')) return response({}, 503);
        const released = liveExecution?.status === 'released';
        return response({
          archives: released ? [observationArchiveSummary()] : [],
          page: { limit: 10, nextCursor: null },
        });
      }
      if (url.endsWith('/api/observations/archives/execution-measured-test')) {
        return response({
          archive: {
            archiveId: 'execution-measured-test',
            evidence,
            analysis,
            execution: {
              executionId: 'execution-measured-test',
              manifestId: manifest.manifestId,
              status: 'released',
              createdAt: timestamp,
              completedAt: timestamp,
            },
          },
          summary: observationArchiveSummary(),
        });
      }
      if (url.endsWith('/api/genome/execution-measured-test')) {
        return response({
          execution: liveExecution,
          summary: executionSummary(liveExecution!),
        });
      }
      if (url.includes('/evidence/latest')) {
        if (remoteWorkflow?.failures?.has('evidence')) return response({}, 503);
        const currentEvidence = remoteWorkflow
          ? remoteWorkflow.evidence
          : latestEvidence;
        return currentEvidence
          ? response(currentEvidence)
          : response(null, 204);
      }
      if (url.includes('/evidence-analysis/latest')) {
        if (remoteWorkflow?.failures?.has('analysis')) return response({}, 503);
        const currentAnalysis = remoteWorkflow
          ? remoteWorkflow.analysis
          : latestAnalysis;
        return currentAnalysis
          ? response(currentAnalysis)
          : response(null, 204);
      }
      if (url.endsWith('/analyse-evidence')) return response(analysis, 201);
      if (url.endsWith('/codex-manifest/execution')) {
        if (init?.method !== 'POST' && remoteWorkflow) {
          if (remoteWorkflow.failures?.has('execution'))
            return response({}, 503);
          return remoteWorkflow.execution
            ? response(remoteWorkflow.execution)
            : response(null, 204);
        }
        if (init?.method !== 'POST' && !liveExecution)
          return response(null, 204);
        liveExecution ??= makeExecution();
        return response(liveExecution, 201);
      }
      if (url.endsWith('/api/repository-executions/execution-measured-test')) {
        return response(liveExecution);
      }
      if (
        url.endsWith(
          '/api/repository-executions/execution-measured-test/rollback/release',
        )
      ) {
        liveExecution = {
          ...liveExecution,
          rollback: {
            ...(liveExecution?.rollback as Record<string, unknown>),
            status: 'released',
            headSha: '2'.repeat(40),
            previewUrl: repository.studyUrl,
            completedAt: timestamp,
          },
        };
        return response(liveExecution);
      }
      if (
        url.endsWith(
          '/api/repository-executions/execution-measured-test/rollback',
        )
      ) {
        liveExecution = {
          ...liveExecution,
          rollback: {
            rollbackId: 'rollback-111111111111',
            status: 'queued',
            branch: 'darwin/rollback-111111111111',
            revertedSha: '1'.repeat(40),
            headSha: null,
            workflowRunId: null,
            workflowUrl: null,
            pullRequestNumber: null,
            pullRequestUrl: null,
            previewUrl: null,
            patch: null,
            changedFiles: [],
            checks: [
              {
                name: 'Git revert generation',
                status: 'pending',
                durationMs: null,
                output: 'Waiting for the controlled rollback workflow.',
              },
            ],
            error: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            completedAt: null,
          },
        };
        return response(liveExecution, 201);
      }
      if (
        url.endsWith(
          '/api/repository-executions/execution-measured-test/release',
        )
      ) {
        liveExecution = {
          ...liveExecution,
          status: 'released',
          headSha: '1'.repeat(40),
          previewUrl: repository.studyUrl,
          deploymentVerification: {
            status: 'verified',
            expectedCommit: '1'.repeat(40),
            expectedAppVersion: '1'.repeat(12),
            observedCommit: '1'.repeat(40),
            observedAppVersion: '1'.repeat(12),
            attempts: 2,
            verifiedAt: timestamp,
            lastError: null,
          },
          completedAt: timestamp,
        };
        return response(liveExecution);
      }
      if (url.includes('/codex-manifest')) {
        if (init?.method !== 'POST' && remoteWorkflow) {
          if (remoteWorkflow.failures?.has('manifest'))
            return response({}, 503);
          return remoteWorkflow.manifest
            ? response(remoteWorkflow.manifest)
            : response({}, 404);
        }
        const requestBody =
          typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const candidates = [
          analysis.selectedMutation,
          ...analysis.alternatives,
        ].filter((entry) => requestBody.mutationIds?.includes(entry.id));
        return response(
          candidates.length
            ? {
                ...manifest,
                mutationId: candidates[0]!.id,
                mutationIds: candidates.map((candidate) => candidate.id),
                brief: candidates
                  .map((candidate) => candidate.codexBrief)
                  .join('\n\n'),
                evidenceCitations: [
                  ...new Set(
                    candidates.flatMap((candidate) => candidate.evidenceIds),
                  ),
                ],
                acceptanceCriteria: candidates.flatMap(
                  (candidate) => candidate.acceptanceCriteria,
                ),
              }
            : manifest,
          201,
        );
      }
      if (url.includes('/api/diagnostics')) {
        return response({
          requestId: 'diagnostics-test',
          generatedAt: timestamp,
          retentionDays: 30,
          events: [
            {
              eventId: 'd7bfb4f3-0984-4af4-88a9-998c341a7785',
              kind: 'audit',
              requestId: 'mutation-request-test',
              occurredAt: timestamp,
              actor: 'operator',
              action: 'mutation.release',
              target:
                '/api/repository-executions/execution-measured-test/release',
              outcome: 'success',
              beforeState: 'preview_ready',
              afterState: 'released',
              provider: null,
              operation: null,
              durationMs: 245,
              errorCode: null,
            },
          ],
          metrics: [
            {
              provider: 'github',
              operation: 'merge_evolution_pull_request',
              count: 2,
              failureCount: 0,
              averageDurationMs: 210,
              maximumDurationMs: 245,
            },
          ],
        });
      }
      if (url.endsWith('/api/health')) {
        return response({
          status: 'ok',
          service: 'darwin-api',
          version: '0.19.1',
          commitSha: 'a'.repeat(40),
          buildId: 'v0.19.1@aaaaaaa',
          retention: {
            status: 'healthy',
            policy: {
              version: '1.0.0',
              rawTelemetryDays: 30,
              workspaceDays: 30,
              derivedEvidenceDays: 90,
              executionArtifactDays: 30,
              fossilRecordDays: 365,
              operationalAuditDays: 90,
              maxEventsPerStudy: 50_000,
              maxEventsPerTarget: 250_000,
            },
            eventCount: 14,
            studyCount: 1,
            largestStudyEventCount: 14,
            expiredRecordCount: 0,
            lastSweepAt: null,
          },
          analysis: {
            mode: 'live',
            model: 'gpt-5.6',
            liveModelAvailable: true,
          },
          timestamp,
        });
      }
      if (url.endsWith('/api/target-connection/disconnect')) {
        liveConnection = null;
        return response(null, 204);
      }
      if (url.endsWith('/api/target-connection')) {
        if (init?.method === 'POST') {
          liveConnection = targetConnection;
          return response(targetConnection, 201);
        }
        return liveConnection ? response(liveConnection) : response(null, 204);
      }
      if (url.endsWith('/api/demo/reset')) {
        if (init?.method === 'POST') {
          liveReset = resetExecution('complete');
          return response(liveReset);
        }
        return liveReset ? response(liveReset) : response(null, 204);
      }
      return response({ error: 'unexpected_test_route', url }, 404);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  window.history.replaceState({}, '', '/');
});

describe('Rosalind control room', () => {
  it('hydrates a deep-linked observation outside the first archive page', async () => {
    window.history.replaceState(
      {},
      '',
      '/?view=observations#observation-execution-measured-test',
    );
    const fetchMock = installApi();

    render(<App />);

    expect(await screen.findByText('Evidence assessment')).toBeVisible();
    expect(
      document.querySelector<HTMLDetailsElement>(
        '#observation-execution-measured-test',
      )?.open,
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(
          '/api/observations/archives/execution-measured-test',
        ),
      ),
    ).toHaveLength(1);
  });

  it('keeps the control room as a concise operational overview', async () => {
    const fetchMock = installApi();
    render(<App />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Rosalind — Helping your software adapt.',
      }),
    ).toBeVisible();
    expect(
      document.querySelector('img[src*="darwin-dna-wireframe"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open measured study/ }),
    ).toHaveAttribute('href', expect.stringContaining('study=true'));
    expect(
      screen.getByRole('link', { name: 'Target application' }),
    ).toHaveAttribute('href', '/?view=target');
    const workspaceLinks = within(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).getAllByRole('link');
    expect(workspaceLinks.at(-1)).toHaveAccessibleName('Darwin Labs');
    expect(
      document.body.textContent?.replaceAll('Darwin Labs', ''),
    ).not.toMatch(/\bDarwin\b/);
    expect(screen.getByRole('link', { name: 'Control room' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByText('Observe 10,000 interactions'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Versioned outcome validation'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Deterministic mock/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Live mutation portfolio ready'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Standalone ProjectFlow' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Repository genome · --' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('Selection pressure')).toBeVisible();
    const measuredSessions = screen
      .getByText('Measured sessions')
      .closest('article');
    expect(measuredSessions).not.toBeNull();
    expect(within(measuredSessions!).getByText('4')).toBeVisible();
    expect(
      within(measuredSessions!).getByText('3 anonymous participants'),
    ).toBeVisible();
    expect(screen.getByText('Fitness delta')).toBeVisible();
    expect(screen.getByText('Release confidence')).toBeVisible();
    const navigation = screen.getByRole('navigation', {
      name: 'Primary navigation',
    });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      'Control room',
      'Target application',
      'Observations',
      'Mutations',
      'Genome',
      'Darwin Labs',
    ]);
    expect(
      within(navigation).getByRole('link', { name: 'Observations' }),
    ).toHaveAttribute('href', '/?view=observations');
    expect(
      within(navigation).getByRole('link', { name: 'Mutations' }),
    ).toHaveAttribute('href', '/?view=mutations');
    expect(
      within(navigation).queryByRole('link', { name: 'System status' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open system status' }),
    ).toHaveAttribute('href', '/?view=status');
    expect(
      screen.queryByRole('heading', { name: 'Live study evidence' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Evolved · v1.1')).not.toBeInTheDocument();
    document
      .querySelectorAll<HTMLImageElement>('.brand-mark')
      .forEach((mark) => {
        expect(mark.src).toContain('/assets/darwin-growth-mark.png');
      });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/events/raw?limit=200'),
        expect.objectContaining({ signal: expect.anything() }),
      ),
    );
  });

  it('shows redacted operational diagnostics in System status', async () => {
    window.history.replaceState({}, '', '/?view=status');
    installApi();
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Operational diagnostics' }),
    ).toBeVisible();
    expect(screen.getByText('Provider latency')).toBeVisible();
    expect(screen.getByText('github')).toBeVisible();
    expect(screen.getByText(/merge_evolution_pull_request/)).toBeVisible();
    expect(screen.getByText('Privileged transitions')).toBeVisible();
    expect(screen.getByText('mutation.release')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
  });

  it('shows live GPT pressure clusters, ranked mutations, and Codex handoff', async () => {
    window.history.replaceState({}, '', '/?view=mutations');
    const fetchMock = installApi();
    const { rerender } = render(<App />);

    const evidenceSummary = await screen.findByText(
      'Evidence and mutation reasoning',
    );
    const evidenceDisclosure = evidenceSummary.closest('details');
    expect(evidenceDisclosure).not.toHaveAttribute('open');
    fireEvent.click(evidenceSummary);
    expect(evidenceDisclosure).toHaveAttribute('open');

    const ask = await screen.findByRole('button', { name: 'Ask gpt-5.6' });
    expect(ask).toBeEnabled();
    fireEvent.click(ask);

    expect(await screen.findByText('Reveal capacity context')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getAllByText('Capacity controls require interpretation').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText('Ranked pressure portfolio')).toBeVisible();
    expect(screen.getAllByText('82%').length).toBeGreaterThan(0);
    expect(screen.getByText('68%')).toBeVisible();
    expect(screen.getByText('64%')).toBeVisible();
    expect(screen.getByText('Replace bars with a table')).toBeVisible();
    expect(await screen.findByText('Measured validation plan')).toBeVisible();
    expect(
      screen
        .getAllByText('capacity-clarity')
        .find((element) => element.hasAttribute('data-explain')),
    ).toHaveAttribute(
      'data-explain',
      expect.stringContaining('grouped selection pressure'),
    );
    expect(
      screen.getAllByText('EV-001', { selector: '.evidence-chip' })[0],
    ).toHaveAttribute(
      'data-explain',
      expect.stringContaining('Support: 1 events'),
    );
    expect(
      screen.getAllByRole('link', { name: 'Open EV-001 in Observations' })[0],
    ).toHaveAttribute('href', '/?view=observations#signal-EV-001');

    const primary = screen.getByRole('checkbox', {
      name: 'Implement Reveal capacity context',
    });
    const alternative = screen.getByRole('checkbox', {
      name: 'Implement Replace bars with a table',
    });
    const secondAlternative = screen.getByRole('checkbox', {
      name: 'Implement Add a capacity preview',
    });
    await waitFor(() => expect(primary).toBeChecked());
    fireEvent.click(primary);
    expect(primary).not.toBeChecked();
    fireEvent.click(alternative);
    expect(alternative).toBeChecked();
    fireEvent.click(alternative);
    expect(alternative).not.toBeChecked();
    fireEvent.click(alternative);
    fireEvent.click(secondAlternative);
    expect(alternative).toBeChecked();
    expect(secondAlternative).toBeChecked();

    fireEvent.click(
      screen.getByRole('button', { name: /Replace bars with a table/ }),
    );
    expect(screen.getAllByText('Measured validation plan')).toHaveLength(2);
    expect(
      screen.getAllByText('Capacity presentation is too dense').length,
    ).toBeGreaterThanOrEqual(2);

    fireEvent.click(
      screen.getByRole('button', { name: 'Start controlled evolution' }),
    );
    expect(
      await screen.findByText('MANIFEST manifest-measured-test'),
    ).toBeVisible();
    expect(await screen.findByText('Codex execution')).toBeVisible();
    expect(
      await screen.findByRole('button', { name: 'Release reviewed mutation' }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Release reviewed mutation' }),
    );
    expect(await screen.findByText('Mutation workspace')).toBeVisible();
    window.history.replaceState({}, '', '/?view=observations');
    rerender(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Observation archive' }),
    ).toBeVisible();
    expect(
      within(
        screen.getByLabelText('Verified measurement boundary'),
      ).getAllByText('111111111111').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Informed mutation')).toBeVisible();
    const observationArtifact = document.querySelector<HTMLDetailsElement>(
      '#observation-execution-measured-test',
    );
    expect(observationArtifact?.open).toBe(false);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(
          '/api/observations/archives/execution-measured-test',
        ),
      ),
    ).toHaveLength(0);
    fireEvent.click(
      observationArtifact!.querySelector(':scope > summary') as HTMLElement,
    );
    expect(await screen.findByText('Evidence assessment')).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(
          '/api/observations/archives/execution-measured-test',
        ),
      ),
    ).toHaveLength(1);
    expect(
      screen.getAllByText('Reveal capacity context', { exact: false }).length,
    ).toBeGreaterThanOrEqual(2);
    window.history.replaceState({}, '', '/?view=genome');
    rerender(<App />);
    const executionArtifact = await waitFor(() => {
      const artifact = document.querySelector<HTMLDetailsElement>(
        '#fossil-execution-measured-test',
      );
      expect(artifact).not.toBeNull();
      return artifact!;
    });
    expect(executionArtifact?.open).toBe(false);
    expect(
      within(executionArtifact).getByText('Reveal capacity context'),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith('/api/genome/execution-measured-test'),
      ),
    ).toHaveLength(0);
    fireEvent.click(
      executionArtifact!.querySelector(':scope > summary') as HTMLElement,
    );
    expect(screen.getByText('73/100 → 94/100')).toBeVisible();
    expect(screen.getByText('formula 1.0.0')).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Codex execution record' }),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith('/api/genome/execution-measured-test'),
      ),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/analyse-evidence'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/codex-manifest'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          mutationIds: ['capacity-table', 'capacity-preview'],
        }),
      }),
    );
  });

  it('hydrates an approved Darwin Lab mutation into the Mutations workspace', async () => {
    window.history.replaceState({}, '', '/?view=mutations');
    installApi(null, null, [], undefined, evidence, [labExperiment]);

    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'Expose assigned work in primary navigation',
      }),
    ).toBeVisible();
    expect(screen.getByText('Darwin Lab handoff')).toBeVisible();
    expect(screen.getByText('L-EV-001')).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Prepare and dispatch ProjectFlow mutation',
      }),
    ).toBeEnabled();
  });

  it('connects, verifies, and disconnects ProjectFlow from the target view', async () => {
    window.history.replaceState({}, '', '/?view=target');
    const fetchMock = installApi();
    render(<App />);

    expect(screen.queryByText(/Baseline v1\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Evolved v1\.1/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Connect a target application' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Target application' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Control room' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByText('Rosalind API')).toBeVisible();
    expect(await screen.findByText('No repository is connected')).toBeVisible();
    expect(screen.getByLabelText('GitHub repository')).toHaveValue(
      'sjohnston1972/projectflow',
    );
    const connectButton = screen.getByRole('button', {
      name: 'Connect ProjectFlow',
    });
    await waitFor(() => expect(connectButton).toBeEnabled());
    fireEvent.click(connectButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/target-connection'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Cloudflare runtime')).toBeVisible();
    expect(
      screen.getByText('darwin.target.json', { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open measured study' }),
    ).toHaveAttribute('href', 'http://localhost:5174/?study=true');
    expect(
      screen.getByRole('link', { name: 'Open production deployment' }),
    ).toHaveAttribute('href', 'http://localhost:5174/');
    expect(
      screen.getByRole('link', { name: 'Open GitHub repository' }),
    ).toHaveAttribute('href', repository.url);
    expect(
      screen.getByText('Connected').closest('.connection-actions'),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/target-connection'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fullName: repository.fullName,
          branch: repository.branch,
          productionUrl: 'http://localhost:5174/',
          studyUrl: 'http://localhost:5174/?study=true',
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('No repository is connected')).toBeVisible();
  });

  it('uses the connected repository snapshot as the active genome', async () => {
    window.history.replaceState({}, '', '/?view=status');
    installApi(null, targetConnection);
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: `Repository genome · ${repository.baseSha.slice(0, 12)}`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open system status' }),
    ).toHaveAttribute('aria-current', 'page');
    const runtimePanel = screen
      .getByRole('heading', { name: 'Runtime connected' })
      .closest('aside');
    expect(runtimePanel).not.toBeNull();
    const workerStatus = within(runtimePanel!)
      .getByText('Worker API')
      .closest('div');
    expect(workerStatus).not.toBeNull();
    expect(
      within(workerStatus!).getByText('v0.19.1 · aaaaaaa · online'),
    ).toBeVisible();
    const controlRoomStatus = within(runtimePanel!)
      .getByText('Control room')
      .closest('div');
    expect(controlRoomStatus).not.toBeNull();
    expect(
      within(controlRoomStatus!).getByText(expectedWebBuild),
    ).toBeVisible();
    const retentionStatus = screen
      .getByText('Storage retention')
      .closest('div');
    expect(retentionStatus).not.toBeNull();
    expect(
      within(retentionStatus!).getByText(
        '14 / 250,000 events · 0 expired · awaiting first sweep',
      ),
    ).toBeVisible();
  });

  it('does not restore reasoning produced from an older evidence pack', async () => {
    window.history.replaceState({}, '', '/?view=mutations');
    installApi({
      ...analysis,
      evidenceId: 'evidence-stale-test',
      evidenceHash: 'd'.repeat(64),
    });
    render(<App />);

    expect(
      await screen.findByText('Evidence and mutation reasoning'),
    ).toBeVisible();
    expect(
      screen.queryByText('Reveal capacity context'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask gpt-5.6' })).toBeEnabled();
  });

  it('hydrates workflow state created by another operator on live refresh', async () => {
    window.history.replaceState({}, '', '/?view=mutations');
    const remoteWorkflow: RemoteWorkflow = {
      evidence,
      analysis: null,
      manifest: null,
      execution: null,
    };
    installApi(null, null, [], remoteWorkflow);
    render(<App />);

    fireEvent.click(await screen.findByText('Evidence and mutation reasoning'));
    expect(
      await screen.findByText('Evidence pack evidence-measured-test'),
    ).toBeVisible();
    expect(
      screen.queryByText('Reveal capacity context'),
    ).not.toBeInTheDocument();

    remoteWorkflow.analysis = analysis;
    remoteWorkflow.manifest = manifest;
    remoteWorkflow.execution = makeExecution();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh live telemetry' }),
    );

    expect(await screen.findByText('Reveal capacity context')).toBeVisible();
    expect(
      await screen.findByText('MANIFEST manifest-measured-test'),
    ).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Codex execution' }),
    ).toBeVisible();
  });

  it('reports named subsystem failures without discarding healthy state', async () => {
    window.history.replaceState({}, '', '/?view=observations');
    installApi(null, null, [], {
      evidence,
      analysis: null,
      manifest: null,
      execution: null,
      failures: new Set(['genome']),
    });
    render(<App />);

    expect(
      await screen.findByText('Evidence pack evidence-measured-test'),
    ).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Genome: request returned 503',
    );
  });

  it('persists the light theme from the header control', () => {
    installApi();
    render(<App />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    );

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('darwin-theme')).toBe('light');
    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeVisible();
  });

  it('keeps detailed telemetry separate from the mutation workspace', async () => {
    window.history.replaceState({}, '', '/?view=observations');
    const fetchMock = installApi(
      null,
      null,
      [],
      undefined,
      observationEvidence,
    );
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Observations' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: 'Live study evidence' }),
    ).toBeVisible();
    expect(await screen.findByText('incremental updates')).toBeVisible();
    expect(screen.getByText(/Last update/)).toBeVisible();
    expect(
      await screen.findByText('Evidence pack evidence-measured-test'),
    ).toBeVisible();
    expect(screen.getByText('directional')).toBeVisible();
    expect(screen.getByText('Volume')).toBeVisible();
    expect(screen.getByText('28/100')).toBeVisible();
    expect(screen.getByText('Diversity')).toBeVisible();
    expect(screen.getByText('Completion')).toBeVisible();
    expect(screen.getByText('Recency')).toBeVisible();
    const studyCounts = screen.getByLabelText('Real study counts');
    expect(within(studyCounts).getByText('4')).toBeVisible();
    expect(within(studyCounts).getByText('3')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Ask gpt-5.6' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Observations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', {
        name: 'Ranked by severity and independent support',
      }),
    ).toBeVisible();
    // The full signal inspector is collapsed by default to reduce clutter.
    fireEvent.click(
      document.querySelector(
        '#signal-inspector-disclosure > summary',
      ) as HTMLElement,
    );
    expect(
      screen.getByRole('heading', {
        name: 'Exact detector output and raw event links',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: /Inspect task abandonment on nav-projects/i,
      }),
    ).toBeVisible();
    expect(screen.getByLabelText('Severity')).toBeVisible();
    expect(screen.getByLabelText('Rule / event')).toBeVisible();
    expect(screen.getByLabelText('Target')).toBeVisible();
    expect(screen.getByLabelText('Session')).toBeVisible();
    expect(screen.getByLabelText('Task')).toBeVisible();
    expect(screen.getByText('1–8 of 10')).toBeVisible();
    expect(document.getElementById('signal-EV-001')).not.toBeNull();
    expect(document.getElementById('signal-EV-010')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.getElementById('signal-EV-010')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Severity'), {
      target: { value: 'high' },
    });
    expect(await screen.findByText('3 of 10 signals')).toBeVisible();
    expect(screen.getByText('1–3 of 3')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Severity'), {
      target: { value: 'all' },
    });
    const firstSignal = await waitFor(() => {
      const row = document.getElementById('signal-EV-001');
      expect(row).not.toBeNull();
      return row as HTMLDetailsElement;
    });
    fireEvent.click(
      firstSignal.querySelector(':scope > summary') as HTMLElement,
    );
    expect(
      within(firstSignal).getByText('Canonical evidence trace'),
    ).toBeVisible();
    expect(
      within(firstSignal).getByText(/outside the latest loaded trace window/i),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh live telemetry' }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes('/events/raw?limit=200'),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('locks measured study access while a baseline reset is incomplete', async () => {
    installApi(null, null, resetExecution('queued'));
    render(<App />);

    expect(
      await screen.findByText('Reset queued in GitHub Actions'),
    ).toBeVisible();
    const studyLink = screen.getByText('Measured study locked').closest('a');
    expect(studyLink).toHaveAttribute('aria-disabled', 'true');
    expect(studyLink).not.toHaveAttribute('href');
    expect(
      screen.getByRole('button', { name: 'Reset evolution demo' }),
    ).toBeDisabled();
  });

  it('keeps a visible reset failure and allows a clean retry', async () => {
    const fetchMock = installApi(null, null, resetExecution('failed'));
    render(<App />);

    expect(
      await screen.findByText('Baseline validation failed.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry reset' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/demo/reset'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            confirmation: 'RESET DARWIN DEMO',
            exportAcknowledged: true,
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Baseline validation failed.'),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows the Genome in its own workspace', async () => {
    window.history.replaceState({}, '', '/?view=genome');
    installApi();
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Genome' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Genome' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Genome' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('heading', { name: 'Live study evidence' }),
    ).not.toBeInTheDocument();
  });

  it('uses unique execution IDs and resolvable ARIA references in Genome', async () => {
    window.history.replaceState({}, '', '/?view=genome');
    installApi(null, null, [
      makeArchivedExecution('execution-one', '1'),
      makeArchivedExecution('execution-two', '2'),
    ]);
    render(<App />);

    await waitFor(() =>
      expect(document.querySelectorAll('.fossil-artifact')).toHaveLength(2),
    );

    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    for (const element of document.querySelectorAll<HTMLElement>(
      '[aria-labelledby], [aria-describedby], [aria-controls]',
    )) {
      for (const attribute of [
        'aria-labelledby',
        'aria-describedby',
        'aria-controls',
      ]) {
        const references = element.getAttribute(attribute)?.split(/\s+/) ?? [];
        for (const reference of references) {
          expect(
            document.getElementById(reference),
            `${attribute} must resolve ${reference}`,
          ).not.toBeNull();
        }
      }
    }
  });
});
