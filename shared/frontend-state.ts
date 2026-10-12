import type { TunnelStatus } from './types';

export type CompanionStatus = Partial<TunnelStatus> & {
  id?: string;
  tunnelId?: string;
  error?: string;
};

export type CompanionResponse = CompanionStatus & {
  tunnel?: CompanionStatus;
  status?: CompanionStatus;
};

export type FrontendPhase = 'disconnected' | 'setup' | 'paired' | 'validating' | 'starting' | 'active' | 'stopping' | 'stopped' | 'error';

/** Flatten the companion's direct and legacy nested response shapes. */
export function normalizeCompanionStatus(value: CompanionResponse): CompanionStatus {
  const status = value.tunnel || value.status || value;
  return {
    ...status,
    id: status.id || status.tunnelId || value.id || value.tunnelId,
  };
}

/** Convert a backend state into the exact UI state shown by the workspace. */
export function phaseForCompanionStatus(value: CompanionStatus): FrontendPhase {
  switch (value.state?.toLowerCase()) {
    case 'active': return 'active';
    case 'starting': return 'starting';
    case 'stopping': return 'stopping';
    case 'validating': return 'validating';
    case 'error':
    case 'failed': return 'error';
    case 'stopped': return 'stopped';
    default: return 'paired';
  }
}
