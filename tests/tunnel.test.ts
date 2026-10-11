import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { CloudflaredTunnel, parseTunnelUrl } from '../server/tunnel';
import { validateLocalTarget } from '../shared/target';
describe('cloudflared output', () => {
  it('extracts only a real Quick Tunnel URL', () => {
    expect(parseTunnelUrl('2024-01-01 INF https://bright-tree.trycloudflare.com')).toBe('https://bright-tree.trycloudflare.com');
    expect(parseTunnelUrl('no public endpoint yet')).toBeUndefined();
    expect(parseTunnelUrl('https://bright-tree.trycloudflare.com.evil.test')).toBeUndefined();
    expect(parseTunnelUrl('https://bright-tree.trycloudflare.com')).toBe('https://bright-tree.trycloudflare.com');
  });
});

it('starts and stops cleanly with a fake cloudflared process', async () => {
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const fake = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number; killed: boolean; kill: () => void };
  fake.stdout = new EventEmitter(); fake.stderr = new EventEmitter(); fake.pid = 42; fake.killed = false;
  fake.kill = () => { fake.killed = true; fake.emit('exit', 0); };
  const tunnel = new CloudflaredTunnel('fake', (() => fake) as never);
  const started = tunnel.start(validateLocalTarget(`http://127.0.0.1:${port}`));
  for (let attempt = 0; attempt < 100 && fake.stderr.listenerCount('data') === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  fake.stderr.emit('data', Buffer.from('https://bright-tree.trycloudflare.com\n'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(tunnel.status().state).toBe('starting');
  fake.stderr.emit('data', Buffer.from('Registered tunnel connection\n'));
  await expect(started).resolves.toMatchObject({ state: 'active', pid: 42 });
  await expect(tunnel.stop()).resolves.toMatchObject({ state: 'stopped' });
  expect(fake.killed).toBe(true);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
