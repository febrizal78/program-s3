import { EventEmitter } from 'node:events'
import { regionById } from '../shared/regions'
import {
  DEFAULT_SETTINGS,
  type ConnectionStatus,
  type DeviceView,
  type LogEntry,
  type SaveSettingsInput,
  type Schedule,
  type ScheduleAction,
  type Secrets,
  type Settings,
  type SettingsState
} from '../shared/types'
import { DeviceManager, type CloudApi } from './manager'
import { Scheduler } from './scheduler'
import { maskAccessId, type Store } from './store'
import { TuyaCloud } from './tuya/cloud'
import { LanDiscovery } from './tuya/local'
import { PulsarClient } from './tuya/pulsar'

const MAX_LOGS = 200

export interface ControllerOptions {
  /** Hanya untuk pengujian. */
  cloudFactory?: (secrets: Secrets, endpoint: string) => CloudApi & { getToken(force?: boolean): Promise<{ uid: string }> }
  discovery?: LanDiscovery | null
}

export function resolveEndpoint(settings: Settings): string {
  return settings.endpointOverride.trim() || regionById(settings.region).endpoint
}

export function resolvePulsarBase(settings: Settings): string {
  return settings.pulsarOverride.trim() || regionById(settings.region).pulsarWs
}

/** Validasi & normalisasi masukan pengaturan dari renderer. */
export function sanitizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (patch.region !== undefined) out.region = regionById(patch.region).id
  if (patch.endpointOverride !== undefined) {
    const v = patch.endpointOverride.trim().replace(/\/+$/, '')
    if (v && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) throw new Error('Endpoint harus berupa URL https, mis. https://openapi.tuyaeu.com')
    out.endpointOverride = v
  }
  if (patch.pulsarOverride !== undefined) {
    const v = patch.pulsarOverride.trim()
    if (v && !/^wss:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v)) throw new Error('Endpoint Message Service harus berupa wss://host:port/')
    out.pulsarOverride = v
  }
  if (patch.appUid !== undefined) out.appUid = patch.appUid.trim()
  if (patch.pollIntervalSec !== undefined) {
    const n = Math.round(Number(patch.pollIntervalSec))
    out.pollIntervalSec = Number.isFinite(n) ? Math.min(600, Math.max(5, n)) : DEFAULT_SETTINGS.pollIntervalSec
  }
  for (const k of ['lanEnabled', 'realtimeEnabled', 'closeToTray', 'launchAtLogin'] as const) {
    if (patch[k] !== undefined) out[k] = !!patch[k]
  }
  return out
}

/**
 * Perekat semua layanan: penyimpanan, klien cloud, LAN, realtime, penjadwal.
 * Tidak bergantung pada Electron sehingga mudah diuji.
 *
 * Event: `status` (ConnectionStatus), `log` (LogEntry), `device` (DeviceView),
 *        `devices` (DeviceView[]), `schedules` (Schedule[]), `settings` (Settings)
 */
export class AppController extends EventEmitter {
  readonly manager: DeviceManager
  readonly scheduler: Scheduler
  private cloud: (CloudApi & { getToken(force?: boolean): Promise<{ uid: string }> }) | null = null
  private discovery: LanDiscovery | null
  private pulsar?: PulsarClient
  private logs: LogEntry[] = []
  private status: ConnectionStatus = { cloud: 'unconfigured', realtime: 'off', lanDevices: 0 }
  private settings: Settings

  constructor(
    private readonly store: Store,
    private readonly opts: ControllerOptions = {}
  ) {
    super()
    this.settings = store.getSettings()
    this.discovery = opts.discovery === undefined ? new LanDiscovery() : opts.discovery

    this.manager = new DeviceManager({
      getCloud: () => this.cloud,
      getSettings: () => this.settings,
      store,
      discovery: this.discovery ?? undefined
    })
    this.manager.on('device', (d: DeviceView) => this.emit('device', d))
    this.manager.on('devices', (d: DeviceView[]) => this.emit('devices', d))
    this.manager.on('log', (e: { level: LogEntry['level']; message: string }) => this.log(e.level, e.message))
    this.manager.on('lan-count', (n: number) => this.setStatus({ lanDevices: n }))

    this.scheduler = new Scheduler(store.getSchedules(), (s) => store.saveSchedules(s), (action) => this.runAction(action))
    this.scheduler.on('changed', (s: Schedule[]) => this.emit('schedules', s))
    this.scheduler.on('log', (m: string) => this.log('info', m))

    if (this.discovery) {
      this.discovery.on('found', (f) => this.manager.onFound(f))
      this.discovery.on('warn', (m: string) => this.log('warn', m))
    }
  }

  // ───────────────────────── Siklus hidup ─────────────────────────

  start(): void {
    this.rebuildCloud()
    this.applyRuntime()
    this.scheduler.start()
    if (this.cloud) this.loadInBackground()
  }

  dispose(): void {
    this.scheduler.stop()
    this.manager.dispose()
    this.pulsar?.stop()
    this.discovery?.stop()
  }

  // ───────────────────────── Status & log ─────────────────────────

  getStatus(): ConnectionStatus {
    return this.status
  }

  private setStatus(patch: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  getLogs(): LogEntry[] {
    return this.logs
  }

  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { at: Date.now(), level, message }
    this.logs.push(entry)
    if (this.logs.length > MAX_LOGS) this.logs.shift()
    this.emit('log', entry)
  }

  // ───────────────────────── Pengaturan ─────────────────────────

  getSettings(): Settings {
    return this.settings
  }

