import { normalizeCompanionStatus, phaseForCompanionStatus, type CompanionResponse, type CompanionStatus, type FrontendPhase } from './frontend-state';

export type CompanionErrorKind = 'auth' | 'timeout' | 'connection' | 'http' | 'invalid-response';

export class CompanionRequestError extends Error {
  constructor(message: string, public readonly kind: CompanionErrorKind, public readonly status?: number) {
    super(message);
    this.name = 'CompanionRequestError';
  }
}

export interface FrontendControllerOptions {
  request: (path: string, init?: RequestInit) => Promise<CompanionResponse>;
  onStatus: (status: CompanionStatus, phase: FrontendPhase) => void;
  onError: (error: unknown, phase: FrontendPhase) => void;
  pollIntervalMs?: number;
  /** Return a cancellation function, allowing tests to inject a deterministic clock. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

export interface FrontendController {
  start(url: string): Promise<void>;
  stop(id: string): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}

/** One read at a time; mutations have their own ordering boundary, never a read revision. */
export function createFrontendController(options: FrontendControllerOptions): FrontendController {
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
  let disposed = false;
  let epoch = 0;
  let status: CompanionStatus = {};
  let read: Promise<void> | undefined;
  let mutation: Promise<void> | undefined;
  let pendingPhase: FrontendPhase | undefined;
  let cancelTimer: (() => void) | undefined;

  function pollLater() {
    cancelTimer?.();
    cancelTimer = undefined;
    if (!disposed) cancelTimer = schedule(() => { cancelTimer = undefined; void refresh(); }, options.pollIntervalMs ?? 2500);
  }

  function apply(raw: CompanionResponse) {
    status = normalizeCompanionStatus(raw);
    const phase = phaseForCompanionStatus(status);
    // An idle snapshot while POST/DELETE is pending must not re-enable mutation controls.
    options.onStatus(status, pendingPhase && (phase === 'paired' || phase === 'stopped') ? pendingPhase : phase);
  }

  function report(error: unknown, fallback: FrontendPhase) {
    options.onError(error, error instanceof CompanionRequestError && error.kind === 'auth' ? 'setup' : fallback);
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (read) return read;
    cancelTimer?.();
    cancelTimer = undefined;
    const revision = epoch;
    read = (async () => {
      // Defer dispatch until the single-flight slot is installed (also handles synchronous throws).
      await Promise.resolve();
      if (disposed) return;
      try {
        const result = await options.request('/status');
        if (!disposed && revision === epoch) apply(result);
      } catch (error) {
        if (!disposed && revision === epoch) report(error, pendingPhase ?? 'disconnected');
      } finally {
        read = undefined;
        pollLater();
      }
    })();
    return read;
  }

  function mutate(path: string, init: RequestInit, phase: FrontendPhase): Promise<void> {
    if (disposed) return Promise.resolve();
    // Mutations are single-flight, but refresh remains independently available.
    if (mutation) return mutation;
    ++epoch;
    pendingPhase = phase;
    options.onStatus(status, phase);
    pollLater();
    mutation = (async () => {
      await Promise.resolve();
      if (disposed) return;
      let failed = false;
      try {
        const result = await options.request(path, init);
        if (disposed) return;
        ++epoch; // Invalidate every GET dispatched before this authoritative response.
        pendingPhase = undefined;
        apply(result);
      } catch (error) {
        if (disposed) return;
        ++epoch;
        pendingPhase = undefined;
        failed = true;
        report(error, 'error');
      } finally {
        mutation = undefined;
        if (!disposed) {
          pollLater();
          if (failed) {
            // A timed-out POST may still finish server-side. Reconcile via a fresh GET,
            // after any older read drains; never replay an uncertain mutation.
            if (read) await read;
            if (!disposed) await refresh();
          }
        }
      }
    })();
    return mutation;
  }

  return {
    start: (url) => mutate('/tunnels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim(), consent: true }) }, 'validating'),
    stop: (id) => mutate(`/tunnels/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'stopping'),
    refresh,
    dispose() { disposed = true; ++epoch; cancelTimer?.(); cancelTimer = undefined; },
  };
}
