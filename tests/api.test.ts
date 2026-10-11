import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { YerelApi } from '../server';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCloudflaredExecutable } from '../server';

class FakeRequest extends EventEmitter {
  method = 'POST';
  url = '/api/validate';
  headers: Record<string, string> = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' };
  destroy() { return this; }
  send(body: string) { queueMicrotask(() => { this.emit('data', Buffer.from(body)); this.emit('end'); }); }
}
function response() {
  let body = ''; let status = 0;
  return { response: { writeHead(code: number) { status = code; }, end(value?: string) { body = value || ''; } } as unknown as ServerResponse, read: () => ({ status, body: JSON.parse(body) }) };
}

describe('HTTP API security and validation', () => {
  it('rejects an unexpected host and origin before handling an endpoint', async () => {
    const api = new YerelApi(); const req = new FakeRequest(); req.headers.host = 'localhost:3000'; req.headers.origin = 'http://evil.test';
    const out = response(); await api.handle(req as unknown as IncomingMessage, out.response);
    expect(out.read()).toMatchObject({ status: 403, body: { ok: false } });
  });
  it('validates only local targets and requires JSON requests', async () => {
    const api = new YerelApi(); const req = new FakeRequest(); req.headers['content-type'] = 'text/plain';
    const out = response(); await api.handle(req as unknown as IncomingMessage, out.response);
    expect(out.read().status).toBe(415);
    const valid = new FakeRequest(); const validOut = response(); const handled = api.handle(valid as unknown as IncomingMessage, validOut.response); valid.send(JSON.stringify({ url: 'https://localhost:8443/demo' })); await handled;
    expect(validOut.read()).toMatchObject({ status: 200, body: { ok: true, target: { port: 8443 } } });
  });
  it('accepts localhost as an alias for the loopback Yerel interface', async () => {
    const api = new YerelApi(); const req = new FakeRequest(); req.headers.host = 'localhost:3000'; req.headers.origin = 'http://localhost:3000';
    const out = response(); const handled = api.handle(req as unknown as IncomingMessage, out.response); req.send(JSON.stringify({ url: 'http://127.0.0.1:5173' })); await handled;
    expect(out.read()).toMatchObject({ status: 200, body: { ok: true, target: { port: 5173 } } });
  });
});

describe('cloudflared executable discovery', () => {
  it('searches Windows PATH entries with PATHEXT and preserves spaces', () => {
    const folder = join(tmpdir(), `yerel cloudflared ${Date.now()}`); mkdirSync(folder, { recursive: true });
    const executable = join(folder, 'cloudflared.CMD'); writeFileSync(executable, '@echo off\r\n');
    try { expect(resolveCloudflaredExecutable('cloudflared', { PATH: folder, PATHEXT: '.COM;.EXE;.CMD' }, 'win32')).toBe(executable); }
    finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it('returns undefined for a missing executable', () => {
    expect(resolveCloudflaredExecutable('cloudflared', { PATH: 'C:\\does-not-exist', PATHEXT: '.EXE;.CMD' }, 'win32')).toBeUndefined();
  });
  it('reports the same resolved executable in the snapshot used by the UI', async () => {
    const previous = process.env.YEREL_CLOUDFLARED_PATH; process.env.YEREL_CLOUDFLARED_PATH = process.execPath;
    try {
      const api = new YerelApi(); await api.detectCloudflared();
      expect(api.snapshot().cloudflared).toMatchObject({ available: true, path: process.execPath });
    } finally { if (previous === undefined) delete process.env.YEREL_CLOUDFLARED_PATH; else process.env.YEREL_CLOUDFLARED_PATH = previous; }
  });
});
