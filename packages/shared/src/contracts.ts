import { z } from 'zod';

import { DarwinProvenanceSchema } from './provenance';

export const PersonaSchema = z.enum([
  'project_manager',
  'developer',
  'executive',
  'administrator',
]);

export const OrganismVariantSchema = z.enum(['baseline', 'evolved']);

export const WorkflowGoalSchema = z.enum([
  'find_assigned_tasks',
  'create_task',
  'update_task',
  'review_project_health',
  'review_reports',
  'manage_members',
  'configure_workspace',
]);

export const TelemetryEventTypeSchema = z.enum([
  'page_view',
  'click',
  'search',
  'workflow_started',
  'workflow_completed',
  'workflow_abandoned',
  'validation_error',
  'backtrack',
]);

export const TelemetryEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  persona: PersonaSchema,
  variant: OrganismVariantSchema,
  goal: WorkflowGoalSchema,
  type: TelemetryEventTypeSchema,
  route: z.string().min(1),
  target: z.string().optional(),
  timestamp: z.string().datetime(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const StudyIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const StudyRouteSchema = z.string().min(1).max(256).startsWith('/');
const SemanticTargetSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const StudyTelemetrySourceSchema = z.enum([
  'real_user',
  'automated',
  'synthetic',
]);

export const ViewportClassSchema = z.enum(['mobile', 'tablet', 'desktop']);
export const PointerTypeSchema = z.enum(['mouse', 'touch', 'pen', 'unknown']);

export const InteractionSignalTypeSchema = z.enum([
  'rage_click',
  'false_affordance',
  'unexpected_double_click',
  'element_indecision',
  'cursor_thrashing',
]);

const StudyEventBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    sessionId: StudyIdentifierSchema,
    participantId: StudyIdentifierSchema,
    studyId: StudyIdentifierSchema,
    appVersion: z.string().min(1).max(32),
    source: StudyTelemetrySourceSchema,
    provenance: DarwinProvenanceSchema.optional(),
    occurredAt: z.string().datetime(),
    sequence: z.number().int().nonnegative(),
    route: StudyRouteSchema,
    viewport: ViewportClassSchema,
  })
  .strict();

export const SessionStartedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('session_started'),
});

export const SessionEndedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('session_ended'),
  durationMs: z.number().int().nonnegative(),
});

export const PageViewEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('page_view'),
});

export const ElementClickedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('element_clicked'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      pointerType: PointerTypeSchema,
      interactive: z.boolean(),
      clickCount: z.number().int().min(1).max(3),
      xRatio: z.number().min(0).max(1),
      yRatio: z.number().min(0).max(1),
      hoverToClickMs: z.number().int().nonnegative().max(600_000).nullable(),
    })
    .strict()
    .optional(),
});

export const HoverStartedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('hover_started'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z.object({ pointerType: PointerTypeSchema }).strict(),
});

export const HoverEndedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('hover_ended'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      pointerType: PointerTypeSchema,
      durationMs: z.number().int().nonnegative().max(600_000),
      clicked: z.boolean(),
      immediateExit: z.boolean(),
      hoverToClickMs: z.number().int().nonnegative().max(600_000).nullable(),
    })
    .strict(),
});

export const PointerTransitionEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('pointer_transition'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      pointerType: PointerTypeSchema,
      fromTargetId: SemanticTargetSchema.optional(),
      elapsedMs: z.number().int().nonnegative().max(600_000),
    })
    .strict(),
});

export const InteractionSignalEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('interaction_signal'),
  targetId: SemanticTargetSchema.optional(),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      signal: InteractionSignalTypeSchema,
      pointerType: PointerTypeSchema,
      count: z.number().int().positive().max(100),
      windowMs: z.number().int().nonnegative().max(600_000),
      relatedTargetIds: z.array(SemanticTargetSchema).max(4).optional(),
    })
    .strict(),
});

export const DragAttemptedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('drag_attempted'),
  targetId: SemanticTargetSchema.optional(),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      pointerType: PointerTypeSchema,
      draggable: z.boolean(),
      distancePx: z.number().int().nonnegative().max(10_000),
    })
    .strict(),
});

export const TouchCancelledEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('touch_cancelled'),
  targetId: SemanticTargetSchema.optional(),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      pointerType: z.literal('touch'),
      durationMs: z.number().int().nonnegative().max(600_000),
    })
    .strict(),
});

export const RouteChangedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('route_changed'),
  properties: z
    .object({
      fromRoute: StudyRouteSchema,
    })
    .strict(),
});

export const BrowserNavigationEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('browser_navigation'),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      direction: z.enum(['back', 'forward']),
      fromRoute: StudyRouteSchema,
      toRoute: StudyRouteSchema,
    })
    .strict(),
});

export const ViewportZoomChangedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('viewport_zoom_changed'),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      fromScale: z.number().min(0.25).max(5),
      toScale: z.number().min(0.25).max(5),
    })
    .strict(),
});

export const ValidationErrorEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('validation_error'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      fieldId: SemanticTargetSchema,
      errorCode: SemanticTargetSchema,
    })
    .strict(),
});

export const SearchPerformedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('search_performed'),
  targetId: SemanticTargetSchema,
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      queryLength: z.number().int().min(0).max(512),
      resultCount: z.number().int().nonnegative().max(10_000),
    })
    .strict(),
});

export const TaskStartedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('task_started'),
  taskAttemptId: StudyIdentifierSchema,
  taskId: StudyIdentifierSchema,
});

export const TaskCompletedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('task_completed'),
  taskAttemptId: StudyIdentifierSchema,
  taskId: StudyIdentifierSchema,
  durationMs: z.number().int().nonnegative(),
  outcome: z.literal('success'),
});

export const TaskFailedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('task_failed'),
  taskAttemptId: StudyIdentifierSchema,
  taskId: StudyIdentifierSchema,
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(['failed', 'abandoned']),
});

export const FeedbackSubmittedEventSchema = StudyEventBaseSchema.extend({
  eventType: z.literal('feedback_submitted'),
  taskAttemptId: StudyIdentifierSchema.optional(),
  taskId: StudyIdentifierSchema.optional(),
  properties: z
    .object({
      length: z.number().int().min(0).max(500),
    })
    .strict(),
});

