import {
  StudyTelemetryEventSchema,
  TelemetryBatchSchema,
  TelemetryReceiptSchema,
  type DarwinProvenance,
  type StudyTelemetryEvent,
  type TelemetryReceipt,
  type ViewportClass,
} from '@darwin/shared';

type ClientSource = 'real_user' | 'automated' | 'synthetic';
type TerminalOutcome = 'success' | 'failed' | 'abandoned';

export interface TelemetryClientConfig {
  appVersion: string;
  studyId: string;
  participantId: string;
  endpoint?: string;
  source?: ClientSource;
  provenance?: DarwinProvenance;
  studySessionToken?: string;
  sessionId?: string;
  initialRoute?: string;
  flushIntervalMs?: number;
  batchSize?: number;
  maxOutboxSize?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  requestTimeoutMs?: number;
  random?: () => number;
  onEvent?: (event: StudyTelemetryEvent) => void;
  onHealth?: (health: TelemetryClientHealth) => void;
  fetcher?: typeof fetch;
}

export interface TelemetryClientHealth {
  outboxSize: number;
  droppedEvents: number;
  storageFailures: number;
  deliveryFailures: number;
  consecutiveDeliveryFailures: number;
  nextRetryAt: string | null;
  lastDeliveryError: string | null;
}

export type TelemetryFlushResult =
  | ({ status: 'delivered' } & TelemetryReceipt)
  | { status: 'empty'; accepted: 0; rejected: 0 }
  | { status: 'offline'; accepted: 0; rejected: 0 }
  | {
      status: 'retrying';
      accepted: 0;
      rejected: 0;
      attempt: number;
      retryAt: string;
    };

interface ActiveAttempt {
  id: string;
  taskId: string;
  startedAt: number;
}

type PointerKind = 'mouse' | 'touch' | 'pen' | 'unknown';

interface HoverState {
  startedAt: number;
  pointerType: PointerKind;
  clickedAt: number | null;
}

interface DragState {
  startedAt: number;
  x: number;
  y: number;
  targetId?: string;
  pointerType: PointerKind;
  draggable: boolean;
  emitted: boolean;
}

interface CursorState {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
}

const storagePrefix = 'darwin:telemetry-outbox';
const sequenceStoragePrefix = 'darwin:telemetry-sequence';
let fallbackIdCounter = 0;

