import { randomUUID } from 'node:crypto'
import { canonicalUrl, signRequest, type QueryValue } from './sign'

export class TuyaApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'TuyaApiError'
  }
}

/** Pesan yang lebih ramah untuk kode error yang umum. */
export function explainError(code: number | string, msg: string): string {
  switch (String(code)) {
    case '1004':
      return 'Tanda tangan ditolak (sign invalid). Periksa Access ID/Secret dan pastikan wilayah (data center) sama dengan proyek di iot.tuya.com.'
    case '1106':
      return 'Izin ditolak (permission deny). Pastikan akun aplikasi sudah ditautkan ke proyek cloud dan API yang dibutuhkan sudah di-subscribe.'
    case '1010':
    case '1011':
      return 'Token tidak valid atau kedaluwarsa.'
    case '2406':
      return 'Proyek belum diberi izin untuk API ini. Cek layanan API yang di-subscribe di proyek cloud.'
    default:
      return `${msg} (kode ${code})`
  }
}

export interface CloudOptions {
  accessId: string
  accessSecret: string
  endpoint: string
  fetchImpl?: typeof fetch
  /** Hanya untuk pengujian. */
  now?: () => number
  nonce?: () => string
  timeoutMs?: number
}

interface TokenInfo {
  access: string
  uid: string
  /** epoch ms */
  expiresAt: number
}

interface Envelope<T> {
  success: boolean
  result?: T
  code?: number | string
  msg?: string
  t?: number
}

// ───────────────────────── Tipe respons ─────────────────────────

export interface CloudDevice {
  id: string
  name: string
  category: string
  product_name?: string
  online?: boolean
  local_key?: string
  uid?: string
  owner_id?: string
  uuid?: string
  sub?: boolean
  ip?: string
}

export interface CloudSpecItem {
  code: string
  type: string
  values: string
  name?: string
  desc?: string
}

export interface CloudSpecs {
  category?: string
  functions?: CloudSpecItem[]
  status?: CloudSpecItem[]
}

export interface CloudStatusItem {
  code: string
  value: unknown
}

export interface CloudHome {
  home_id: number | string
  name: string
}

export interface CloudScene {
  scene_id: string
  name: string
  enabled?: boolean
}

export interface CloudProperty {
  code: string
  dp_id: number
  value?: unknown
  type?: string
}

// ───────────────────────── Klien ─────────────────────────

export class TuyaCloud {
  private token?: TokenInfo
  private tokenPending?: Promise<TokenInfo>
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly nonce: () => string

  constructor(private readonly opts: CloudOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.now = opts.now ?? Date.now
    this.nonce = opts.nonce ?? randomUUID
  }

  get endpoint(): string {
    return this.opts.endpoint.replace(/\/+$/, '')
  }

  // ── Token ──

  async getToken(force = false): Promise<TokenInfo> {
    if (!force && this.token && this.token.expiresAt - this.now() > 60_000) return this.token
    this.tokenPending ??= this.fetchToken().finally(() => {
      this.tokenPending = undefined
    })
    return this.tokenPending
  }

  private async fetchToken(): Promise<TokenInfo> {
    const result = await this.send<{ access_token: string; expire_time: number; uid?: string }>(
      'GET',
      '/v1.0/token',
      { query: { grant_type: 1 } }
    )
    this.token = {
      access: result.access_token,
      uid: result.uid ?? '',
      expiresAt: this.now() + result.expire_time * 1000
    }
    return this.token
  }

  // ── Request umum ──

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<T> {
    let token = await this.getToken()
    try {
      return await this.send<T>(method, path, opts, token.access)
    } catch (err) {
      if (err instanceof TuyaApiError && (err.code === 1010 || err.code === 1011)) {
        token = await this.getToken(true)
        return this.send<T>(method, path, opts, token.access)
      }
      throw err
    }
  }

