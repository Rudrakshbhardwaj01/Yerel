import { describe, expect, it } from 'vitest';
import process from 'node:process';
import { createCompanion, parseArgs, startForeground } from '../cli';
import type { LocalTarget, TunnelStatus } from '../shared/types';

describe('CLI parsing', () => {
  it('accepts a positional local target', () => {
    expect(parseArgs(['http://127.0.0.1:5173']).target).toBe('http://127.0.0.1:5173');
  });

  it('rejects unknown options and multiple targets', () => {
    expect(() => parseArgs(['--wat'])).toThrow('Unknown option');
    expect(() => parseArgs(['http://127.0.0.1:5173', 'http://127.0.0.1:5174'])).toThrow('Unexpected argument');
  });
});

class FakeTunnel {
  value: TunnelStatus = { state: 'idle' };
  listeners = new Set<(status: TunnelStatus) => void>();
  stopped = false;
  status() { return this.value; }
  onChange(listener: (status: TunnelStatus) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async start(target: LocalTarget) {
    this.value = { state: 'active', target, url: 'https://example.trycloudflare.com' };
    this.listeners.forEach((listener) => listener(this.value));
    return this.value;
  }
  async stop() { this.stopped = true; this.value = { state: 'stopped' }; this.listeners.forEach((listener) => listener(this.value)); return this.value; }
}

describe('foreground CLI', () => {
  it('prints target, status, and public URL, then cleans up on shutdown', async () => {
    const tunnel = new FakeTunnel();
    const output: string[] = [];
    const session = startForeground(['http://127.0.0.1:5173'], process.env, {
      executablePath: process.execPath,
      tunnel,
      log: (message) => output.push(message),
      errorLog: (message) => output.push(`error: ${message}`),
    });
    await session.ready;
    expect(output).toEqual(expect.arrayContaining([
      'Target: http://127.0.0.1:5173',
      'Status: active',
      'Public URL: https://example.trycloudflare.com',
    ]));
    await session.shutdown();
    await session.done;
    expect(tunnel.stopped).toBe(true);
    expect(output).toContain('Status: stopped');
  });

  it('fails before starting when the target is not local', () => {
    expect(() => startForeground(['https://example.com'], process.env, { executablePath: process.execPath, tunnel: new FakeTunnel() })).toThrow('localhost');
  });

  it('reports executable launch errors', async () => {
    const session = startForeground(['http://127.0.0.1:5173'], process.env, { executablePath: 'C:/missing/cloudflared.exe' });
    await expect(session.ready).rejects.toThrow('cloudflared was found');
  });
});

describe('companion API', () => {
  it('protects status, enforces origin and runs one tunnel lifecycle', async () => {
    const tunnel = new FakeTunnel();
    const companion = createCompanion({ port: 0, token: 'test-token', tunnel, origins: ['http://allowed.test'], log: () => {} });
    const { port } = await companion.ready;
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      expect((await fetch(`${endpoint}/health`)).status).toBe(200);
      expect((await fetch(`${endpoint}/status`)).status).toBe(401);
      expect((await fetch(`${endpoint}/status`, { headers: { authorization: 'Bearer test-token', origin: 'http://blocked.test' } })).status).toBe(403);
      const start = await fetch(`${endpoint}/tunnels`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', origin: 'http://allowed.test' }, body: JSON.stringify({ url: 'http://127.0.0.1:5173', consent: true }) });
      expect(start.status).toBe(201);
      expect((await fetch(`${endpoint}/tunnels`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:5174', consent: true }) })).status).toBe(409);
      expect((await fetch(`${endpoint}/tunnels/tunnel-1`, { method: 'DELETE', headers: { authorization: 'Bearer test-token' } })).status).toBe(200);
      expect(tunnel.stopped).toBe(true);
    } finally { await companion.close(); }
  });

  it('exchanges a pairing token and rejects unsafe starts', async () => {
    const companion = createCompanion({ port: 0, token: 'pair-token', tunnel: new FakeTunnel(), log: () => {} });
    const { port } = await companion.ready;
    try {
      const pair = await fetch(`http://127.0.0.1:${port}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'pair-token' }) });
      expect(pair.status).toBe(200);
      const unsafe = await fetch(`http://127.0.0.1:${port}/tunnels`, { method: 'POST', headers: { authorization: 'Bearer pair-token', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com', consent: true }) });
      expect(unsafe.status).toBe(400);
    } finally { await companion.close(); }
  });

  it('allows the default local website origins when no origin flag is supplied', async () => {
    const companion = createCompanion({ port: 0, token: 'default-origin-token', tunnel: new FakeTunnel(), log: () => {} });
    const { port } = await companion.ready;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { headers: { authorization: 'Bearer default-origin-token', origin: 'http://127.0.0.1:3000' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3000');
    } finally { await companion.close(); }
  });

  it('supports an allowed production-origin private-network preflight', async () => {
    const companion = createCompanion({ port: 0, token: 'production-origin-token', tunnel: new FakeTunnel(), origins: ['https://tryyerel.vercel.app'], log: () => {} });
    const { port } = await companion.ready;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://tryyerel.vercel.app',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
          'access-control-request-private-network': 'true',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('https://tryyerel.vercel.app');
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
      expect(response.headers.get('access-control-allow-private-network')).toBe('true');
    } finally { await companion.close(); }
  });

  it('denies a production-origin preflight from an origin that is not allowlisted', async () => {
    const companion = createCompanion({ port: 0, token: 'denied-production-token', tunnel: new FakeTunnel(), origins: ['https://tryyerel.vercel.app'], log: () => {} });
    const { port } = await companion.ready;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-private-network')).toBeNull();
    } finally { await companion.close(); }
  });

  it('allows authenticated production-origin status after the preflight contract', async () => {
    const companion = createCompanion({ port: 0, token: 'production-status-token', tunnel: new FakeTunnel(), origins: ['https://tryyerel.vercel.app'], log: () => {} });
    const { port } = await companion.ready;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { headers: { origin: 'https://tryyerel.vercel.app', authorization: 'Bearer production-status-token' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('https://tryyerel.vercel.app');
    } finally { await companion.close(); }
  });
});
