import { EventEmitter } from 'node:events'
import dgram from 'node:dgram'
import TuyAPI from 'tuyapi'
// Parser paket & kunci UDP yang sama dengan yang dipakai tuyapi untuk `find()`.
import parserModule from 'tuyapi/lib/message-parser'
import configModule from 'tuyapi/lib/config'

const { MessageParser } = parserModule
const { UDP_KEY } = configModule

// ───────────────────────── Discovery ─────────────────────────

export interface FoundDevice {
  id: string
  ip: string
  version: string
}

/** Dekode satu paket broadcast Tuya (port 6666/6667) menjadi {id, ip, version}. */
export function parseBroadcast(message: Buffer): FoundDevice | null {
  try {
    const parser = new MessageParser({ key: UDP_KEY, version: '3.1' })
    const packet = parser.parse(message)[0]
    const payload = packet?.payload as { gwId?: string; ip?: string; version?: string | number } | string | undefined
    if (!payload || typeof payload === 'string') return null
    if (!payload.gwId || !payload.ip) return null
    return { id: payload.gwId, ip: payload.ip, version: String(payload.version ?? '3.3') }
  } catch {
    return null
  }
}

/**
 * Mendengarkan broadcast UDP perangkat Tuya di jaringan lokal.
 * Perangkat memancarkan paket tiap beberapa detik; kita simpan IP & versi protokolnya.
 */
export class LanDiscovery extends EventEmitter {
  private sockets: dgram.Socket[] = []
  private readonly found = new Map<string, FoundDevice>()

  get(id: string): FoundDevice | undefined {
    return this.found.get(id)
  }

  start(): void {
    if (this.sockets.length > 0) return
    // 6666 = tanpa enkripsi (v3.1), 6667 = terenkripsi (v3.3+), 7000 = v3.5.
    for (const port of [6666, 6667, 7000]) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      socket.on('message', (msg) => {
        const dev = parseBroadcast(msg)
        if (!dev) return
        const prev = this.found.get(dev.id)
        this.found.set(dev.id, dev)
        if (!prev || prev.ip !== dev.ip || prev.version !== dev.version) this.emit('found', dev)
      })
      socket.on('error', (err) => {
        this.emit('warn', `Discovery UDP port ${port}: ${err.message}`)
        try {
          socket.close()
        } catch {
          /* sudah tertutup */
        }
      })
      try {
        socket.bind(port)
        this.sockets.push(socket)
      } catch (err) {
        this.emit('warn', `Tidak bisa membuka UDP port ${port}: ${(err as Error).message}`)
      }
    }
  }

  stop(): void {
    for (const s of this.sockets) {
      try {
        s.close()
      } catch {
        /* abaikan */
      }
    }
    this.sockets = []
    this.found.clear()
  }
}

// ───────────────────────── Koneksi per perangkat ─────────────────────────

export interface LanTarget {
  id: string
  key: string
  ip: string
  version: string
}

/** Subset TuyAPI yang kita pakai — memudahkan pengujian dengan objek tiruan. */
export interface TuyaSocket extends EventEmitter {
  connect(): Promise<boolean>
  disconnect(): void
  isConnected(): boolean
  get(opts: { schema?: boolean }): Promise<unknown>
  set(opts: { multiple: true; data: Record<string, unknown>; shouldWaitForResponse?: boolean }): Promise<unknown>
}

export type SocketFactory = (target: LanTarget) => TuyaSocket

export const defaultSocketFactory: SocketFactory = (t) =>
  new TuyAPI({
    id: t.id,
    key: t.key,
    ip: t.ip,
    version: t.version,
    issueGetOnConnect: true,
    issueRefreshOnConnect: true
  }) as unknown as TuyaSocket

type Timer = ReturnType<typeof setTimeout>

export interface LanLinkOptions {
  factory?: SocketFactory
  minBackoffMs?: number
  maxBackoffMs?: number
  setTimeoutFn?: (fn: () => void, ms: number) => Timer
  clearTimeoutFn?: (t: Timer) => void
}

/**
 * Menjaga satu koneksi TCP ke perangkat: connect, reconnect dengan backoff,
 * meneruskan perubahan DP, dan mengirim perintah.
 *
 * Event: `dps` (Record<string, unknown> — kunci = nomor DP), `state` ('connecting'|'connected'|'disconnected'), `warn` (string)
 */