  getSettingsState(): SettingsState {
    const secrets = this.store.getSecrets()
    return {
      settings: this.settings,
      hasCredentials: !!secrets,
      accessIdMasked: secrets ? maskAccessId(secrets.accessId) : '',
      secretsEncrypted: this.store.secretsEncrypted()
    }
  }

  saveSettings(input: SaveSettingsInput): SettingsState {
    const clean = sanitizeSettings(input.settings)
    const before = this.settings
    this.settings = this.store.saveSettings(clean)

    let credentialsChanged = false
    if (input.clearCredentials) {
      this.store.saveSecrets(null)
      credentialsChanged = true
    } else if (input.credentials) {
      const { accessId, accessSecret } = input.credentials
      if (!accessId.trim() || !accessSecret.trim()) throw new Error('Access ID dan Access Secret wajib diisi')
      this.store.saveSecrets({ accessId: accessId.trim(), accessSecret: accessSecret.trim() })
      credentialsChanged = true
    }

    const cloudChanged =
      credentialsChanged ||
      before.region !== this.settings.region ||
      before.endpointOverride !== this.settings.endpointOverride ||
      before.appUid !== this.settings.appUid

    if (cloudChanged) {
      this.rebuildCloud()
      if (this.cloud) this.loadInBackground(true)
      else this.emit('devices', [])
    }
    this.applyRuntime()
    this.emit('settings', this.settings)
    return this.getSettingsState()
  }

  async testCloud(input?: { credentials?: Secrets; settings?: Partial<Settings> }): Promise<{ ok: boolean; message: string }> {
    const settings = { ...this.settings, ...sanitizeSettings(input?.settings ?? {}) }
    const secrets = input?.credentials?.accessId ? input.credentials : this.store.getSecrets()
    if (!secrets) return { ok: false, message: 'Isi Access ID dan Access Secret terlebih dahulu.' }
    try {
      const cloud = this.makeCloud(secrets, resolveEndpoint(settings))
      await cloud.getToken(true)
      return { ok: true, message: 'Berhasil terhubung ke Tuya Cloud.' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  // ───────────────────────── Internal ─────────────────────────

  private makeCloud(secrets: Secrets, endpoint: string): NonNullable<AppController['cloud']> {
    if (this.opts.cloudFactory) return this.opts.cloudFactory(secrets, endpoint)
    return new TuyaCloud({ accessId: secrets.accessId, accessSecret: secrets.accessSecret, endpoint })
  }

  private rebuildCloud(): void {
    this.manager.stopPolling()
    const secrets = this.store.getSecrets()
    if (!secrets) {
      this.cloud = null
      this.setStatus({ cloud: 'unconfigured', cloudMessage: undefined })
      return
    }
    this.cloud = this.makeCloud(secrets, resolveEndpoint(this.settings))
    this.setStatus({ cloud: 'connecting', cloudMessage: undefined })
  }

  /** Terapkan pengaturan yang memengaruhi LAN & realtime tanpa memuat ulang cloud. */
  private applyRuntime(): void {
    // LAN
    if (this.settings.lanEnabled && this.discovery) {
      this.discovery.start()
      this.manager.syncLan()
    } else {
      this.discovery?.stop()
      this.manager.stopLan()
    }

    // Realtime (Message Service)
    this.pulsar?.stop()
    this.pulsar = undefined
    this.manager.setRealtimeActive(false)
    const secrets = this.store.getSecrets()
    const wsBase = resolvePulsarBase(this.settings)
    if (this.settings.realtimeEnabled && secrets) {
      if (!wsBase) {
        this.setStatus({ realtime: 'error', realtimeMessage: 'Endpoint Message Service untuk wilayah ini belum diketahui. Isi manual di Pengaturan.' })
      } else {
        const client = new PulsarClient({ accessId: secrets.accessId, accessKey: secrets.accessSecret, wsBase })
        client.on('event', (ev) => this.manager.handleRealtime(ev))
        client.on('state', (s: string) => {
          const map: Record<string, ConnectionStatus['realtime']> = { connecting: 'connecting', connected: 'connected', error: 'error', stopped: 'off' }
          this.manager.setRealtimeActive(s === 'connected')
          this.setStatus({ realtime: map[s] ?? 'off', realtimeMessage: undefined })
        })
        client.on('warn', (m: string) => {
          this.log('warn', m)
          this.setStatus({ realtimeMessage: m })
        })
        this.pulsar = client
        client.start()
      }
    } else {
      this.setStatus({ realtime: 'off', realtimeMessage: undefined })
    }
  }

  /** Muat perangkat tanpa menunggu; kegagalan sudah dicatat ke status & log oleh `loadDevices`. */
  private loadInBackground(force = false): void {
    this.loadDevices(force).catch(() => undefined)
  }

  async loadDevices(force = false): Promise<DeviceView[]> {
    if (!this.cloud) throw new Error('Kredensial cloud belum diisi. Buka Pengaturan.')
    this.setStatus({ cloud: 'connecting', cloudMessage: undefined })
    try {
      const devices = await this.manager.refresh({ force })
      this.setStatus({ cloud: 'ok', cloudMessage: undefined })
      this.manager.startPolling()
      this.log('info', `${devices.length} perangkat dimuat`)
      return devices
    } catch (err) {
      const message = (err as Error).message
      this.setStatus({ cloud: 'error', cloudMessage: message })
      this.log('error', `Gagal memuat perangkat: ${message}`)
      throw err
    }
  }

  private async runAction(action: ScheduleAction): Promise<void> {
    if (action.type === 'dp') await this.manager.setDps(action.deviceId, action.values)
    else await this.manager.triggerScene(action.homeId, action.sceneId)
  }
}
