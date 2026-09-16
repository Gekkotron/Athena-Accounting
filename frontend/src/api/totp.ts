import { api } from './client';

export interface TotpStatus {
  enabled: boolean;
  remainingRecoveryCodes: number;
}

export interface TotpEnrollResponse {
  secret: string;
  otpauthUrl: string;
}

export interface TotpRecoveryCodesResponse {
  recoveryCodes: string[];
}

export function getTotpStatus() {
  return api<TotpStatus>('/api/auth/2fa/status');
}

export function enrollTotp(password: string) {
  return api<TotpEnrollResponse>('/api/auth/2fa/enroll', {
    method: 'POST',
    json: { password },
  });
}

export function confirmTotp(code: string) {
  return api<TotpRecoveryCodesResponse>('/api/auth/2fa/confirm', {
    method: 'POST',
    json: { code },
  });
}

export function verifyTotp(code: string) {
  return api<{ user: { id: number; username: string } }>('/api/auth/2fa/verify', {
    method: 'POST',
    json: { code },
  });
}

export function disableTotp(input: { password: string; code: string }) {
  return api<{ ok: true }>('/api/auth/2fa/disable', {
    method: 'POST',
    json: input,
  });
}

export function regenerateRecoveryCodes(password: string) {
  return api<TotpRecoveryCodesResponse>('/api/auth/2fa/regenerate-codes', {
    method: 'POST',
    json: { password },
  });
}