  private async send<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: unknown },
    accessToken?: string
  ): Promise<T> {
    const url = canonicalUrl(path, opts.query)
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const t = String(this.now())
    const nonce = this.nonce()
    const sign = signRequest({
      clientId: this.opts.accessId,
      secret: this.opts.accessSecret,
      accessToken,
      t,
      nonce,
      method,
      url,
      body
    })
    const headers: Record<string, string> = {
      client_id: this.opts.accessId,
      sign,
      t,
      nonce,
      sign_method: 'HMAC-SHA256',
      'Content-Type': 'application/json'
    }
    if (accessToken) headers.access_token = accessToken

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000)
    let res: Response
    try {
      res = await this.fetchImpl(this.endpoint + url, { method, headers, body, signal: controller.signal })
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'AbortError' ? 'waktu habis' : err.message) : String(err)
      throw new TuyaApiError('network', `Tidak dapat menghubungi server Tuya: ${reason}`)
    } finally {
      clearTimeout(timer)
    }

    let json: Envelope<T>
    try {
      json = (await res.json()) as Envelope<T>
    } catch {
      throw new TuyaApiError(res.status, `Respons tidak valid dari server Tuya (HTTP ${res.status})`, res.status)
    }
    if (!json.success) {
      const code = json.code ?? res.status
      throw new TuyaApiError(code, explainError(code, json.msg ?? 'Permintaan gagal'), res.status)
    }
    return json.result as T
  }

  // ───────────────────────── Perangkat ─────────────────────────

  /**
   * Daftar perangkat. Dengan `uid` akun aplikasi: `/v1.0/users/{uid}/devices`.
   * Tanpa `uid`: seluruh perangkat proyek lewat `/v2.0/cloud/thing/device` (berhalaman).
   */
  async listDevices(uid?: string): Promise<CloudDevice[]> {
    if (uid) {
      const result = await this.request<CloudDevice[] | { devices?: CloudDevice[] }>('GET', `/v1.0/users/${encodeURIComponent(uid)}/devices`)
      return Array.isArray(result) ? result : (result?.devices ?? [])
    }
    const pageSize = 20
    const all: CloudDevice[] = []
    const seen = new Set<string>()
    let lastId: string | undefined
    for (let page = 0; page < 50; page++) {
      const result = await this.request<unknown>('GET', '/v2.0/cloud/thing/device', {
        query: { page_size: pageSize, last_id: lastId }
      })
      const { items, next } = parseDevicePage(result)
      const fresh = items.filter((d) => d?.id && !seen.has(d.id))
      fresh.forEach((d) => seen.add(d.id))
      all.push(...fresh)
      if (items.length < pageSize || fresh.length === 0) break
      lastId = next ?? items[items.length - 1].id
    }
    return all
  }

  async getSpecifications(deviceId: string): Promise<CloudSpecs> {
    return this.request<CloudSpecs>('GET', `/v1.0/devices/${deviceId}/specifications`)
  }

  async getStatus(deviceId: string): Promise<CloudStatusItem[]> {
    return this.request<CloudStatusItem[]>('GET', `/v1.0/devices/${deviceId}/status`)
  }

  /** Status banyak perangkat sekaligus (maks. 20 id per panggilan). */
  async getStatusBatch(deviceIds: string[]): Promise<Array<{ id: string; status: CloudStatusItem[] }>> {
    const out: Array<{ id: string; status: CloudStatusItem[] }> = []
    for (let i = 0; i < deviceIds.length; i += 20) {
      const chunk = deviceIds.slice(i, i + 20)
      const result = await this.request<Array<{ id: string; status: CloudStatusItem[] }>>('GET', '/v1.0/devices/status', {
        query: { device_ids: chunk.join(',') }
      })
      out.push(...(result ?? []))
    }
    return out
  }

  /** Pemetaan kode DP ↔ nomor DP lokal (dibutuhkan untuk kontrol LAN). */
  async getDpProperties(deviceId: string): Promise<CloudProperty[]> {
    const result = await this.request<{ properties?: CloudProperty[] }>('GET', `/v2.0/cloud/thing/${deviceId}/shadow/properties`)
    return result?.properties ?? []
  }

  async sendCommands(deviceId: string, commands: Array<{ code: string; value: unknown }>): Promise<void> {
    await this.request<boolean>('POST', `/v1.0/devices/${deviceId}/commands`, { body: { commands } })
  }

  // ───────────────────────── Rumah & scene ─────────────────────────

  async listHomes(uid: string): Promise<CloudHome[]> {
    const result = await this.request<CloudHome[] | { homes?: CloudHome[] }>('GET', `/v1.0/users/${encodeURIComponent(uid)}/homes`)
    return Array.isArray(result) ? result : (result?.homes ?? [])
  }

  async listScenes(homeId: string): Promise<CloudScene[]> {
    const result = await this.request<CloudScene[] | { scenes?: CloudScene[] }>('GET', `/v1.1/homes/${encodeURIComponent(homeId)}/scenes`)
    return Array.isArray(result) ? result : (result?.scenes ?? [])
  }

  async triggerScene(homeId: string, sceneId: string): Promise<void> {
    await this.request<boolean>('POST', `/v1.0/homes/${encodeURIComponent(homeId)}/scenes/${encodeURIComponent(sceneId)}/trigger`)
  }
}

/** Bentuk respons halaman perangkat bisa berupa array atau objek berisi daftar. */
export function parseDevicePage(result: unknown): { items: CloudDevice[]; next?: string } {
  if (Array.isArray(result)) return { items: result as CloudDevice[] }
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    const list = (obj.list ?? obj.devices ?? obj.data) as CloudDevice[] | undefined
    const next = (obj.last_id ?? obj.last_row_key) as string | undefined
    if (Array.isArray(list)) return { items: list, next: next || undefined }
  }
  return { items: [] }
}
