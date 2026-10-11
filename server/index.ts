import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import next from 'next';
import { validateLocalTarget } from '../shared/target';
import type { ActivityEvent, DesktopSnapshot, LocalTarget } from '../shared/types';
import { CloudflaredTunnel } from './tunnel';

const MAX_BODY = 8 * 1024;
type ExecutableEnvironment = { PATH?: string; PATHEXT?: string };
export function resolveCloudflaredExecutable(command = process.env.YEREL_CLOUDFLARED_PATH || 'cloudflared', env: ExecutableEnvironment = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT }, platform = process.platform): string | undefined {
  const value = command.trim();
  if (!value) return undefined;
  const windows = platform === 'win32';
  const hasPath = path.isAbsolute(value) || value.includes('/') || value.includes('\\');
  const extensions = windows ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (candidate: string) => {
    if (!windows || path.extname(candidate)) return [candidate];
    return extensions.map((extension) => `${candidate}${extension}`);
  };
  const locations = hasPath ? [''] : (env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const location of locations) {
    const base = hasPath ? value : path.join(location, value);
    for (const candidate of candidates(base)) {
      try { accessSync(candidate, fsConstants.F_OK); return path.resolve(candidate); } catch { /* continue searching */ }
    }
  }
  return undefined;
}
type Options = { dev?: boolean; hostname?: string; port?: number; tunnel?: CloudflaredTunnel };
export class YerelApi {
  readonly tunnel: CloudflaredTunnel;
  private readonly host: string;
  private readonly port: number;
  private readonly origin: string;
  private readonly activity: ActivityEvent[] = [];
  private cloudflared: DesktopSnapshot['cloudflared'] = { available: false };
  private readonly executablePath: string | undefined;
  constructor(options: { hostname?: string; port?: number; tunnel?: CloudflaredTunnel } = {}) {
    this.host = options.hostname || process.env.HOST || '127.0.0.1';
    this.port = options.port || Number(process.env.PORT || 3000);
    this.origin = `http://${this.host.includes(':') ? `[${this.host}]` : this.host}:${this.port}`;
    this.executablePath = resolveCloudflaredExecutable();
    this.tunnel = options.tunnel || new CloudflaredTunnel(this.executablePath || process.env.YEREL_CLOUDFLARED_PATH || 'cloudflared');
  }
  snapshot(): DesktopSnapshot { return { tunnel: this.tunnel.status(), activity: this.activity, cloudflared: this.cloudflared }; }
  private addActivity(level: ActivityEvent['level'], message: string, detail?: string) { this.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), level, message, detail: detail?.replace(/(token|key|secret|password)=?\S+/gi, '$1=[redacted]') }); if (this.activity.length > 80) this.activity.pop(); }
  private reject(res: ServerResponse, status: number, error: string) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error })); }
  private send(res: ServerResponse, value: unknown, status = 200) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
  private isAllowedLoopbackHost(value: string | undefined) {
    if (!value) return false;
    try {
      const parsed = new URL(`http://${value}`);
      const host = parsed.hostname.toLowerCase();
      const port = Number(parsed.port || 80);
      return port === this.port && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1');
    } catch { return false; }
  }
  private sameOrigin(req: IncomingMessage) {
    if (!this.isAllowedLoopbackHost(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' && this.isAllowedLoopbackHost(parsed.host);
    } catch { return false; }
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith('/api/')) return false;
    if (!this.sameOrigin(req)) { this.reject(res, 403, 'Invalid host or origin.'); return true; }
    const path = new URL(req.url, this.origin).pathname;
    if (req.method === 'GET' && path === '/api/snapshot') { this.send(res, this.snapshot()); return true; }
    if (req.method !== 'POST' || !['/api/validate', '/api/session/start', '/api/session/stop'].includes(path)) { this.reject(res, 404, 'Not found.'); return true; }
    if (!req.headers.origin || !this.sameOrigin(req)) { this.reject(res, 403, 'A same-origin request is required.'); return true; }
    if (path === '/api/session/stop') { const result = await this.tunnel.stop(); this.addActivity('info', 'Sharing stopped'); this.send(res, result); return true; }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) { this.reject(res, 415, 'Content-Type must be application/json.'); return true; }
    let body: unknown;
    try { body = await readJson(req); } catch (error) { this.reject(res, error instanceof Error && error.message === 'Payload too large.' ? 413 : 400, error instanceof Error ? error.message : 'Invalid JSON.'); return true; }
    const value = typeof body === 'object' && body !== null && 'url' in body ? (body as { url?: unknown }).url : undefined;
    let target: LocalTarget;
     try { target = validateLocalTarget(value, Number(this.origin.split(':').pop())); } catch (error) { this.send(res, { ok: false, error: error instanceof Error ? error.message : 'Invalid target.' }); return true; }
    if (path === '/api/validate') { this.send(res, { ok: true, target }); return true; }
    this.addActivity('info', 'Target validated', target.url); this.addActivity('info', 'Secure tunnel starting');
    try { const result = await this.tunnel.start(target); this.addActivity('success', 'Tunnel ready', result.url); this.send(res, result); } catch (error) { const message = error instanceof Error ? error.message : 'Unable to start tunnel.'; this.addActivity('error', 'Tunnel could not start', message); this.reject(res, 409, message); }
    return true;
  }
  async detectCloudflared() {
    if (!this.executablePath) { this.cloudflared = { available: false, error: `cloudflared was not found. Checked ${process.platform === 'win32' ? 'PATH and PATHEXT' : 'PATH'}. Set YEREL_CLOUDFLARED_PATH to the executable if it is installed elsewhere.` }; return; }
    try {
      const result = await promisify(execFile)(this.executablePath, ['--version'], { timeout: 3000, windowsHide: true });
      this.cloudflared = { available: true, path: this.executablePath, version: result.stdout.trim().split(/\r?\n/)[0] };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown launch error.';
      this.cloudflared = { available: false, path: this.executablePath, error: `cloudflared was found at ${this.executablePath}, but could not be launched: ${detail}` };
    }
  }
  async shutdown() { await this.tunnel.stop(); }
}
function readJson(req: IncomingMessage): Promise<unknown> { return new Promise((resolve, reject) => { let data = ''; let size = 0; req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('Payload too large.')); req.destroy(); return; } data += chunk.toString('utf8'); }); req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON.')); } }); req.on('error', reject); }); }

export async function startServer(options: Options = {}) {
  const dev = options.dev ?? (process.argv.includes('--dev') || (!process.argv.includes('--production') && process.env.NODE_ENV !== 'production')); const hostname = options.hostname || process.env.HOST || '127.0.0.1'; const port = options.port || Number(process.env.PORT || 3000);
  const app = next({ dev, hostname, port }); const handle = app.getRequestHandler(); const api = new YerelApi({ hostname, port, tunnel: options.tunnel });
   await app.prepare(); const server = createHttpServer(async (req, res) => { if (await api.handle(req, res)) return; await handle(req, res); });
   await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, () => { server.removeListener('error', reject); resolve(); }); }); await api.detectCloudflared();
   console.log(`Yerel is running at http://${hostname}:${port}`);
   console.log(api.snapshot().cloudflared.available ? `cloudflared detected: ${api.snapshot().cloudflared.version || 'available'}` : 'cloudflared not detected; sharing will report an actionable setup error.');
  const shutdown = async () => { await api.shutdown(); await new Promise<void>((resolve) => server.close(() => resolve())); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  return { server, api, shutdown };
}
if (require.main === module) void startServer().catch((error) => { console.error(error); process.exitCode = 1; });