const fallbackUuid = () => {
  const bytes = new Uint8Array(16);
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.getRandomValues === 'function') {
    browserCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    const view = new DataView(bytes.buffer);
    const timestamp = Date.now();
    view.setUint32(0, Math.floor(timestamp / 0x1_0000_0000));
    view.setUint32(4, timestamp >>> 0);
    view.setUint32(12, fallbackIdCounter++ >>> 0);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const createId = (prefix?: string) => {
  const value =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackUuid();
  return prefix ? `${prefix}-${value}` : value;
};

const getViewportClass = (): ViewportClass => {
  if (window.innerWidth < 640) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
};

const normalizeRoute = (route: string) => {
  const path = route.trim();
  return path.startsWith('/') ? path : `/${path}`;
};

const semanticTargetOf = (origin: EventTarget | null) =>
  origin instanceof Element
    ? origin.closest<HTMLElement>('[data-darwin-id]')
    : null;

const pointerTypeOf = (event: MouseEvent | PointerEvent): PointerKind => {
  const value = 'pointerType' in event ? event.pointerType : '';
  return value === 'mouse' || value === 'touch' || value === 'pen'
    ? value
    : event instanceof MouseEvent
      ? 'mouse'
      : 'unknown';
};

const isInteractive = (target: HTMLElement) =>
  target.dataset.darwinInteractive === 'true' ||
  target.matches(
    'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
  );

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const roundRatio = (value: number) => Math.round(value * 1000) / 1000;

export class DarwinTelemetryClient {
  private readonly config: TelemetryClientConfig & {
    source: ClientSource;
    sessionId: string;
    flushIntervalMs: number;
    batchSize: number;
    maxOutboxSize: number;
    retryBaseMs: number;
    retryMaxMs: number;
    requestTimeoutMs: number;
    random: () => number;
  };
  private readonly outboxKey: string;
  private readonly sequenceKey: string;
  private readonly fetcher: typeof fetch;
  private outbox: StudyTelemetryEvent[];
  private currentRoute: string;
  private sequence = 0;
  private activeAttempt: ActiveAttempt | null = null;
  private flushTimer: number | null = null;
  private retryTimer: number | null = null;
  private flushPromise: Promise<TelemetryFlushResult> | null = null;
  private flushRequested = false;
  private retryAttempt = 0;
  private nextRetryAt = 0;
  private droppedEvents = 0;
  private storageFailures = 0;
  private deliveryFailures = 0;
  private lastDeliveryError: string | null = null;
  private startedAt = Date.now();
  private initialized = false;
  private sessionEnded = false;
  private readonly beaconedEventIds = new Set<string>();
  private readonly hovers = new Map<string, HoverState>();
  private readonly clickHistory = new Map<string, number[]>();
  private readonly rageSignalAt = new Map<string, number>();
  private readonly transitions: Array<{ targetId: string; at: number }> = [];
  private lastTransition: { targetId: string; at: number } | null = null;
  private lastIndecisionAt = 0;
  private dragState: DragState | null = null;
  private cursorState: CursorState | null = null;
  private directionChanges: number[] = [];
  private lastThrashAt = 0;
  private basePixelRatio = 1;
  private baseViewportScale = 1;
  private lastZoomScale = 1;

  constructor(config: TelemetryClientConfig) {
    const sessionId = config.sessionId ?? createId('session');
    this.config = {
      ...config,
      source: config.source ?? 'real_user',
      sessionId,
      flushIntervalMs: config.flushIntervalMs ?? 5_000,
      batchSize: Math.min(50, Math.max(1, config.batchSize ?? 20)),
      maxOutboxSize: Math.min(5_000, Math.max(2, config.maxOutboxSize ?? 500)),
      retryBaseMs: Math.min(60_000, Math.max(100, config.retryBaseMs ?? 1_000)),
      retryMaxMs: Math.min(
        60 * 60 * 1_000,
        Math.max(1_000, config.retryMaxMs ?? 60_000),
      ),
      requestTimeoutMs: clamp(config.requestTimeoutMs ?? 10_000, 1_000, 60_000),
      random: config.random ?? Math.random,
    };
    this.fetcher = config.fetcher ?? fetch.bind(globalThis);
    this.currentRoute = normalizeRoute(
      config.initialRoute ?? window.location.pathname,
    );
    this.outboxKey = `${storagePrefix}:${config.studyId}:${config.participantId}`;
    this.sequenceKey = `${sequenceStoragePrefix}:${config.studyId}:${config.participantId}:${sessionId}`;
    this.outbox = this.readOutbox();
    this.sequence = Math.max(
      this.readSequence(),
      ...this.outbox
        .filter((event) => event.sessionId === sessionId)
        .map((event) => event.sequence + 1),
    );
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.sessionEnded = false;
    this.startedAt = Date.now();
    this.basePixelRatio = window.devicePixelRatio || 1;
    this.baseViewportScale = window.visualViewport?.scale || 1;
    this.lastZoomScale = 1;
    document.addEventListener('click', this.captureClick);
    document.addEventListener('pointerover', this.capturePointerOver);
    document.addEventListener('pointerout', this.capturePointerOut);
    document.addEventListener('pointerdown', this.capturePointerDown);
    document.addEventListener('pointermove', this.capturePointerMove);
    document.addEventListener('pointerup', this.capturePointerUp);
    document.addEventListener('pointercancel', this.capturePointerCancel);
    document.addEventListener('touchcancel', this.captureTouchCancel);
    document.addEventListener('visibilitychange', this.captureVisibility);
    window.addEventListener('pagehide', this.capturePageHide);
    window.addEventListener('resize', this.captureViewportZoom);
    window.visualViewport?.addEventListener('resize', this.captureViewportZoom);

    this.enqueue({ eventType: 'session_started' });
    this.enqueue({ eventType: 'page_view' });

    if (this.config.endpoint) {
      this.flushTimer = window.setInterval(() => {
        void this.flush().catch(() => undefined);
      }, this.config.flushIntervalMs);
    }
  }

  destroy() {
    if (!this.initialized) return;
    this.endSession();
    document.removeEventListener('click', this.captureClick);
    document.removeEventListener('pointerover', this.capturePointerOver);
    document.removeEventListener('pointerout', this.capturePointerOut);
    document.removeEventListener('pointerdown', this.capturePointerDown);
    document.removeEventListener('pointermove', this.capturePointerMove);
    document.removeEventListener('pointerup', this.capturePointerUp);
    document.removeEventListener('pointercancel', this.capturePointerCancel);
    document.removeEventListener('touchcancel', this.captureTouchCancel);
    document.removeEventListener('visibilitychange', this.captureVisibility);
    window.removeEventListener('pagehide', this.capturePageHide);
    window.removeEventListener('resize', this.captureViewportZoom);
    window.visualViewport?.removeEventListener(
      'resize',
      this.captureViewportZoom,
    );
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.flushTimer = null;
    this.retryTimer = null;
    this.initialized = false;
  }

  trackPageView(route = this.currentRoute) {
    this.currentRoute = normalizeRoute(route);
    this.enqueue({ eventType: 'page_view' });
  }

  trackRouteChanged(route: string) {
    const nextRoute = normalizeRoute(route);
    const fromRoute = this.currentRoute;
    if (nextRoute === fromRoute) return;
    this.currentRoute = nextRoute;
    this.enqueue({
      eventType: 'route_changed',
      properties: { fromRoute },
    });
    this.enqueue({ eventType: 'page_view' });
  }

  trackBrowserNavigation(
    direction: 'back' | 'forward',
    fromRoute: string,
    toRoute: string,
  ) {
    this.enqueue({
      eventType: 'browser_navigation',
      ...this.attemptFields(),
      properties: {
        direction,
        fromRoute: normalizeRoute(fromRoute),
        toRoute: normalizeRoute(toRoute),
      },
    });
  }

  trackValidationError(targetId: string, fieldId: string, errorCode: string) {
    this.enqueue({
      eventType: 'validation_error',
      targetId,
      ...this.attemptFields(),
      properties: { fieldId, errorCode },
    });
  }

  trackSearch(targetId: string, queryLength: number, resultCount: number) {
    this.enqueue({
      eventType: 'search_performed',
      targetId,
      ...this.attemptFields(),
      properties: { queryLength, resultCount },
    });
  }

  taskStarted(taskId: string) {
    if (this.activeAttempt) this.taskCompleted('abandoned');
    const attempt: ActiveAttempt = {
      id: createId('attempt'),
      taskId,
      startedAt: Date.now(),
    };
    this.activeAttempt = attempt;
    this.enqueue({
      eventType: 'task_started',
      taskAttemptId: attempt.id,
      taskId,
    });
    return attempt.id;
  }

  taskCompleted(outcome: TerminalOutcome, flush = true) {
    if (!this.activeAttempt) return null;
    const attempt = this.activeAttempt;
    const durationMs = Math.max(0, Date.now() - attempt.startedAt);
    this.activeAttempt = null;

    if (outcome === 'success') {
      this.enqueue({
        eventType: 'task_completed',
        taskAttemptId: attempt.id,
        taskId: attempt.taskId,
        durationMs,
        outcome,
      });
    } else {
      this.enqueue({
        eventType: 'task_failed',
        taskAttemptId: attempt.id,
        taskId: attempt.taskId,
        durationMs,
        outcome,
      });
    }

    if (flush && this.config.endpoint) {
      void this.flush().catch(() => undefined);
    }

    return attempt.id;
  }

  feedbackSubmitted(feedbackLength: number) {
    this.enqueue({
      eventType: 'feedback_submitted',
      ...this.attemptFields(),
      properties: { length: Math.min(500, Math.max(0, feedbackLength)) },
    });
  }

  snapshot() {
    return [...this.outbox];
  }

  health(): TelemetryClientHealth {
    return {
      outboxSize: this.outbox.length,
      droppedEvents: this.droppedEvents,
      storageFailures: this.storageFailures,
      deliveryFailures: this.deliveryFailures,
      consecutiveDeliveryFailures: this.retryAttempt,
      nextRetryAt: this.nextRetryAt
        ? new Date(this.nextRetryAt).toISOString()
        : null,
      lastDeliveryError: this.lastDeliveryError,
    };
  }

  async flush(): Promise<TelemetryFlushResult> {
    if (this.flushPromise) {
      this.flushRequested = true;
      return this.flushPromise;
    }
    const operation = this.deliverNextBatch();
    this.flushPromise = operation;
    try {
      return await operation;
    } finally {
      this.flushPromise = null;
      const requested = this.flushRequested;
      this.flushRequested = false;
      if (
        this.config.endpoint &&
        this.outbox.length > 0 &&
        Date.now() >= this.nextRetryAt &&
        (requested || this.outbox.length >= this.config.batchSize)
      ) {
        window.setTimeout(() => void this.flush().catch(() => undefined), 0);
      }
    }
  }

  private async deliverNextBatch(): Promise<TelemetryFlushResult> {
    if (this.outbox.length === 0) {
      return { status: 'empty', accepted: 0, rejected: 0 };
    }
    if (!this.config.endpoint) {
      return { status: 'offline', accepted: 0, rejected: 0 };
    }
    if (Date.now() < this.nextRetryAt) return this.retryingResult();

    const events = this.outbox.slice(0, this.config.batchSize);
    const batch = TelemetryBatchSchema.parse({ events });
    // Bound every delivery attempt: an unresponsive endpoint must not hang
    // the outbox forever. A timeout falls into the same retry/back-off path
    // as any other delivery failure below.
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(
      () => timeoutController.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      const response = await this.fetcher(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.studySessionToken
            ? { 'X-Darwin-Study-Session': this.config.studySessionToken }
            : {}),
        },
        body: JSON.stringify(batch),
        keepalive: true,
        signal: timeoutController.signal,
      });
      if (!response.ok) {
        return this.scheduleRetry(
          `Telemetry delivery failed: ${response.status}`,
          response.headers.get('Retry-After'),
        );
      }

      const receipt = TelemetryReceiptSchema.parse(await response.json());
      if (
        receipt.accepted +
          receipt.rejected +
          receipt.duplicates +
          receipt.sequenceConflicts !==
        events.length
      ) {
        return this.scheduleRetry(
          'Telemetry receipt did not account for the complete batch.',
        );
      }
      this.removeFromOutbox(events);
      this.clearRetryState();
      this.persistOutbox();
      this.notifyHealth();
      return { status: 'delivered', ...receipt };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return this.scheduleRetry(
        timedOut
          ? `Telemetry delivery timed out after ${this.config.requestTimeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : 'Telemetry delivery failed.',
      );
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private retryingResult(): TelemetryFlushResult {
    return {
      status: 'retrying',
      accepted: 0,
      rejected: 0,
      attempt: this.retryAttempt,
      retryAt: new Date(this.nextRetryAt).toISOString(),
    };
  }

  private scheduleRetry(
    message: string,
    retryAfterHeader?: string | null,
  ): TelemetryFlushResult {
    this.deliveryFailures += 1;
    this.retryAttempt += 1;
    this.lastDeliveryError = message;
    const exponentialDelay = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * 2 ** Math.min(20, this.retryAttempt - 1),
    );
    const jitterMultiplier = 0.75 + clamp(this.config.random(), 0, 1) * 0.5;
    const jitteredDelay = Math.round(exponentialDelay * jitterMultiplier);
    const retryAfterMs = this.parseRetryAfter(retryAfterHeader);
    const delayMs = Math.min(
      60 * 60 * 1_000,
      Math.max(jitteredDelay, retryAfterMs ?? 0),
    );
    this.nextRetryAt = Date.now() + delayMs;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.flush().catch(() => undefined);
    }, delayMs);
    this.notifyHealth();
    return this.retryingResult();
  }

  private parseRetryAfter(value?: string | null) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1_000);
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }

  private clearRetryState() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.nextRetryAt = 0;
    this.lastDeliveryError = null;
  }

  private readonly captureClick = (event: MouseEvent) => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const target = origin.closest<HTMLElement>('[data-darwin-id]');
    const targetId = target?.dataset.darwinId;
    if (!targetId) return;

    const now = Date.now();
    const pointerType = pointerTypeOf(event);
    const hover = this.hovers.get(targetId);
    if (hover) hover.clickedAt = now;
    const rect = target.getBoundingClientRect();
    const xRatio = rect.width
      ? clamp((event.clientX - rect.left) / rect.width, 0, 1)
      : 0.5;
    const yRatio = rect.height
      ? clamp((event.clientY - rect.top) / rect.height, 0, 1)
      : 0.5;
    const interactive = isInteractive(target);
    const clickCount = Math.min(3, Math.max(1, event.detail || 1));

    this.enqueue({
      eventType: 'element_clicked',
      targetId,
      ...this.attemptFields(),
      properties: {
        pointerType,
        interactive,
        clickCount,
        xRatio: roundRatio(xRatio),
        yRatio: roundRatio(yRatio),
        hoverToClickMs: hover ? Math.max(0, now - hover.startedAt) : null,
      },
    });

    if (!interactive) {
      this.emitSignal('false_affordance', pointerType, targetId, 1, 0);
    }
    if (clickCount >= 2) {
      this.emitSignal(
        'unexpected_double_click',
        pointerType,
        targetId,
        clickCount,
        0,
      );
    }

    const recentClicks = [
      ...(this.clickHistory.get(targetId) ?? []),
      now,
    ].filter((timestamp) => now - timestamp <= 1_000);
    this.clickHistory.set(targetId, recentClicks);
    if (
      recentClicks.length >= 3 &&
      now - (this.rageSignalAt.get(targetId) ?? 0) > 1_000
    ) {
      this.rageSignalAt.set(targetId, now);
      this.emitSignal(
        'rage_click',
        pointerType,
        targetId,
        recentClicks.length,
        now - recentClicks[0]!,
      );
    }
  };

  private readonly capturePointerOver = (event: PointerEvent) => {
    const target = semanticTargetOf(event.target);
    const targetId = target?.dataset.darwinId;
    const pointerType = pointerTypeOf(event);
    if (!targetId || pointerType === 'touch') return;
    if (
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    ) {
      return;
    }

    const now = Date.now();
    this.hovers.set(targetId, { startedAt: now, pointerType, clickedAt: null });
    this.enqueue({
      eventType: 'hover_started',
      targetId,
      ...this.attemptFields(),
      properties: { pointerType },
    });

    if (this.lastTransition?.targetId !== targetId) {
      this.enqueue({
        eventType: 'pointer_transition',
        targetId,
        ...this.attemptFields(),
        properties: {
          pointerType,
          ...(this.lastTransition
            ? { fromTargetId: this.lastTransition.targetId }
            : {}),
          elapsedMs: this.lastTransition
            ? Math.min(600_000, Math.max(0, now - this.lastTransition.at))
            : 0,
        },
      });
      this.recordTransition(targetId, pointerType, now);
    }
  };

  private readonly capturePointerOut = (event: PointerEvent) => {
    const target = semanticTargetOf(event.target);
    const targetId = target?.dataset.darwinId;
    if (!targetId) return;
    if (
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    ) {
      return;
    }
    const hover = this.hovers.get(targetId);
    if (!hover) return;
    this.hovers.delete(targetId);
    const durationMs = Math.min(
      600_000,
      Math.max(0, Date.now() - hover.startedAt),
    );
    this.enqueue({
      eventType: 'hover_ended',
      targetId,
      ...this.attemptFields(),
      properties: {
        pointerType: hover.pointerType,
        durationMs,
        clicked: hover.clickedAt !== null,
        immediateExit: durationMs < 120 && hover.clickedAt === null,
        hoverToClickMs:
          hover.clickedAt === null
            ? null
            : Math.max(0, hover.clickedAt - hover.startedAt),
      },
    });
  };

  private readonly capturePointerDown = (event: PointerEvent) => {
    const target = semanticTargetOf(event.target);
    this.dragState = {
      startedAt: Date.now(),
      x: event.clientX,
      y: event.clientY,
      ...(target?.dataset.darwinId
        ? { targetId: target.dataset.darwinId }
        : {}),
      pointerType: pointerTypeOf(event),
      draggable:
        target?.draggable === true ||
        target?.dataset.darwinDraggable === 'true',
      emitted: false,
    };
  };

  private readonly capturePointerMove = (event: PointerEvent) => {
    this.detectDragIntent(event);
    this.detectCursorThrashing(event);
  };

  private readonly capturePointerUp = () => {
    this.dragState = null;
  };

  private readonly capturePointerCancel = (event: PointerEvent) => {
    if (pointerTypeOf(event) === 'touch') this.emitTouchCancelled(event.target);
    this.dragState = null;
  };

  private readonly captureTouchCancel = (event: TouchEvent) => {
    this.emitTouchCancelled(event.target);
    this.dragState = null;
  };

  private emitTouchCancelled(origin: EventTarget | null) {
    const targetId = semanticTargetOf(origin)?.dataset.darwinId;
    const durationMs = this.dragState
      ? Math.min(600_000, Math.max(0, Date.now() - this.dragState.startedAt))
      : 0;
    this.enqueue({
      eventType: 'touch_cancelled',
      ...(targetId ? { targetId } : {}),
      ...this.attemptFields(),
      properties: { pointerType: 'touch', durationMs },
    });
  }

  private detectDragIntent(event: PointerEvent) {
    const drag = this.dragState;
    if (!drag || drag.emitted) return;
    const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (distance < 12) return;
    drag.emitted = true;
    this.enqueue({
      eventType: 'drag_attempted',
      ...(drag.targetId ? { targetId: drag.targetId } : {}),
      ...this.attemptFields(),
      properties: {
        pointerType: drag.pointerType,
        draggable: drag.draggable,
        distancePx: Math.min(10_000, Math.round(distance)),
      },
    });
  }

  private detectCursorThrashing(event: PointerEvent) {
    const pointerType = pointerTypeOf(event);
    if (pointerType === 'touch') return;
    const now = Date.now();
    const previous = this.cursorState;
    if (!previous) {
      this.cursorState = {
        x: event.clientX,
        y: event.clientY,
        directionX: 0,
        directionY: 0,
      };
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 3) return;
    const directionX = dx / distance;
    const directionY = dy / distance;
    const dot =
      directionX * previous.directionX + directionY * previous.directionY;
    if (previous.directionX !== 0 && dot < -0.35) {
      this.directionChanges.push(now);
    }
    this.directionChanges = this.directionChanges.filter(
      (timestamp) => now - timestamp <= 1_000,
    );
    this.cursorState = {
      x: event.clientX,
      y: event.clientY,
      directionX,
      directionY,
    };
    if (this.directionChanges.length >= 6 && now - this.lastThrashAt > 2_000) {
      this.lastThrashAt = now;
      const targetId = semanticTargetOf(event.target)?.dataset.darwinId;
      this.emitSignal(
        'cursor_thrashing',
        pointerType,
        targetId,
        this.directionChanges.length,
        now - this.directionChanges[0]!,
      );
      this.directionChanges = [];
    }
  }

  private recordTransition(
    targetId: string,
    pointerType: PointerKind,
    now: number,
  ) {
    this.lastTransition = { targetId, at: now };
    this.transitions.push({ targetId, at: now });
    while (this.transitions.length > 6) this.transitions.shift();
    const recent = this.transitions.filter((item) => now - item.at <= 2_000);
    const lastFour = recent.slice(-4);
    const alternates =
      lastFour.length === 4 &&
      lastFour[0]!.targetId === lastFour[2]!.targetId &&
      lastFour[1]!.targetId === lastFour[3]!.targetId &&
      lastFour[0]!.targetId !== lastFour[1]!.targetId;
    if (alternates && now - this.lastIndecisionAt > 2_000) {
      this.lastIndecisionAt = now;
      this.emitSignal(
        'element_indecision',
        pointerType,
        targetId,
        4,
        now - lastFour[0]!.at,
        [...new Set(lastFour.map((item) => item.targetId))],
      );
    }
  }

  private emitSignal(
    signal:
      | 'rage_click'
      | 'false_affordance'
      | 'unexpected_double_click'
      | 'element_indecision'
      | 'cursor_thrashing',
    pointerType: PointerKind,
    targetId: string | undefined,
    count: number,
    windowMs: number,
    relatedTargetIds?: string[],
  ) {
    this.enqueue({
      eventType: 'interaction_signal',
      ...(targetId ? { targetId } : {}),
      ...this.attemptFields(),
      properties: {
        signal,
        pointerType,
        count: Math.min(100, Math.max(1, count)),
        windowMs: Math.min(600_000, Math.max(0, Math.round(windowMs))),
        ...(relatedTargetIds ? { relatedTargetIds } : {}),
      },
    });
  }

  private readonly captureVisibility = () => {
    if (document.visibilityState === 'hidden') this.flushWithBeacon();
  };

  private readonly capturePageHide = () => {
    this.endSession(false);
    this.flushWithBeacon();
  };

  private readonly captureViewportZoom = () => {
    const pixelRatio = (window.devicePixelRatio || 1) / this.basePixelRatio;
    const viewportScale =
      (window.visualViewport?.scale || 1) / this.baseViewportScale;
    const nextScale = Math.round(pixelRatio * viewportScale * 100) / 100;
    if (Math.abs(nextScale - this.lastZoomScale) < 0.05) return;
    const fromScale = this.lastZoomScale;
    this.lastZoomScale = nextScale;
    this.enqueue({
      eventType: 'viewport_zoom_changed',
      ...this.attemptFields(),
      properties: {
        fromScale: clamp(fromScale, 0.25, 5),
        toScale: clamp(nextScale, 0.25, 5),
      },
    });
  };

  private endSession(flushActiveAttempt = true) {
    if (this.sessionEnded) return;
    this.sessionEnded = true;
    if (this.activeAttempt) {
      this.taskCompleted('abandoned', flushActiveAttempt);
    }
    this.enqueue({
      eventType: 'session_ended',
      durationMs: Math.max(0, Date.now() - this.startedAt),
    });
  }

  private flushWithBeacon() {
    if (!this.config.endpoint || !navigator.sendBeacon || !this.outbox.length) {
      return;
    }
    for (
      let offset = 0;
      offset < this.outbox.length;
      offset += this.config.batchSize
    ) {
      const events = this.outbox
        .slice(offset, offset + this.config.batchSize)
        .filter((event) => !this.beaconedEventIds.has(event.eventId));
      if (!events.length) continue;
      const batch = TelemetryBatchSchema.safeParse({ events });
      if (!batch.success) continue;
      const body = JSON.stringify(batch.data);
      if (!navigator.sendBeacon(this.config.endpoint, body)) break;
      events.forEach((event) => this.beaconedEventIds.add(event.eventId));
    }
  }

  private removeFromOutbox(events: StudyTelemetryEvent[]) {
    const deliveredIds = new Set(events.map((event) => event.eventId));
    this.outbox = this.outbox.filter(
      (event) => !deliveredIds.has(event.eventId),
    );
    deliveredIds.forEach((eventId) => this.beaconedEventIds.delete(eventId));
  }

  private attemptFields() {
    return this.activeAttempt
      ? {
          taskAttemptId: this.activeAttempt.id,
          taskId: this.activeAttempt.taskId,
        }
      : {};
  }

  private enqueue(
    event:
      | { eventType: 'session_started' | 'page_view' }
      | { eventType: 'session_ended'; durationMs: number }
      | {
          eventType: 'element_clicked';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            pointerType: PointerKind;
            interactive: boolean;
            clickCount: number;
            xRatio: number;
            yRatio: number;
            hoverToClickMs: number | null;
          };
        }
      | {
          eventType: 'hover_started';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: { pointerType: PointerKind };
        }
      | {
          eventType: 'hover_ended';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            pointerType: PointerKind;
            durationMs: number;
            clicked: boolean;
            immediateExit: boolean;
            hoverToClickMs: number | null;
          };
        }
      | {
          eventType: 'pointer_transition';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            pointerType: PointerKind;
            fromTargetId?: string;
            elapsedMs: number;
          };
        }
      | {
          eventType: 'interaction_signal';
          targetId?: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            signal:
              | 'rage_click'
              | 'false_affordance'
              | 'unexpected_double_click'
              | 'element_indecision'
              | 'cursor_thrashing';
            pointerType: PointerKind;
            count: number;
            windowMs: number;
            relatedTargetIds?: string[];
          };
        }
      | {
          eventType: 'drag_attempted';
          targetId?: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            pointerType: PointerKind;
            draggable: boolean;
            distancePx: number;
          };
        }
      | {
          eventType: 'touch_cancelled';
          targetId?: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            pointerType: 'touch';
            durationMs: number;
          };
        }
      | { eventType: 'route_changed'; properties: { fromRoute: string } }
      | {
          eventType: 'browser_navigation';
          taskAttemptId?: string;
          taskId?: string;
          properties: {
            direction: 'back' | 'forward';
            fromRoute: string;
            toRoute: string;
          };
        }
      | {
          eventType: 'viewport_zoom_changed';
          taskAttemptId?: string;
          taskId?: string;
          properties: { fromScale: number; toScale: number };
        }
      | {
          eventType: 'validation_error';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: { fieldId: string; errorCode: string };
        }
      | {
          eventType: 'search_performed';
          targetId: string;
          taskAttemptId?: string;
          taskId?: string;
          properties: { queryLength: number; resultCount: number };
        }
      | {
          eventType: 'task_started';
          taskAttemptId: string;
          taskId: string;
        }
      | {
          eventType: 'task_completed';
          taskAttemptId: string;
          taskId: string;
          durationMs: number;
          outcome: 'success';
        }
      | {
          eventType: 'task_failed';
          taskAttemptId: string;
          taskId: string;
          durationMs: number;
          outcome: 'failed' | 'abandoned';
        }
      | {
          eventType: 'feedback_submitted';
          taskAttemptId?: string;
          taskId?: string;
          properties: { length: number };
        },
  ) {
    const candidate = {
      schemaVersion: 1,
      eventId: createId(),
      sessionId: this.config.sessionId,
      participantId: this.config.participantId,
      studyId: this.config.studyId,
      appVersion: this.config.appVersion,
      source: this.config.source,
      occurredAt: new Date().toISOString(),
      sequence: this.sequence,
      route: this.currentRoute,
      viewport: getViewportClass(),
      ...(this.config.provenance ? { provenance: this.config.provenance } : {}),
      ...event,
    };
    const parsed = StudyTelemetryEventSchema.parse(candidate);
    this.sequence += 1;
    this.persistSequence();
    this.outbox.push(parsed);
    if (this.outbox.length > this.config.maxOutboxSize) {
      const overflow = this.outbox.length - this.config.maxOutboxSize;
      this.outbox.splice(0, overflow);
      this.droppedEvents += overflow;
    }
    this.persistOutbox();
    try {
      this.config.onEvent?.(parsed);
    } catch {
      // Telemetry callbacks must never interrupt the instrumented application.
    }
    this.notifyHealth();
    if (this.config.endpoint && this.outbox.length >= this.config.batchSize) {
      void this.flush().catch(() => undefined);
    }
  }

  private readOutbox() {
    try {
      const stored = localStorage.getItem(this.outboxKey);
      if (!stored) return [];
      const value: unknown = JSON.parse(stored);
      if (!Array.isArray(value)) return [];
      return value.flatMap((item) => {
        const parsed = StudyTelemetryEventSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    } catch {
      this.storageFailures += 1;
      return [];
    }
  }

  private persistOutbox() {
    try {
      localStorage.setItem(this.outboxKey, JSON.stringify(this.outbox));
    } catch {
      this.storageFailures += 1;
      this.notifyHealth();
    }
  }

  private readSequence() {
    try {
      const stored = localStorage.getItem(this.sequenceKey);
      if (stored === null) return 0;
      const value = Number(stored);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      this.storageFailures += 1;
      return 0;
    }
  }

  private persistSequence() {
    try {
      localStorage.setItem(this.sequenceKey, String(this.sequence));
    } catch {
      this.storageFailures += 1;
      this.notifyHealth();
    }
  }

  private notifyHealth() {
    try {
      this.config.onHealth?.(this.health());
    } catch {
      // Health observers are isolated from product behavior.
    }
  }
}

export const createTelemetryClient = (config: TelemetryClientConfig) =>
  new DarwinTelemetryClient(config);
