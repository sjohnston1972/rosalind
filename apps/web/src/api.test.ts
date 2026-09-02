import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, setOperatorToken } from './api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setOperatorToken(null);
  });

  it('aborts a hung request once the timeout elapses', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    vi.stubGlobal('fetch', fetcher);

    const call = apiFetch('/api/health', undefined, 5_000);
    const settled = vi.fn();
    call.catch(settled);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetcher.mock.calls[0]!;
    expect(requestInit?.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(settled).toHaveBeenCalled());
    const [reason] = settled.mock.calls[0]!;
    expect(reason).toMatchObject({ name: 'AbortError' });
  });

  it('honours a caller-supplied signal without waiting for the timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();

    const call = apiFetch(
      '/api/health',
      { signal: controller.signal },
      30_000,
    );
    const settled = vi.fn();
    call.catch(settled);
    controller.abort();

    await vi.waitFor(() => expect(settled).toHaveBeenCalled());
    expect(settled.mock.calls[0]![0]).toMatchObject({ name: 'AbortError' });
  });

  it('resolves normally well within the timeout window', async () => {
    const response = new Response(null, { status: 204 });
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetcher);

    await expect(apiFetch('/api/health')).resolves.toBe(response);
  });
});
