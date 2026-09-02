import {
  HealthResponseSchema,
  TargetApplicationConnectionSchema,
  type CodexImplementationManifest,
  type DemoResetStatus,
  type EvidenceAnalysis,
  type EvidenceMutationCandidate,
  type EvidencePack,
  type EvidenceSignal,
  type FitnessOutcome,
  type ObservationArchive,
  type ObservationArchiveSummary,
  type RepositoryMutationExecution,
  type RepositoryExecutionSummary,
  type RepositoryRollback,
  type RetentionHealth,
  type StoredTelemetryEvent,
  type TargetApplicationConnection,
  type TargetConnectionRequest,
} from '@darwin/shared';
import rootPackage from '../../../package.json';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Box,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleDashed,
  ClipboardCheck,
  Code2,
  Database,
  Dna,
  FileCheck2,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Github,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Moon,
  MousePointer2,
  Network,
  Link2,
  Radar,
  Rocket,
  RotateCcw,
  Server,
  ShieldCheck,
  Sun,
  Users,
  Unplug,
  X,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';

import {
  useLiveTelemetry,
  type LiveTelemetryState,
} from './telemetry/useLiveTelemetry';
import {
  useLabMutationHandoff,
  type LabMutationHandoff,
} from './telemetry/useLabMutationHandoff';
import { apiFetch, getOperatorToken, setOperatorToken } from './api';
import { DarwinLabView } from './LabView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProvenanceChip } from './components/ProvenanceChip';
import {
  ControlRoomView,
  type ControlRoomMetric,
} from './views/ControlRoomView';
import {
  GenomeHistoryView,
  type ProvenanceFilter,
} from './views/GenomeHistoryView';
import { SystemStatusView } from './views/SystemStatusView';

type HealthState = 'checking' | 'online' | 'offline';
type Theme = 'dark' | 'light';
type DashboardCapability =
  | 'observe'
  | 'inspect_evidence'
  | 'reason'
  | 'execute'
  | 'release'
  | 'reset'
  | 'delete_data'
  | 'connect'
  | 'simulate';

const operatorCapabilities: DashboardCapability[] = [
  'observe',
  'inspect_evidence',
  'reason',
  'execute',
  'release',
  'reset',
  'delete_data',
  'connect',
  'simulate',
];

interface ApiHealthState {
  status: HealthState;
  version: string | null;
  commitSha: string | null;
  retention: RetentionHealth | null;
  analysis: {
    mode: 'live';
    model: string;
    liveModelAvailable: boolean;
  } | null;
}

const navItems = [
  {
    label: 'Control room',
    icon: LayoutDashboard,
  },
  {
    label: 'Target application',
    icon: Box,
  },
  {
    label: 'Observations',
    icon: Radar,
  },
  {
    label: 'Mutations',
    icon: FlaskConical,
  },
  {
    label: 'Genome',
    icon: Dna,
  },
  {
    label: 'Darwin Labs',
    icon: Users,
  },
] as const;

type DashboardView = (typeof navItems)[number]['label'] | 'System status';

const dashboardRoutes: Record<DashboardView, string> = {
  'Control room': '/',
  'Target application': '/?view=target',
  Observations: '/?view=observations',
  'Darwin Labs': '/?view=lab',
  Mutations: '/?view=mutations',
  'System status': '/?view=status',
  Genome: '/?view=genome',
};

const executionWorkspaceId = (executionId: string) =>
  `repository-execution-${executionId}`;

const scrollToExecutionWorkspace = (workspaceId: string) => {
  document.getElementById(workspaceId)?.scrollIntoView?.({
    behavior: 'smooth',
    block: 'start',
  });
};