export class LanLink extends EventEmitter {
  private socket?: TuyaSocket
  private stopped = true
  private backoff: number
  private timer?: Timer
  private connected = false
  private readonly factory: SocketFactory
  private readonly minBackoff: number
  private readonly maxBackoff: number
  private readonly setT: (fn: () => void, ms: number) => Timer
  private readonly clearT: (t: Timer) => void

  constructor(
    private target: LanTarget,
    opts: LanLinkOptions = {}
  ) {
    super()
    this.factory = opts.factory ?? defaultSocketFactory
    this.minBackoff = opts.minBackoffMs ?? 2_000
    this.maxBackoff = opts.maxBackoffMs ?? 60_000
    this.backoff = this.minBackoff
    this.setT = opts.setTimeoutFn ?? setTimeout
    this.clearT = opts.clearTimeoutFn ?? clearTimeout
  }

  get isConnected(): boolean {
    return this.connected
  }

  get currentTarget(): LanTarget {
    return this.target
  }

  /** Perbarui IP/kunci/versi; jika berubah, sambung ulang. */
  update(target: LanTarget): void {
    const changed = target.ip !== this.target.ip || target.key !== this.target.key || target.version !== this.target.version
    this.target = target
    if (changed && !this.stopped) {
      this.teardown()
      void this.connect()
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.backoff = this.minBackoff
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) this.clearT(this.timer)
    this.timer = undefined
    this.teardown()
  }

  private teardown(): void {
    const socket = this.socket
    this.socket = undefined
    const wasConnected = this.connected
    this.connected = false
    if (socket) {
      socket.removeAllListeners()
      // Hindari crash karena event 'error' tanpa listener setelah dilepas.
      socket.on('error', () => undefined)
      try {
        socket.disconnect()
      } catch {
        /* abaikan */
      }
    }
    if (wasConnected) this.emit('state', 'disconnected')
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return
    this.emit('state', 'connecting')
    let socket: TuyaSocket
    try {
      socket = this.factory(this.target)
    } catch (err) {
      // mis. kunci/ID tidak valid — jangan sampai menjadi unhandled rejection.
      this.emit('warn', `LAN ${this.target.id}: tidak bisa membuat koneksi: ${(err as Error).message}`)
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.on('data', (payload: { dps?: Record<string, unknown> }) => this.onData(payload))
    socket.on('dp-refresh', (payload: { dps?: Record<string, unknown> }) => this.onData(payload))
    socket.on('error', (err: Error) => this.emit('warn', `LAN ${this.target.id}: ${err.message}`))
    socket.on('disconnected', () => {
      if (this.socket !== socket) return
      this.teardown()
      this.scheduleReconnect()
    })

    try {
      await socket.connect()
      if (this.socket !== socket) return
      this.connected = true
      this.backoff = this.minBackoff
      this.emit('state', 'connected')
      try {
        const initial = (await socket.get({ schema: true })) as { dps?: Record<string, unknown> } | undefined
        if (initial && typeof initial === 'object') this.onData(initial)
      } catch (err) {
        this.emit('warn', `LAN ${this.target.id}: gagal membaca status awal: ${(err as Error).message}`)
      }
    } catch (err) {
      if (this.socket !== socket) return
      this.emit('warn', `LAN ${this.target.id}: gagal tersambung: ${(err as Error).message}`)
      this.teardown()
      this.scheduleReconnect()
    }
  }

  private onData(payload: { dps?: Record<string, unknown> } | undefined): void {
    if (payload && typeof payload === 'object' && payload.dps && typeof payload.dps === 'object') {
      this.emit('dps', payload.dps)
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff)
    this.timer = this.setT(() => {
      this.timer = undefined
      void this.connect()
    }, delay)
  }

  /** Kirim satu atau beberapa DP (kunci = nomor DP, nilai = format perangkat). */
  async setDps(dps: Record<string, unknown>): Promise<void> {
    if (!this.socket || !this.connected) throw new Error('Perangkat belum tersambung di LAN')
    await this.socket.set({ multiple: true, data: dps, shouldWaitForResponse: false })
  }
}
