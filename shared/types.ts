export type SessionState = 'idle' | 'validating' | 'starting' | 'active' | 'stopping' | 'error' | 'stopped';
export interface LocalTarget { url: string; port: number; protocol: 'http' | 'https'; host: string; }
export interface TunnelStatus { state: SessionState; url?: string; pid?: number; error?: string; startedAt?: string; target?: LocalTarget; }