function getDashboardView(): DashboardView {
  switch (new URLSearchParams(window.location.search).get('view')) {
    case 'target':
      return 'Target application';
    case 'observations':
      return 'Observations';
    case 'lab':
      return 'Darwin Labs';
    case 'mutations':
      return 'Mutations';
    case 'status':
      return 'System status';
    case 'genome':
    case 'fossil':
      return 'Genome';
    default:
      return 'Control room';
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const webBuildRelease =
  import.meta.env.VITE_DARWIN_RELEASE || rootPackage.version;
const webBuildCommit = import.meta.env.VITE_DARWIN_COMMIT_SHA || 'local';
const shortCommit = (commitSha: string) =>
  commitSha === 'local' ? commitSha : commitSha.slice(0, 7);
const projectFlowBaseUrl =
  import.meta.env.VITE_PROJECTFLOW_BASE_URL ?? 'http://localhost:5174';
const configuredTarget: TargetConnectionRequest = {
  fullName: 'sjohnston1972/projectflow',
  branch: 'main',
  productionUrl: `${projectFlowBaseUrl}/`,
  studyUrl: `${projectFlowBaseUrl}/?study=true`,
};

const resetStatusLabel: Record<DemoResetStatus, string> = {
  queued: 'Reset queued in GitHub Actions',
  running: 'ProjectFlow baseline is being restored',
  validating: 'Restored baseline is being validated',
  deploying: 'Waiting for the baseline deployment',
  complete: 'Baseline deployment verified',
  failed: 'Baseline reset requires attention',
};
function signedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

function DarwinDashboard({
  capabilities,
}: {
  capabilities: DashboardCapability[];
}) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );
  const [health, setHealth] = useState<ApiHealthState>({
    status: 'checking',
    version: null,
    commitSha: null,
    retention: null,
    analysis: null,
  });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [genomeProvenanceFilter, setGenomeProvenanceFilter] =
    useState<ProvenanceFilter>('all');
  const activeView = getDashboardView();
  const targetConnection = useTargetConnection();
  const liveTelemetry = useLiveTelemetry({
    canInspectEvidence: capabilities.includes('inspect_evidence'),
    eventPollingEnabled: ['Control room', 'Observations', 'Mutations'].includes(
      activeView,
    ),
    executionPollingEnabled: ['Mutations', 'Genome'].includes(activeView),
  });
  const labMutationHandoff = useLabMutationHandoff(
    apiBaseUrl,
    activeView === 'Mutations',
  );
  const resetBlocksStudy = Boolean(
    liveTelemetry.resetExecution?.status !== undefined &&
    liveTelemetry.resetExecution.status !== 'complete',
  );
  const repository =
    targetConnection.connection?.repository ??
    liveTelemetry.execution?.repository ??
    liveTelemetry.analysis?.repository ??
    undefined;
  const rollback = liveTelemetry.execution?.rollback;
  const rollbackPreviewUrl =
    rollback && ['preview_ready', 'releasing'].includes(rollback.status)
      ? rollback.previewUrl
      : null;
  const targetApplicationUrl =
    rollbackPreviewUrl ??
    (liveTelemetry.execution?.previewUrl &&
    ['preview_ready', 'releasing'].includes(liveTelemetry.execution.status)
      ? liveTelemetry.execution.previewUrl
      : (targetConnection.connection?.repository.studyUrl ??
        repository?.studyUrl)) ??
    `${projectFlowBaseUrl}/?study=true`;
  const executionCommit =
    liveTelemetry.execution &&
    ['preview_ready', 'releasing', 'released'].includes(
      liveTelemetry.execution.status,
    )
      ? liveTelemetry.execution.headSha
      : null;
  const rollbackCommit =
    rollback?.status === 'released' ? rollback.headSha : null;
  const activeCommit =
    rollbackCommit ??
    executionCommit ??
    targetConnection.connection?.repository.baseSha ??
    repository?.baseSha;
  const activeGenomeStage =
    rollback?.status === 'released'
      ? 'rollback released'
      : rollback
        ? `rollback ${rollback.status}`
        : (liveTelemetry.execution?.status ?? 'measured baseline');
  const mutationArchived =
    liveTelemetry.execution?.status === 'released' &&
    (!rollback || ['failed', 'released'].includes(rollback.status));
  const activeGenomeLoci = repository
    ? [
        { locus: 'Repository', value: repository.fullName },
        { locus: 'Tracked branch', value: repository.branch },
        {
          locus: 'Active commit',
          value: activeCommit?.slice(0, 12) ?? 'awaiting release',
        },
        { locus: 'Source snapshot', value: repository.sourceHash.slice(0, 16) },
        {
          locus: 'Mutable surface',
          value: `${repository.mutablePaths.length} bounded source paths`,
        },
      ]
    : [];
  const resetDemo = () => liveTelemetry.resetEvolution();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('darwin-theme', theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f7fb' : '#101211');
  }, [theme]);
  const studySessions = Object.keys(liveTelemetry.sessionCounts).length;
  const studyParticipants = liveTelemetry.participantCount;
  const latestReleasedExecution = liveTelemetry.genomeExecutions.find(
    (execution) => execution.status === 'released',
  );
  const latestFitnessOutcome = liveTelemetry.fitnessOutcomes.find(
    (outcome) => outcome.executionId === latestReleasedExecution?.executionId,
  );
  const pressureClusters =
    liveTelemetry.analysis?.evidenceAssessment.pressureClusters ?? [];
  const highSeveritySignals =
    liveTelemetry.evidence?.frictionSignals.filter(
      (signal) => signal.severity === 'high',
    ).length ?? 0;
  const releaseForConfidence =
    liveTelemetry.execution ?? latestReleasedExecution ?? null;
  const releaseCheckSummary = releaseForConfidence
    ? 'checkSummary' in releaseForConfidence
      ? releaseForConfidence.checkSummary
      : {
          total: releaseForConfidence.checks.length,
          passed: releaseForConfidence.checks.filter(
            (check) => check.status === 'passed',
          ).length,
          failed: releaseForConfidence.checks.filter(
            (check) => check.status === 'failed',
          ).length,
        }
    : null;
  const passedChecks = releaseCheckSummary?.passed;
  const totalChecks = releaseCheckSummary?.total ?? 0;
  const releaseRolledBack =
    releaseForConfidence?.rollback?.status === 'released';
  const releaseConfidence: Pick<ControlRoomMetric, 'value' | 'meta' | 'tone'> =
    !releaseForConfidence
      ? {
          value: '--',
          meta: 'No repository mutation to validate',
          tone: 'neutral',
        }
      : releaseRolledBack
        ? {
            value: 'REVERTED',
            meta: 'The retained release was rolled back',
            tone: 'amber',
          }
        : releaseForConfidence.status === 'failed'
          ? {
              value: 'HOLD',
              meta: 'Repository execution requires attention',
              tone: 'amber',
            }
          : totalChecks
            ? {
                value:
                  releaseForConfidence.status === 'released' &&
                  passedChecks === totalChecks
                    ? '100%'
                    : `${passedChecks}/${totalChecks}`,
                meta:
                  releaseForConfidence.status === 'released'
                    ? `${passedChecks}/${totalChecks} repository checks passed`
                    : `${passedChecks}/${totalChecks} checks passed before release`,
                tone:
                  passedChecks === totalChecks ? 'signal' : ('amber' as const),
              }
            : {
                value: 'PENDING',
                meta: 'Repository checks have not reported yet',
                tone: 'neutral',
              };

  const metrics: ControlRoomMetric[] = [
    {
      label: 'Measured events',
      help: 'Semantic events emitted by real ProjectFlow browser sessions and persisted in D1.',
      value: liveTelemetry.count.toLocaleString('en-US'),
      meta: liveTelemetry.count
        ? 'Measured ProjectFlow behavior'
        : 'Awaiting a real session',
      tone: liveTelemetry.count ? 'signal' : 'neutral',
    },
    {
      label: 'Measured sessions',
      help: 'Independent browser journeys across the complete measured study cycle, including sessions outside the recent trace window.',
      value: String(studySessions),
      meta: `${studyParticipants} anonymous participants`,
      tone: studySessions ? 'signal' : 'neutral',
    },
    {
      label: 'Evidence strength',
      help: 'Server-derived coverage score based on event volume, independent sessions, participants, and completed attempts.',
      value: liveTelemetry.evidence
        ? `${liveTelemetry.evidence.quality.score}`
        : '--',
      meta: liveTelemetry.evidence
        ? `${liveTelemetry.evidence.quality.strength} evidence`
        : 'Generate an evidence pack',
      tone:
        liveTelemetry.evidence?.quality.strength === 'substantial'
          ? 'signal'
          : 'amber',
    },
    {
      label: 'Selection pressure',
      help: 'Friction that survives evidence parsing. Once GPT reasoning is run, related signals are grouped into pressure clusters that drive mutation choices.',
      value: liveTelemetry.analysis
        ? String(pressureClusters.length)
        : liveTelemetry.evidence
          ? String(liveTelemetry.evidence.frictionSignals.length)
          : '--',
      meta: liveTelemetry.analysis
        ? `${highSeveritySignals} high-severity signals across GPT clusters`
        : liveTelemetry.evidence
          ? `${highSeveritySignals} high-severity signals · GPT grouping pending`
          : liveTelemetry.behaviorSignalCount
            ? `${liveTelemetry.behaviorSignalCount} behavioral signals awaiting evidence`
            : 'Awaiting observed behavior',
      tone: liveTelemetry.analysis
        ? 'signal'
        : liveTelemetry.evidence
          ? 'amber'
          : 'neutral',
    },
    {
      label: 'Live reasoning',
      help: 'The current measured evidence portfolio produced by the configured OpenAI model. Rosalind never substitutes an invented recommendation.',
      value: liveTelemetry.analysis ? 'READY' : '--',
      meta: liveTelemetry.analysis
        ? `${liveTelemetry.analysis.alternatives.length + 1} mutations scored`
        : health.analysis?.liveModelAvailable
          ? `${health.analysis.model} available`
          : 'Live model unavailable',
      tone: liveTelemetry.analysis ? 'signal' : 'neutral',
    },
    {
      label: 'Fitness delta',
      help: 'The persisted server-side 0-100 fitness outcome. Formula 1.0.0 weights task completion, navigation efficiency, error rate, feature discovery, and median duration after compatibility and sample gates pass.',
      value:
        latestFitnessOutcome?.status === 'measured'
          ? signedNumber(latestFitnessOutcome.delta!)
          : latestFitnessOutcome?.status === 'insufficient'
            ? 'GATED'
            : latestFitnessOutcome?.status === 'rolled_back'
              ? 'STOPPED'
              : latestReleasedExecution
                ? 'PENDING'
                : '--',
      meta:
        latestFitnessOutcome?.status === 'measured'
          ? `${latestFitnessOutcome.baselineScore}/100 → ${latestFitnessOutcome.evolvedScore}/100 · formula ${latestFitnessOutcome.formulaVersion}`
          : (latestFitnessOutcome?.limitations[0] ??
            (latestReleasedExecution
              ? 'Awaiting a compatible post-release cohort'
              : 'Retain a mutation to establish a baseline')),
      tone:
        latestFitnessOutcome?.status === 'measured'
          ? latestFitnessOutcome.delta! > 0
            ? 'signal'
            : latestFitnessOutcome.delta! < 0
              ? 'amber'
              : 'neutral'
          : latestFitnessOutcome?.status === 'insufficient' ||
              latestFitnessOutcome?.status === 'rolled_back'
            ? 'amber'
            : 'neutral',
    },
    {
      label: 'Release confidence',
      help: 'A live state derived only from the recorded GitHub repository execution and its validation checks. It does not predict a release outcome.',
      value: releaseConfidence.value,
      meta: releaseConfidence.meta,
      tone: releaseConfidence.tone,
    },
    {
      label: 'Genome evolutions',
      help: 'Accepted mutation bundles retained in the Genome. This increases only after a reviewed repository mutation is released; a rollback does not create another evolution.',
      value: String(liveTelemetry.genomeEvolutionCount),
      meta: liveTelemetry.genomeEvolutionCount
        ? `${liveTelemetry.genomeEvolutionCount} accepted ${liveTelemetry.genomeEvolutionCount === 1 ? 'release' : 'releases'}`
        : 'No accepted releases',
      tone: liveTelemetry.genomeEvolutionCount ? 'signal' : 'neutral',
    },
  ];

  useEffect(() => {
    const controller = new AbortController();

    apiFetch(`${apiBaseUrl}/api/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Health request failed');
        const parsed = HealthResponseSchema.safeParse(await response.json());
        setHealth(
          parsed.success
            ? {
                status: 'online',
                version: parsed.data.version,
                commitSha: parsed.data.commitSha,
                retention: parsed.data.retention,
                analysis: parsed.data.analysis,
              }
            : {
                status: 'offline',
                version: null,
                commitSha: null,
                retention: null,
                analysis: null,
              },
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setHealth({
          status: 'offline',
          version: null,
          commitSha: null,
          retention: null,
          analysis: null,
        });
      });

    return () => controller.abort();
  }, []);

  if (activeView === 'Target application') {
    return (
      <div className="min-h-screen bg-carbon text-white">
        <GlobalExplainTooltip />
        <DashboardSidebar
          activeView="Target application"
          health={health}
          navigationOpen={navigationOpen}
          onClose={() => setNavigationOpen(false)}
        />
        {navigationOpen && (
          <button
            className="fixed inset-0 z-30 bg-black/70 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
            type="button"
          />
        )}
        <main className="lg:pl-[248px]">
          <header className="topbar">
            <button
              className="icon-button lg:hidden"
              type="button"
              onClick={() => setNavigationOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>
            <div className="flex items-center gap-2 text-xs text-mist">
              <span className="hidden sm:inline">Workspace</span>
              <ChevronRight className="hidden sm:block" size={14} />
              <span className="font-mono text-white">Target application</span>
            </div>
            <div className="ml-auto flex items-center gap-2 border-l border-line pl-4 text-xs text-mist">
              <span
                className="controlled-mode-status"
                data-explain="Controlled mode verifies a bounded repository contract before Rosalind can reason over source or execute a mutation."
                tabIndex={0}
              >
                <ShieldCheck size={15} className="text-signal" />
                <span>Controlled mode</span>
              </span>
              <ThemeToggle theme={theme} onChange={setTheme} />
            </div>
          </header>
          <TargetConnectionView
            connection={targetConnection.connection}
            error={targetConnection.error}
            loading={targetConnection.loading}
            saving={targetConnection.saving}
            studyBlocked={resetBlocksStudy}
            onConnect={targetConnection.connect}
            onDisconnect={targetConnection.disconnect}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-carbon text-white">
      <GlobalExplainTooltip />
      <DashboardSidebar
        activeView={activeView}
        health={health}
        navigationOpen={navigationOpen}
        onClose={() => setNavigationOpen(false)}
      />

      {navigationOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
          type="button"
        />
      )}

      <main className="lg:pl-[248px]" id="top">
        <header className="topbar">
          <button
            className="icon-button lg:hidden"
            type="button"
            onClick={() => setNavigationOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div className="flex items-center gap-2 text-xs text-mist">
            <span className="hidden sm:inline">Workspace</span>
            <ChevronRight className="hidden sm:block" size={14} />
            <span className="font-mono text-white">{activeView}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 border-l border-line pl-4 text-xs text-mist">
            <span
              className="controlled-mode-status"
              data-explain="Controlled mode requires human approval and uses a bounded target, diff, validation workflow, and explicit release step."
              tabIndex={0}
            >
              <ShieldCheck size={15} className="text-signal" />
              <span>Controlled mode</span>
            </span>
            <ThemeToggle theme={theme} onChange={setTheme} />
            <button
              className="icon-button"
              type="button"
              onClick={() => void resetDemo()}
              disabled={liveTelemetry.resetting}
              aria-label={
                liveTelemetry.resetExecution?.status === 'failed'
                  ? 'Retry evolution reset'
                  : 'Reset evolution demo'
              }
              data-explain="Dispatch the ProjectFlow baseline restore workflow. Rosalind preserves current state until the workflow passes and production reports the restored commit."
            >
              {liveTelemetry.resetting ? (
                <CircleDashed className="is-spinning" size={15} />
              ) : (
                <RotateCcw size={15} />
              )}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1640px] px-5 pb-12 pt-8 sm:px-8 lg:px-10 lg:pt-11">
          {liveTelemetry.resetExecution &&
            liveTelemetry.resetExecution.status !== 'complete' && (
              <section
                className={`reset-status-band ${liveTelemetry.resetExecution.status === 'failed' ? 'is-failed' : ''}`}
                role={
                  liveTelemetry.resetExecution.status === 'failed'
                    ? 'alert'
                    : 'status'
                }
              >
                {liveTelemetry.resetExecution.status === 'failed' ? (
                  <AlertTriangle size={19} />
                ) : (
                  <CircleDashed className="is-spinning" size={19} />
                )}
                <div>
                  <strong>
                    {resetStatusLabel[liveTelemetry.resetExecution.status]}
                  </strong>
                  <span>
                    {liveTelemetry.resetExecution.error ??
                      'Measured study access remains locked until the verified baseline is live.'}
                  </span>
                </div>
                {liveTelemetry.resetExecution.workflowUrl && (
                  <a
                    href={liveTelemetry.resetExecution.workflowUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Workflow <ExternalLink size={12} />
                  </a>
                )}
                {liveTelemetry.resetExecution.status === 'failed' && (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => void resetDemo()}
                    disabled={liveTelemetry.resetting}
                  >
                    <RotateCcw size={15} /> Retry reset
                  </button>
                )}
              </section>
            )}
          {activeView === 'Control room' && (
            <ControlRoomView
              analysisReady={Boolean(liveTelemetry.analysis)}
              measuredEventCount={liveTelemetry.count}
              metrics={metrics}
              statusText={
                liveTelemetry.evidence
                  ? `${liveTelemetry.evidence.frictionSignals.length} pressures ready for GPT`
                  : liveTelemetry.count
                    ? `${liveTelemetry.count} measured events`
                    : 'Awaiting measured behavior'
              }
              studyBlocked={resetBlocksStudy}
              targetApplicationUrl={targetApplicationUrl}
              targetConnected={Boolean(targetConnection.connection)}
            />
          )}

          {activeView !== 'Control room' && (
            <WorkspaceHeading activeView={activeView} />
          )}

          {activeView === 'Observations' && (
            <>
              <LiveTelemetryPanel
                telemetry={liveTelemetry}
                analysisConfig={health.analysis}
                mode="observations"
              />
              {liveTelemetry.observationArchives.length > 0 && (
                <ObservationArchivePanel
                  archives={liveTelemetry.observationArchives}
                  nextCursor={liveTelemetry.observationArchivesNextCursor}
                  loadArchive={liveTelemetry.loadObservationArchive}
                  onLoadMore={() =>
                    void liveTelemetry.loadMoreObservationArchives()
                  }
                />
              )}
            </>
          )}

          {activeView === 'Darwin Labs' && (
            <DarwinLabView
              apiBaseUrl={apiBaseUrl}
              defaultTargetUrl={`${projectFlowBaseUrl}/`}
              liveReasoningAvailable={
                health.analysis?.liveModelAvailable ?? false
              }
              reasoningModel={health.analysis?.model ?? 'gpt-5.6'}
            />
          )}

          {activeView === 'Mutations' &&
            (labMutationHandoff.handoff ? (
              <>
                <LabMutationHandoffWorkspace
                  dispatching={labMutationHandoff.dispatching}
                  error={labMutationHandoff.error}
                  handoff={labMutationHandoff.handoff}
                  onStart={() => void labMutationHandoff.startImplementation()}
                />
                {labMutationHandoff.handoff.execution && (
                  <RepositoryExecutionWorkspace
                    execution={labMutationHandoff.handoff.execution}
                    manifest={labMutationHandoff.handoff.manifest}
                    releasing={labMutationHandoff.releasing}
                    retrying={labMutationHandoff.dispatching}
                    rollingBack={labMutationHandoff.rollingBack}
                    releasingRollback={labMutationHandoff.releasingRollback}
                    onRelease={() => void labMutationHandoff.release()}
                    onRollback={() => void labMutationHandoff.startRollback()}
                    onReleaseRollback={() =>
                      void labMutationHandoff.releaseRollback()
                    }
                    onRetry={() =>
                      void labMutationHandoff.startImplementation()
                    }
                  />
                )}
              </>
            ) : mutationArchived && liveTelemetry.execution ? (
              <MutationWorkspaceReset execution={liveTelemetry.execution} />
            ) : (
              <>
                <LiveTelemetryPanel
                  telemetry={liveTelemetry}
                  analysisConfig={health.analysis}
                  mode="mutations"
                />
                {liveTelemetry.execution && (
                  <RepositoryExecutionWorkspace
                    execution={liveTelemetry.execution}
                    manifest={liveTelemetry.manifest}
                    releasing={liveTelemetry.releasingExecution}
                    retrying={liveTelemetry.implementing}
                    rollingBack={liveTelemetry.rollingBack}
                    releasingRollback={liveTelemetry.releasingRollback}
                    onRelease={() => void liveTelemetry.releaseExecution()}
                    onRollback={() => void liveTelemetry.startRollback()}
                    onReleaseRollback={() =>
                      void liveTelemetry.releaseRollback()
                    }
                    onRetry={() =>
                      void liveTelemetry.startControlledEvolution(
                        liveTelemetry.manifest?.mutationIds ??
                          (liveTelemetry.manifest
                            ? [liveTelemetry.manifest.mutationId]
                            : []),
                      )
                    }
                  />
                )}
              </>
            ))}

          {activeView === 'System status' && (
            <SystemStatusView
              apiBaseUrl={apiBaseUrl}
              health={health}
              webBuild={{
                release: webBuildRelease,
                commitSha: webBuildCommit,
              }}
              telemetry={{
                status: liveTelemetry.status,
                count: liveTelemetry.count,
                evidence: liveTelemetry.evidence,
              }}
              activeCommit={activeCommit ?? null}
              activeGenomeStage={activeGenomeStage}
              activeGenomeLoci={activeGenomeLoci}
              repositoryConnected={repository !== undefined}
            />
          )}

          {activeView === 'Genome' && (
            <GenomeHistoryView
              baselineSha={repository?.baseSha ?? null}
              executionCount={liveTelemetry.genomeExecutions.length}
              hasMore={Boolean(liveTelemetry.genomeNextCursor)}
              onFilterChange={setGenomeProvenanceFilter}
              onLoadMore={() => void liveTelemetry.loadMoreGenome()}
              provenanceFilter={genomeProvenanceFilter}
            >
              {liveTelemetry.genomeExecutions
                .filter(
                  (genomeExecution) =>
                    genomeProvenanceFilter === 'all' ||
                    (genomeExecution.provenance?.evidenceClass ?? 'legacy') ===
                      genomeProvenanceFilter,
                )
                .map((genomeExecution) => (
                  <FossilExecutionArtifact
                    key={genomeExecution.executionId}
                    execution={genomeExecution}
                    executionDetail={
                      liveTelemetry.execution?.executionId ===
                      genomeExecution.executionId
                        ? liveTelemetry.execution
                        : null
                    }
                    loadExecution={liveTelemetry.loadGenomeExecution}
                    fitnessOutcome={
                      liveTelemetry.fitnessOutcomes.find(
                        (outcome) =>
                          outcome.executionId === genomeExecution.executionId,
                      ) ?? null
                    }
                    mutationTitle={
                      liveTelemetry.observationArchives.find(
                        (archive) =>
                          archive.execution.executionId ===
                          genomeExecution.executionId,
                      )?.analysis.selectedMutation.title ?? null
                    }
                    manifest={
                      liveTelemetry.execution?.executionId ===
                      genomeExecution.executionId
                        ? liveTelemetry.manifest
                        : null
                    }
                    releasing={liveTelemetry.releasingExecution}
                    retrying={liveTelemetry.implementing}
                    rollingBack={liveTelemetry.rollingBack}
                    releasingRollback={liveTelemetry.releasingRollback}
                    onRelease={() =>
                      void liveTelemetry.releaseExecution(
                        genomeExecution.executionId,
                      )
                    }
                    onRollback={() =>
                      void liveTelemetry.startRollback(
                        genomeExecution.executionId,
                      )
                    }
                    onReleaseRollback={() =>
                      void liveTelemetry.releaseRollback(
                        genomeExecution.executionId,
                      )
                    }
                    onRetry={() =>
                      void liveTelemetry.startControlledEvolution(
                        liveTelemetry.manifest?.mutationIds ??
                          (liveTelemetry.manifest
                            ? [liveTelemetry.manifest.mutationId]
                            : []),
                      )
                    }
                  />
                ))}
            </GenomeHistoryView>
          )}

          <footer className="mt-8 flex flex-col gap-2 border-t border-line pt-5 text-xs text-mist sm:flex-row sm:items-center sm:justify-between">
            <p>ProjectFlow / controlled evolution environment</p>
            <p className="font-mono">
              ROSALIND CORE v{webBuildRelease}@{shortCommit(webBuildCommit)}
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function useTargetConnection() {
  const [connection, setConnection] =
    useState<TargetApplicationConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`${apiBaseUrl}/api/target-connection`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 204) return null;
        if (!response.ok) throw new Error('Target connection lookup failed.');
        return TargetApplicationConnectionSchema.parse(await response.json());
      })
      .then((result) => setConnection(result))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError')
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Target connection lookup failed.',
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const connect = async (request: TargetConnectionRequest) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`${apiBaseUrl}/api/target-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Target verification failed.');
      }
      setConnection(TargetApplicationConnectionSchema.parse(payload));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Target verification failed.',
      );
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(
        `${apiBaseUrl}/api/target-connection/disconnect`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error('Target disconnect failed.');
      setConnection(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Target disconnect failed.',
      );
    } finally {
      setSaving(false);
    }
  };

  return { connection, loading, saving, error, connect, disconnect };
}

