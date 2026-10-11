import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LocalTarget, TunnelStatus } from '../shared/types';

const MAX_OUTPUT = 64 * 1024;
const DEFAULT_START_TIMEOUT = 30_000;
const DEFAULT_STOP_TIMEOUT = 1_500;
const URL_RE = /https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com(?=$|[\s"'()[\]{}<>/:?,])/i;

/** Parse complete log lines only. This prevents a URL split across chunks from being accepted. */
export function parseTunnelUrl(output: string) {
  for (const line of output.slice(-MAX_OUTPUT).split(/\r?\n/)) {
    const match = line.match(URL_RE);
    if (match && (match.index === 0 || /[\s"'([<{]/.test(line[match.index! - 1]))) return match[0];
  }
  return undefined;
}
export function hasRegisteredConnection(output: string) {
  return /registered\s+(?:tunnel\s+)?connection/i.test(output.slice(-MAX_OUTPUT));
}

export function checkTargetReachable(target: LocalTarget, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = target.protocol === 'https' ? httpsRequest : request;
    const req = client(target.url, { method: 'GET', timeout: timeoutMs, headers: { 'user-agent': 'Yerel/health-check' } }, (res) => { res.resume(); resolve(); });
    req.on('timeout', () => req.destroy(new Error('Local target did not respond in time.')));
    req.on('error', reject); req.end();
  });
}

type Spawn = typeof spawn;
type Child = ChildProcessWithoutNullStreams;
type Options = { startupTimeoutMs?: number; stopTimeoutMs?: number; reachabilityTimeoutMs?: number };
type Run = { generation: number; target: LocalTarget; child?: Child; cancelled: boolean; settled: boolean; resolve: (status: TunnelStatus) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout; output: string; partial: string };

export class CloudflaredTunnel {
  private child?: Child;
  private current: TunnelStatus = { state: 'idle' };
  private listeners = new Set<(status: TunnelStatus) => void>();
  private run?: Run;
  private generation = 0;
  constructor(private executable = 'cloudflared', private spawnProcess: Spawn = spawn, private options: Options = {}) {}
  status() { return this.current; }
  onChange(listener: (status: TunnelStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private set(status: TunnelStatus) { this.current = status; this.listeners.forEach((listener) => listener(status)); }
  private live(run: Run) { return this.run === run && run.generation === this.generation && !run.cancelled; }
  private settle(run: Run, error?: Error, status?: TunnelStatus) {
    if (run.settled) return;
    run.settled = true; if (run.timer) clearTimeout(run.timer);
    if (this.live(run) && status) this.set(status);
    if (error) run.reject(error); else run.resolve(status!);
  }
  start(target: LocalTarget): Promise<TunnelStatus> {
    if (this.run || this.child || this.current.state === 'active' || this.current.state === 'stopping') return Promise.reject(new Error('A tunnel is already running.'));
    const generation = ++this.generation;
    let resolve!: (status: TunnelStatus) => void; let reject!: (error: Error) => void;
    const promise = new Promise<TunnelStatus>((res, rej) => { resolve = res; reject = rej; });
    const run: Run = { generation, target, cancelled: false, settled: false, resolve, reject, output: '', partial: '' };
    this.run = run; this.set({ state: 'starting', target });
    void this.launch(run);
    return promise;
  }
  private async launch(run: Run) {
    try {
      await checkTargetReachable(run.target, this.options.reachabilityTimeoutMs);
      if (!this.live(run)) return;
      let child: Child;
      try { child = this.spawnProcess(this.executable, ['tunnel', '--url', run.target.url], { shell: false, windowsHide: true }); }
      catch (error) { await this.fail(run, error instanceof Error && error.message.includes('ENOENT') ? 'cloudflared was not found. Install it and ensure it is on PATH.' : 'Unable to start cloudflared.'); return; }
      run.child = child; this.child = child;
      const onData = (chunk: Buffer) => { if (!this.live(run) || run.settled) return; run.partial += chunk.toString(); const lines = run.partial.split(/\r?\n/); run.partial = lines.pop() || ''; if (!lines.length) return; run.output = (run.output + lines.join('\n') + '\n').slice(-MAX_OUTPUT); const url = parseTunnelUrl(run.output); if (url && hasRegisteredConnection(run.output)) void this.ready(run, url); };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.once('error', (error) => { void this.fail(run, error.message.includes('ENOENT') ? 'cloudflared was not found. Install it and ensure it is on PATH.' : 'cloudflared failed to start.'); });
      child.once('exit', (code) => { if (this.child === child) this.child = undefined; if (this.run === run && !run.settled && !run.cancelled) void this.fail(run, `cloudflared exited before becoming ready (code ${code ?? 'unknown'}).`); else if (this.live(run) && this.current.state === 'active') { this.run = undefined; this.set({ state: 'error', error: 'The tunnel process exited unexpectedly.', target: run.target }); } });
      run.timer = setTimeout(() => { void this.fail(run, 'Timed out waiting for a registered public URL.'); }, this.options.startupTimeoutMs ?? DEFAULT_START_TIMEOUT);
    } catch (error) { if (this.live(run)) await this.fail(run, error instanceof Error ? error.message : 'Unable to start tunnel.'); }
  }
  private async ready(run: Run, url: string) {
    if (!this.live(run) || run.settled) return;
    try { await checkTargetReachable(run.target, this.options.reachabilityTimeoutMs); } catch { await this.fail(run, 'The local target is not reachable.'); return; }
    if (!this.live(run) || run.settled) return;
    this.settle(run, undefined, { state: 'active', url, pid: run.child?.pid, startedAt: new Date().toISOString(), target: run.target });
  }
  private async fail(run: Run, message: string) {
    if (run.settled) return;
    run.cancelled = true; ++this.generation;
    const child = run.child;
    if (child) {
      try { await this.terminate(child); } catch (error) { this.set({ state: 'error', error: `${message} Process could not be terminated: ${error instanceof Error ? error.message : 'unknown error'}.`, target: run.target }); run.reject(new Error(message)); return; }
      if (this.child === child) this.child = undefined;
    }
    this.run = undefined; this.set({ state: 'error', error: message, target: run.target }); this.settle(run, new Error(message));
  }
  private terminate(child: Child) {
    return new Promise<void>((resolve, reject) => {
      let finished = false; const finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); child.removeListener('exit', onExit); error ? reject(error) : resolve(); };
      const onExit = () => finish(); const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (error) { finish(error instanceof Error ? error : new Error('Unable to terminate cloudflared.')); return; } const killTimer = setTimeout(() => finish(new Error('cloudflared did not exit.')), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT); child.once('exit', () => clearTimeout(killTimer)); }, this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT);
      child.once('exit', onExit); try { child.kill(); } catch (error) { finish(error instanceof Error ? error : new Error('Unable to terminate cloudflared.')); }
    });
  }
  async stop() {
    const run = this.run;
    if (!run) { if (this.current.state === 'active') this.set({ ...this.current, state: 'stopping' }); this.set({ state: 'stopped' }); return this.current; }
    run.cancelled = true; ++this.generation; if (run.timer) clearTimeout(run.timer); this.set({ ...this.current, state: 'stopping' });
    const child = run.child;
    if (!child) { this.run = undefined; this.settle(run, new Error('Tunnel startup cancelled.')); this.set({ state: 'stopped' }); return this.current; }
    try { await this.terminate(child); } catch (error) { this.set({ state: 'error', error: error instanceof Error ? error.message : 'cloudflared did not exit.', target: run.target }); throw error; }
    if (this.child === child) this.child = undefined; this.run = undefined; this.settle(run, new Error('Tunnel startup cancelled.')); this.set({ state: 'stopped' }); return this.current;
  }
}