export const StudyTelemetryEventSchema = z.discriminatedUnion('eventType', [
  SessionStartedEventSchema,
  SessionEndedEventSchema,
  PageViewEventSchema,
  ElementClickedEventSchema,
  HoverStartedEventSchema,
  HoverEndedEventSchema,
  PointerTransitionEventSchema,
  InteractionSignalEventSchema,
  DragAttemptedEventSchema,
  TouchCancelledEventSchema,
  RouteChangedEventSchema,
  BrowserNavigationEventSchema,
  ViewportZoomChangedEventSchema,
  ValidationErrorEventSchema,
  SearchPerformedEventSchema,
  TaskStartedEventSchema,
  TaskCompletedEventSchema,
  TaskFailedEventSchema,
  FeedbackSubmittedEventSchema,
]);

export const TelemetryBatchSchema = z
  .object({
    events: z.array(StudyTelemetryEventSchema).min(1).max(50),
  })
  .strict();

export const TelemetryReceiptSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative().default(0),
  sequenceConflicts: z.number().int().nonnegative().default(0),
});

export const OperationalTelemetryMetricsSchema = z.object({
  updatedAt: z.string().datetime().nullable(),
  telemetryRequests: z.number().int().nonnegative(),
  acceptedEvents: z.number().int().nonnegative(),
  rejectedEvents: z.number().int().nonnegative(),
  duplicateEvents: z.number().int().nonnegative(),
  authenticationRejected: z.number().int().nonnegative(),
  replayRejected: z.number().int().nonnegative(),
  contextRejected: z.number().int().nonnegative(),
  rateLimited: z.number().int().nonnegative(),
});

export const RetentionPolicySchema = z.object({
  version: z.literal('1.0.0'),
  rawTelemetryDays: z.literal(30),
  workspaceDays: z.literal(30),
  derivedEvidenceDays: z.literal(90),
  executionArtifactDays: z.literal(30),
  fossilRecordDays: z.literal(365),
  operationalAuditDays: z.literal(90),
  maxEventsPerStudy: z.number().int().positive(),
  maxEventsPerTarget: z.number().int().positive(),
});

export const RetentionHealthSchema = z.object({
  status: z.enum(['healthy', 'attention']),
  policy: RetentionPolicySchema,
  eventCount: z.number().int().nonnegative(),
  studyCount: z.number().int().nonnegative(),
  largestStudyEventCount: z.number().int().nonnegative(),
  expiredRecordCount: z.number().int().nonnegative(),
  lastSweepAt: z.string().datetime().nullable(),
});

export const RetentionDeletedCountsSchema = z.object({
  telemetryEvents: z.number().int().nonnegative(),
  workspaces: z.number().int().nonnegative(),
  evidencePacks: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  manifests: z.number().int().nonnegative(),
  executions: z.number().int().nonnegative(),
  callbackArtifacts: z.number().int().nonnegative(),
  validations: z.number().int().nonnegative(),
});

export const RetentionSweepResultSchema = z.object({
  status: z.literal('completed'),
  policyVersion: z.literal('1.0.0'),
  completedAt: z.string().datetime(),
  compactedExecutions: z.number().int().nonnegative(),
  deleted: RetentionDeletedCountsSchema,
});

export const RetentionDeletionResponseSchema = z.object({
  status: z.literal('deleted'),
  scope: z.enum(['participant', 'study', 'execution']),
  studyId: StudyIdentifierSchema.optional(),
  participantId: StudyIdentifierSchema.optional(),
  executionId: StudyIdentifierSchema.optional(),
  deleted: RetentionDeletedCountsSchema,
});

const storedAt = { receivedAt: z.string().datetime() };
export const StoredTelemetryEventSchema = z.discriminatedUnion('eventType', [
  SessionStartedEventSchema.extend(storedAt),
  SessionEndedEventSchema.extend(storedAt),
  PageViewEventSchema.extend(storedAt),
  ElementClickedEventSchema.extend(storedAt),
  HoverStartedEventSchema.extend(storedAt),
  HoverEndedEventSchema.extend(storedAt),
  PointerTransitionEventSchema.extend(storedAt),
  InteractionSignalEventSchema.extend(storedAt),
  DragAttemptedEventSchema.extend(storedAt),
  TouchCancelledEventSchema.extend(storedAt),
  RouteChangedEventSchema.extend(storedAt),
  BrowserNavigationEventSchema.extend(storedAt),
  ViewportZoomChangedEventSchema.extend(storedAt),
  ValidationErrorEventSchema.extend(storedAt),
  SearchPerformedEventSchema.extend(storedAt),
  TaskStartedEventSchema.extend(storedAt),
  TaskCompletedEventSchema.extend(storedAt),
  TaskFailedEventSchema.extend(storedAt),
  FeedbackSubmittedEventSchema.extend(storedAt),
]);

export const StudyEventsResponseSchema = z.object({
  studyId: StudyIdentifierSchema,
  events: z.array(StoredTelemetryEventSchema),
  cursor: z.string().min(1).max(500).nullable(),
  hasMore: z.boolean(),
  count: z.number().int().nonnegative(),
  sessionCounts: z.record(z.string(), z.number().int().nonnegative()),
  participantCount: z.number().int().nonnegative(),
  behaviorSignalCount: z.number().int().nonnegative(),
});

export const StudyTelemetrySummarySchema = z
  .object({
    studyId: StudyIdentifierSchema,
    count: z.number().int().nonnegative(),
    sessionCount: z.number().int().nonnegative(),
    participantCount: z.number().int().nonnegative(),
    behaviorSignalCount: z.number().int().nonnegative(),
  })
  .strict();

export const StudySessionResponseSchema = z.object({
  studyId: StudyIdentifierSchema,
  sessionId: StudyIdentifierSchema,
  events: z.array(StoredTelemetryEventSchema),
});

export const StudyEvidenceClassSchema = z.enum([
  'human_study',
  'automated_study',
  'darwin_lab',
]);

export const StudySessionIssueRequestSchema = z
  .object({
    studyId: StudyIdentifierSchema,
    appVersion: z.string().min(1).max(32),
    evidenceClass: StudyEvidenceClassSchema,
    labExperimentId: StudyIdentifierSchema.nullable().default(null),
    runId: StudyIdentifierSchema.nullable().default(null),
  })
  .strict()
  .superRefine((request, context) => {
    const hasLabIdentity = Boolean(request.labExperimentId && request.runId);
    if ((request.evidenceClass === 'darwin_lab') !== hasLabIdentity) {
      context.addIssue({
        code: 'custom',
        message: 'Darwin Lab sessions require an experiment and run identity.',
      });
    }
  });

