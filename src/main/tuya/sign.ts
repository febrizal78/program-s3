import { createHash, createHmac } from 'node:crypto'

/** SHA-256 dari string kosong — dipakai untuk request tanpa body. */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export type QueryValue = string | number | boolean | undefined | null

/** `path?k1=v1&k2=v2` dengan kunci terurut abjad (nilai tidak di-URL-encode, sesuai spesifikasi tanda tangan Tuya). */
export function canonicalUrl(path: string, query?: Record<string, QueryValue>): string {
  const entries = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (entries.length === 0) return path
  return `${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`
}

export function buildStringToSign(method: string, url: string, body?: string): string {
  const contentHash = body ? sha256Hex(body) : EMPTY_BODY_SHA256
  // Baris ke-3 = "Signature-Headers" opsional; kosong.
  return [method.toUpperCase(), contentHash, '', url].join('\n')
}

export interface SignInput {
  clientId: string
  secret: string
  /** Kosong untuk request pengambilan token. */
  accessToken?: string
  /** Timestamp milidetik (string). */
  t: string
  nonce: string
  method: string
  /** Hasil `canonicalUrl`. */
  url: string
  body?: string
}

/** HMAC-SHA256 (huruf besar) sesuai skema tanda tangan Tuya OpenAPI. */
export function signRequest(input: SignInput): string {
  const stringToSign = buildStringToSign(input.method, input.url, input.body)
  const message = input.clientId + (input.accessToken ?? '') + input.t + input.nonce + stringToSign
  return createHmac('sha256', input.secret).update(message, 'utf8').digest('hex').toUpperCase()
}
