import { EventEmitter } from 'node:events'
import { createDecipheriv, createHash } from 'node:crypto'
import WebSocket from 'ws'

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex')

/**
 * Kata sandi WebSocket Message Service: `md5(accessId + md5(accessKey))[8..24]`.
 * CATATAN: diturunkan dari implementasi SDK Tuya yang diketahui; belum diverifikasi
 * terhadap server sungguhan dari lingkungan pengembangan ini.
 */
export function derivePulsarPassword(accessId: string, accessKey: string): string {
  return md5(accessId + md5(accessKey)).slice(8, 24)
}

export function buildPulsarUrl(wsBase: string, accessId: string): string {
  const base = wsBase.endsWith('/') ? wsBase : wsBase + '/'
  return `${base}ws/v2/consumer/persistent/${accessId}/out/event/${accessId}-sub?ackTimeoutMillis=3000&subscriptionType=Failover`
}

/** `data` pesan dienkripsi AES-128-ECB (base64) dengan kunci = accessKey[8..24]. */
export function decryptPulsarData(dataB64: string, accessKey: string): string {
  const key = Buffer.from(accessKey.slice(8, 24), 'utf8')
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

export interface PulsarEvent {
  devId: string
  /** Laporan status DP (format cloud). */
  status?: Array<{ code: string; value: unknown }>
  /** `online` / `offline` untuk perubahan keberadaan perangkat. */
  bizCode?: string
}

/** Urai satu frame WebSocket dari server menjadi event perangkat (atau null jika bukan data). */
export function decodePulsarFrame(frame: string, accessKey: string): { messageId: string; event: PulsarEvent | null } | null {
  let msg: { messageId?: string; payload?: string }
  try {
    msg = JSON.parse(frame)
  } catch {
    return null
  }
  if (!msg.messageId) return null
  if (!msg.payload) return { messageId: msg.messageId, event: null }
  try {
    const payload = JSON.parse(Buffer.from(msg.payload, 'base64').toString('utf8')) as { data?: string }
    if (!payload.data) return { messageId: msg.messageId, event: null }
    const data = JSON.parse(decryptPulsarData(payload.data, accessKey)) as PulsarEvent & { bizData?: unknown }
    if (!data.devId) return { messageId: msg.messageId, event: null }
    return { messageId: msg.messageId, event: { devId: data.devId, status: data.status, bizCode: data.bizCode } }
  } catch {
    return { messageId: msg.messageId, event: null }
  }
}

export interface PulsarOptions {
  accessId: string
  accessKey: string
  wsBase: string
  /** Hanya untuk pengujian. */
  createSocket?: (url: string, headers: Record<string, string>) => WebSocket
  reconnectMs?: number
}

/**
 * Klien Tuya Message Service (Pulsar lewat WebSocket) untuk push status realtime.
 * Event: `event` (PulsarEvent), `state` ('connecting'|'connected'|'error'|'stopped'), `warn` (string)
 */
export class PulsarClient extends EventEmitter {
  private ws?: WebSocket
  private stopped = true
  private timer?: ReturnType<typeof setTimeout>
  private attempts = 0

  constructor(private readonly opts: PulsarOptions) {
    super()
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempts = 0
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const ws = this.ws
    this.ws = undefined
    if (ws) {
      ws.removeAllListeners()
      ws.on('error', () => undefined)
      try {
        ws.close()
      } catch {
        /* abaikan */
      }
    }
    this.emit('state', 'stopped')
  }

  private open(): void {
    this.emit('state', 'connecting')
    const url = buildPulsarUrl(this.opts.wsBase, this.opts.accessId)
    const headers = {
      Connection: 'Upgrade',
      username: this.opts.accessId,
      password: derivePulsarPassword(this.opts.accessId, this.opts.accessKey)
    }
    const ws = this.opts.createSocket ? this.opts.createSocket(url, headers) : new WebSocket(url, { headers })
    this.ws = ws

    ws.on('open', () => {
      this.attempts = 0
      this.emit('state', 'connected')
    })
    ws.on('message', (raw: WebSocket.RawData) => {
      const decoded = decodePulsarFrame(raw.toString(), this.opts.accessKey)
      if (!decoded) return
      // Konfirmasi (ack) agar pesan tidak dikirim ulang.
      try {
        ws.send(JSON.stringify({ messageId: decoded.messageId }))
      } catch {
        /* koneksi mungkin sedang tutup */
      }
      if (decoded.event) this.emit('event', decoded.event)
    })
    ws.on('unexpected-response', (_req, res) => {
      this.emit('warn', `Message Service menolak koneksi (HTTP ${res.statusCode}). Pastikan layanan Message Service aktif di proyek cloud.`)
    })
    ws.on('error', (err: Error) => {
      this.emit('warn', `Message Service: ${err.message}`)
    })
    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = undefined
      if (this.stopped) return
      this.emit('state', 'error')
      this.attempts += 1
      const base = this.opts.reconnectMs ?? 5_000
      const delay = Math.min(base * 2 ** Math.min(this.attempts - 1, 5), 120_000)
      this.timer = setTimeout(() => {
        this.timer = undefined
        if (!this.stopped) this.open()
      }, delay)
    })
  }
}