export const StudySessionClaimsSchema = z
  .object({
    version: z.literal(1),
    studyId: StudyIdentifierSchema,
    participantId: StudyIdentifierSchema,
    sessionId: StudyIdentifierSchema,
    appVersion: z.string().min(1).max(32),
    evidenceClass: StudyEvidenceClassSchema,
    source: z.enum(['real_user', 'automated']),
    targetId: z.literal('projectflow'),
    deploymentOrigin: z.string().url(),
    labExperimentId: StudyIdentifierSchema.nullable(),
    runId: StudyIdentifierSchema.nullable(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const StudySessionIssueResponseSchema = z
  .object({
    token: z.string().min(32).max(4_096),
    claims: StudySessionClaimsSchema,
    expiresAt: z.string().datetime(),
  })
  .strict();

export const ProjectFlowProjectSchema = z.object({
  id: StudyIdentifierSchema,
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(8),
  owner: z.string().min(1).max(80),
  status: z.enum(['On track', 'At risk', 'Overdue']),
  dueDate: z.string().min(1).max(32),
});

export const ProjectFlowTaskSchema = z.object({
  id: StudyIdentifierSchema,
  projectId: StudyIdentifierSchema,
  title: z.string().min(1).max(160),
  assignee: z.string().min(1).max(80),
  status: z.enum(['To do', 'In progress', 'Done']),
  dueDate: z.string().min(1).max(32),
});

export const ProjectFlowWorkspaceSchema = z.object({
  projects: z.array(ProjectFlowProjectSchema).max(100),
  tasks: z.array(ProjectFlowTaskSchema).max(500),
  updatedAt: z.string().datetime(),
});

export const ParticipantWorkspaceResponseSchema = z.object({
  studyId: StudyIdentifierSchema,
  participantId: StudyIdentifierSchema,
  workspace: ProjectFlowWorkspaceSchema.nullable(),
});

export const EvidenceClassSchema = z.enum([
  'measured',
  'automated',
  'predicted',
  'synthetic',
]);

export const TaskAttemptSchema = z.object({
  attemptId: StudyIdentifierSchema,
  taskId: StudyIdentifierSchema,
  participantId: StudyIdentifierSchema,
  sessionId: StudyIdentifierSchema,
  appVersion: z.string().min(1),
  source: StudyTelemetrySourceSchema,
  outcome: z.enum(['success', 'failed', 'abandoned', 'open']),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  interactionCount: z.number().int().nonnegative(),
  routePath: z.array(StudyRouteSchema),
  eventIds: z.array(z.string().uuid()).min(1),
});

export const FrictionRuleSchema = z.enum([
  'navigation_loop',
  'repeated_target',
  'task_abandonment',
  'excess_path_length',
  'validation_friction',
  'search_dependency',
  'rage_click',
  'false_affordance',
  'hover_hesitation',
  'cursor_indecision',
  'drag_expectation',
  'touch_conflict',
  'browser_back_dependency',
  'zoom_readability',
]);

export const EvidenceTraceEventSchema = z.object({
  eventId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string().min(1),
  route: StudyRouteSchema,
  targetId: SemanticTargetSchema.optional(),
});

const EvidenceAttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const EvidenceJourneyEventSchema = z.object({
  eventRef: z.string().regex(/^E-\d{3}$/),
  sequence: z.number().int().nonnegative(),
  offsetMs: z.number().int().nonnegative(),
  eventType: z.string().min(1),
  route: StudyRouteSchema,
  targetId: SemanticTargetSchema.optional(),
  attributes: z.record(z.string(), EvidenceAttributeValueSchema),
});

export const EvidenceJourneySchema = z.object({
  journeyId: z.string().regex(/^J-\d{3}$/),
  appVersion: z.string().min(1),
  source: z.enum(['real_user', 'automated']),
  viewport: ViewportClassSchema,
  eventCount: z.number().int().positive(),
  events: z.array(EvidenceJourneyEventSchema).min(1).max(500),
});

export const EvidenceQualitySchema = z.object({
  strength: z.enum(['insufficient', 'directional', 'substantial']),
  score: z.number().int().min(0).max(100),
  eventCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  completedAttemptCount: z.number().int().nonnegative(),
  terminalAttemptCount: z.number().int().nonnegative(),
  dimensions: z.object({
    volume: z.object({
      score: z.number().int().min(0).max(100),
      observedEvents: z.number().int().nonnegative(),
      minimumEvents: z.number().int().positive(),
    }),
    diversity: z.object({
      score: z.number().int().min(0).max(100),
      observedParticipants: z.number().int().nonnegative(),
      minimumParticipants: z.number().int().positive(),
      observedSessions: z.number().int().nonnegative(),
      minimumSessions: z.number().int().positive(),
    }),
    completion: z.object({
      score: z.number().int().min(0).max(100),
      terminalAttempts: z.number().int().nonnegative(),
      minimumTerminalAttempts: z.number().int().positive(),
    }),
    recency: z.object({
      score: z.number().int().min(0).max(100),
      latestEventAt: z.string().datetime(),
      maximumAgeDays: z.number().int().positive(),
    }),
    weakestScore: z.number().int().min(0).max(100),
  }),
  limitations: z.array(z.string().min(1)),
});

export const EvidenceSignalIdentifierSchema = z
  .string()
  .regex(/^(?:EV-(?:\d{3}|[a-f0-9]{12})|L-EV-\d{3})$/);

export const EvidenceSignalSchema = z.object({
  evidenceId: EvidenceSignalIdentifierSchema,
  ruleId: FrictionRuleSchema,
  ruleVersion: z.enum(['1.0.0', '1.1.0', '1.2.0', '1.3.0']),
  severity: z.enum(['low', 'medium', 'high']),
  taskId: StudyIdentifierSchema.optional(),
  summary: z.string().min(1),
  affectedAttemptIds: z.array(StudyIdentifierSchema),
  supportingEventIds: z.array(z.string().uuid()).min(1),
  trace: z.array(EvidenceTraceEventSchema).min(1).max(12),
  support: z.object({
    events: z.number().int().positive(),
    attempts: z.number().int().nonnegative(),
    sessions: z.number().int().positive(),
    participants: z.number().int().positive(),
  }),
});

export const EvidenceTaskSummarySchema = z.object({
  taskId: StudyIdentifierSchema,
  attempts: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
  medianDurationMs: z.number().int().nonnegative().nullable(),
  medianInteractions: z.number().nonnegative().nullable(),
  optimalInteractions: z.number().int().positive(),
  topPaths: z.array(
    z.object({
      path: z.array(StudyRouteSchema),
      count: z.number().int().positive(),
    }),
  ),
});

export const EvidenceApplicationMapSchema = z.object({
  source: z.object({
    repositorySha: z.string().regex(/^[a-f0-9]{40}$/),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  product: z.object({
    name: z.literal('ProjectFlow'),
    purpose: z.string().min(1),
    primaryUser: z.string().min(1),
    domainEntities: z.array(z.string().min(1)).min(1),
    primaryGoals: z.array(z.string().min(1)).min(1),
  }),
  activeGenome: z.object({
    version: z.string().min(1),
    navigation: z.array(z.string().min(1)).min(1),
    capabilities: z.array(z.string().min(1)).min(1),
  }),
  interfaceInventory: z
    .array(
      z.object({
        area: z.string().min(1),
        purpose: z.string().min(1),
        primaryActions: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  routes: z.array(StudyRouteSchema).min(1),
  mutableAreas: z.array(z.string().min(1)),
  protectedAreas: z.array(z.string().min(1)),
});

const HistoricalEvidenceQualitySchema = EvidenceQualitySchema.pick({
  strength: true,
  score: true,
  eventCount: true,
  sessionCount: true,
  participantCount: true,
  completedAttemptCount: true,
  limitations: true,
});

const HistoricalEvidenceApplicationMapSchema =
  EvidenceApplicationMapSchema.omit({
    source: true,
    activeGenome: true,
  }).extend({
    activeVariant: z.object({
      name: OrganismVariantSchema,
      version: z.string().min(1),
      navigation: z.array(z.string().min(1)).min(1),
      capabilities: z.array(z.string().min(1)).min(1),
    }),
  });

const EvidencePackBaseSchema = z.object({
  evidenceId: StudyIdentifierSchema,
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  evidenceClass: EvidenceClassSchema,
  provenance: DarwinProvenanceSchema.optional(),
  study: z.object({
    studyId: StudyIdentifierSchema,
    appVersion: z.string().min(1),
    measuredCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable()
      .default(null),
    deploymentVerifiedAt: z.string().datetime().nullable().default(null),
    sourceEventCount: z.number().int().nonnegative(),
    participants: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    attempts: z.number().int().nonnegative(),
  }),
  taskAttempts: z.array(TaskAttemptSchema),
  tasks: z.array(EvidenceTaskSummarySchema),
  journeys: z.array(EvidenceJourneySchema).min(1).max(50),
  frictionSignals: z.array(EvidenceSignalSchema),
});

export const EvidencePackSchema = EvidencePackBaseSchema.extend({
  parserVersion: z.enum(['1.0.0', '1.1.0', '1.2.0', '1.3.0']),
  quality: EvidenceQualitySchema,
  applicationMap: EvidenceApplicationMapSchema,
});

export const HistoricalEvidencePackSchema = EvidencePackBaseSchema.extend({
  parserVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']),
  quality: HistoricalEvidenceQualitySchema,
  applicationMap: HistoricalEvidenceApplicationMapSchema,
});

export const StoredEvidencePackSchema = z.union([
  EvidencePackSchema,
  HistoricalEvidencePackSchema,
]);

export const EvidenceMutationCandidateSchema = z.object({
  provenance: DarwinProvenanceSchema.optional(),
  id: StudyIdentifierSchema,
  title: z.string().min(1),
  problem: z.string().min(1),
  evidenceIds: z.array(EvidenceSignalIdentifierSchema).min(1),
  pressureClusterIds: z.array(StudyIdentifierSchema).min(1),
  hypothesis: z.string().min(1),
  change: z.string().min(1),
  predictedImpact: z.object({
    metric: z.string().min(1),
    direction: z.enum(['increase', 'decrease']),
    rationale: z.string().min(1),
  }),
  confidence: z.number().min(0).max(1),
  scorecard: z.object({
    evidenceStrength: z.number().int().min(0).max(100),
    userImpact: z.number().int().min(0).max(100),
    feasibility: z.number().int().min(0).max(100),
    validationClarity: z.number().int().min(0).max(100),
    total: z.number().int().min(0).max(100),
  }),
  scope: z.array(z.string().min(1)).min(1),
  tradeoffs: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  validationPlan: z.object({
    primaryMetric: z.string().min(1),
    baseline: z.string().min(1),
    successThreshold: z.string().min(1),
    guardrails: z.array(z.string().min(1)).min(1),
  }),
  codexBrief: z.string().min(1),
});

export const EvidencePressureClusterSchema = z.object({
  id: StudyIdentifierSchema,
  title: z.string().min(1),
  interpretation: z.string().min(1),
  evidenceIds: z.array(EvidenceSignalIdentifierSchema).min(1),
  affectedTargets: z.array(SemanticTargetSchema),
  userConsequence: z.string().min(1),
  competingExplanations: z.array(z.string().min(1)).min(1),
  mutationOpportunity: z.string().min(1),
});

export const RepositoryContextSchema = z.object({
  owner: StudyIdentifierSchema,
  name: StudyIdentifierSchema,
  fullName: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  url: z.string().url(),
  branch: StudyIdentifierSchema,
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
  mutablePaths: z.array(z.string().min(1)).min(1),
  protectedPaths: z.array(z.string().min(1)).min(1),
  contextPaths: z.array(z.string().min(1)).min(1),
  validationCommands: z.array(z.string().min(1)).min(1),
  maximumChangedFiles: z.number().int().positive(),
  maximumChangedLines: z.number().int().positive(),
  productionUrl: z.string().url(),
  studyUrl: z.string().url(),
});

export const TargetConnectionRequestSchema = z
  .object({
    fullName: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    branch: StudyIdentifierSchema,
    productionUrl: z.string().url(),
    studyUrl: z.string().url(),
  })
  .strict();

export const TargetConnectionCheckSchema = z.object({
  id: z.enum(['repository', 'contract', 'runtime', 'telemetry']),
  label: z.string().min(1),
  status: z.literal('passed'),
  detail: z.string().min(1),
});

export const TargetApplicationConnectionSchema = z.object({
  connectionId: StudyIdentifierSchema,
  status: z.literal('connected'),
  connectedAt: z.string().datetime(),
  verifiedAt: z.string().datetime(),
  target: z.object({
    targetId: SemanticTargetSchema,
    name: z.string().min(1),
    purpose: z.string().min(1),
    defaultBranch: StudyIdentifierSchema,
  }),
  repository: RepositoryContextSchema,
  ingestion: z
    .object({
      credentialId: StudyIdentifierSchema,
      targetId: SemanticTargetSchema,
      studyIds: z.array(StudyIdentifierSchema).min(1),
      allowedOrigins: z.array(z.string().url()).min(1),
      signatureAlgorithm: z.literal('hmac-sha256'),
      issuedAt: z.string().datetime(),
    })
    .optional(),
  applicationMap: EvidenceApplicationMapSchema,
  checks: z.array(TargetConnectionCheckSchema).length(4),
});

const EvidenceAssessmentSchema = z.object({
  summary: z.string().min(1),
  quality: EvidenceQualitySchema,
  pressureClusters: z.array(EvidencePressureClusterSchema).min(1).max(8),
  selectionRationale: z.string().min(1),
});

export const EvidenceAnalysisSchema = z.object({
  provenance: DarwinProvenanceSchema.optional(),
  analysisId: StudyIdentifierSchema,
  evidenceId: StudyIdentifierSchema,
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.enum(['1.0.0', '1.1.0', '2.0.0', '2.1.0', '3.0.0']),
  mode: z.literal('live'),
  model: z.string().min(1),
  promptCache: z
    .object({
      key: z.string().min(1).max(64),
      contextVersion: z.string().min(1),
      retention: z.literal('24h'),
      cachedTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  repository: RepositoryContextSchema.optional(),
  evidenceAssessment: EvidenceAssessmentSchema,
  selectedMutation: EvidenceMutationCandidateSchema,
  alternatives: z.array(EvidenceMutationCandidateSchema).min(2).max(5),
  unsupportedIdeasRejected: z.array(
    z.object({
      idea: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
});

export const HistoricalEvidenceAnalysisSchema = EvidenceAnalysisSchema.extend({
  evidenceAssessment: EvidenceAssessmentSchema.extend({
    quality: HistoricalEvidenceQualitySchema,
  }),
});

export const StoredEvidenceAnalysisSchema = z.union([
  EvidenceAnalysisSchema,
  HistoricalEvidenceAnalysisSchema,
]);

export const CodexImplementationManifestSchema = z.object({
  provenance: DarwinProvenanceSchema.optional(),
  manifestId: StudyIdentifierSchema,
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  analysisId: StudyIdentifierSchema,
  mutationId: StudyIdentifierSchema,
  mutationIds: z.array(StudyIdentifierSchema).min(1).max(6).optional(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.enum(['1.0.0', '1.1.0', '2.0.0', '2.1.0', '3.0.0']),
  repositoryCommit: z.string().min(1),
  repository: RepositoryContextSchema.optional(),
  createdAt: z.string().datetime(),
  brief: z.string().min(1),
  evidenceCitations: z.array(EvidenceSignalIdentifierSchema).min(1),
  allowedPaths: z.array(z.string().min(1)).min(1),
  protectedPaths: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  validationCommands: z.array(z.string().min(1)).min(1),
});

export const CodexManifestRequestSchema = z
  .object({
    mutationId: StudyIdentifierSchema.optional(),
    mutationIds: z
      .array(StudyIdentifierSchema)
      .min(1)
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Mutation IDs must be unique.',
      })
      .optional(),
  })
  .refine((request) => !(request.mutationId && request.mutationIds), {
    message: 'Use mutationId or mutationIds, not both.',
  });

export const SimulationRunSchema = z.object({
  id: z.string().min(1),
  seed: z.number().int(),
  variant: OrganismVariantSchema,
  eventCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const SimulationRequestSchema = z
  .object({
    seed: z.number().int().default(1859),
    variant: OrganismVariantSchema.default('baseline'),
  })
  .strict();

export const SimulationMetricsSchema = z.object({
  sessions: z.number().int().positive(),
  workflowCompletionRate: z.number().min(0).max(1),
  workflowAbandonmentRate: z.number().min(0).max(1),
  averagePageViewsPerWorkflow: z.number().nonnegative(),
  averageBacktracksPerWorkflow: z.number().nonnegative(),
  searchUsageRate: z.number().min(0).max(1),
  validationErrorRate: z.number().min(0).max(1),
  medianWorkflowDurationMs: z.number().nonnegative(),
});

export const FrictionSignalSchema = z.object({
  key: z.enum([
    'workflow_abandonment',
    'navigation_overhead',
    'backtracking',
    'search_dependency',
    'validation_errors',
  ]),
  value: z.number().nonnegative(),
  unit: z.enum(['rate', 'events_per_workflow', 'page_views', 'count']),
});

export const SimulationSummarySchema = z.object({
  run: SimulationRunSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  personaCounts: z.record(z.number().int().nonnegative()),
  eventTypeCounts: z.record(z.number().int().nonnegative()),
  goalCounts: z.record(z.number().int().nonnegative()),
  routeCounts: z.record(z.number().int().nonnegative()),
  metrics: SimulationMetricsSchema,
  frictionSignals: z.array(FrictionSignalSchema),
});

export const SimulationResultSchema = z.object({
  run: SimulationRunSchema,
  events: z.array(TelemetryEventSchema),
  summary: SimulationSummarySchema,
});

export const SimulationCreateResponseSchema = z.object({
  run: SimulationRunSchema,
  summary: SimulationSummarySchema,
});

export const DemoResetRequestSchema = z
  .object({
    confirmation: z.literal('RESET DARWIN DEMO'),
    exportAcknowledged: z.literal(true),
  })
  .strict();

export const RepositoryExecutionStatusSchema = z.enum([
  'prepared',
  'queued',
  'codex_running',
  'validating',
  'failed',
  'pull_request_open',
  'preview_ready',
  'releasing',
  'deployment_verifying',
  'released',
]);

export const RepositoryDeploymentVerificationSchema = z.object({
  status: z.enum(['verifying', 'verified']),
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  expectedAppVersion: z.string().min(1).max(32),
  observedCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  observedAppVersion: z.string().min(1).max(32).nullable(),
  attempts: z.number().int().nonnegative(),
  verifiedAt: z.string().datetime().nullable(),
  lastError: z.string().min(1).max(500).nullable(),
});

export const DemoResetStatusSchema = z.enum([
  'queued',
  'running',
  'validating',
  'deploying',
  'complete',
  'failed',
]);

export const DemoResetExecutionSchema = z.object({
  resetId: StudyIdentifierSchema,
  status: DemoResetStatusSchema,
  // Optimistic-concurrency token. Every persisted transition increments this,
  // and the destructive reset (see reset-execution.ts / telemetry-repository.ts)
  // only commits via a DB-level compare-and-swap on (status, version) so a
  // stale or concurrent worker can never re-run the destructive step.
  version: z.number().int().nonnegative().default(0),
  repository: z.object({
    fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    branch: z.string().min(1).max(200),
    studyUrl: z.string().url(),
  }),
  baselineTag: z.string().min(1).max(100),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  repositoryResetDispatched: z.boolean(),
  workflowRunId: z.number().int().positive().nullable(),
  workflowUrl: z.string().url().nullable(),
  baselineCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  deploymentVerification:
    RepositoryDeploymentVerificationSchema.nullable().default(null),
  error: z.string().min(1).max(4_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const DemoResetCallbackSchema = DemoResetExecutionSchema.pick({
  workflowRunId: true,
  workflowUrl: true,
  baselineCommit: true,
  error: true,
})
  .partial()
  .extend({
    status: z.enum(['running', 'validating', 'deploying', 'failed']),
  });

export const DemoResetResponseSchema = DemoResetExecutionSchema;

export const RepositoryExecutionCheckSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['pending', 'running', 'passed', 'failed']),
  durationMs: z.number().int().nonnegative().nullable(),
  output: z.string().max(20_000),
});

export const RepositoryRollbackStatusSchema = z.enum([
  'prepared',
  'queued',
  'validating',
  'failed',
  'pull_request_open',
  'preview_ready',
  'releasing',
  'released',
]);

export const RepositoryRollbackSchema = z.object({
  rollbackId: StudyIdentifierSchema,
  status: RepositoryRollbackStatusSchema,
  branch: z.string().min(1),
  revertedSha: z.string().regex(/^[a-f0-9]{40}$/),
  headSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  workflowRunId: z.number().int().positive().nullable(),
  workflowUrl: z.string().url().nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  pullRequestUrl: z.string().url().nullable(),
  previewUrl: z.string().url().nullable(),
  patch: z.string().max(500_000).nullable(),
  changedFiles: z.array(z.string().min(1).max(500)).max(100),
  checks: z.array(RepositoryExecutionCheckSchema).max(50),
  error: z.string().max(4_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const RepositoryMutationExecutionSchema = z.object({
  provenance: DarwinProvenanceSchema.optional(),
  executionId: StudyIdentifierSchema,
  revision: z.number().int().nonnegative().default(0),
  manifestId: StudyIdentifierSchema,
  manifestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  analysisId: StudyIdentifierSchema,
  repository: RepositoryContextSchema,
  status: RepositoryExecutionStatusSchema,
  branch: z.string().min(1),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  headSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  workflowRunId: z.number().int().positive().nullable(),
  workflowUrl: z.string().url().nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  pullRequestUrl: z.string().url().nullable(),
  previewUrl: z.string().url().nullable(),
  patch: z.string().max(500_000).nullable(),
  changedFiles: z.array(z.string().min(1).max(500)).max(100),
  checks: z.array(RepositoryExecutionCheckSchema).max(50),
  codex: z.object({
    threadId: z.string().min(1).nullable(),
    finalMessage: z.string().max(100_000).nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  deploymentVerification:
    RepositoryDeploymentVerificationSchema.nullable().default(null),
  rollback: RepositoryRollbackSchema.nullable().default(null),
  error: z.string().max(4_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const EvolutionCycleSchema = z.object({
  studyId: StudyIdentifierSchema,
  startedAt: z.string().datetime().nullable(),
  genomeEvolutionCount: z.number().int().nonnegative(),
  measuredCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable()
    .default(null),
  appVersion: z.string().min(1).max(32).nullable().default(null),
  deploymentVerifiedAt: z.string().datetime().nullable().default(null),
});

export const CursorPageSchema = z.object({
  limit: z.number().int().min(1).max(25),
  nextCursor: z.string().min(1).max(500).nullable(),
});

export const RepositoryRollbackSummarySchema = RepositoryRollbackSchema.pick({
  rollbackId: true,
  status: true,
  revertedSha: true,
  headSha: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).extend({
  changedFileCount: z.number().int().nonnegative(),
  checkSummary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  hasPatch: z.boolean(),
  hasError: z.boolean(),
});

export const RepositoryExecutionSummarySchema =
  RepositoryMutationExecutionSchema.pick({
    provenance: true,
    executionId: true,
    manifestId: true,
    analysisId: true,
    status: true,
    branch: true,
    baseSha: true,
    headSha: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
  }).extend({
    repository: RepositoryContextSchema.pick({
      fullName: true,
      url: true,
      branch: true,
      baseSha: true,
      sourceHash: true,
    }),
    changedFileCount: z.number().int().nonnegative(),
    checkSummary: z.object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    hasPatch: z.boolean(),
    hasCodexOutput: z.boolean(),
    hasError: z.boolean(),
    rollback: RepositoryRollbackSummarySchema.nullable(),
  });

export const FitnessFormulaVersionSchema = z.literal('1.0.0');

export const FitnessCohortSchema = z.object({
  evidenceId: StudyIdentifierSchema,
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  appVersion: z.string().min(1).max(32),
  measuredCommit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  participants: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  terminalAttempts: z.number().int().nonnegative(),
  taskIds: z.array(StudyIdentifierSchema),
});

export const FitnessComponentSchema = z.object({
  metric: z.enum([
    'task_completion',
    'navigation_efficiency',
    'error_rate',
    'feature_discovery',
    'median_duration',
  ]),
  weight: z.number().int().positive().max(100),
  baselineScore: z.number().int().min(0).max(100),
  evolvedScore: z.number().int().min(0).max(100),
  delta: z.number().int().min(-100).max(100),
});

export const FitnessOutcomeSchema = z.object({
  outcomeId: StudyIdentifierSchema,
  executionId: StudyIdentifierSchema,
  studyId: StudyIdentifierSchema,
  formulaVersion: FitnessFormulaVersionSchema,
  status: z.enum(['measured', 'insufficient', 'rolled_back']),
  generatedAt: z.string().datetime(),
  invalidatedAt: z.string().datetime().nullable(),
  baseline: FitnessCohortSchema,
  evolved: FitnessCohortSchema,
  minimumSample: z.object({
    terminalAttempts: z.number().int().positive(),
    sessions: z.number().int().positive(),
    participants: z.number().int().positive(),
    tasks: z.number().int().positive(),
    matchingTaskSet: z.literal(true),
  }),
  components: z.array(FitnessComponentSchema).max(5),
  baselineScore: z.number().int().min(0).max(100).nullable(),
  evolvedScore: z.number().int().min(0).max(100).nullable(),
  delta: z.number().int().min(-100).max(100).nullable(),
  limitations: z.array(z.string().min(1).max(500)).max(30),
});

export const GenomeHistoryResponseSchema = z.object({
  evolutionCycle: EvolutionCycleSchema,
  executions: z.array(RepositoryExecutionSummarySchema).max(25),
  fitnessOutcomes: z.array(FitnessOutcomeSchema).default([]),
  page: CursorPageSchema,
});

export const GenomeExecutionDetailResponseSchema = z.object({
  execution: RepositoryMutationExecutionSchema,
  summary: RepositoryExecutionSummarySchema,
});

export const ObservationArchiveSchema = z.object({
  archiveId: StudyIdentifierSchema,
  evidence: StoredEvidencePackSchema,
  analysis: StoredEvidenceAnalysisSchema,
  execution: RepositoryMutationExecutionSchema.pick({
    provenance: true,
    executionId: true,
    manifestId: true,
    status: true,
    createdAt: true,
    completedAt: true,
  }),
});

export const ObservationArchiveSummarySchema = z.object({
  archiveId: StudyIdentifierSchema,
  evidence: EvidencePackBaseSchema.pick({
    provenance: true,
    evidenceId: true,
    evidenceHash: true,
    generatedAt: true,
    evidenceClass: true,
    study: true,
  }).extend({
    quality: EvidenceQualitySchema.pick({ strength: true, score: true }),
    signalCount: z.number().int().nonnegative(),
    fitness: z.object({
      terminalAttemptCount: z.number().int().nonnegative(),
      completedAttemptCount: z.number().int().nonnegative(),
      medianInteractions: z.number().nonnegative().nullable(),
    }),
  }),
  analysis: EvidenceAnalysisSchema.pick({
    provenance: true,
    analysisId: true,
    model: true,
    createdAt: true,
  }).extend({
    selectedMutation: EvidenceMutationCandidateSchema.pick({
      provenance: true,
      id: true,
      title: true,
    }),
  }),
  execution: RepositoryMutationExecutionSchema.pick({
    provenance: true,
    executionId: true,
    manifestId: true,
    status: true,
    createdAt: true,
    completedAt: true,
  }),
});

export const ObservationArchivesResponseSchema = z.object({
  archives: z.array(ObservationArchiveSummarySchema).max(25),
  page: CursorPageSchema,
});

export const ObservationArchiveDetailResponseSchema = z.object({
  archive: ObservationArchiveSchema,
  summary: ObservationArchiveSummarySchema,
});

export const RepositoryExecutionCallbackSchema =
  RepositoryMutationExecutionSchema.pick({
    status: true,
    headSha: true,
    workflowRunId: true,
    workflowUrl: true,
    pullRequestNumber: true,
    pullRequestUrl: true,
    previewUrl: true,
    patch: true,
    changedFiles: true,
    checks: true,
    codex: true,
    deploymentVerification: true,
    error: true,
    completedAt: true,
  })
    .partial()
    .extend({ status: RepositoryExecutionStatusSchema });

export const RepositoryRollbackCallbackSchema = RepositoryRollbackSchema.pick({
  status: true,
  headSha: true,
  workflowRunId: true,
  workflowUrl: true,
  pullRequestNumber: true,
  pullRequestUrl: true,
  previewUrl: true,
  patch: true,
  changedFiles: true,
  checks: true,
  error: true,
  completedAt: true,
})
  .partial()
  .extend({ status: RepositoryRollbackStatusSchema });

export const OperationalProviderSchema = z.enum([
  'd1',
  'openai',
  'github',
  'target',
]);

export const OperationalOutcomeSchema = z.enum(['success', 'failure']);

export const OperationalEventSchema = z.object({
  eventId: z.string().uuid(),
  kind: z.enum(['audit', 'metric']),
  requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  occurredAt: z.string().datetime(),
  actor: z.enum([
    'operator',
    'viewer',
    'local-development',
    'projectflow',
    'repository-callback',
    'anonymous',
    'system',
  ]),
  action: z.string().min(1).max(120),
  target: z.string().min(1).max(240),
  outcome: OperationalOutcomeSchema,
  beforeState: z.string().min(1).max(120).nullable(),
  afterState: z.string().min(1).max(120).nullable(),
  provider: OperationalProviderSchema.nullable(),
  operation: z.string().min(1).max(120).nullable(),
  durationMs: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(120).nullable(),
});

export const OperationalMetricSummarySchema = z.object({
  provider: OperationalProviderSchema,
  operation: z.string().min(1).max(120),
  count: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  averageDurationMs: z.number().int().nonnegative(),
  maximumDurationMs: z.number().int().nonnegative(),
});

export const DiagnosticsResponseSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  generatedAt: z.string().datetime(),
  retentionDays: z.literal(30),
  events: z.array(OperationalEventSchema).max(100),
  metrics: z.array(OperationalMetricSummarySchema).max(100),
});

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('darwin-api'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  commitSha: z.union([
    z
      .string()
      .length(40)
      .regex(/^[a-f0-9]+$/),
    z.literal('local'),
  ]),
  buildId: z.string().min(1),
  retention: RetentionHealthSchema,
  analysis: z.object({
    mode: z.literal('live'),
    model: z.string().min(1),
    liveModelAvailable: z.boolean(),
  }),
  timestamp: z.string().datetime(),
});

export type Persona = z.infer<typeof PersonaSchema>;
export type OrganismVariant = z.infer<typeof OrganismVariantSchema>;
export type WorkflowGoal = z.infer<typeof WorkflowGoalSchema>;
export type TelemetryEventType = z.infer<typeof TelemetryEventTypeSchema>;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type StudyTelemetrySource = z.infer<typeof StudyTelemetrySourceSchema>;
export type ViewportClass = z.infer<typeof ViewportClassSchema>;
export type StudyTelemetryEvent = z.infer<typeof StudyTelemetryEventSchema>;
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
export type TelemetryReceipt = z.infer<typeof TelemetryReceiptSchema>;
export type OperationalTelemetryMetrics = z.infer<
  typeof OperationalTelemetryMetricsSchema
>;
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;
export type RetentionHealth = z.infer<typeof RetentionHealthSchema>;
export type RetentionDeletedCounts = z.infer<
  typeof RetentionDeletedCountsSchema
>;
export type RetentionSweepResult = z.infer<typeof RetentionSweepResultSchema>;
export type RetentionDeletionResponse = z.infer<
  typeof RetentionDeletionResponseSchema
>;
export type StoredTelemetryEvent = z.infer<typeof StoredTelemetryEventSchema>;
export type StudyEventsResponse = z.infer<typeof StudyEventsResponseSchema>;
export type StudyTelemetrySummary = z.infer<typeof StudyTelemetrySummarySchema>;
export type StudySessionResponse = z.infer<typeof StudySessionResponseSchema>;
export type StudyEvidenceClass = z.infer<typeof StudyEvidenceClassSchema>;
export type StudySessionIssueRequest = z.infer<
  typeof StudySessionIssueRequestSchema
>;
export type StudySessionClaims = z.infer<typeof StudySessionClaimsSchema>;
export type StudySessionIssueResponse = z.infer<
  typeof StudySessionIssueResponseSchema
>;
export type ProjectFlowProject = z.infer<typeof ProjectFlowProjectSchema>;
export type ProjectFlowTask = z.infer<typeof ProjectFlowTaskSchema>;
export type ProjectFlowWorkspace = z.infer<typeof ProjectFlowWorkspaceSchema>;
export type ParticipantWorkspaceResponse = z.infer<
  typeof ParticipantWorkspaceResponseSchema
>;
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;
export type FrictionRule = z.infer<typeof FrictionRuleSchema>;
export type EvidenceTraceEvent = z.infer<typeof EvidenceTraceEventSchema>;
export type EvidenceSignal = z.infer<typeof EvidenceSignalSchema>;
export type EvidenceApplicationMap = z.infer<
  typeof EvidenceApplicationMapSchema
>;
export type EvidenceTaskSummary = z.infer<typeof EvidenceTaskSummarySchema>;
export type EvidencePack = z.infer<typeof EvidencePackSchema>;
export type StoredEvidencePack = z.infer<typeof StoredEvidencePackSchema>;
export type EvidenceMutationCandidate = z.infer<
  typeof EvidenceMutationCandidateSchema
>;
export type EvidenceAnalysis = z.infer<typeof EvidenceAnalysisSchema>;
export type StoredEvidenceAnalysis = z.infer<
  typeof StoredEvidenceAnalysisSchema
>;
export type RepositoryContext = z.infer<typeof RepositoryContextSchema>;
export type TargetConnectionRequest = z.infer<
  typeof TargetConnectionRequestSchema
>;
export type TargetApplicationConnection = z.infer<
  typeof TargetApplicationConnectionSchema
>;
export type CodexImplementationManifest = z.infer<
  typeof CodexImplementationManifestSchema
>;
export type CodexManifestRequest = z.infer<typeof CodexManifestRequestSchema>;
export type EvolutionCycle = z.infer<typeof EvolutionCycleSchema>;
export type FitnessCohort = z.infer<typeof FitnessCohortSchema>;
export type FitnessComponent = z.infer<typeof FitnessComponentSchema>;
export type FitnessOutcome = z.infer<typeof FitnessOutcomeSchema>;
export type GenomeHistoryResponse = z.infer<typeof GenomeHistoryResponseSchema>;
export type ObservationArchive = z.infer<typeof ObservationArchiveSchema>;
export type ObservationArchiveSummary = z.infer<
  typeof ObservationArchiveSummarySchema
>;
export type ObservationArchivesResponse = z.infer<
  typeof ObservationArchivesResponseSchema
>;
export type SimulationRun = z.infer<typeof SimulationRunSchema>;
export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;
export type SimulationMetrics = z.infer<typeof SimulationMetricsSchema>;
export type FrictionSignal = z.infer<typeof FrictionSignalSchema>;
export type SimulationSummary = z.infer<typeof SimulationSummarySchema>;
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
export type SimulationCreateResponse = z.infer<
  typeof SimulationCreateResponseSchema
>;
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;
export type DemoResetExecution = z.infer<typeof DemoResetExecutionSchema>;
export type DemoResetStatus = z.infer<typeof DemoResetStatusSchema>;
export type DemoResetCallback = z.infer<typeof DemoResetCallbackSchema>;
export type RepositoryExecutionStatus = z.infer<
  typeof RepositoryExecutionStatusSchema
>;
export type RepositoryExecutionCheck = z.infer<
  typeof RepositoryExecutionCheckSchema
>;
export type RepositoryMutationExecution = z.infer<
  typeof RepositoryMutationExecutionSchema
>;
export type RepositoryExecutionSummary = z.infer<
  typeof RepositoryExecutionSummarySchema
>;
export type RepositoryDeploymentVerification = z.infer<
  typeof RepositoryDeploymentVerificationSchema
>;
export type RepositoryExecutionCallback = z.infer<
  typeof RepositoryExecutionCallbackSchema
>;
export type RepositoryRollbackStatus = z.infer<
  typeof RepositoryRollbackStatusSchema
>;
export type RepositoryRollback = z.infer<typeof RepositoryRollbackSchema>;
export type RepositoryRollbackCallback = z.infer<
  typeof RepositoryRollbackCallbackSchema
>;
export type OperationalProvider = z.infer<typeof OperationalProviderSchema>;
export type OperationalOutcome = z.infer<typeof OperationalOutcomeSchema>;
export type OperationalEvent = z.infer<typeof OperationalEventSchema>;
export type OperationalMetricSummary = z.infer<
  typeof OperationalMetricSummarySchema
>;
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
