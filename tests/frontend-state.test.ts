import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCompanionStatus, phaseForCompanionStatus, type CompanionResponse } from '../shared/frontend-state';
import { CompanionRequestError, createFrontendController, type FrontendController } from '../shared/frontend-controller';

const activeResponse = {
  state: 'active',
  url: 'https://diamond-wrapping-often-cardiff.trycloudflare.com',
  pid: 4692,
  startedAt: '2026-10-12T04:58:44.514Z',
  target: { url: 'http://127.0.0.1:5173', port: 5173, protocol: 'http', host: '127.0.0.1' },
  tunnelId: 'tunnel-1',
} as const;

describe('frontend tunnel-state synchronization', () => {
  it('normalizes the exact active companion response for both start and status refresh', () => {
    const normalized = normalizeCompanionStatus(activeResponse);
    expect(normalized.state).toBe('active');
    expect(normalized.url).toBe(activeResponse.url);
    expect(normalized.id).toBe('tunnel-1');
    expect(phaseForCompanionStatus(normalized)).toBe('active');

    const refreshed = normalizeCompanionStatus({ ...activeResponse });
    expect(refreshed).toMatchObject({ state: 'active', url: activeResponse.url, id: 'tunnel-1' });
    expect(phaseForCompanionStatus(refreshed)).toBe('active');
  });

  it('keeps stopped and failed states honest', () => {
    expect(phaseForCompanionStatus({ state: 'stopped' })).toBe('stopped');
    expect(phaseForCompanionStatus({ state: 'error', error: 'cloudflared exited' })).toBe('error');
  });
});

function deferred() {
  let resolve!: (value: CompanionResponse) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<CompanionResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('workspace request lifecycle', () => {
  let controller: FrontendController;
  function setup(request = vi.fn<(path: string, init?: RequestInit) => Promise<CompanionResponse>>()) {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const onError = vi.fn();
    controller = createFrontendController({ request, onStatus, onError });
    return { request, onStatus, onError };
  }
  afterEach(() => { controller?.dispose(); vi.useRealTimers(); });

  it('applies successful Start immediately, then refreshes the exact URL and stops with the normalized id', async () => {
    const { request, onStatus } = setup();
    request.mockResolvedValue(activeResponse);
    await controller.start(activeResponse.target.url);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/tunnels');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ url: activeResponse.target.url, consent: true });
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ url: activeResponse.url, id: 'tunnel-1', target: activeResponse.target }), 'active');
    await controller.refresh();
    expect(request).toHaveBeenLastCalledWith('/status');
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ url: activeResponse.url, id: 'tunnel-1' }), 'active');
    const id = onStatus.mock.lastCall![0].id;
    request.mockResolvedValueOnce({ state: 'stopped' });
    await controller.stop(id);
    expect(request).toHaveBeenLastCalledWith('/tunnels/tunnel-1', { method: 'DELETE' });
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'stopped' }), 'stopped');
  });

  it('ignores an older starting GET that resolves after a successful Start response', async () => {
    const { request, onStatus } = setup();
    const startResponse = deferred(); const staleRead = deferred();
    request.mockReturnValueOnce(startResponse.promise).mockReturnValueOnce(staleRead.promise);
    const start = controller.start(activeResponse.target.url);
    await Promise.resolve();
    // Poll is dispatched AFTER POST, but its snapshot is older than the POST result.
    const refresh = controller.refresh();
    await Promise.resolve();
    startResponse.resolve(activeResponse);
    await start;
    const calls = onStatus.mock.calls.length;
    staleRead.resolve({ state: 'starting', tunnelId: 'tunnel-1' });
    await refresh;
    expect(onStatus).toHaveBeenCalledTimes(calls);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ url: activeResponse.url, id: 'tunnel-1' }), 'active');
  });

  it('keeps polling across identical starting responses and does not invalidate the pending POST', async () => {
    const { request, onStatus } = setup();
    const startResponse = deferred();
    request.mockReturnValueOnce(startResponse.promise).mockResolvedValue({ state: 'starting', tunnelId: 'tunnel-1' });
    const start = controller.start(activeResponse.target.url);
    await vi.advanceTimersByTimeAsync(7500);
    expect(request.mock.calls.filter(([path]) => path === '/status')).toHaveLength(3);
    startResponse.resolve(activeResponse);
    await start;
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ url: activeResponse.url }), 'active');
  });

  it('recovers after a start timeout by polling until active, without replaying POST', async () => {
    const { request, onStatus } = setup();
    request.mockRejectedValueOnce(new CompanionRequestError('Timed out', 'timeout'))
      .mockResolvedValueOnce({ state: 'starting', tunnelId: 'tunnel-1' })
      .mockResolvedValueOnce({ state: 'starting', tunnelId: 'tunnel-1' })
      .mockResolvedValue(activeResponse);
    await controller.start(activeResponse.target.url);
    await vi.advanceTimersByTimeAsync(5000);
    expect(request.mock.calls.filter(([path]) => path === '/tunnels')).toHaveLength(1);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ url: activeResponse.url }), 'active');
  });

  it('recovers an existing active tunnel on a fresh workspace status request', async () => {
    const { request, onStatus } = setup();
    request.mockResolvedValue(activeResponse);
    await controller.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/status');
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'active', url: activeResponse.url, id: 'tunnel-1' }), 'active');
  });

  it('serializes repeated refreshes and cancels future updates when the workspace closes', async () => {
    const { request, onStatus } = setup();
    const read = deferred();
    request.mockReturnValue(read.promise);
    const first = controller.refresh();
    const second = controller.refresh();
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
    controller.dispose();
    read.resolve(activeResponse);
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('shows backend error and stopped states rather than keeping an active URL', async () => {
    const { request, onStatus } = setup();
    request.mockResolvedValueOnce(activeResponse)
      .mockResolvedValueOnce({ state: 'error', error: 'cloudflared exited' })
      .mockResolvedValueOnce({ state: 'stopped' });
    await controller.refresh();
    await controller.refresh();
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', error: 'cloudflared exited' }), 'error');
    expect(onStatus.mock.lastCall![0].url).toBeUndefined();
    await controller.refresh();
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'stopped' }), 'stopped');
  });
});
