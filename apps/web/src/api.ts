const operatorTokenKey = 'darwin:operator-token';

export const getOperatorToken = () =>
  window.sessionStorage.getItem(operatorTokenKey)?.trim() || null;

export const setOperatorToken = (token: string | null) => {
  if (token) window.sessionStorage.setItem(operatorTokenKey, token.trim());
  else window.sessionStorage.removeItem(operatorTokenKey);
};

// Every request Rosalind's UI makes is bounded: an unresponsive worker or a
// dropped network path must surface as a timeout, never hang a view forever.
export const apiFetchTimeoutMs = 20_000;

/**
 * Combine the caller's own abort signal (if any) with an internal timeout,
 * so a hung request always settles even when nobody is watching for it.
 */
const boundedSignal = (
  timeoutMs: number,
  callerSignal: AbortSignal | null | undefined,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else
      callerSignal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
  }
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
};

export const apiFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = apiFetchTimeoutMs,
) => {
  const token = getOperatorToken();
  const bounded = boundedSignal(timeoutMs, init?.signal);
  try {
    let response: Response;
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      response = await fetch(input, {
        ...init,
        headers,
        signal: bounded.signal,
      });
    } else {
      response = await fetch(input, { ...init, signal: bounded.signal });
    }
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('darwin:operator-unauthorized'));
    }
    return response;
  } finally {
    bounded.dispose();
  }
};
