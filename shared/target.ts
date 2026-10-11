import type { LocalTarget } from './types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export function validateLocalTarget(value: unknown, controlPort?: number): LocalTarget {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a local URL first.');
  const input = value.trim();
  let parsed: URL;
  try { parsed = new URL(input.includes('://') ? input : `http://${input}`); } catch { throw new Error('Enter a valid local HTTP URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS targets are supported.');
  if (parsed.username || parsed.password) throw new Error('Credentials are not allowed in local URLs.');
  if (parsed.hash) throw new Error('URL fragments are not allowed.');
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error('For safety, the target must point to localhost.');
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port must be between 1 and 65535.');
  if (controlPort && port === controlPort && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) throw new Error('Yerel cannot share its own control port.');
  return { url: parsed.toString().replace(/\/$/, ''), port, protocol: parsed.protocol.slice(0, -1) as 'http' | 'https', host: parsed.hostname };
}
