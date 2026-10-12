import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { CloudflaredTunnel } from '../server/tunnel';
import { resolveCloudflaredExecutable } from '../shared/cloudflared';
import { validateLocalTarget } from '../shared/target';
import type { LocalTarget, TunnelStatus } from '../shared/types';

export interface CliOptions { target?: string; origins?: string[]; }
export interface ForegroundTunnel { status(): TunnelStatus; start(target: LocalTarget): Promise<TunnelStatus>; stop(): Promise<TunnelStatus>; onChange?(listener: (status: TunnelStatus) => void): () => void; }
export interface ForegroundOptions { tunnel?: ForegroundTunnel; executablePath?: string; log?: (message: string) => void; errorLog?: (message: string) => void; waitForShutdown?: boolean; }

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): CliOptions {
  let target: string | undefined; const origins = (env.YEREL_ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') throw new Error(usage());
    if (arg === '--origin' || arg.startsWith('--origin=')) {
      const value = arg === '--origin' ? argv[++i] : arg.slice('--origin='.length);
      if (!value) throw new Error('--origin requires a value.');
      origins.push(value); continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (target === undefined) target = arg; else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { target, origins: [...new Set(origins)] };
}
export function usage() { return 'Usage: yerel [local-url] [--origin <exact-origin>]'; }

async function detectCloudflared(executablePath: string) {
  try { const result = await promisify(execFile)(executablePath, ['--version'], { timeout: 3000, windowsHide: true }); return result.stdout.trim().split(/\r?\n/)[0] || 'available'; }
  catch (error) { throw new Error(`cloudflared was found but could not be launched: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

export function startForeground(argv = process.argv.slice(2), env: Record<string, string | undefined> = process.env, options: ForegroundOptions = {}) {
  const parsed = parseArgs(argv, env); if (!parsed.target) throw new Error('A local target URL is required.');
  const target = validateLocalTarget(parsed.target); const executablePath = options.executablePath ?? resolveCloudflaredExecutable(env.YEREL_CLOUDFLARED_PATH || 'cloudflared', env);
  if (!executablePath) throw new Error('cloudflared was not found. Set YEREL_CLOUDFLARED_PATH or add it to PATH.');
  const log = options.log ?? console.log; const errorLog = options.errorLog ?? console.error; const tunnel = options.tunnel ?? new CloudflaredTunnel(executablePath);
  let closing: Promise<void> | undefined; let unsubscribe: (() => void) | undefined; let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const shutdown = () => { if (!closing) closing = tunnel.stop().catch((error) => errorLog(error instanceof Error ? error.message : String(error))).then(() => { unsubscribe?.(); resolveDone(); }); return closing; };
  const report = (status: TunnelStatus) => { log(`Status: ${status.state}`); if (status.url) log(`Public URL: ${status.url}`); if (status.error) errorLog(status.error); };
  const ready = (async () => { const version = await detectCloudflared(executablePath); log(`Target: ${target.url}`); log(`cloudflared detected: ${version}`); unsubscribe = tunnel.onChange?.(report); report(tunnel.status()); report(await tunnel.start(target)); })().catch((error) => { errorLog(error instanceof Error ? error.message : String(error)); resolveDone(); throw error; });
  return { target, tunnel, shutdown, done: done.then(() => ready.catch(() => undefined)), ready };
}

const MAX_BODY = 8 * 1024;
export interface CompanionOptions { tunnel?: ForegroundTunnel; executablePath?: string; host?: string; port?: number; token?: string; origins?: string[]; env?: Record<string, string | undefined>; log?: (message: string) => void; errorLog?: (message: string) => void; }
export interface Companion { server: Server; token: string; ready: Promise<{ port: number }>; close(): Promise<void>; port(): number; }

function json(res: ServerResponse, status: number, value: unknown, origin?: string) { res.statusCode = status; res.setHeader('content-type', 'application/json'); if (origin) res.setHeader('access-control-allow-origin', origin); res.end(JSON.stringify(value)); }
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => { let text = ''; if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { reject(new Error('Request body is too large.')); req.destroy(); return; }
    req.setEncoding('utf8'); req.on('data', (chunk: string) => { text += chunk; if (Buffer.byteLength(text) > MAX_BODY) { reject(new Error('Request body is too large.')); req.destroy(); } });
    req.on('end', () => { if (!text) return resolve({}); try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new Error('Request body must be JSON.')); } }); req.on('error', reject);
  });
}
function sameSecret(a: string, b: string) { const aa = createHash('sha256').update(a).digest(); const bb = createHash('sha256').update(b).digest(); return timingSafeEqual(aa, bb); }

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function createCompanion(options: CompanionOptions = {}): Companion {
  const env = options.env ?? process.env; const token = options.token ?? randomBytes(24).toString('hex'); const configuredOrigins = (env.YEREL_ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean); const allowedOrigins = options.origins?.length ? options.origins : (configuredOrigins.length ? configuredOrigins : DEFAULT_ORIGINS); const origins = new Set(allowedOrigins);
  const port = options.port ?? Number(env.YEREL_CONTROL_PORT ?? 3847); const host = options.host ?? '127.0.0.1'; const log = options.log ?? console.log; const errorLog = options.errorLog ?? console.error;
  // Companion startup must remain useful even when cloudflared is not installed yet;
  // the tunnel start operation reports that actionable error when requested.
  const executable = options.executablePath ?? resolveCloudflaredExecutable(env.YEREL_CLOUDFLARED_PATH || 'cloudflared', env);
  const tunnel = options.tunnel ?? new CloudflaredTunnel(executable ?? 'cloudflared'); let activeId: string | undefined; let nextId = 1;
  const server = createServer((req, res) => { void handle(req, res); });
  const ready = new Promise<{ port: number }>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); const actual = (server.address() as import('node:net').AddressInfo).port; log(`Yerel companion listening on http://${host}:${actual}`); log(`Pairing token: ${token}`); resolve({ port: actual }); }); });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined; if (origin && !origins.has(origin)) { json(res, 403, { error: 'Origin is not allowed.' }); return; }
    if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
      res.setHeader('access-control-max-age', '300');
      res.setHeader('vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
      // Edge/Chromium sends this request header for HTTPS -> loopback requests.
      // Opt in only after the exact Origin allowlist check above succeeds.
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('access-control-allow-private-network', 'true');
      res.statusCode = 204; res.end(); return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`); const publicHealth = req.method === 'GET' && url.pathname === '/health';
    // Pairing is the one unauthenticated exchange: the token is supplied in the JSON body.
    const pairing = req.method === 'POST' && url.pathname === '/pair';
    const auth = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]; if (!publicHealth && !pairing && (!auth || !sameSecret(auth, token))) { json(res, 401, { error: 'Unauthorized.' }, origin); return; }
    try {
      if (publicHealth) { json(res, 200, { ok: true }, origin); return; }
      if (pairing) { const body = await readBody(req); if (typeof body.token !== 'string' || !sameSecret(body.token, token)) { json(res, 401, { error: 'Invalid pairing token.' }, origin); return; } json(res, 200, { token }, origin); return; }
      if (req.method === 'GET' && url.pathname === '/status') { json(res, 200, { ...tunnel.status(), tunnelId: activeId }, origin); return; }
      if (req.method === 'POST' && url.pathname === '/tunnels') { if (activeId) { json(res, 409, { error: 'A tunnel is already running.', tunnelId: activeId }, origin); return; } const body = await readBody(req); if (body.consent !== true) { json(res, 400, { error: 'Explicit consent is required.' }, origin); return; } const target = validateLocalTarget(body.url, (server.address() as import('node:net').AddressInfo).port); const id = `tunnel-${nextId++}`; activeId = id; try { const status = await tunnel.start(target); json(res, 201, { id, ...status }, origin); } catch (error) { activeId = undefined; json(res, 502, { error: error instanceof Error ? error.message : 'Unable to start tunnel.' }, origin); } return; }
      const match = url.pathname.match(/^\/tunnels\/([^/]+)$/); if (req.method === 'DELETE' && match) { if (!activeId || match[1] !== activeId) { json(res, 404, { error: 'Tunnel not found.' }, origin); return; } const status = await tunnel.stop(); activeId = undefined; json(res, 200, status, origin); return; }
      if (req.method === 'DELETE' && url.pathname === '/pair') { json(res, 200, { ok: true }, origin); return; }
      json(res, 404, { error: 'Not found.' }, origin);
    } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : 'Bad request.' }, origin); }
  }
  async function close() { if (activeId) { try { await tunnel.stop(); } catch (error) { errorLog(error instanceof Error ? error.message : String(error)); } activeId = undefined; } await new Promise<void>((resolve) => server.close(() => resolve())); }
  return { server, token, ready, close, port: () => (server.address() as import('node:net').AddressInfo)?.port ?? port };
}

export async function run(argv = process.argv.slice(2), env: Record<string, string | undefined> = process.env, options: ForegroundOptions = {}) {
  const parsed = parseArgs(argv, env);
  if (parsed.target) { const session = startForeground(argv, env, options); const shutdown = () => { void session.shutdown(); }; process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); try { await session.ready; if (options.waitForShutdown !== false) await session.done; } finally { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); } return; }
  const parsedOrigins = parsed.origins ?? []; const companion = createCompanion({ origins: parsedOrigins.length ? parsedOrigins : undefined, executablePath: options.executablePath, log: options.log, errorLog: options.errorLog, tunnel: options.tunnel }); const shutdown = () => { void companion.close(); }; process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); try { await companion.ready; await new Promise<void>(() => {}); } finally { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { if (process.argv.slice(2).some((arg) => arg === '--help' || arg === '-h')) console.log(usage()); else run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }); }
