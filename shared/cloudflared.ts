import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

export type ExecutableEnvironment = { PATH?: string; PATHEXT?: string };

export function resolveCloudflaredExecutable(command = process.env.YEREL_CLOUDFLARED_PATH || 'cloudflared', env: ExecutableEnvironment = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT }, platform = process.platform): string | undefined {
  const value = command.trim();
  if (!value) return undefined;
  const windows = platform === 'win32';
  const hasPath = path.isAbsolute(value) || value.includes('/') || value.includes('\\');
  const extensions = windows ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (candidate: string) => !windows || path.extname(candidate) ? [candidate] : extensions.map((extension) => `${candidate}${extension}`);
  const locations = hasPath ? [''] : (env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const location of locations) {
    for (const candidate of candidates(hasPath ? value : path.join(location, value))) {
      try { accessSync(candidate, fsConstants.F_OK); return path.resolve(candidate); } catch { /* keep searching */ }
    }
  }
  return undefined;
}