function WorkspaceHeading({ activeView }: { activeView: DashboardView }) {
  if (activeView === 'Darwin Labs') return null;
  const content: Record<
    Exclude<
      DashboardView,
      'Control room' | 'Target application' | 'Darwin Labs'
    >,
    {
      eyebrow: string;
      title: string;
      description: string;
      poweredBy?: string;
    }
  > = {
    Observations: {
      eyebrow: 'Measured behavior',
      title: 'Observations',
      description:
        'Review the real ProjectFlow sessions, interaction signals, and evidence Rosalind can cite.',
    },
    Mutations: {
      eyebrow: 'Controlled selection',
      title: 'Mutations',
      description:
        'Reason over verified evidence, compare candidates, and supervise the bounded Codex implementation.',
      poweredBy: 'Codex',
    },
    'System status': {
      eyebrow: 'Runtime and genome',
      title: 'System status',
      description:
        'Inspect the live Rosalind services and the immutable ProjectFlow source snapshot used for selection.',
    },
    Genome: {
      eyebrow: 'Genome history',
      title: 'Genome',
      description:
        'Review retained code mutations, their validation evidence, and controlled rollback history.',
    },
  };
  const view = content[activeView as keyof typeof content];

  if (!view) return null;
  if (view.poweredBy) {
    return (
      <header className="workspace-hero">
        <p className="section-label">{view.eyebrow}</p>
        <h1 className="workspace-hero-title">{view.title}</h1>
        <p className="workspace-hero-tag">
          powered by <strong>{view.poweredBy}</strong>
        </p>
      </header>
    );
  }
  return (
    <section className="border-b border-line pb-8">
      <p className="section-label">{view.eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{view.title}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-mist sm:text-base">
        {view.description}
      </p>
    </section>
  );
}

function DashboardSidebar({
  activeView,
  health,
  navigationOpen,
  onClose,
}: {
  activeView: DashboardView;
  health: ApiHealthState;
  navigationOpen: boolean;
  onClose: () => void;
}) {
  return (
    <aside className={navigationOpen ? 'sidebar sidebar-open' : 'sidebar'}>
      <div className="flex h-20 items-center justify-between border-b border-line px-5">
        <a
          className="flex items-center gap-3"
          href="/"
          aria-label="Rosalind control room"
        >
          <DarwinMark />
          <span className="text-[17px] font-semibold tracking-[0.16em]">
            ROSALIND
          </span>
        </a>
        <button
          className="icon-button lg:hidden"
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-3 py-6" aria-label="Primary navigation">
        <p className="section-label px-3">Workspace</p>
        <ul className="mt-3 space-y-1">
          {navItems.map(({ label, icon: Icon }) => {
            const active = label === activeView;
            const href = dashboardRoutes[label];

            return (
              <li key={label}>
                <a
                  className={active ? 'nav-item nav-item-active' : 'nav-item'}
                  href={href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                  {active && (
                    <span
                      className="ml-auto h-1.5 w-1.5 bg-signal"
                      aria-hidden="true"
                    />
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line p-4">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            className={`status-dot status-${health.status}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Rosalind API</p>
            <p className="mt-0.5 text-xs capitalize text-mist">
              {health.version
                ? `v${health.version} · ${shortCommit(health.commitSha ?? 'local')} · ${health.status}`
                : health.status}
            </p>
          </div>
          <a
            className="icon-button ml-auto"
            href={dashboardRoutes['System status']}
            onClick={onClose}
            aria-label="Open system status"
            aria-current={activeView === 'System status' ? 'page' : undefined}
            title="Open system status"
          >
            <Server size={16} />
          </a>
        </div>
      </div>
    </aside>
  );
}

function TargetConnectionView({
  connection,
  error,
  loading,
  saving,
  studyBlocked,
  onConnect,
  onDisconnect,
}: {
  connection: TargetApplicationConnection | null;
  error: string | null;
  loading: boolean;
  saving: boolean;
  studyBlocked: boolean;
  onConnect: (request: TargetConnectionRequest) => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [request, setRequest] = useState<TargetConnectionRequest>(() => ({
    ...configuredTarget,
  }));
  const update = (field: keyof TargetConnectionRequest, value: string) =>
    setRequest((current) => ({ ...current, [field]: value }));
  const githubUrl = `https://github.com/${request.fullName.trim()}`;

  return (
    <div className="target-connect-main">
      <section className="target-connect-intro">
        <p className="section-label">Repository onboarding</p>
        <div className="target-connect-title-row">
          <div>
            <h1>Connect a target application</h1>
            <p>
              Give Rosalind a GitHub repository and measured deployment.
              Rosalind verifies the target contract before it observes
              telemetry, reasons over source, or prepares a mutation.
            </p>
          </div>
        </div>
      </section>

      <ol className="connection-steps" aria-label="Connection verification">
        {[
          ['01', 'Repository', 'Read the exact GitHub commit'],
          ['02', 'Contract', 'Validate darwin.target.json'],
          ['03', 'Runtime', 'Reach the Cloudflare deployment'],
          ['04', 'Ready', 'Bind telemetry and mutations'],
        ].map(([number, label, detail]) => (
          <li className={connection ? 'is-complete' : ''} key={number}>
            <span>{connection ? <Check size={14} /> : number}</span>
            <div>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
          </li>
        ))}
      </ol>

      <section className="connection-workspace">
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onConnect(request);
          }}
        >
          <div className="connection-section-heading">
            <div>
              <p className="section-label">Target definition</p>
              <h2>ProjectFlow repository</h2>
            </div>
            <Github size={21} />
          </div>
          <label>
            <span>GitHub repository</span>
            <div className="connection-input-with-link">
              <input
                aria-label="GitHub repository"
                value={request.fullName}
                onChange={(event) => update('fullName', event.target.value)}
                autoComplete="off"
              />
              <a
                aria-label="Open GitHub repository"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                title="Open GitHub repository"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <small>Owner and repository name</small>
          </label>
          <div className="connection-field-grid">
            <label>
              <span>Tracked branch</span>
              <input
                aria-label="Tracked branch"
                value={request.branch}
                onChange={(event) => update('branch', event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Production deployment</span>
              <div className="connection-input-with-link">
                <input
                  aria-label="Production deployment"
                  type="url"
                  value={request.productionUrl}
                  onChange={(event) =>
                    update('productionUrl', event.target.value)
                  }
                  autoComplete="off"
                />
                <a
                  aria-label="Open production deployment"
                  href={request.productionUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open production deployment"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
            </label>
          </div>
          <label>
            <span>Measured study URL</span>
            <div className="connection-input-with-link">
              <input
                aria-label="Measured study URL"
                type="url"
                value={request.studyUrl}
                onChange={(event) => update('studyUrl', event.target.value)}
                autoComplete="off"
              />
              <a
                aria-label="Open measured study"
                href={studyBlocked ? undefined : request.studyUrl}
                target="_blank"
                rel="noreferrer"
                aria-disabled={studyBlocked || undefined}
                title={
                  studyBlocked
                    ? 'Measured study locked until reset verification completes'
                    : 'Open measured study'
                }
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <small>
              {studyBlocked
                ? 'Locked until the baseline reset deployment is verified'
                : 'Rosalind telemetry is enabled on this application view'}
            </small>
          </label>

          {error && (
            <p className="connection-error" role="alert">
              <AlertTriangle size={15} /> {error}
            </p>
          )}

          <div className="connection-actions">
            <div className="start-action-wrap">
              {!connection && !loading && (
                <span className="start-here-cue" aria-hidden="true">
                  Start here <ArrowDown size={15} />
                </span>
              )}
              <button
                className="primary-action"
                type="submit"
                disabled={saving || loading}
                data-explain="Verify the live GitHub commit, Rosalind target contract, bounded source paths, validation commands, and Cloudflare runtime before saving this connection."
              >
                {saving ? (
                  <CircleDashed className="animate-spin" size={17} />
                ) : connection ? (
                  <ShieldCheck size={17} />
                ) : (
                  <Link2 size={17} />
                )}
                {saving
                  ? 'Verifying target'
                  : connection
                    ? 'Re-verify connection'
                    : 'Connect ProjectFlow'}
              </button>
            </div>
            {connection && (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={saving}
                  onClick={() => void onDisconnect()}
                  data-explain="Remove the active binding so the repository connection can be demonstrated again. Telemetry and genome history are left unchanged."
                >
                  <Unplug size={16} /> Disconnect
                </button>
                <span className="connection-state connection-state-live">
                  <span className="status-dot" aria-hidden="true" />
                  {loading || saving ? 'Checking connection' : 'Connected'}
                </span>
              </>
            )}
          </div>
        </form>

        <div className="connection-verification" aria-live="polite">
          <div className="connection-section-heading">
            <div>
              <p className="section-label">Live verification</p>
              <h2>{connection ? connection.target.name : 'Awaiting target'}</h2>
            </div>
            <ShieldCheck size={21} />
          </div>
          {connection ? (
            <>
              <p className="connection-purpose">{connection.target.purpose}</p>
              <div className="connection-identity">
                <span>Active commit</span>
                <code>{connection.repository.baseSha.slice(0, 12)}</code>
                <span>Source fingerprint</span>
                <code>{connection.repository.sourceHash.slice(0, 16)}</code>
              </div>
              <ul className="connection-check-list">
                {connection.checks.map((check) => (
                  <li key={check.id}>
                    <CheckCircle2 size={17} />
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="connection-empty-state">
              <Github size={28} />
              <strong>No repository is connected</strong>
              <p>
                Rosalind will show each verification result here before the
                target becomes available to GPT and Codex.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DarwinMark() {
  return (
    <img
      className="brand-mark"
      src="/assets/darwin-growth-mark.png"
      alt=""
      aria-hidden="true"
    />
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      aria-label={`Switch to ${nextTheme} theme`}
      data-explain={`Switch to ${nextTheme} theme`}
      onClick={() => onChange(nextTheme)}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span
      className="info-tip"
      tabIndex={0}
      aria-label={text}
      data-explain={text}
    >
      <CircleHelp size={14} aria-hidden="true" />
    </span>
  );
}

interface ExplainTooltipState {
  target: HTMLElement;
  text: string;
}

interface ExplainTooltipPosition {
  left: number;
  top: number;
}

function GlobalExplainTooltip() {
  const [tooltip, setTooltip] = useState<ExplainTooltipState | null>(null);
  const [position, setPosition] = useState<ExplainTooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let activeTarget: HTMLElement | null = null;
    const explainTarget = (eventTarget: EventTarget | null) =>
      eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>('[data-explain]')
        : null;
    const show = (event: Event) => {
      const target = explainTarget(event.target);
      const text = target?.dataset.explain?.trim();
      if (!target || !text || target === activeTarget) return;
      activeTarget = target;
      setPosition(null);
      setTooltip({ target, text });
    };
    const hide = (event: Event) => {
      if (!activeTarget) return;
      const relatedTarget =
        'relatedTarget' in event
          ? (event as FocusEvent | PointerEvent).relatedTarget
          : null;
      if (
        relatedTarget instanceof Node &&
        activeTarget.contains(relatedTarget)
      ) {
        return;
      }
      activeTarget = null;
      setTooltip(null);
      setPosition(null);
    };
    const dismiss = () => {
      activeTarget = null;
      setTooltip(null);
      setPosition(null);
    };

    document.addEventListener('pointerover', show, true);
    document.addEventListener('pointerout', hide, true);
    document.addEventListener('focusin', show, true);
    document.addEventListener('focusout', hide, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerover', show, true);
      document.removeEventListener('pointerout', hide, true);
      document.removeEventListener('focusin', show, true);
      document.removeEventListener('focusout', hide, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current || window.innerWidth < 640) return;
    const targetRect = tooltip.target.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const gutter = 12;
    const gap = 9;
    const halfWidth = tooltipRect.width / 2;
    const left = Math.min(
      window.innerWidth - gutter - halfWidth,
      Math.max(gutter + halfWidth, targetRect.left + targetRect.width / 2),
    );
    const preferredTop = targetRect.top - tooltipRect.height - gap;
    const top =
      preferredTop >= gutter
        ? preferredTop
        : Math.min(
            window.innerHeight - gutter - tooltipRect.height,
            targetRect.bottom + gap,
          );
    setPosition({ left, top: Math.max(gutter, top) });
  }, [tooltip]);

  if (!tooltip) return null;
  return createPortal(
    <div
      className="global-explain-tooltip"
      ref={tooltipRef}
      role="tooltip"
      style={
        window.innerWidth < 640
          ? undefined
          : {
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? 'visible' : 'hidden',
            }
      }
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}

const signalPageSize = 8;
const signalSeverityRank: Record<EvidenceSignal['severity'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const signalTargets = (signal: EvidenceSignal) => [
  ...new Set(signal.trace.map((event) => event.targetId ?? event.route)),
];

const signalAttemptRecords = (
  signal: EvidenceSignal,
  attempts: EvidencePack['taskAttempts'],
) => {
  const affected = new Set(signal.affectedAttemptIds);
  return attempts.filter((attempt) => affected.has(attempt.attemptId));
};

const signalSessions = (
  signal: EvidenceSignal,
  attempts: EvidencePack['taskAttempts'],
  events: StoredTelemetryEvent[],
) => {
  const eventIds = new Set(signal.supportingEventIds);
  return [
    ...new Set([
      ...signalAttemptRecords(signal, attempts).map(
        (attempt) => attempt.sessionId,
      ),
      ...events
        .filter((event) => eventIds.has(event.eventId))
        .map((event) => event.sessionId),
    ]),
  ];
};

const signalTasks = (
  signal: EvidenceSignal,
  attempts: EvidencePack['taskAttempts'],
) => [
  ...new Set([
    ...(signal.taskId ? [signal.taskId] : []),
    ...signalAttemptRecords(signal, attempts).map((attempt) => attempt.taskId),
  ]),
];

const signalRank = (signal: EvidenceSignal) =>
  signalSeverityRank[signal.severity] * 1_000_000 +
  signal.support.participants * 10_000 +
  signal.support.sessions * 1_000 +
  signal.support.attempts * 100 +
  signal.support.events;

interface SignalPressureGroup {
  id: string;
  ruleId: EvidenceSignal['ruleId'];
  target: string;
  severity: EvidenceSignal['severity'];
  signals: EvidenceSignal[];
  eventCount: number;
  attemptCount: number;
  sessionCount: number;
  participantCount: number;
}

const buildSignalPressureGroups = (
  signals: EvidenceSignal[],
  attempts: EvidencePack['taskAttempts'],
  events: StoredTelemetryEvent[],
): SignalPressureGroup[] => {
  const groups = new Map<string, EvidenceSignal[]>();
  for (const signal of signals) {
    const target = signalTargets(signal)[0] ?? 'route-level';
    const id = `${signal.ruleId}:${target}`;
    groups.set(id, [...(groups.get(id) ?? []), signal]);
  }
  return [...groups.entries()]
    .map(([id, groupedSignals]) => {
      const eventIds = new Set(
        groupedSignals.flatMap((signal) => signal.supportingEventIds),
      );
      const attemptIds = new Set(
        groupedSignals.flatMap((signal) => signal.affectedAttemptIds),
      );
      const relatedAttempts = attempts.filter((attempt) =>
        attemptIds.has(attempt.attemptId),
      );
      const sessions = new Set([
        ...relatedAttempts.map((attempt) => attempt.sessionId),
        ...events
          .filter((event) => eventIds.has(event.eventId))
          .map((event) => event.sessionId),
      ]);
      const participants = new Set(
        relatedAttempts.map((attempt) => attempt.participantId),
      );
      const severity = groupedSignals.reduce<EvidenceSignal['severity']>(
        (highest, signal) =>
          signalSeverityRank[signal.severity] > signalSeverityRank[highest]
            ? signal.severity
            : highest,
        'low',
      );
      return {
        id,
        ruleId: groupedSignals[0]!.ruleId,
        target: id.slice(id.indexOf(':') + 1),
        severity,
        signals: [...groupedSignals].sort(
          (left, right) => signalRank(right) - signalRank(left),
        ),
        eventCount: eventIds.size,
        attemptCount: attemptIds.size,
        sessionCount: Math.max(
          sessions.size,
          ...groupedSignals.map((signal) => signal.support.sessions),
        ),
        participantCount: Math.max(
          participants.size,
          ...groupedSignals.map((signal) => signal.support.participants),
        ),
      };
    })
    .sort(
      (left, right) =>
        signalSeverityRank[right.severity] -
          signalSeverityRank[left.severity] ||
        right.participantCount - left.participantCount ||
        right.sessionCount - left.sessionCount ||
        right.attemptCount - left.attemptCount ||
        right.eventCount - left.eventCount ||
        left.id.localeCompare(right.id),
    );
};

function LabMutationHandoffWorkspace({
  dispatching,
  error,
  handoff,
  onStart,
}: {
  dispatching: boolean;
  error: string | null;
  handoff: LabMutationHandoff;
  onStart: () => void;
}) {
  const { experiment, execution, mutation } = handoff;
  return (
    <section className="surface-panel lab-mutation-handoff">
      <div className="panel-heading">
        <div>
          <p className="section-label">Darwin Lab handoff</p>
          <h2>{mutation.title}</h2>
        </div>
        <ProvenanceChip provenance={experiment.selection!.provenance} />
      </div>
      <p>{mutation.problem}</p>
      <div className="lab-evidence-summary">
        <span>{experiment.name}</span>
        <span>{mutation.evidenceIds.join(' · ')}</span>
        <span>{Math.round(mutation.confidence * 100)}% confidence</span>
      </div>
      <details className="mutation-causal-disclosure" open={!execution}>
        <summary>Hypothesis &amp; implementation brief</summary>
        <div className="mutation-causal-change">
          <div>
            <span>Hypothesis</span>
            <p>{mutation.hypothesis}</p>
          </div>
          <div>
            <span>Controlled implementation brief</span>
            <p>{mutation.implementationBrief}</p>
          </div>
        </div>
      </details>
      {error && (
        <div className="lab-error" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {!execution && (
        <div className="lab-dispatch-action">
          <button
            className="primary-action"
            type="button"
            disabled={dispatching}
            onClick={onStart}
          >
            {dispatching ? (
              <CircleDashed className="is-spinning" size={16} />
            ) : (
              <Rocket size={16} />
            )}
            {dispatching
              ? 'Dispatching controlled mutation'
              : 'Prepare and dispatch ProjectFlow mutation'}
          </button>
        </div>
      )}
    </section>
  );
}

function LiveTelemetryPanel({
  telemetry,
  analysisConfig,
  mode,
}: {
  telemetry: LiveTelemetryState;
  analysisConfig: ApiHealthState['analysis'];
  mode: 'observations' | 'mutations';
}) {
  const isObservations = mode === 'observations';
  const sessions = [
    ...new Set(telemetry.events.map((event) => event.sessionId)),
  ];
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [signalSeverityFilter, setSignalSeverityFilter] = useState('all');
  const [signalRuleEventFilter, setSignalRuleEventFilter] = useState('all');
  const [signalTargetFilter, setSignalTargetFilter] = useState('all');
  const [signalSessionFilter, setSignalSessionFilter] = useState('all');
  const [signalTaskFilter, setSignalTaskFilter] = useState('all');
  const [signalPage, setSignalPage] = useState(0);
  const pendingSignalRevealPage = useRef<number | null>(null);
  // Set only when the operator clicks "Analyse latest behaviour" so evidence
  // generation auto-advances into reasoning; a page load with existing evidence
  // never sets it, keeping reasoning a deliberate action.
  const pendingAnalyse = useRef(false);
  const [implementationMutationIds, setImplementationMutationIds] = useState<
    string[]
  >([]);
  const [expandedMutationIds, setExpandedMutationIds] = useState<string[]>([]);
  const visibleEvents = selectedSession
    ? telemetry.events.filter((event) => event.sessionId === selectedSession)
    : telemetry.events;
  const evidenceSignals = telemetry.evidence?.frictionSignals ?? [];
  const evidenceAttempts = telemetry.evidence?.taskAttempts ?? [];
  const rankedSignals = useMemo(
    () =>
      [...evidenceSignals].sort(
        (left, right) =>
          signalRank(right) - signalRank(left) ||
          left.evidenceId.localeCompare(right.evidenceId),
      ),
    [evidenceSignals],
  );
  const pressureGroups = useMemo(
    () =>
      buildSignalPressureGroups(
        evidenceSignals,
        evidenceAttempts,
        telemetry.events,
      ),
    [evidenceAttempts, evidenceSignals, telemetry.events],
  );
  const signalRules = useMemo(
    () => [...new Set(evidenceSignals.map((signal) => signal.ruleId))].sort(),
    [evidenceSignals],
  );
  const signalEventTypes = useMemo(
    () =>
      [
        ...new Set(
          evidenceSignals.flatMap((signal) =>
            signal.trace.map((event) => event.eventType),
          ),
        ),
      ].sort(),
    [evidenceSignals],
  );
  const signalTargetOptions = useMemo(
    () => [...new Set(evidenceSignals.flatMap(signalTargets))].sort(),
    [evidenceSignals],
  );
  const signalSessionOptions = useMemo(
    () =>
      [
        ...new Set(
          evidenceSignals.flatMap((signal) =>
            signalSessions(signal, evidenceAttempts, telemetry.events),
          ),
        ),
      ].sort(),
    [evidenceAttempts, evidenceSignals, telemetry.events],
  );
  const signalTaskOptions = useMemo(
    () =>
      [
        ...new Set(
          evidenceSignals.flatMap((signal) =>
            signalTasks(signal, evidenceAttempts),
          ),
        ),
      ].sort(),
    [evidenceAttempts, evidenceSignals],
  );
  const filteredSignals = rankedSignals.filter((signal) => {
    if (
      signalSeverityFilter !== 'all' &&
      signal.severity !== signalSeverityFilter
    ) {
      return false;
    }
    if (
      signalRuleEventFilter.startsWith('rule:') &&
      signal.ruleId !== signalRuleEventFilter.slice('rule:'.length)
    ) {
      return false;
    }
    if (
      signalRuleEventFilter.startsWith('event:') &&
      !signal.trace.some(
        (event) =>
          event.eventType === signalRuleEventFilter.slice('event:'.length),
      )
    ) {
      return false;
    }
    if (
      signalTargetFilter !== 'all' &&
      !signalTargets(signal).includes(signalTargetFilter)
    ) {
      return false;
    }
    if (
      signalSessionFilter !== 'all' &&
      !signalSessions(signal, evidenceAttempts, telemetry.events).includes(
        signalSessionFilter,
      )
    ) {
      return false;
    }
    return (
      signalTaskFilter === 'all' ||
      signalTasks(signal, evidenceAttempts).includes(signalTaskFilter)
    );
  });
  const signalPageCount = Math.max(
    1,
    Math.ceil(filteredSignals.length / signalPageSize),
  );
  const pagedSignals = filteredSignals.slice(
    signalPage * signalPageSize,
    (signalPage + 1) * signalPageSize,
  );
  const configuredModel = analysisConfig?.model ?? 'gpt-5.6';
  const liveModelAvailable = analysisConfig?.liveModelAvailable ?? false;
  const implementationCandidates = telemetry.analysis
    ? [telemetry.analysis.selectedMutation, ...telemetry.analysis.alternatives]
    : [];
  const rankedImplementationCandidates = [...implementationCandidates].sort(
    (left, right) => right.scorecard.total - left.scorecard.total,
  );
  const implementationCandidatesSelected = implementationCandidates.filter(
    (candidate) => implementationMutationIds.includes(candidate.id),
  );
  const manifestMutationIds = telemetry.manifest
    ? (telemetry.manifest.mutationIds ?? [telemetry.manifest.mutationId])
    : [];
  const manifestMatchesSelection =
    telemetry.manifest !== null &&
    manifestMutationIds.length === implementationCandidatesSelected.length &&
    implementationCandidatesSelected.every(
      (candidate, index) => candidate.id === manifestMutationIds[index],
    );
  const lastUpdatedLabel = telemetry.lastUpdatedAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(telemetry.lastUpdatedAt))
    : null;
  const toggleImplementationMutation = (mutationId: string) => {
    setImplementationMutationIds((current) =>
      current.includes(mutationId)
        ? current.filter((id) => id !== mutationId)
        : [...current, mutationId],
    );
  };
  // One linear step: build evidence from the latest sessions if needed, then
  // reason over it. Evidence generation auto-advances into analysis via the
  // effect below so the operator never leaves the Mutations view.
  const analyseLatest = async () => {
    if (telemetry.evidence) {
      await telemetry.analyseEvidence();
      return;
    }
    pendingAnalyse.current = true;
    await telemetry.generateEvidence();
  };

  const focusPressureGroup = (group: SignalPressureGroup) => {
    setSignalSeverityFilter('all');
    setSignalRuleEventFilter(`rule:${group.ruleId}`);
    setSignalTargetFilter(group.target);
    setSignalSessionFilter('all');
    setSignalTaskFilter('all');
    setSignalPage(0);
    openSignalInspector();
    window.requestAnimationFrame(() =>
      document
        .getElementById('signal-inspector')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };
  const openSignalInspector = () => {
    const disclosure = document.getElementById('signal-inspector-disclosure');
    if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
  };

  const revealExactSignal = (signal: EvidenceSignal) => {
    openSignalInspector();
    setSignalSeverityFilter('all');
    setSignalRuleEventFilter('all');
    setSignalTargetFilter('all');
    setSignalSessionFilter('all');
    setSignalTaskFilter('all');
    const revealPage = Math.max(
      0,
      Math.floor(rankedSignals.indexOf(signal) / signalPageSize),
    );
    pendingSignalRevealPage.current = revealPage;
    setSignalPage(revealPage);
    window.history.replaceState(
      {},
      '',
      `${dashboardRoutes.Observations}#signal-${signal.evidenceId}`,
    );
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const row = document.getElementById(`signal-${signal.evidenceId}`);
        if (!(row instanceof HTMLDetailsElement)) return;
        row.open = true;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }),
    );
  };

  useEffect(() => {
    setImplementationMutationIds(
      telemetry.manifest
        ? (telemetry.manifest.mutationIds ?? [telemetry.manifest.mutationId])
        : telemetry.analysis
          ? [telemetry.analysis.selectedMutation.id]
          : [],
    );
    setExpandedMutationIds(
      telemetry.analysis ? [telemetry.analysis.selectedMutation.id] : [],
    );
  }, [telemetry.analysis?.analysisId, telemetry.manifest]);

  useEffect(() => {
    if (pendingSignalRevealPage.current !== null) {
      setSignalPage(pendingSignalRevealPage.current);
      pendingSignalRevealPage.current = null;
      return;
    }
    setSignalPage(0);
  }, [
    signalSeverityFilter,
    signalRuleEventFilter,
    signalTargetFilter,
    signalSessionFilter,
    signalTaskFilter,
    telemetry.evidence?.evidenceId,
  ]);

  useEffect(() => {
    if (!isObservations || !telemetry.evidence) return;
    const signalId = decodeURIComponent(window.location.hash).replace(
      '#signal-',
      '',
    );
    if (!signalId || signalId === window.location.hash) return;
    const signalIndex = rankedSignals.findIndex(
      (signal) => signal.evidenceId === signalId,
    );
    if (signalIndex < 0) return;
    revealExactSignal(rankedSignals[signalIndex]!);
  }, [isObservations, telemetry.evidence?.evidenceId]);

  useEffect(() => {
    if (
      pendingAnalyse.current &&
      telemetry.evidence &&
      !telemetry.analysis &&
      !telemetry.analysing &&
      telemetry.evidence.frictionSignals.length > 0 &&
      liveModelAvailable
    ) {
      pendingAnalyse.current = false;
      void telemetry.analyseEvidence();
    }
  }, [
    telemetry.evidence,
    telemetry.analysis,
    telemetry.analysing,
    liveModelAvailable,
    telemetry,
  ]);

  return (
    <section className="mt-8 surface-panel live-evidence" id="real-evidence">
      <div className="panel-heading live-evidence-heading">
        <div>
          <p className="section-label">
            {isObservations
              ? 'Measured source · real users'
              : 'Evidence-led selection'}
          </p>
          <div className="heading-with-help">
            <h2 className="mt-2 text-xl font-semibold">
              {isObservations ? 'Live study evidence' : 'Mutation workspace'}
            </h2>
            <InfoTip
              text={
                isObservations
                  ? telemetry.canInspectEvidence
                    ? 'Real semantic events ingested from the standalone ProjectFlow application. Evidence-inspector access shows ordered pseudonymous traces without recording typed values.'
                    : 'Aggregate study counts omit event records and participant or session identifiers. Ordered traces require evidence-inspector access.'
                  : 'GPT reasons only over the verified evidence pack and connected ProjectFlow source snapshot. Candidate changes stay reviewable until an approved manifest is executed.'
              }
            />
          </div>
          <p className="mt-2 text-sm text-mist">
            {isObservations
              ? telemetry.canInspectEvidence
                ? 'Ordered semantic events from standalone ProjectFlow.'
                : 'Aggregate behavior counts with raw identities omitted.'
              : 'Compare real pressure clusters, choose a bounded mutation bundle, and supervise the implementation.'}
          </p>
        </div>
        <div className="live-evidence-actions">
          <div className="live-update-stack">
            <button
              aria-label="Refresh live telemetry"
              className={`source-status source-${telemetry.status}`}
              data-explain="Refresh events, evidence, GPT analysis, Codex manifest, current execution, Genome, and observation archives from Rosalind's API. Partial failures name the affected subsystem."
              disabled={telemetry.refreshing}
              onClick={() => void telemetry.refresh()}
              type="button"
            >
              <span /> {telemetry.refreshing ? 'refreshing' : telemetry.status}
              <RotateCcw
                className={telemetry.refreshing ? 'is-spinning' : ''}
                size={12}
              />
            </button>
            <div
              aria-live="polite"
              className={`live-update-indicator is-${telemetry.pollingState}`}
            >
              <span>
                {telemetry.pollingState === 'paused'
                  ? 'updates paused'
                  : telemetry.pollingState === 'stale'
                    ? 'telemetry stale'
                    : 'incremental updates'}
              </span>
              {telemetry.lastUpdatedAt && lastUpdatedLabel && (
                <time dateTime={telemetry.lastUpdatedAt}>
                  Last update {lastUpdatedLabel}
                </time>
              )}
            </div>
          </div>
          {isObservations && telemetry.canInspectEvidence && (
            <button
              className="primary-action evidence-action"
              type="button"
              disabled={!telemetry.count || telemetry.generating}
              onClick={() => void telemetry.generateEvidence()}
              data-explain="Parse the current measured D1 events into ordered journeys, coverage quality, task attempts, and citeable friction signals."
            >
              {telemetry.generating ? (
                <CircleDashed className="is-spinning" size={15} />
              ) : (
                <FileCheck2 size={15} />
              )}
              {telemetry.generating ? 'Parsing evidence' : 'Generate evidence'}
            </button>
          )}
        </div>
      </div>

      {telemetry.error && (
        <div className="error-band telemetry-error" role="alert">
          <AlertTriangle size={16} />
          <span>{telemetry.error}</span>
          <button
            type="button"
            aria-label="Dismiss telemetry error"
            onClick={telemetry.clearError}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {isObservations && (
        <>
          <div
            className="evidence-stats measurement-boundary"
            aria-label="Verified measurement boundary"
          >
            <div data-explain="The exact ProjectFlow production commit admitted into the current evidence cycle only after deployment verification succeeds.">
              <GitBranch size={16} />
              <span>Measured commit</span>
              <strong>
                {telemetry.evolutionCycle.measuredCommit?.slice(0, 12) ??
                  'baseline'}
              </strong>
            </div>
            <div data-explain="The single application version required for every event in the current evidence pack.">
              <Dna size={16} />
              <span>App version</span>
              <strong>
                {telemetry.evolutionCycle.appVersion ?? 'baseline'}
              </strong>
            </div>
            <div data-explain="The production deployment timestamp that anchors the current evidence cycle. Events received before this boundary are excluded.">
              <ShieldCheck size={16} />
              <span>Deployment</span>
              <strong>
                {telemetry.evolutionCycle.deploymentVerifiedAt
                  ? `verified ${new Date(
                      telemetry.evolutionCycle.deploymentVerifiedAt,
                    ).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'baseline study'}
              </strong>
            </div>
          </div>
          <div className="evidence-stats" aria-label="Real study counts">
            <div data-explain="Every persisted semantic event in this study, counted across the full database rather than only the recent trace window.">
              <Database size={16} />
              <span>Measured events</span>
              <strong>{telemetry.count}</strong>
            </div>
            <div data-explain="Distinct ordered browser sessions across the full persisted study.">
              <Network size={16} />
              <span>Sessions</span>
              <strong>{telemetry.sessionCount}</strong>
            </div>
            <div data-explain="Anonymous participant identifiers represented across the full persisted study.">
              <Users size={16} />
              <span>Participants</span>
              <strong>{telemetry.participantCount}</strong>
            </div>
            <div data-explain="Hover hesitation, rage click, false affordance, indecision, drag expectation, browser Back, zoom-readability, and touch-conflict observations.">
              <MousePointer2 size={16} />
              <span>Behavior signals</span>
              <strong>{telemetry.behaviorSignalCount}</strong>
            </div>
          </div>

          {telemetry.events.length ? (
            <div className="trace-layout">
              <div className="session-index">
                <button
                  className={selectedSession === null ? 'is-active' : ''}
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  data-explain="All persisted events in this study. The detailed trace remains responsive by polling and displaying only the latest 200 records."
                >
                  All captured events <span>{telemetry.count}</span>
                </button>
                {sessions.map((session) => {
                  const count = telemetry.sessionCounts[session] ?? 0;
                  return (
                    <button
                      className={selectedSession === session ? 'is-active' : ''}
                      key={session}
                      type="button"
                      onClick={() => setSelectedSession(session)}
                      data-explain="All persisted events in this session. Selecting it filters the detailed trace to its latest loaded records."
                    >
                      {shortId(session)} <span>{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="event-trace" aria-label="Ordered event trace">
                {visibleEvents.slice(-12).map((event) => (
                  <EventTraceRow event={event} key={event.eventId} />
                ))}
              </div>
            </div>
          ) : telemetry.count && !telemetry.canInspectEvidence ? (
            <div className="empty-evidence">
              <ShieldCheck size={18} />
              <div>
                <strong>Aggregate telemetry view</strong>
                <span>
                  Raw sessions and ordered traces require the evidence-inspector
                  capability.
                </span>
              </div>
            </div>
          ) : (
            <div className="empty-evidence">
              <Activity size={18} />
              <div>
                <strong>Waiting for a real ProjectFlow interaction</strong>
                <span>
                  Open ProjectFlow and interact to create the first trace.
                </span>
              </div>
            </div>
          )}
        </>
      )}
      {telemetry.evidence && (
        <details
          className={`evidence-pack evidence-disclosure ${isObservations ? 'is-observations' : ''}`}
          open={isObservations ? true : undefined}
        >
          <summary className="evidence-disclosure-summary">
            <span>
              <strong>Evidence and mutation reasoning</strong>
              <small>
                {telemetry.evidence.quality.strength} evidence ·{' '}
                {telemetry.evidence.quality.score}/100 quality ·{' '}
                {telemetry.evidence.frictionSignals.length} signals
              </small>
            </span>
            <span>
              {telemetry.analysis
                ? `${rankedImplementationCandidates.length} ranked mutations`
                : 'Reasoning not yet run'}
              <ChevronRight size={16} />
            </span>
          </summary>
          <div className="evidence-pack-header">
            <div>
              <span className="evidence-class">
                {telemetry.evidence.evidenceClass}
              </span>
              <ProvenanceChip provenance={telemetry.evidence.provenance} />
              <strong>Evidence pack {telemetry.evidence.evidenceId}</strong>
              <code>{telemetry.evidence.evidenceHash.slice(0, 16)}</code>
            </div>
            <dl>
              <div>
                <dt>Parser</dt>
                <dd>{telemetry.evidence.parserVersion}</dd>
              </div>
              <div>
                <dt>App version</dt>
                <dd>{telemetry.evidence.study.appVersion}</dd>
              </div>
              <div>
                <dt>Measured commit</dt>
                <dd>
                  {telemetry.evidence.study.measuredCommit?.slice(0, 12) ??
                    'baseline'}
                </dd>
              </div>
              <div>
                <dt>Quality</dt>
                <dd>{telemetry.evidence.quality.score}/100</dd>
              </div>
              <div>
                <dt>Journeys</dt>
                <dd>{telemetry.evidence.journeys.length}</dd>
              </div>
              <div>
                <dt>Attempts</dt>
                <dd>{telemetry.evidence.study.attempts}</dd>
              </div>
              <div>
                <dt>Signals</dt>
                <dd>{telemetry.evidence.frictionSignals.length}</dd>
              </div>
            </dl>
          </div>
          {isObservations && (
            <>
              {evidenceSignals.length ? (
                <>
                  <section
                    className="signal-pressure-overview"
                    aria-labelledby="pressure-overview-title"
                  >
                    <div className="signal-section-heading">
                      <div>
                        <span className="section-label">Top pressures</span>
                        <h3 id="pressure-overview-title">
                          Ranked by severity and independent support
                        </h3>
                      </div>
                      <span>
                        {pressureGroups.length} grouped pressures ·{' '}
                        {evidenceSignals.length} exact signals
                      </span>
                    </div>
                    <div className="top-pressure-grid">
                      {pressureGroups.slice(0, 3).map((group, index) => (
                        <button
                          key={group.id}
                          onClick={() => focusPressureGroup(group)}
                          type="button"
                          aria-label={`Inspect ${group.ruleId.replaceAll('_', ' ')} on ${group.target}`}
                        >
                          <span className="pressure-rank">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span
                            className={`signal-severity severity-${group.severity}`}
                          >
                            {group.severity}
                          </span>
                          <strong>{group.ruleId.replaceAll('_', ' ')}</strong>
                          <code>{group.target}</code>
                          <small>
                            {group.participantCount} participants ·{' '}
                            {group.sessionCount} sessions · {group.eventCount}{' '}
                            events
                          </small>
                        </button>
                      ))}
                    </div>
                    <div
                      className="pressure-group-list"
                      aria-label="Ranked pressure groups"
                    >
                      {pressureGroups.map((group) => (
                        <details key={group.id}>
                          <summary>
                            <span
                              className={`signal-severity severity-${group.severity}`}
                            >
                              {group.severity}
                            </span>
                            <span className="pressure-group-title">
                              <strong>
                                {group.ruleId.replaceAll('_', ' ')}
                              </strong>
                              <code>{group.target}</code>
                            </span>
                            <span className="pressure-group-support">
                              {group.signals.length} signals ·{' '}
                              {group.eventCount} events · {group.attemptCount}{' '}
                              attempts · {group.sessionCount} sessions ·{' '}
                              {group.participantCount} participants
                            </span>
                            <ChevronRight size={15} />
                          </summary>
                          <div>
                            {group.signals.map((signal) => (
                              <a
                                href={`#signal-${signal.evidenceId}`}
                                key={signal.evidenceId}
                                onClick={(event) => {
                                  event.preventDefault();
                                  revealExactSignal(signal);
                                }}
                              >
                                <span>{signal.evidenceId}</span>
                                <strong>{signal.summary}</strong>
                                <small>
                                  {signal.support.events} events ·{' '}
                                  {signal.support.sessions} sessions
                                </small>
                              </a>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </section>

                  <details
                    className="signal-inspector-disclosure"
                    id="signal-inspector-disclosure"
                  >
                    <summary className="signal-inspector-summary">
                      Full signal inspector · {evidenceSignals.length} exact
                      signals with filters and raw traces
                    </summary>
                    <section
                      className="signal-inspector"
                      id="signal-inspector"
                      aria-labelledby="signal-inspector-title"
                    >
                    <div className="signal-section-heading">
                      <div>
                        <span className="section-label">
                          Full signal inspector
                        </span>
                        <h3 id="signal-inspector-title">
                          Exact detector output and raw event links
                        </h3>
                      </div>
                      <span>
                        {filteredSignals.length} of {evidenceSignals.length}{' '}
                        signals
                      </span>
                    </div>
                    <div className="signal-filters" aria-label="Signal filters">
                      <label>
                        <span>Severity</span>
                        <select
                          value={signalSeverityFilter}
                          onChange={(event) =>
                            setSignalSeverityFilter(event.target.value)
                          }
                        >
                          <option value="all">All severities</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label>
                        <span>Rule / event</span>
                        <select
                          value={signalRuleEventFilter}
                          onChange={(event) =>
                            setSignalRuleEventFilter(event.target.value)
                          }
                        >
                          <option value="all">All rules and events</option>
                          <optgroup label="Detector rules">
                            {signalRules.map((rule) => (
                              <option key={rule} value={`rule:${rule}`}>
                                {rule.replaceAll('_', ' ')}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Trace event types">
                            {signalEventTypes.map((eventType) => (
                              <option
                                key={eventType}
                                value={`event:${eventType}`}
                              >
                                {eventType.replaceAll('_', ' ')}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <label>
                        <span>Target</span>
                        <select
                          value={signalTargetFilter}
                          onChange={(event) =>
                            setSignalTargetFilter(event.target.value)
                          }
                        >
                          <option value="all">All targets</option>
                          {signalTargetOptions.map((target) => (
                            <option key={target} value={target}>
                              {target}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Session</span>
                        <select
                          value={signalSessionFilter}
                          onChange={(event) =>
                            setSignalSessionFilter(event.target.value)
                          }
                        >
                          <option value="all">All sessions</option>
                          {signalSessionOptions.map((session) => (
                            <option key={session} value={session}>
                              {shortId(session)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Task</span>
                        <select
                          value={signalTaskFilter}
                          onChange={(event) =>
                            setSignalTaskFilter(event.target.value)
                          }
                        >
                          <option value="all">All tasks</option>
                          {signalTaskOptions.map((task) => (
                            <option key={task} value={task}>
                              {task.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="evidence-signals">
                      {pagedSignals.length ? (
                        pagedSignals.map((signal) => {
                          const supportingIds = new Set(
                            signal.supportingEventIds,
                          );
                          const rawEvents = telemetry.events.filter((event) =>
                            supportingIds.has(event.eventId),
                          );
                          return (
                            <details
                              id={`signal-${signal.evidenceId}`}
                              key={signal.evidenceId}
                            >
                              <summary>
                                <span className="evidence-signal-id">
                                  {signal.evidenceId}
                                </span>
                                <span className="evidence-signal-title">
                                  <strong>
                                    {signal.ruleId.replaceAll('_', ' ')}
                                  </strong>
                                  <small>
                                    {signalTargets(signal).join(' · ')}
                                  </small>
                                </span>
                                <span className="signal-row-support">
                                  {signal.support.events} events ·{' '}
                                  {signal.support.attempts} attempts ·{' '}
                                  {signal.support.sessions} sessions ·{' '}
                                  {signal.support.participants} participants
                                </span>
                                <span
                                  className={`signal-severity severity-${signal.severity}`}
                                >
                                  {signal.severity}
                                </span>
                                <ChevronRight size={15} />
                              </summary>
                              <p>{signal.summary}</p>
                              <div className="signal-provenance">
                                <span>Rule {signal.ruleVersion}</span>
                                <span>
                                  {signal.affectedAttemptIds.length} cited
                                  attempts
                                </span>
                                <span>
                                  {signal.supportingEventIds.length} cited event
                                  IDs
                                </span>
                                {signalTasks(signal, evidenceAttempts).map(
                                  (task) => (
                                    <span key={task}>Task {task}</span>
                                  ),
                                )}
                              </div>
                              <div className="signal-detail-grid">
                                <div className="signal-trace">
                                  <span>Canonical evidence trace</span>
                                  {signal.trace.map((event) => (
                                    <code key={event.eventId}>
                                      {event.sequence
                                        .toString()
                                        .padStart(2, '0')}{' '}
                                      · {event.eventType} ·{' '}
                                      {event.targetId ?? event.route}
                                    </code>
                                  ))}
                                </div>
                                <div className="signal-raw-events">
                                  <span>Loaded raw semantic events</span>
                                  {rawEvents.length ? (
                                    rawEvents.map((event) => (
                                      <EventTraceRow
                                        event={event}
                                        key={event.eventId}
                                      />
                                    ))
                                  ) : (
                                    <p>
                                      Exact event IDs are retained in the
                                      evidence pack; their raw records are
                                      outside the latest loaded trace window.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </details>
                          );
                        })
                      ) : (
                        <p className="no-signals">
                          No exact signals match all selected filters.
                        </p>
                      )}
                    </div>
                    <nav
                      className="signal-pagination"
                      aria-label="Signal pages"
                    >
                      <span>
                        {filteredSignals.length
                          ? `${signalPage * signalPageSize + 1}–${Math.min((signalPage + 1) * signalPageSize, filteredSignals.length)} of ${filteredSignals.length}`
                          : '0 signals'}
                      </span>
                      <div>
                        <button
                          type="button"
                          disabled={signalPage === 0}
                          onClick={() =>
                            setSignalPage((current) => Math.max(0, current - 1))
                          }
                        >
                          Previous
                        </button>
                        <span>
                          Page {Math.min(signalPage + 1, signalPageCount)} of{' '}
                          {signalPageCount}
                        </span>
                        <button
                          type="button"
                          disabled={signalPage + 1 >= signalPageCount}
                          onClick={() =>
                            setSignalPage((current) =>
                              Math.min(signalPageCount - 1, current + 1),
                            )
                          }
                        >
                          Next
                        </button>
                      </div>
                    </nav>
                    </section>
                  </details>
                </>
              ) : (
                <div className="evidence-signals">
                  <p className="no-signals">
                    No detector threshold was crossed by the current real
                    sample.
                  </p>
                </div>
              )}
              <div className="evidence-quality-band">
                <div>
                  <span>Evidence quality</span>
                  <strong>{telemetry.evidence.quality.strength}</strong>
                  <code>{telemetry.evidence.quality.score}/100</code>
                </div>
                <dl className="evidence-dimensions">
                  <div>
                    <dt>Volume</dt>
                    <dd>
                      {telemetry.evidence.quality.dimensions.volume.score}/100
                    </dd>
                    <small>
                      {
                        telemetry.evidence.quality.dimensions.volume
                          .observedEvents
                      }
                      /
                      {
                        telemetry.evidence.quality.dimensions.volume
                          .minimumEvents
                      }{' '}
                      events
                    </small>
                  </div>
                  <div>
                    <dt>Diversity</dt>
                    <dd>
                      {telemetry.evidence.quality.dimensions.diversity.score}
                      /100
                    </dd>
                    <small>
                      {
                        telemetry.evidence.quality.dimensions.diversity
                          .observedParticipants
                      }{' '}
                      participants ·{' '}
                      {
                        telemetry.evidence.quality.dimensions.diversity
                          .observedSessions
                      }{' '}
                      sessions
                    </small>
                  </div>
                  <div>
                    <dt>Completion</dt>
                    <dd>
                      {telemetry.evidence.quality.dimensions.completion.score}
                      /100
                    </dd>
                    <small>
                      {
                        telemetry.evidence.quality.dimensions.completion
                          .terminalAttempts
                      }
                      /
                      {
                        telemetry.evidence.quality.dimensions.completion
                          .minimumTerminalAttempts
                      }{' '}
                      terminal attempts
                    </small>
                  </div>
                  <div>
                    <dt>Recency</dt>
                    <dd>
                      {telemetry.evidence.quality.dimensions.recency.score}/100
                    </dd>
                    <small>
                      ≤
                      {
                        telemetry.evidence.quality.dimensions.recency
                          .maximumAgeDays
                      }
                      d gate
                    </small>
                  </div>
                </dl>
                {telemetry.evidence.quality.limitations.length ? (
                  <ul>
                    {telemetry.evidence.quality.limitations.map(
                      (limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p>No material coverage limitation detected.</p>
                )}
              </div>
            </>
          )}
          {!isObservations && (
            <div className="reasoning-workspace">
              <div className="reasoning-heading">
                <div>
                  <span className="section-label">
                    OpenAI reasoning boundary
                  </span>
                  <div className="reasoning-title">
                    <strong>{configuredModel} evidence reasoning</strong>
                    <span
                      className={`model-runtime ${liveModelAvailable ? 'is-live' : 'is-unavailable'}`}
                    >
                      {liveModelAvailable ? 'LIVE API' : 'UNAVAILABLE'}
                    </span>
                    <InfoTip text="The model invocation point. GPT reasons once per evidence hash over the product goals, route inventory, active variant, capabilities, friction signals, complete ordered journeys, coverage limitations, 50 mutation examples, and the ProjectFlow source snapshot. The request is cached; invalid citations or protected scope are rejected before a proposal can continue." />
                  </div>
                </div>
                <button
                  className="primary-action evidence-action"
                  type="button"
                  disabled={
                    !telemetry.evidence.frictionSignals.length ||
                    telemetry.analysing ||
                    !liveModelAvailable
                  }
                  onClick={() => void telemetry.analyseEvidence()}
                  data-explain={`Invoke ${configuredModel} once for this evidence hash. The request contains aggregate evidence and the structured ProjectFlow application map, never raw participant records.`}
                >
                  {telemetry.analysing ? (
                    <CircleDashed className="is-spinning" size={15} />
                  ) : (
                    <BrainCircuit size={15} />
                  )}
                  {telemetry.analysing
                    ? 'Reasoning over evidence'
                    : telemetry.analysis
                      ? 'Open cached reasoning'
                      : liveModelAvailable
                        ? `Ask ${configuredModel}`
                        : 'Live model unavailable'}
                </button>
              </div>
              {telemetry.analysis && (
                <div className="analysis-result">
                  <details className="analysis-audit-disclosure">
                    <summary>Reasoning provenance</summary>
                    <div className="analysis-audit-line">
                      <ProvenanceChip
                        provenance={telemetry.analysis.provenance}
                      />
                      <span>{telemetry.analysis.mode}</span>
                      <code>{telemetry.analysis.model}</code>
                      <code>prompt {telemetry.analysis.promptVersion}</code>
                      <code>{telemetry.analysis.cacheKey.slice(0, 16)}...</code>
                      {telemetry.analysis.promptCache && (
                        <code>
                          prompt cache ·{' '}
                          {telemetry.analysis.promptCache.cachedTokens ===
                          undefined
                            ? telemetry.analysis.promptCache.contextVersion
                            : `${telemetry.analysis.promptCache.cachedTokens} tokens`}
                        </code>
                      )}
                    </div>
                  </details>
                  <div className="reasoning-assessment">
                    <div>
                      <span>Evidence assessment</span>
                      <strong>
                        {telemetry.analysis.evidenceAssessment.quality.strength}
                      </strong>
                      <code>
                        {telemetry.analysis.evidenceAssessment.quality.score}
                        /100
                      </code>
                    </div>
                    <p>{telemetry.analysis.evidenceAssessment.summary}</p>
                  </div>
                  <div className="mutation-portfolio">
                    <div className="mutation-portfolio-heading">
                      <div>
                        <span>Ranked pressure portfolio</span>
                        <strong>
                          Every suggestion includes its full pressure analysis
                        </strong>
                      </div>
                      <code>
                        {rankedImplementationCandidates.length} suggestions
                      </code>
                    </div>
                    {rankedImplementationCandidates.map((candidate, index) => (
                      <MutationPortfolioRow
                        analysis={telemetry.analysis!}
                        candidate={candidate}
                        evidence={telemetry.evidence}
                        expanded={expandedMutationIds.includes(candidate.id)}
                        key={candidate.id}
                        onExpansionChange={() =>
                          setExpandedMutationIds((current) =>
                            current.includes(candidate.id)
                              ? current.filter((id) => id !== candidate.id)
                              : [...current, candidate.id],
                          )
                        }
                        onSelectionChange={() =>
                          toggleImplementationMutation(candidate.id)
                        }
                        rank={index + 1}
                        selected={implementationMutationIds.includes(
                          candidate.id,
                        )}
                      />
                    ))}
                  </div>
                  <div className="codex-handoff">
                    <div>
                      <ClipboardCheck size={17} />
                      <div>
                        <strong>Controlled Codex handoff</strong>
                        <span>
                          {implementationCandidatesSelected.length
                            ? `Implementation bundle · ${implementationCandidatesSelected.map((candidate) => candidate.title).join(' + ')}.`
                            : 'No mutations selected.'}{' '}
                          Brief, allow-list, evidence citations and validation
                          commands only.
                        </span>
                      </div>
                    </div>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={
                        telemetry.preparingManifest ||
                        telemetry.implementing ||
                        implementationCandidatesSelected.length === 0
                      }
                      onClick={() => {
                        if (
                          telemetry.execution &&
                          telemetry.execution.status !== 'failed' &&
                          manifestMatchesSelection
                        ) {
                          scrollToExecutionWorkspace(
                            executionWorkspaceId(
                              telemetry.execution.executionId,
                            ),
                          );
                          return;
                        }
                        void telemetry
                          .startControlledEvolution(
                            implementationCandidatesSelected.map(
                              (candidate) => candidate.id,
                            ),
                          )
                          .then((execution) => {
                            if (!execution) return;
                            const workspaceId = executionWorkspaceId(
                              execution.executionId,
                            );
                            window.setTimeout(
                              () => scrollToExecutionWorkspace(workspaceId),
                              0,
                            );
                          });
                      }}
                    >
                      {telemetry.preparingManifest || telemetry.implementing ? (
                        <CircleDashed className="is-spinning" size={14} />
                      ) : (
                        <Rocket size={14} />
                      )}
                      {telemetry.preparingManifest
                        ? 'Preparing manifest'
                        : telemetry.implementing
                          ? 'Applying mutation'
                          : telemetry.execution?.status === 'failed' &&
                              manifestMatchesSelection
                            ? 'Retry controlled evolution'
                            : telemetry.execution && manifestMatchesSelection
                              ? 'View implementation'
                              : 'Start controlled evolution'}
                    </button>
                  </div>
                  {telemetry.manifest && manifestMatchesSelection && (
                    <div className="manifest-audit">
                      <ProvenanceChip
                        provenance={telemetry.manifest.provenance}
                      />
                      <span>MANIFEST {telemetry.manifest.manifestId}</span>
                      <code>{telemetry.manifest.manifestHash}</code>
                      <span>
                        {telemetry.manifest.allowedPaths.length} allowed ·{' '}
                        {telemetry.manifest.protectedPaths.length} protected ·{' '}
                        {telemetry.manifest.validationCommands.length} checks ·{' '}
                        {manifestMutationIds.length} mutation
                        {manifestMutationIds.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </details>
      )}
      {!isObservations && !telemetry.evidence && (
        <div className="empty-evidence empty-evidence-action">
          <div>
            <FileCheck2 size={18} />
            <div>
              <strong>Analyse the latest measured behaviour</strong>
              <span>
                One step builds the evidence pack from real ProjectFlow sessions
                and asks {configuredModel} for a ranked, evidence-cited mutation
                portfolio — no need to switch to Observations.
              </span>
            </div>
          </div>
          <button
            className="primary-action evidence-action"
            type="button"
            disabled={
              telemetry.generating ||
              telemetry.analysing ||
              !telemetry.count ||
              !liveModelAvailable
            }
            onClick={() => void analyseLatest()}
            data-explain="Build deterministic evidence from the measured study, then invoke the model once over that evidence hash. Stale-version telemetry is rejected until a matching cohort is measured."
          >
            {telemetry.generating || telemetry.analysing ? (
              <CircleDashed className="is-spinning" size={15} />
            ) : (
              <BrainCircuit size={15} />
            )}
            {telemetry.generating
              ? 'Building evidence'
              : telemetry.analysing
                ? 'Reasoning over evidence'
                : !telemetry.count
                  ? 'Awaiting measured behavior'
                  : liveModelAvailable
                    ? 'Analyse latest behaviour'
                    : 'Live model unavailable'}
          </button>
        </div>
      )}
    </section>
  );
}

function MutationPortfolioRow({
  analysis,
  candidate,
  evidence,
  expanded,
  onExpansionChange,
  onSelectionChange,
  rank,
  selected,
}: {
  analysis: EvidenceAnalysis;
  candidate: EvidenceMutationCandidate;
  evidence: LiveTelemetryState['evidence'];
  expanded: boolean;
  onExpansionChange: () => void;
  onSelectionChange: () => void;
  rank: number;
  selected: boolean;
}) {
  const clusters = candidate.pressureClusterIds
    .map((clusterId) =>
      analysis.evidenceAssessment.pressureClusters.find(
        (cluster) => cluster.id === clusterId,
      ),
    )
    .filter(
      (
        cluster,
      ): cluster is EvidenceAnalysis['evidenceAssessment']['pressureClusters'][number] =>
        cluster !== undefined,
    );
  const score = candidate.scorecard.total;
  const heatHue = Math.max(5, Math.round(180 - score * 2));
  const heatStyle = {
    '--preference-fill': `${score}%`,
    '--preference-heat': String(heatHue),
  } as CSSProperties;
  const panelId = `mutation-portfolio-${candidate.id}`;

  return (
    <article
      className={`mutation-portfolio-row ${selected ? 'is-selected' : ''}`}
      style={heatStyle}
    >
      <div className="mutation-portfolio-summary">
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="mutation-portfolio-expand"
          onClick={onExpansionChange}
          type="button"
        >
          <span className="portfolio-rank">#{rank}</span>
          <div className="portfolio-title">
            <div>
              {clusters.map((cluster) => (
                <code
                  data-explain={`${cluster.id} is a grouped selection pressure supported by ${cluster.evidenceIds.length} cited evidence signals.`}
                  key={cluster.id}
                  tabIndex={0}
                >
                  {cluster.id}
                </code>
              ))}
              {rank === 1 && <span>GPT preferred</span>}
              <ProvenanceChip provenance={candidate.provenance} />
            </div>
            <strong>
              {clusters.map((cluster) => cluster.title).join(' + ') ||
                candidate.problem}
            </strong>
            <span>{candidate.title}</span>
          </div>
          <div
            className="portfolio-preference"
            data-explain="Rosalind preference is the composite portfolio score: 35% evidence strength, 25% user impact, 20% feasibility, and 20% validation clarity. It is a ranking, not a probability of success."
            tabIndex={0}
          >
            <strong>{score}%</strong>
            <span>preference</span>
            <div aria-hidden="true">
              <span />
            </div>
          </div>
          <ChevronRight className={expanded ? 'is-expanded' : ''} size={17} />
        </button>
        <label className="portfolio-select">
          <input
            aria-label={`Implement ${candidate.title}`}
            checked={selected}
            onChange={onSelectionChange}
            type="checkbox"
            value={candidate.id}
          />
          <span>Implement</span>
        </label>
      </div>

      {expanded && (
        <div className="mutation-portfolio-detail" id={panelId}>
          <div className="portfolio-hypothesis">
            <span>Hypothesis</span>
            <p>{candidate.hypothesis}</p>
          </div>
          <div className="mutation-causal-change">
            <span>Evidence-led change</span>
            <p>{candidate.change}</p>
          </div>
          <div className="mutation-citations">
            {candidate.evidenceIds.map((id) => (
              <EvidenceChip evidence={evidence} id={id} key={id} />
            ))}
            <span>
              {candidate.predictedImpact.metric}{' '}
              {candidate.predictedImpact.direction}
            </span>
          </div>

          {clusters.map((cluster) => (
            <section className="portfolio-pressure-analysis" key={cluster.id}>
              <div>
                <code>{cluster.id}</code>
                <strong>{cluster.title}</strong>
              </div>
              <p>{cluster.interpretation}</p>
              <div className="portfolio-pressure-evidence">
                {cluster.evidenceIds.map((id) => (
                  <EvidenceChip evidence={evidence} id={id} key={id} />
                ))}
              </div>
              <dl>
                <div>
                  <dt>User consequence</dt>
                  <dd>{cluster.userConsequence}</dd>
                </div>
                <div>
                  <dt>Competing explanations</dt>
                  <dd>{cluster.competingExplanations.join(' · ')}</dd>
                </div>
                <div>
                  <dt>Evolution opportunity</dt>
                  <dd>{cluster.mutationOpportunity}</dd>
                </div>
              </dl>
              {cluster.affectedTargets.length > 0 && (
                <div className="portfolio-targets">
                  <span>Affected targets</span>
                  {cluster.affectedTargets.map((target) => (
                    <code key={target}>{target}</code>
                  ))}
                </div>
              )}
            </section>
          ))}

          <div className="mutation-scorecard">
            {Object.entries(candidate.scorecard).map(([label, value]) => (
              <div key={label}>
                <span>{label.replace(/([A-Z])/g, ' $1')}</span>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
          <div className="validation-plan">
            <span>Measured validation plan</span>
            <strong>{candidate.validationPlan.primaryMetric}</strong>
            <p>
              {candidate.validationPlan.baseline} →{' '}
              {candidate.validationPlan.successThreshold}
            </p>
            <small>
              Guardrails · {candidate.validationPlan.guardrails.join(' · ')}
            </small>
          </div>
          <div className="portfolio-implementation-context">
            <div>
              <span>Scope</span>
              <p>{candidate.scope.join(' · ')}</p>
            </div>
            <div>
              <span>Tradeoffs</span>
              <p>{candidate.tradeoffs.join(' · ')}</p>
            </div>
            <div>
              <span>Predicted impact rationale</span>
              <p>{candidate.predictedImpact.rationale}</p>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function EvidenceChip({
  evidence,
  id,
}: {
  evidence: LiveTelemetryState['evidence'];
  id: string;
}) {
  const signal = evidence?.frictionSignals.find(
    (candidate) => candidate.evidenceId === id,
  );
  const explanation = signal
    ? `${signal.summary} Severity: ${signal.severity}. Support: ${signal.support.events} events, ${signal.support.attempts} attempts, ${signal.support.sessions} sessions, ${signal.support.participants} participants.`
    : `${id} is a citation from the current measured evidence pack.`;

  return (
    <a
      aria-label={`Open ${id} in Observations`}
      className="evidence-chip"
      data-explain={`${explanation} Open the cited detector record in Observations.`}
      href={`${dashboardRoutes.Observations}#signal-${id}`}
    >
      {id}
    </a>
  );
}

function EventTraceRow({ event }: { event: StoredTelemetryEvent }) {
  const target =
    'targetId' in event && event.targetId ? event.targetId : event.route;
  return (
    <div className="event-trace-row">
      <span className="event-sequence">
        {event.sequence.toString().padStart(2, '0')}
      </span>
      <span className={`event-kind kind-${event.eventType}`}>
        {event.eventType.replaceAll('_', ' ')}
      </span>
      <code>{target}</code>
      <span className="event-detail">{describeTelemetryEvent(event)}</span>
      <span>{shortId(event.participantId)}</span>
      <time dateTime={event.receivedAt}>
        {new Date(event.receivedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </time>
    </div>
  );
}

function describeTelemetryEvent(event: StoredTelemetryEvent) {
  switch (event.eventType) {
    case 'element_clicked':
      return event.properties
        ? `${event.properties.pointerType} · ${Math.round(event.properties.xRatio * 100)}% x / ${Math.round(event.properties.yRatio * 100)}% y${event.properties.interactive ? '' : ' · non-interactive'}`
        : 'semantic click';
    case 'hover_started':
      return `${event.properties.pointerType} entered target`;
    case 'hover_ended':
      return `${formatTelemetryDuration(event.properties.durationMs)} · ${event.properties.clicked ? `clicked after ${formatTelemetryDuration(event.properties.hoverToClickMs ?? 0)}` : event.properties.immediateExit ? 'immediate exit' : 'no click'}`;
    case 'pointer_transition':
      return `${event.properties.fromTargetId ?? 'entry'} → target · ${formatTelemetryDuration(event.properties.elapsedMs)}`;
    case 'interaction_signal':
      return `${event.properties.signal.replaceAll('_', ' ')} · ${event.properties.count} / ${formatTelemetryDuration(event.properties.windowMs)}`;
    case 'drag_attempted':
      return `${event.properties.distancePx}px · ${event.properties.draggable ? 'supported' : 'unsupported drag'}`;
    case 'touch_cancelled':
      return `touch cancelled after ${formatTelemetryDuration(event.properties.durationMs)}`;
    case 'browser_navigation':
      return `${event.properties.direction} · ${event.properties.fromRoute} → ${event.properties.toRoute}`;
    case 'viewport_zoom_changed':
      return `${Math.round(event.properties.fromScale * 100)}% → ${Math.round(event.properties.toScale * 100)}%`;
    default:
      return 'ordered study event';
  }
}

const formatTelemetryDuration = (milliseconds: number) =>
  milliseconds >= 1_000
    ? `${(milliseconds / 1_000).toFixed(1)}s`
    : `${milliseconds}ms`;

const shortId = (value: string) => {
  const suffix = value.split('-').at(-1) ?? value;
  return suffix.length > 10 ? suffix.slice(0, 10) : suffix;
};

const executionStatusLabel: Record<
  RepositoryMutationExecution['status'],
  string
> = {
  prepared: 'Preparing dispatch',
  queued: 'Queued in GitHub Actions',
  codex_running: 'Codex is editing ProjectFlow',
  validating: 'Repository checks are running',
  failed: 'Execution failed',
  pull_request_open: 'Pull request open',
  preview_ready: 'Preview ready for review',
  releasing: 'Merging reviewed pull request',
  deployment_verifying: 'Verifying production deployment',
  released: 'Mutation released',
};

const rollbackStatusLabel: Record<RepositoryRollback['status'], string> = {
  prepared: 'Preparing rollback dispatch',
  queued: 'Queued in GitHub Actions',
  validating: 'Rollback checks are running',
  failed: 'Rollback failed',
  pull_request_open: 'Rollback pull request open',
  preview_ready: 'Rollback preview ready',
  releasing: 'Merging reviewed rollback',
  released: 'Rollback released',
};

function MutationWorkspaceReset({
  execution,
}: {
  execution: RepositoryMutationExecution;
}) {
  const rollbackReleased = execution.rollback?.status === 'released';
  return (
    <section className="mt-8 surface-panel mutation-reset-panel">
      <div>
        <p className="section-label">Selection archived</p>
        <h2 className="mt-2 text-xl font-semibold">Ready for fresh evidence</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-mist">
          {rollbackReleased
            ? 'The retained mutation and its reviewed rollback are recorded in Genome. New evidence can now begin the next controlled evolution cycle.'
            : 'The retained mutation is recorded in Genome. New evidence can now begin the next controlled evolution cycle.'}
        </p>
      </div>
      <a className="secondary-action" href={dashboardRoutes.Genome}>
        <Dna size={16} /> Open Genome
      </a>
    </section>
  );
}

function ObservationArchivePanel({
  archives,
  nextCursor,
  loadArchive,
  onLoadMore,
}: {
  archives: ObservationArchiveSummary[];
  nextCursor: string | null;
  loadArchive: (archiveId: string) => Promise<ObservationArchive>;
  onLoadMore: () => void;
}) {
  const [provenanceFilter, setProvenanceFilter] =
    useState<ProvenanceFilter>('all');
  const filteredArchives = archives.filter(
    (archive) =>
      provenanceFilter === 'all' ||
      (archive.evidence.provenance?.evidenceClass ?? 'legacy') ===
        provenanceFilter,
  );
  return (
    <section
      className="mt-8 surface-panel observation-archive"
      aria-labelledby="observation-archive-title"
    >
      <div className="panel-heading">
        <div>
          <p className="section-label">Retained evidence</p>
          <div className="heading-with-help">
            <h2
              id="observation-archive-title"
              className="mt-2 text-xl font-semibold"
            >
              Observation archive
            </h2>
            <InfoTip text="Evidence is archived here once it has driven a completed controlled mutation. The active study above contains only the next measurement cycle." />
          </div>
        </div>
        <Database size={19} className="text-mist" />
      </div>
      <label className="artifact-filter">
        <span>Evidence class</span>
        <select
          value={provenanceFilter}
          onChange={(event) =>
            setProvenanceFilter(event.target.value as ProvenanceFilter)
          }
        >
          <option value="all">All evidence classes</option>
          <option value="human_study">Human study</option>
          <option value="darwin_lab">Darwin Labs</option>
          <option value="automated_study">Automated study</option>
          <option value="scale_replay">Scale replay</option>
          <option value="legacy">Unknown / legacy</option>
        </select>
      </label>
      {filteredArchives.map((archive) => (
        <ObservationArchiveArtifact
          key={archive.archiveId}
          archive={archive}
          loadArchive={loadArchive}
        />
      ))}
      {nextCursor && (
        <div className="archive-pagination">
          <button
            className="secondary-action"
            type="button"
            onClick={onLoadMore}
          >
            Load older observation records
          </button>
        </div>
      )}
    </section>
  );
}

function ObservationArchiveArtifact({
  archive,
  loadArchive,
}: {
  archive: ObservationArchiveSummary;
  loadArchive: (archiveId: string) => Promise<ObservationArchive>;
}) {
  const [detail, setDetail] = useState<ObservationArchive | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deepLinked =
    window.location.hash === `#observation-${archive.archiveId}`;
  const [open, setOpen] = useState(deepLinked);

  const hydrate = async () => {
    if (detail || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      setDetail(await loadArchive(archive.archiveId));
    } catch (reason) {
      setLoadError(
        reason instanceof Error ? reason.message : 'Archive detail failed.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deepLinked) void hydrate();
  }, []);

  const { analysis, evidence, execution } = archive;
  const failed = execution.status === 'failed';
  return (
    <details
      className="fossil-artifact observation-artifact"
      id={`observation-${archive.archiveId}`}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (nextOpen) void hydrate();
      }}
    >
      <summary>
        <div className="fossil-artifact-summary">
          <div>
            <span>Evidence</span>
            <strong>{evidence.evidenceId}</strong>
            <ProvenanceChip provenance={evidence.provenance} />
          </div>
          <div>
            <span>Measured scope</span>
            <strong>
              {evidence.study.sourceEventCount.toLocaleString('en-US')} events
              {' · '}
              {evidence.study.sessions} sessions
            </strong>
          </div>
          <div>
            <span>Evidence quality</span>
            <strong>
              {evidence.quality.strength} {evidence.quality.score}/100
            </strong>
          </div>
          <div>
            <span>Informed mutation</span>
            <strong>{analysis.selectedMutation.title}</strong>
          </div>
          <span className={failed ? 'status-badge is-failed' : 'status-badge'}>
            {failed ? 'FAILED' : 'ARCHIVED'}
          </span>
        </div>
        <ChevronRight className="fossil-artifact-chevron" size={18} />
      </summary>
      <div className="fossil-artifact-detail observation-archive-detail">
        {loading && (
          <ArchiveLoading label="Loading evidence journeys and traces" />
        )}
        {loadError && (
          <ArchiveLoadError
            message={loadError}
            onRetry={() => void hydrate()}
          />
        )}
        {detail && (
          <>
            <div className="observation-archive-stats">
              <div>
                <span>Participants</span>
                <strong>{detail.evidence.study.participants}</strong>
              </div>
              <div>
                <span>Task attempts</span>
                <strong>{detail.evidence.study.attempts}</strong>
              </div>
              <div>
                <span>Selection pressures</span>
                <strong>{detail.evidence.frictionSignals.length}</strong>
              </div>
              <div>
                <span>Reasoned with</span>
                <strong>{detail.analysis.model}</strong>
              </div>
            </div>
            <div className="observation-archive-copy">
              <div>
                <span className="section-label">Evidence assessment</span>
                <p>{detail.analysis.evidenceAssessment.summary}</p>
              </div>
              <div>
                <span className="section-label">
                  Mutation informed by this evidence
                </span>
                <strong>{detail.analysis.selectedMutation.title}</strong>
                <p>{detail.analysis.selectedMutation.hypothesis}</p>
              </div>
            </div>
            <div className="observation-archive-signals">
              <span className="section-label">Retained signals</span>
              {detail.evidence.frictionSignals.map((signal) => (
                <div key={signal.evidenceId}>
                  <strong>
                    {signal.severity} · {signal.summary}
                  </strong>
                  <span>
                    {signal.support.events} events across{' '}
                    {signal.support.sessions} sessions
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function ArchiveLoading({ label }: { label: string }) {
  return (
    <div className="archive-detail-state" aria-live="polite">
      <CircleDashed className="is-spinning" size={18} /> {label}
    </div>
  );
}

function ArchiveLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="archive-detail-state is-error" role="alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
      <button className="secondary-action" type="button" onClick={onRetry}>
        Retry detail
      </button>
    </div>
  );
}

function FossilExecutionArtifact({
  execution,
  executionDetail,
  loadExecution,
  fitnessOutcome,
  mutationTitle,
  manifest,
  releasing,
  retrying,
  rollingBack,
  releasingRollback,
  onRelease,
  onRollback,
  onReleaseRollback,
  onRetry,
}: {
  execution: RepositoryExecutionSummary;
  executionDetail: RepositoryMutationExecution | null;
  loadExecution: (executionId: string) => Promise<RepositoryMutationExecution>;
  fitnessOutcome: FitnessOutcome | null;
  mutationTitle: string | null;
  manifest: CodexImplementationManifest | null;
  releasing: boolean;
  retrying: boolean;
  rollingBack: boolean;
  releasingRollback: boolean;
  onRelease: () => void;
  onRollback: () => void;
  onReleaseRollback: () => void;
  onRetry: () => void;
}) {
  const [detail, setDetail] = useState<RepositoryMutationExecution | null>(
    executionDetail,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deepLinked =
    window.location.hash === `#fossil-${execution.executionId}`;
  const [open, setOpen] = useState(deepLinked);

  useEffect(() => {
    if (executionDetail) setDetail(executionDetail);
  }, [executionDetail]);

  const hydrate = async () => {
    if (detail || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      setDetail(await loadExecution(execution.executionId));
    } catch (reason) {
      setLoadError(
        reason instanceof Error ? reason.message : 'Genome detail failed.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deepLinked) void hydrate();
  }, []);

  const retained = execution.status === 'released';
  const failed = execution.status === 'failed';
  const rollback = execution.rollback;
  const artifactState =
    rollback?.status === 'released'
      ? 'REVERTED'
      : failed
        ? 'EXECUTION FAILED'
        : retained
          ? 'RETAINED'
          : 'CANDIDATE';

  return (
    <details
      className="fossil-artifact"
      id={`fossil-${execution.executionId}`}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (nextOpen) void hydrate();
      }}
    >
      <summary>
        <div className="fossil-artifact-summary">
          <div>
            <span>Genome</span>
            <strong>
              {execution.headSha?.slice(0, 12) ?? execution.branch}
            </strong>
            <ProvenanceChip provenance={execution.provenance} />
          </div>
          <div>
            <span>Mutation</span>
            <strong title={mutationTitle ?? execution.manifestId}>
              {mutationTitle ?? execution.manifestId}
            </strong>
          </div>
          <div>
            <span>Selection</span>
            <strong>
              {rollback?.status === 'released'
                ? 'Returned to baseline'
                : retained
                  ? 'Survived selection'
                  : failed
                    ? 'Execution failed'
                    : executionStatusLabel[execution.status]}
            </strong>
          </div>
          <div>
            <span>Fitness</span>
            <strong>
              {fitnessOutcome?.status === 'measured'
                ? `${fitnessOutcome.evolvedScore}/100 · ${signedNumber(fitnessOutcome.delta!)}`
                : fitnessOutcome?.status === 'insufficient'
                  ? 'Sample gated'
                  : fitnessOutcome?.status === 'rolled_back'
                    ? 'Stopped after rollback'
                    : retained
                      ? 'Measurement pending'
                      : '--'}
            </strong>
          </div>
          <span className={failed ? 'status-badge is-failed' : 'status-badge'}>
            {artifactState}
          </span>
        </div>
        <ChevronRight className="fossil-artifact-chevron" size={18} />
      </summary>
      <div className="fossil-artifact-detail">
        {fitnessOutcome && <FitnessOutcomePanel outcome={fitnessOutcome} />}
        {loading && (
          <ArchiveLoading label="Loading patch, checks, and Codex output" />
        )}
        {loadError && (
          <ArchiveLoadError
            message={loadError}
            onRetry={() => void hydrate()}
          />
        )}
        {detail && (
          <RepositoryExecutionWorkspace
            embedded
            archived
            execution={detail}
            manifest={manifest}
            releasing={releasing}
            retrying={retrying}
            rollingBack={rollingBack}
            releasingRollback={releasingRollback}
            onRelease={onRelease}
            onRollback={onRollback}
            onReleaseRollback={onReleaseRollback}
            onRetry={onRetry}
          />
        )}
      </div>
    </details>
  );
}

function FitnessOutcomePanel({ outcome }: { outcome: FitnessOutcome }) {
  return (
    <section
      className="fitness-outcome-panel"
      aria-label="Persisted fitness outcome"
    >
      <div className="fitness-outcome-heading">
        <div>
          <span className="section-label">Measured fitness</span>
          <strong>
            {outcome.status === 'measured'
              ? `${outcome.baselineScore}/100 → ${outcome.evolvedScore}/100`
              : outcome.status === 'rolled_back'
                ? 'Comparison stopped after rollback'
                : 'Minimum sample gate not met'}
          </strong>
        </div>
        <code>formula {outcome.formulaVersion}</code>
      </div>
      {outcome.components.length > 0 && (
        <div className="fitness-component-grid">
          {outcome.components.map((component) => (
            <div key={component.metric}>
              <span>{component.metric.replaceAll('_', ' ')}</span>
              <strong>
                {component.baselineScore} → {component.evolvedScore}
              </strong>
              <code>{component.weight}%</code>
            </div>
          ))}
        </div>
      )}
      <div className="fitness-cohort-line">
        <span>
          Baseline <code>{outcome.baseline.appVersion}</code> ·{' '}
          {outcome.baseline.terminalAttempts} attempts ·{' '}
          {outcome.baseline.sessions} sessions
        </span>
        <span>
          Evolved <code>{outcome.evolved.appVersion}</code> ·{' '}
          {outcome.evolved.terminalAttempts} attempts ·{' '}
          {outcome.evolved.sessions} sessions
        </span>
      </div>
      {outcome.limitations.length > 0 && (
        <ul className="fitness-limitations">
          {outcome.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepositoryExecutionWorkspace({
  execution,
  manifest,
  releasing,
  retrying,
  rollingBack,
  releasingRollback,
  archived = false,
  embedded = false,
  onRelease,
  onRollback,
  onReleaseRollback,
  onRetry,
}: {
  execution: RepositoryMutationExecution;
  manifest: CodexImplementationManifest | null;
  releasing: boolean;
  retrying: boolean;
  rollingBack: boolean;
  releasingRollback: boolean;
  archived?: boolean;
  embedded?: boolean;
  onRelease: () => void;
  onRollback: () => void;
  onReleaseRollback: () => void;
  onRetry: () => void;
}) {
  const lines = execution.patch?.split('\n') ?? [];
  const status = execution.status;
  const codexComplete = [
    'validating',
    'pull_request_open',
    'preview_ready',
    'releasing',
    'deployment_verifying',
    'released',
  ].includes(status);
  const validationComplete = [
    'pull_request_open',
    'preview_ready',
    'releasing',
    'deployment_verifying',
    'released',
  ].includes(status);
  const reviewComplete = [
    'preview_ready',
    'releasing',
    'deployment_verifying',
    'released',
  ].includes(status);
  const regionId = executionWorkspaceId(execution.executionId);
  const headingId = `${regionId}-title`;

  // The one action a human can take right now. Lifted above the patch/checks so
  // the operator never scrolls past the diff to find the button.
  const executionActions = (
    <div className="validation-actions">
      {status === 'failed' && (
        <button
          className="approve-action"
          type="button"
          onClick={onRetry}
          disabled={retrying}
          data-explain="Start a fresh authenticated GitHub Actions run from the same immutable manifest after an infrastructure or validation failure."
        >
          {retrying ? (
            <CircleDashed className="is-spinning" size={16} />
          ) : (
            <RotateCcw size={16} />
          )}
          {retrying ? 'Retrying repository run' : 'Retry repository run'}
        </button>
      )}
      {status === 'preview_ready' && (
        <button
          className="approve-action"
          type="button"
          onClick={onRelease}
          data-explain="Squash-merge the exact reviewed ProjectFlow pull request. GitHub then deploys the retained commit from main."
        >
          <Rocket size={16} /> Release reviewed mutation
        </button>
      )}
      {(status === 'releasing' ||
        (status !== 'deployment_verifying' && releasing)) && (
        <button className="approve-action" type="button" disabled>
          <CircleDashed className="is-spinning" size={16} /> Merging pull request
        </button>
      )}
      {status === 'deployment_verifying' && releasing && (
        <button className="approve-action" type="button" disabled>
          <CircleDashed className="is-spinning" size={16} /> Verifying production
          deployment
        </button>
      )}
      {status === 'deployment_verifying' && !releasing && (
        <button
          className="approve-action"
          type="button"
          onClick={onRelease}
          data-explain="Recheck the ProjectFlow production metadata. The evidence cycle advances only when the deployed commit and app version match the reviewed merge."
        >
          <ShieldCheck size={16} /> Check production deployment
        </button>
      )}
      {status === 'released' && (
        <div className="release-confirmation">
          <CheckCircle2 size={17} /> Mutation survived selection at{' '}
          <code>{execution.headSha?.slice(0, 12)}</code>
        </div>
      )}
    </div>
  );

  return (
    <section
      className={`${embedded ? 'execution-panel execution-panel-embedded' : 'mt-8 surface-panel execution-panel'}`}
      id={regionId}
      aria-labelledby={headingId}
    >
      <div className="panel-heading execution-heading">
        <div>
          <p className="section-label">
            {archived
              ? 'Archived repository mutation'
              : 'Live repository mutation'}
          </p>
          <div className="heading-with-help">
            <h2 id={headingId} className="mt-2 text-xl font-semibold">
              {archived ? 'Codex execution record' : 'Codex execution'}
            </h2>
            <InfoTip text="A real GitHub Actions run applies the selected manifest to the exact ProjectFlow commit, enforces repository policy, runs validation, opens a pull request, and deploys a review preview. Retained mutations can be rolled back through a separately reviewed inverse pull request." />
          </div>
          <ProvenanceChip provenance={execution.provenance} />
        </div>
        <span className={`artifact-badge execution-status-${status}`}>
          {[
            'prepared',
            'queued',
            'codex_running',
            'validating',
            'releasing',
            'deployment_verifying',
          ].includes(status) && (
            <CircleDashed className="is-spinning" size={14} />
          )}
          {![
            'prepared',
            'queued',
            'codex_running',
            'validating',
            'releasing',
            'deployment_verifying',
          ].includes(status) && <GitBranch size={14} />}
          {executionStatusLabel[status]}
        </span>
      </div>

      <div
        className="execution-steps"
        aria-label="Repository execution progress"
      >
        <ExecutionStep index="01" label="Manifest" state="complete" />
        <ExecutionStep
          index="02"
          label="Codex"
          state={
            codexComplete
              ? 'complete'
              : status === 'failed'
                ? 'pending'
                : 'active'
          }
        />
        <ExecutionStep
          index="03"
          label="Checks"
          state={
            validationComplete
              ? 'complete'
              : status === 'validating'
                ? 'active'
                : 'pending'
          }
        />
        <ExecutionStep
          index="04"
          label="Review"
          state={
            reviewComplete
              ? 'complete'
              : status === 'pull_request_open'
                ? 'active'
                : 'pending'
          }
        />
        <ExecutionStep
          index="05"
          label="Release"
          state={
            status === 'released'
              ? 'complete'
              : status === 'releasing' || status === 'deployment_verifying'
                ? 'active'
                : 'pending'
          }
        />
      </div>

      {executionActions}

      <div className="repository-run-summary">
        <div>
          <span>Repository</span>
          <a href={execution.repository.url} target="_blank" rel="noreferrer">
            {execution.repository.fullName} <ExternalLink size={12} />
          </a>
        </div>
        <div>
          <span>Immutable base</span>
          <code>{execution.baseSha.slice(0, 12)}</code>
        </div>
        <div>
          <span>Candidate commit</span>
          <code>{execution.headSha?.slice(0, 12) ?? 'pending'}</code>
        </div>
        <div>
          <span>Branch</span>
          <code>{execution.branch}</code>
        </div>
        {execution.deploymentVerification && (
          <div>
            <span>Production deployment</span>
            <code>
              {execution.deploymentVerification.status} ·{' '}
              {execution.deploymentVerification.expectedAppVersion}
            </code>
          </div>
        )}
      </div>

      <div className="repository-links" aria-label="Repository artifacts">
        {execution.workflowUrl && (
          <a href={execution.workflowUrl} target="_blank" rel="noreferrer">
            <Activity size={14} /> Workflow run <ExternalLink size={12} />
          </a>
        )}
        {execution.pullRequestUrl && (
          <a href={execution.pullRequestUrl} target="_blank" rel="noreferrer">
            <GitBranch size={14} /> Pull request #{execution.pullRequestNumber}{' '}
            <ExternalLink size={12} />
          </a>
        )}
        {execution.previewUrl && (
          <a href={execution.previewUrl} target="_blank" rel="noreferrer">
            <Rocket size={14} /> Open mutation preview{' '}
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {execution.error && (
        <div className="execution-error" role="alert">
          <AlertTriangle size={17} />
          <div>
            <strong>Repository execution stopped</strong>
            <span>{execution.error}</span>
          </div>
        </div>
      )}

      {execution.deploymentVerification?.lastError && (
        <div className="execution-error" role="status">
          <CircleDashed className="is-spinning" size={17} />
          <div>
            <strong>Production deployment still converging</strong>
            <span>
              {execution.deploymentVerification.lastError} · observed{' '}
              {execution.deploymentVerification.observedAppVersion ??
                'no identity'}
            </span>
          </div>
        </div>
      )}

      <details className="execution-detail" open={!reviewComplete}>
        <summary className="execution-detail-summary">
          Patch, checks &amp; Codex report
        </summary>
        <div className="execution-layout">
        <div className="diff-column">
          <div className="artifact-heading">
            <div>
              <span>Real Git patch</span>
              <strong>
                {execution.baseSha.slice(0, 8)} →{' '}
                {execution.headSha?.slice(0, 8) ?? 'Codex working'}
              </strong>
            </div>
            <span>{lines.length ? `${lines.length} lines` : 'pending'}</span>
          </div>
          {lines.length ? (
            <pre
              className="diff-viewer"
              aria-label="ProjectFlow repository diff"
            >
              <code>
                {lines.map((line, index) => (
                  <span
                    className={
                      line.startsWith('+') && !line.startsWith('+++')
                        ? 'diff-addition'
                        : line.startsWith('-') && !line.startsWith('---')
                          ? 'diff-removal'
                          : line.startsWith('@@')
                            ? 'diff-hunk'
                            : ''
                    }
                    key={`${index}-${line}`}
                  >
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    {line || ' '}
                  </span>
                ))}
              </code>
            </pre>
          ) : (
            <div className="validation-ready repository-waiting">
              <CircleDashed
                className={status === 'failed' ? '' : 'is-spinning'}
                size={22}
              />
              <strong>{executionStatusLabel[status]}</strong>
              <span>
                The diff appears here only after Codex has produced a real
                patch.
              </span>
            </div>
          )}
        </div>

        <div className="validation-column">
          <div className="artifact-heading">
            <div>
              <span>Repository validation</span>
              <strong>{execution.checks.length} live checks</strong>
            </div>
            <span>{execution.changedFiles.length} files</span>
          </div>

          <div className="validation-checks">
            {execution.checks.map((check) => (
              <details key={check.name} open={check.status === 'failed'}>
                <summary>
                  {check.status === 'passed' ? (
                    <CheckCircle2 size={15} />
                  ) : check.status === 'failed' ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <CircleDashed
                      className={
                        check.status === 'running' ? 'is-spinning' : ''
                      }
                      size={15}
                    />
                  )}
                  <span>{check.name}</span>
                  <strong>
                    {check.durationMs === null
                      ? check.status
                      : `${(check.durationMs / 1_000).toFixed(1)}s`}
                  </strong>
                </summary>
                <pre>{check.output}</pre>
              </details>
            ))}
          </div>

          {execution.changedFiles.length > 0 && (
            <div className="changed-file-list">
              <span>Changed within manifest</span>
              {execution.changedFiles.map((file) => (
                <code key={file}>{file}</code>
              ))}
            </div>
          )}

          {execution.codex.finalMessage && (
            <details className="codex-run-message">
              <summary>
                <BrainCircuit size={15} /> Codex implementation report
              </summary>
              <pre>{execution.codex.finalMessage}</pre>
            </details>
          )}

          {manifest && (
            <div className="manifest-execution-brief">
              <span>Approved implementation brief</span>
              <p>{manifest.brief}</p>
              <code>{manifest.evidenceCitations.join(' · ')}</code>
            </div>
          )}

        </div>
      </div>
      </details>

      {status === 'released' && (
        <RollbackWorkspace
          execution={execution}
          rollingBack={rollingBack}
          releasingRollback={releasingRollback}
          onRollback={onRollback}
          onReleaseRollback={onReleaseRollback}
        />
      )}
    </section>
  );
}

function ExecutionStep({
  index,
  label,
  state,
}: {
  index: string;
  label: string;
  state: 'pending' | 'active' | 'complete';
}) {
  return (
    <div className={`execution-step step-${state}`}>
      <span>{state === 'complete' ? <Check size={12} /> : index}</span>
      <strong>{label}</strong>
    </div>
  );
}

function RollbackWorkspace({
  execution,
  rollingBack,
  releasingRollback,
  onRollback,
  onReleaseRollback,
}: {
  execution: RepositoryMutationExecution;
  rollingBack: boolean;
  releasingRollback: boolean;
  onRollback: () => void;
  onReleaseRollback: () => void;
}) {
  const rollback = execution.rollback;
  const status = rollback?.status;
  const rollbackInProgress =
    status && !['failed', 'released', 'preview_ready'].includes(status);
  const regionId = `${executionWorkspaceId(execution.executionId)}-rollback`;
  const headingId = `${regionId}-title`;

  return (
    <section
      className="rollback-workspace"
      id={regionId}
      aria-labelledby={headingId}
    >
      <div className="rollback-heading">
        <div>
          <p className="section-label">Controlled rollback</p>
          <ProvenanceChip provenance={execution.provenance} />
          <h3 id={headingId} className="mt-2 text-lg font-semibold">
            {rollback?.status === 'released'
              ? 'Mutation reverted through review'
              : 'Prepare a reviewable inverse change'}
          </h3>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-mist">
            Rosalind never rewrites the active application directly. A rollback
            generates an exact Git revert of the retained commit, validates it,
            deploys a preview, and requires a separate release decision.
          </p>
        </div>
        {rollback && (
          <span
            className={`artifact-badge execution-status-${rollback.status}`}
          >
            {rollbackInProgress ? (
              <CircleDashed className="is-spinning" size={14} />
            ) : rollback.status === 'failed' ? (
              <AlertTriangle size={14} />
            ) : (
              <GitBranch size={14} />
            )}
            {rollbackStatusLabel[rollback.status]}
          </span>
        )}
      </div>

      {!rollback ? (
        <div className="rollback-empty">
          <span>
            The retained commit <code>{execution.headSha?.slice(0, 12)}</code>{' '}
            is eligible for a controlled rollback.
          </span>
          <button
            className="secondary-action"
            type="button"
            onClick={onRollback}
            disabled={rollingBack}
            data-explain="Create a protected ProjectFlow branch with git revert, run real repository validation, open a rollback pull request, and deploy a separate preview before any rollback can be released."
          >
            {rollingBack ? (
              <CircleDashed className="is-spinning" size={16} />
            ) : (
              <RotateCcw size={16} />
            )}
            {rollingBack ? 'Preparing rollback' : 'Prepare controlled rollback'}
          </button>
        </div>
      ) : (
        <>
          <div className="repository-run-summary rollback-summary">
            <div>
              <span>Reverted commit</span>
              <code>{rollback.revertedSha.slice(0, 12)}</code>
            </div>
            <div>
              <span>Rollback commit</span>
              <code>{rollback.headSha?.slice(0, 12) ?? 'pending'}</code>
            </div>
            <div>
              <span>Branch</span>
              <code>{rollback.branch}</code>
            </div>
            <div>
              <span>Inverse patch</span>
              <code>{rollback.changedFiles.length} changed files</code>
            </div>
          </div>

          <div className="repository-links" aria-label="Rollback artifacts">
            {rollback.workflowUrl && (
              <a href={rollback.workflowUrl} target="_blank" rel="noreferrer">
                <Activity size={14} /> Rollback workflow{' '}
                <ExternalLink size={12} />
              </a>
            )}
            {rollback.pullRequestUrl && (
              <a
                href={rollback.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
              >
                <GitBranch size={14} /> Rollback pull request #
                {rollback.pullRequestNumber} <ExternalLink size={12} />
              </a>
            )}
            {rollback.previewUrl && (
              <a href={rollback.previewUrl} target="_blank" rel="noreferrer">
                <Rocket size={14} /> Open rollback preview{' '}
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {rollback.error && (
            <div className="execution-error" role="alert">
              <AlertTriangle size={17} />
              <div>
                <strong>Repository rollback stopped</strong>
                <span>{rollback.error}</span>
              </div>
            </div>
          )}

          {rollback.patch && (
            <details className="codex-run-message rollback-patch">
              <summary>
                <Code2 size={15} /> Review inverse Git patch
              </summary>
              <pre>{rollback.patch}</pre>
            </details>
          )}

          <div className="validation-checks rollback-checks">
            {rollback.checks.map((check) => (
              <details key={check.name} open={check.status === 'failed'}>
                <summary>
                  {check.status === 'passed' ? (
                    <CheckCircle2 size={15} />
                  ) : check.status === 'failed' ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <CircleDashed
                      className={
                        check.status === 'running' ? 'is-spinning' : ''
                      }
                      size={15}
                    />
                  )}
                  <span>{check.name}</span>
                  <strong>
                    {check.durationMs === null
                      ? check.status
                      : `${(check.durationMs / 1_000).toFixed(1)}s`}
                  </strong>
                </summary>
                <pre>{check.output}</pre>
              </details>
            ))}
          </div>

          <div className="validation-actions">
            {status === 'failed' && (
              <button
                className="secondary-action"
                type="button"
                onClick={onRollback}
                disabled={rollingBack}
              >
                {rollingBack ? (
                  <CircleDashed className="is-spinning" size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
                {rollingBack
                  ? 'Retrying rollback'
                  : 'Retry controlled rollback'}
              </button>
            )}
            {status === 'preview_ready' && (
              <button
                className="secondary-action"
                type="button"
                onClick={onReleaseRollback}
                disabled={releasingRollback}
                data-explain="Squash-merge the exact reviewed rollback pull request. This returns ProjectFlow to the code state before the retained mutation."
              >
                {releasingRollback ? (
                  <CircleDashed className="is-spinning" size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
                {releasingRollback
                  ? 'Merging rollback'
                  : 'Release reviewed rollback'}
              </button>
            )}
            {rollbackInProgress && (
              <button className="secondary-action" type="button" disabled>
                <CircleDashed className="is-spinning" size={16} /> Preparing
                controlled rollback
              </button>
            )}
            {status === 'released' && (
              <div className="release-confirmation rollback-confirmation">
                <CheckCircle2 size={17} /> ProjectFlow returned to{' '}
                <code>{rollback.headSha?.slice(0, 12)}</code>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function OperatorBoundary() {
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>(
    'checking',
  );
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DashboardCapability[]>([]);

  const verify = async (candidate?: string) => {
    if (candidate !== undefined) setOperatorToken(candidate);
    try {
      const response = await apiFetch(`${apiBaseUrl}/api/auth/session`);
      const payload = (await response.json()) as {
        capabilities?: string[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Operator authorization failed.');
      }
      const authorizedCapabilities = (payload.capabilities ?? []).filter(
        (capability): capability is DashboardCapability =>
          operatorCapabilities.includes(capability as DashboardCapability),
      );
      if (!authorizedCapabilities.includes('observe')) {
        throw new Error('The access token has no observation capability.');
      }
      setCapabilities(authorizedCapabilities);
      setError(null);
      setState('unlocked');
    } catch (reason) {
      setOperatorToken(null);
      setCapabilities([]);
      setError(
        reason instanceof Error
          ? reason.message
          : 'Operator authorization failed.',
      );
      setState('locked');
    }
  };

  useEffect(() => {
    void verify(getOperatorToken() ?? undefined);
    const lock = () => {
      setOperatorToken(null);
      setCapabilities([]);
      setState('locked');
      setError('Your operator session is no longer authorized.');
    };
    window.addEventListener('darwin:operator-unauthorized', lock);
    return () =>
      window.removeEventListener('darwin:operator-unauthorized', lock);
  }, []);

  if (state === 'unlocked') {
    return <DarwinDashboard capabilities={capabilities} />;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) {
      setError('Enter the operator access token.');
      return;
    }
    setState('checking');
    void verify(candidate);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-carbon px-5 text-white">
      <section
        className="surface-panel w-full max-w-[480px]"
        aria-live="polite"
      >
        <div className="panel-heading">
          <div className="flex items-center gap-4">
            <DarwinMark />
            <div>
              <p className="section-label">Controlled environment</p>
              <h1 className="mt-2 text-2xl font-semibold">
                Rosalind operator access
              </h1>
            </div>
          </div>
          <LockKeyhole className="text-mist" size={20} />
        </div>
        <form className="space-y-5 p-6" onSubmit={submit}>
          <p className="text-sm leading-6 text-mist">
            Unlock the control plane before viewing behavioral evidence or
            approving repository mutations.
          </p>
          <label className="block text-sm font-medium" htmlFor="operator-token">
            Operator access token
          </label>
          <input
            id="operator-token"
            className="connection-input w-full"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={state === 'checking'}
          />
          {error && <p className="text-sm text-amber">{error}</p>}
          <button
            className="primary-action w-full justify-center"
            type="submit"
            disabled={state === 'checking'}
          >
            {state === 'checking' ? (
              <CircleDashed className="is-spinning" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}
            {state === 'checking' ? 'Verifying access' : 'Unlock Rosalind'}
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  return (
    <ErrorBoundary>
      {import.meta.env.MODE === 'test' ? (
        <DarwinDashboard capabilities={operatorCapabilities} />
      ) : (
        <OperatorBoundary />
      )}
    </ErrorBoundary>
  );
}

export default App;
