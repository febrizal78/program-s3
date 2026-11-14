import type { RegionId } from './regions'

// ───────────────────────── Pengaturan ─────────────────────────

export interface Settings {
  region: RegionId
  /** Jika diisi, menggantikan endpoint bawaan wilayah. */
  endpointOverride: string
  /** UID akun aplikasi Tuya/Smart Life (opsional; dipakai untuk daftar rumah). */
  appUid: string
  /** Interval polling status via cloud (detik). */
  pollIntervalSec: number
  /** Aktifkan kontrol & status via jaringan lokal (LAN). */
  lanEnabled: boolean
  /** Aktifkan Tuya Message Service (push realtime, eksperimental). */
  realtimeEnabled: boolean
  /** Basis WebSocket Message Service; kosong = pakai bawaan wilayah. */
  pulsarOverride: string
  /** Tutup jendela = sembunyikan ke tray (jadwal tetap jalan). */
  closeToTray: boolean
  /** Jalankan otomatis saat Windows login. */
  launchAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  region: 'eu',
  endpointOverride: '',
  appUid: '',
  pollIntervalSec: 20,
  lanEnabled: true,
  realtimeEnabled: false,
  pulsarOverride: '',
  closeToTray: true,
  launchAtLogin: false
}

/** Kredensial proyek Tuya IoT Platform. Tidak pernah dikirim balik ke renderer. */
export interface Secrets {
  accessId: string
  accessSecret: string
}

export interface SettingsState {
  settings: Settings
  hasCredentials: boolean
  /** Access ID tersamar (mis. `abcd••••wxyz`) untuk ditampilkan di UI. */
  accessIdMasked: string
  /** false jika enkripsi OS tidak tersedia dan kredensial disimpan apa adanya. */
  secretsEncrypted: boolean
}

export interface SaveSettingsInput {
  settings: Partial<Settings>
  /** Isi hanya jika kredensial diganti. */
  credentials?: Secrets
  /** true = hapus kredensial tersimpan. */
  clearCredentials?: boolean
}

// ───────────────────────── Perangkat ─────────────────────────

export type DpType = 'boolean' | 'enum' | 'integer' | 'string' | 'json' | 'raw' | 'bitmap'

export interface DpSpec {
  code: string
  /** Nomor DP lokal (LAN), bila diketahui. */
  dpId?: number
  name?: string
  type: DpType
  /** rw = baca-tulis, ro = hanya baca, wo = hanya tulis. */
  mode: 'rw' | 'ro' | 'wo'
  range?: string[]
  min?: number
  max?: number
  step?: number
  scale?: number
  unit?: string
}

export type LanState = 'off' | 'searching' | 'connecting' | 'connected'

export interface DeviceView {
  id: string
  name: string
  category: string
  productName: string
  online: boolean
  homeId: string
  /** Nilai terkini per kode DP (format cloud). */
  status: Record<string, unknown>
  specs: DpSpec[]
  lan: LanState
  /** true jika perangkat bisa dikontrol lewat LAN saat ini. */
  lanReady: boolean
}

// ───────────────────────── Scene ─────────────────────────

export interface HomeInfo {
  id: string
  name: string
}

export interface SceneInfo {
  id: string
  homeId: string
  homeName: string
  name: string
  enabled: boolean
}

// ───────────────────────── Jadwal ─────────────────────────

export type ScheduleAction =
  | { type: 'dp'; deviceId: string; values: Record<string, unknown> }
  | { type: 'scene'; homeId: string; sceneId: string; sceneName?: string }

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  /** 'daily' = berulang tiap hari terpilih; 'once' = sekali pada `fireAt`. */
  kind: 'daily' | 'once'
  /** HH:MM (24 jam) — untuk kind 'daily'. */
  time: string
  /** 0 = Minggu … 6 = Sabtu — untuk kind 'daily'. */
  days: number[]
  /** Epoch ms — untuk kind 'once'. */
  fireAt?: number
  action: ScheduleAction
  lastRunAt?: number
  lastResult?: string
}

// ───────────────────────── Status koneksi ─────────────────────────

export interface ConnectionStatus {
  cloud: 'unconfigured' | 'connecting' | 'ok' | 'error'
  cloudMessage?: string
  realtime: 'off' | 'connecting' | 'connected' | 'error'
  realtimeMessage?: string
  lanDevices: number
}

export interface LogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

// ───────────────────────── API jembatan (preload) ─────────────────────────

export interface TuyaBridge {
  getSettings(): Promise<SettingsState>
  saveSettings(input: SaveSettingsInput): Promise<SettingsState>
  testCloud(input?: { credentials?: Secrets; settings?: Partial<Settings> }): Promise<{ ok: boolean; message: string }>

  listDevices(): Promise<DeviceView[]>
  refreshDevices(): Promise<DeviceView[]>
  setDp(deviceId: string, values: Record<string, unknown>): Promise<{ via: 'lan' | 'cloud' }>

  listScenes(): Promise<{ scenes: SceneInfo[]; message?: string }>
  triggerScene(homeId: string, sceneId: string): Promise<void>

  listSchedules(): Promise<Schedule[]>
  saveSchedule(schedule: Schedule): Promise<Schedule[]>
  deleteSchedule(id: string): Promise<Schedule[]>

  getStatus(): Promise<ConnectionStatus>
  getLogs(): Promise<LogEntry[]>

  onDevice(cb: (device: DeviceView) => void): () => void
  onDevices(cb: (devices: DeviceView[]) => void): () => void
  onStatus(cb: (status: ConnectionStatus) => void): () => void
  onSchedules(cb: (schedules: Schedule[]) => void): () => void
  onLog(cb: (entry: LogEntry) => void): () => void
}

export const IPC = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  testCloud: 'cloud:test',
  listDevices: 'devices:list',
  refreshDevices: 'devices:refresh',
  setDp: 'devices:set',
  listScenes: 'scenes:list',
  triggerScene: 'scenes:trigger',
  listSchedules: 'schedules:list',
  saveSchedule: 'schedules:save',
  deleteSchedule: 'schedules:delete',
  getStatus: 'status:get',
  getLogs: 'logs:get',
  evDevice: 'ev:device',
  evDevices: 'ev:devices',
  evStatus: 'ev:status',
  evSchedules: 'ev:schedules',
  evLog: 'ev:log'
} as const
