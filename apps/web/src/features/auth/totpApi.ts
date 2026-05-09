import { apiClient } from '@/lib/api/client'
import { type ApiEnvelope } from '@/lib/api/envelope'

/** Cycle 17 — TOTP-based 2FA. Endpoints under `/me/2fa`. */

export interface TotpSetupResponse {
  secret: string
  qr_uri: string
  backup_codes: string[]
  stage_token: string
  expires_in: number
}

/** POST /me/2fa/setup — stage a fresh secret + 8 backup codes. */
export async function setupTotp(password: string): Promise<TotpSetupResponse> {
  const res = await apiClient.post<ApiEnvelope<TotpSetupResponse>>(
    '/me/2fa/setup',
    { password },
  )
  const data = res.data?.data
  if (!data) throw new Error('서버 응답이 비어 있습니다.')
  return data
}

/** POST /me/2fa/verify — activate 2FA on the user. */
export async function verifyTotpSetup(
  stageToken: string,
  code: string,
): Promise<{ enabled: true }> {
  const res = await apiClient.post<ApiEnvelope<{ enabled: true }>>(
    '/me/2fa/verify',
    { stage_token: stageToken, code },
  )
  return res.data?.data ?? { enabled: true }
}

/** POST /me/2fa/disable — wipe 2FA. Requires password + a current code. */
export async function disableTotp(
  password: string,
  code: string,
): Promise<{ disabled: true }> {
  const res = await apiClient.post<ApiEnvelope<{ disabled: true }>>(
    '/me/2fa/disable',
    { password, code },
  )
  return res.data?.data ?? { disabled: true }
}

/** POST /me/2fa/regenerate-backup-codes — rotate the 8 backup codes. */
export async function regenerateBackupCodes(
  code: string,
): Promise<{ backup_codes: string[] }> {
  const res = await apiClient.post<ApiEnvelope<{ backup_codes: string[] }>>(
    '/me/2fa/regenerate-backup-codes',
    { code },
  )
  return res.data?.data ?? { backup_codes: [] }
}
