export type SessionState = 'idle' | 'validating' | 'starting' | 'active' | 'stopping' | 'error' | 'stopped';
export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';
export interface LocalTarget { url: string; port: number; protocol: 'http' | 'https'; host: string; }
export interface TunnelStatus { state: SessionState; url?: string; pid?: number; error?: string; startedAt?: string; target?: LocalTarget; }
export interface ActivityEvent { id: string; at: string; level: ActivityLevel; message: string; detail?: string; }
export interface DesktopSnapshot { tunnel: TunnelStatus; activity: ActivityEvent[]; cloudflared: { available: boolean; path?: string; version?: string; error?: string; }; }
export type TargetApiResponse = { ok: true; target: LocalTarget } | { ok: false; error: string };
export interface SessionRequest { url: string; }
