// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StudyTelemetryEventSchema,
  type StudyTelemetryEvent,
} from '@darwin/shared';

import { createTelemetryClient } from './telemetry-client';

describe('DarwinTelemetryClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('derives rich pointer evidence without capturing visible content', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    const captured: StudyTelemetryEvent[] = [];
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-rich',
      initialRoute: '/study',
      onEvent: (event) => captured.push(event),
    });
    client.init();

    const surface = document.createElement('section');
    surface.dataset.darwinId = 'metric-open-tasks';
    surface.textContent = 'Confidential open task count';
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 300,
      bottom: 300,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    document.body.append(surface);

    surface.dispatchEvent(
      pointerEvent('pointerover', { clientX: 120, clientY: 220 }),
    );
    vi.advanceTimersByTime(850);
    surface.dispatchEvent(
      pointerEvent('click', { clientX: 250, clientY: 250, detail: 1 }),
    );
    surface.dispatchEvent(
      pointerEvent('pointerout', {
        clientX: 250,
        clientY: 250,
        relatedTarget: document.body,
      }),
    );
    surface.dispatchEvent(pointerEvent('click', { detail: 1 }));
    surface.dispatchEvent(pointerEvent('click', { detail: 1 }));
    surface.dispatchEvent(pointerEvent('click', { detail: 2 }));
    surface.dispatchEvent(
      pointerEvent('pointerdown', { clientX: 10, clientY: 10 }),
    );
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 35, clientY: 10 }),
    );

    expect(captured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'hover_started' }),
        expect.objectContaining({
          eventType: 'hover_ended',
          properties: expect.objectContaining({
            durationMs: 850,
            clicked: true,
            hoverToClickMs: 850,
          }),
        }),
        expect.objectContaining({
          eventType: 'element_clicked',
          properties: expect.objectContaining({
            interactive: false,
            xRatio: 0.75,
            yRatio: 0.5,
          }),
        }),
        expect.objectContaining({
          eventType: 'interaction_signal',
          properties: expect.objectContaining({ signal: 'false_affordance' }),
        }),
        expect.objectContaining({
          eventType: 'interaction_signal',
          properties: expect.objectContaining({ signal: 'rage_click' }),
        }),
        expect.objectContaining({
          eventType: 'interaction_signal',
          properties: expect.objectContaining({
            signal: 'unexpected_double_click',
          }),
        }),
        expect.objectContaining({
          eventType: 'drag_attempted',
          properties: expect.objectContaining({
            draggable: false,
            distancePx: 25,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(captured)).not.toContain('Confidential');

    client.destroy();
  });

  it('captures semantic controls and unambiguous task attempts', () => {
    const captured: unknown[] = [];
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-test',
      initialRoute: '/study',
      onEvent: (event) => captured.push(event),
    });
    client.init();

    const button = document.createElement('button');
    button.dataset.darwinId = 'project-open';
    button.textContent = 'Private project title';
    document.body.append(button);

    const attemptId = client.taskStarted('find-assigned-task');
    button.click();
    client.trackRouteChanged('/projects/apollo/tasks');
    client.trackBrowserNavigation(
      'back',
      '/projects/apollo/tasks',
      '/projects/apollo',
    );
    client.trackSearch('task-search', 14, 1);
    client.taskCompleted('success');

    const parsed = captured.map((event) =>
      StudyTelemetryEventSchema.parse(event),
    );
    const click = parsed.find((event) => event.eventType === 'element_clicked');
    const completion = parsed.find(
      (event) => event.eventType === 'task_completed',
    );
    const browserBack = parsed.find(
      (event) => event.eventType === 'browser_navigation',
    );

    expect(click).toMatchObject({
      targetId: 'project-open',
      taskAttemptId: attemptId,
      taskId: 'find-assigned-task',
    });
    expect(completion).toMatchObject({
      taskAttemptId: attemptId,
      outcome: 'success',
    });
    expect(browserBack).toMatchObject({
      taskAttemptId: attemptId,
      properties: {
        direction: 'back',
        toRoute: '/projects/apollo',
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('Private project title');

    client.destroy();
  });

  it('captures relative browser zoom increases', () => {
    const originalPixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1,
    });
    const captured: StudyTelemetryEvent[] = [];
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-zoom',
      initialRoute: '/study/dashboard',
      onEvent: (event) => captured.push(event),
    });
    client.init();

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.25,
    });
    window.dispatchEvent(new Event('resize'));

    expect(captured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'viewport_zoom_changed',
          properties: { fromScale: 1, toScale: 1.25 },
        }),
      ]),
    );

    client.destroy();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalPixelRatio,
    });
  });

  it('keeps failed deliveries and clears a successfully received batch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 2, rejected: 0 }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-test',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      fetcher,
    });
    client.init();

    await expect(client.flush()).resolves.toEqual({
      status: 'delivered',
      accepted: 2,
      rejected: 0,
      duplicates: 0,
      sequenceConflicts: 0,
    });
    expect(client.snapshot()).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledOnce();

    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { events: unknown[] };
    expect(body.events).toHaveLength(2);

    client.destroy();
  });

  it('retains Beacon batches until a server receipt acknowledges them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T09:00:00.000Z'));
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: 3, rejected: 0 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-beacon',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      retryBaseMs: 100,
      random: () => 0.5,
      fetcher,
    });
    client.init();

    window.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(client.snapshot()).toHaveLength(3);

    await expect(client.flush()).resolves.toMatchObject({
      status: 'retrying',
    });
    expect(client.snapshot()).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(100);
    expect(client.snapshot()).toHaveLength(0);
    client.destroy();
  });

  it('beacons a page-hidden session once without starting a competing fetch', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    const fetcher = vi.fn<typeof fetch>();
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-pagehide',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      fetcher,
    });
    client.init();
    client.taskStarted('find-work');

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.snapshot().map((event) => event.eventType)).toEqual([
      'session_started',
      'page_view',
      'task_started',
      'task_failed',
      'session_ended',
    ]);
    client.destroy();
  });

  it('skips a batch that fails to serialize instead of aborting the beacon flush', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    const fetcher = vi.fn<typeof fetch>();
    // Simulate a batch that cannot be JSON-serialized (e.g. a circular
    // structure) on the first beacon-shaped call only; later batches must
    // still go out rather than the whole flush aborting on the first error.
    const originalStringify = JSON.stringify;
    let beaconStringifyCalls = 0;
    vi.spyOn(JSON, 'stringify').mockImplementation((value, ...rest) => {
      const isBatch =
        !!value &&
        typeof value === 'object' &&
        Array.isArray((value as { events?: unknown }).events);
      // Only the beacon path's own batches should ever throw here -- the
      // periodic fetch-flush path (also triggered by enqueue once the
      // outbox crosses batchSize) serializes an identically shaped batch
      // and must be left alone, so distinguish by call site.
      const fromBeaconPath = (new Error().stack ?? '').includes(
        'flushWithBeacon',
      );
      if (isBatch && fromBeaconPath) {
        beaconStringifyCalls += 1;
        if (beaconStringifyCalls === 1) {
          throw new TypeError('Converting circular structure to JSON');
        }
      }
      return originalStringify(
        value as Parameters<typeof JSON.stringify>[0],
        ...(rest as [null?, (string | number)?]),
      );
    });

    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-beacon-serialize',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 1,
      fetcher,
    });
    client.init();
    expect(client.snapshot()).toHaveLength(2);

    expect(() =>
      window.dispatchEvent(new Event('pagehide')),
    ).not.toThrow();

    // 3 events (session_started, page_view, session_ended) at batchSize 1
    // means 3 beacon attempts; the first fails to serialize and must be
    // skipped, leaving the other two to still go out.
    expect(client.snapshot()).toHaveLength(3);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  it('recovers acknowledged events after an offline retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T09:00:00.000Z'));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: 2, rejected: 0 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-offline',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      retryBaseMs: 100,
      random: () => 0.5,
      fetcher,
    });
    client.init();

    await expect(client.flush()).resolves.toMatchObject({
      status: 'retrying',
      attempt: 1,
    });
    expect(client.snapshot()).toHaveLength(2);
    expect(client.health()).toMatchObject({
      deliveryFailures: 1,
      consecutiveDeliveryFailures: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.snapshot()).toHaveLength(0);
    expect(client.health()).toMatchObject({
      consecutiveDeliveryFailures: 0,
      nextRetryAt: null,
    });
    client.destroy();
  });

  it('retains a batch when its receipt does not account for every event', async () => {
    vi.useFakeTimers();
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-partial-receipt',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ accepted: 1, rejected: 0 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    client.init();

    await expect(client.flush()).resolves.toMatchObject({
      status: 'retrying',
      attempt: 1,
    });
    expect(client.snapshot()).toHaveLength(2);
    expect(client.health().lastDeliveryError).toContain('complete batch');
    client.destroy();
  });

  it('terminally reconciles sequence-conflicting events from a receipt', async () => {
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-sequence-conflict',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            accepted: 0,
            rejected: 0,
            duplicates: 0,
            sequenceConflicts: 2,
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    });
    client.init();

    await expect(client.flush()).resolves.toMatchObject({
      status: 'delivered',
      sequenceConflicts: 2,
    });
    expect(client.snapshot()).toHaveLength(0);
    expect(client.health().consecutiveDeliveryFailures).toBe(0);
    client.destroy();
  });

  it('continues a stable session sequence across client instances', () => {
    const config = {
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-stable-session',
      sessionId: 'session-stable-reload',
      initialRoute: '/study',
    };
    const first = createTelemetryClient(config);
    first.init();
    expect(first.snapshot().map((event) => event.sequence)).toEqual([0, 1]);
    first.destroy();

    const second = createTelemetryClient(config);
    second.init();
    expect(
      second
        .snapshot()
        .slice(-2)
        .map((event) => event.sequence),
    ).toEqual([3, 4]);
    second.destroy();
  });

  it('creates unique valid event IDs without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(Date, 'now').mockReturnValue(1_753_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-fallback-id',
      initialRoute: '/study',
    });
    client.init();

    const events = client.snapshot();
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
    events.forEach((event) =>
      expect(() => StudyTelemetryEventSchema.parse(event)).not.toThrow(),
    );
    client.destroy();
  });

  it('honors Retry-After before retrying a rate-limited batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T09:00:00.000Z'));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': '3' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: 2, rejected: 0 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-rate-limit',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      batchSize: 20,
      retryBaseMs: 100,
      random: () => 0.5,
      fetcher,
    });
    client.init();

    await expect(client.flush()).resolves.toMatchObject({
      status: 'retrying',
      retryAt: '2026-07-18T09:00:03.000Z',
    });
    await expect(client.flush()).resolves.toMatchObject({
      status: 'retrying',
    });
    expect(fetcher).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.snapshot()).toHaveLength(0);
    client.destroy();
  });

  it('retries persistent outbox writes after a transient quota failure', () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      })
      .mockImplementation(function (this: Storage, key: string, value: string) {
        return originalSetItem.call(this, key, value);
      });
    const healthUpdates: Array<{ storageFailures: number }> = [];
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-quota',
      initialRoute: '/study',
      onHealth: (health) => healthUpdates.push(health),
    });

    expect(() => client.init()).not.toThrow();
    expect(client.snapshot()).toHaveLength(2);
    expect(client.health().storageFailures).toBe(1);
    expect(healthUpdates.at(-1)?.storageFailures).toBe(1);
    client.trackPageView('/study/projects');
    expect(setItem.mock.calls.length).toBeGreaterThan(4);
    expect(
      localStorage.getItem(
        'darwin:telemetry-outbox:projectflow-baseline-study:participant-quota',
      ),
    ).toContain('/study/projects');
    client.destroy();
  });

  it('reports every event dropped by the bounded outbox', () => {
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-overflow',
      initialRoute: '/study',
      maxOutboxSize: 3,
    });
    client.init();
    client.trackPageView('/study/projects');
    client.trackPageView('/study/tasks');

    expect(client.snapshot()).toHaveLength(3);
    expect(client.health()).toMatchObject({
      outboxSize: 3,
      droppedEvents: 1,
    });
    client.destroy();
  });

  it('contains timer-driven delivery failures without unhandled rejections', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-timer',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      flushIntervalMs: 100,
      retryBaseMs: 1_000,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });
    client.init();

    await vi.advanceTimersByTimeAsync(100);
    expect(client.health().deliveryFailures).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();

    window.removeEventListener('unhandledrejection', unhandled);
    client.destroy();
  });

  it('aborts a hung delivery once the request timeout elapses and retries', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener('abort', () => {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const client = createTelemetryClient({
      appVersion: '1.0.0',
      studyId: 'projectflow-baseline-study',
      participantId: 'participant-timeout',
      endpoint: '/api/telemetry/events',
      initialRoute: '/study',
      flushIntervalMs: 100,
      retryBaseMs: 1_000,
      requestTimeoutMs: 2_000,
      fetcher,
    });
    client.init();

    // The flush fires at 100ms; the fetch itself never resolves. Advancing
    // past the 2s request timeout must abort it rather than hang forever.
    await vi.advanceTimersByTimeAsync(2_200);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetcher.mock.calls[0]!;
    expect(requestInit?.signal?.aborted).toBe(true);
    expect(client.health().deliveryFailures).toBe(1);
    expect(client.health().lastDeliveryError).toContain('timed out');
    expect(unhandled).not.toHaveBeenCalled();

    window.removeEventListener('unhandledrejection', unhandled);
    client.destroy();
  });
});

const pointerEvent = (type: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
};
