import { EventEmitter } from 'node:events'
import {
  fromLocalValue,
  mergeSpecs,
  normalizeCloudValue,
  toLocalValue
} from '../shared/dp'
import type {
  DeviceView,
  DpSpec,
  HomeInfo,
  LanState,
  SceneInfo,
  Settings
} from '../shared/types'
import type { CachedDevice, Store } from './store'
import type { CloudDevice, TuyaCloud } from './tuya/cloud'
import type { FoundDevice, LanDiscovery, LanTarget } from './tuya/local'
import { LanLink } from './tuya/local'
import type { PulsarEvent } from './tuya/pulsar'

export type CloudApi = Pick<
  TuyaCloud,
  | 'listDevices'
  | 'getSpecifications'
  | 'getStatus'
  | 'getStatusBatch'
  | 'getDpProperties'
  | 'sendCommands'
  | 'listHomes'
  | 'listScenes'
  | 'triggerScene'
>

export interface ManagerDeps {
  getCloud(): CloudApi | null
  getSettings(): Settings
  store: Pick<Store, 'getDeviceCache' | 'saveDeviceCache'>
  discovery?: Pick<LanDiscovery, 'get'>
  linkFactory?: (target: LanTarget) => LanLink
  /** Jeda sebelum membaca ulang status setelah perintah cloud (ms). */
  confirmDelayMs?: number
}

interface DeviceRecord {
  id: string
  name: string
  category: string
  productName: string
  online: boolean
  homeId: string
  localKey: string
  specs: DpSpec[]
  codeToDp: Map<string, number>
  dpToCode: Map<number, string>
  status: Record<string, unknown>
  link?: LanLink
  lanState: LanState
}

const SPEC_CACHE_TTL = 7 * 24 * 3600_000

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Mengelola daftar perangkat, status, dan kontrol:
 *  - cloud  : daftar perangkat, spesifikasi, status (polling/pulsar), perintah
 *  - LAN    : status push + perintah cepat bila perangkat terjangkau
 * Event: `device` (DeviceView), `devices` (DeviceView[]), `log` ({level, message}), `lan-count` (number)
 */
export class DeviceManager extends EventEmitter {
  private records = new Map<string, DeviceRecord>()
  private pollTimer?: ReturnType<typeof setTimeout>
  private pollCount = 0
  private realtimeActive = false
  private readonly linkFactory: (t: LanTarget) => LanLink
  private readonly confirmDelay: number

  constructor(private readonly deps: ManagerDeps) {
    super()
    this.linkFactory = deps.linkFactory ?? ((t) => new LanLink(t))
    this.confirmDelay = deps.confirmDelayMs ?? 1_500
  }

  // ───────────────────────── Tampilan ─────────────────────────

  views(): DeviceView[] {
    return [...this.records.values()].map((r) => this.view(r)).sort((a, b) => a.name.localeCompare(b.name))
  }

  private view(r: DeviceRecord): DeviceView {
    const lanReady = r.lanState === 'connected'
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      productName: r.productName,
      online: r.online || lanReady,
      homeId: r.homeId,
      status: { ...r.status },
      specs: r.specs,
      lan: r.lanState,
      lanReady
    }
  }

  lanConnectedCount(): number {
    return [...this.records.values()].filter((r) => r.lanState === 'connected').length
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit('log', { level, message })
  }

  private emitDevice(r: DeviceRecord): void {
    this.emit('device', this.view(r))
  }

  // ───────────────────────── Muat daftar ─────────────────────────

  async refresh(opts: { force?: boolean } = {}): Promise<DeviceView[]> {
    const cloud = this.deps.getCloud()
    if (!cloud) throw new Error('Kredensial cloud belum diisi. Buka Pengaturan.')
    const settings = this.deps.getSettings()

    const list = await cloud.listDevices(settings.appUid || undefined)
    this.mergeList(list)

    await this.loadSpecs(cloud, opts.force === true)
    await this.pollStatuses(true)
    this.syncLan()
    this.emit('devices', this.views())
    return this.views()
  }

  /** Perbarui catatan dari daftar perangkat cloud (nama, online, kunci lokal). */
  private mergeList(list: CloudDevice[]): void {
    const ids = new Set(list.map((d) => d.id))
    for (const [id, rec] of this.records) {
      if (!ids.has(id)) {
        rec.link?.stop()
        this.records.delete(id)
      }
    }
    for (const d of list) {
      let rec = this.records.get(d.id)
      if (!rec) {
        rec = {
          id: d.id,
          name: d.name,
          category: d.category,
          productName: d.product_name ?? '',
          online: !!d.online,
          homeId: d.owner_id ? String(d.owner_id) : '',
          localKey: d.local_key ?? '',
          specs: [],
          codeToDp: new Map(),
          dpToCode: new Map(),
          status: {},
          lanState: 'off'
        }
        this.records.set(d.id, rec)
        continue
      }
      const wasOnline = rec.online
      rec.name = d.name
      rec.category = d.category
      rec.productName = d.product_name ?? rec.productName
      rec.online = !!d.online
      rec.homeId = d.owner_id ? String(d.owner_id) : rec.homeId
      rec.localKey = d.local_key ?? rec.localKey
      if (wasOnline !== rec.online) this.emitDevice(rec)
    }
  }

  private async loadSpecs(cloud: CloudApi, force: boolean): Promise<void> {
    const cache = this.deps.store.getDeviceCache()
    const now = Date.now()
    const todo: DeviceRecord[] = []
    for (const rec of this.records.values()) {
      const cached = cache[rec.id]
      if (!force && cached && now - cached.fetchedAt < SPEC_CACHE_TTL && cached.specs.length > 0) {
        this.applySpecs(rec, cached.specs)
      } else if (rec.specs.length === 0 || force) {
        todo.push(rec)
      }
    }
    if (todo.length === 0) return

    await mapLimit(todo, 4, async (rec) => {
      try {
        const [spec, props] = await Promise.all([
          cloud.getSpecifications(rec.id),
          cloud.getDpProperties(rec.id).catch((err: Error) => {
            this.log('warn', `Pemetaan DP ${rec.name}: ${err.message}`)
            return []
          })
        ])
        const specs = mergeSpecs(spec.functions, spec.status)
        const byCode = new Map(props.map((p) => [p.code, p.dp_id]))
        for (const s of specs) {
          const dp = byCode.get(s.code)
          if (typeof dp === 'number') s.dpId = dp
        }
        this.applySpecs(rec, specs)
        cache[rec.id] = { specs, fetchedAt: now } satisfies CachedDevice
      } catch (err) {
        this.log('warn', `Spesifikasi ${rec.name} gagal dimuat: ${(err as Error).message}`)
      }
    })
    this.deps.store.saveDeviceCache(cache)
  }

  private applySpecs(rec: DeviceRecord, specs: DpSpec[]): void {
    rec.specs = specs
    rec.codeToDp = new Map()
    rec.dpToCode = new Map()
    for (const s of specs) {
      if (typeof s.dpId === 'number') {
        rec.codeToDp.set(s.code, s.dpId)
        rec.dpToCode.set(s.dpId, s.code)
      }
    }
  }

  // ───────────────────────── Status ─────────────────────────

  /** Gabungkan perubahan status; kirim event bila ada yang berubah. */
  applyStatus(id: string, partial: Record<string, unknown>, silent = false): boolean {
    const rec = this.records.get(id)
    if (!rec) return false
    let changed = false
    for (const [code, raw] of Object.entries(partial)) {
      const value = normalizeCloudValue(code, raw)
      if (JSON.stringify(rec.status[code]) !== JSON.stringify(value)) {
        rec.status[code] = value
        changed = true
      }
    }
    if (changed && !silent) this.emitDevice(rec)
    return changed
  }

  /** Baca status dari cloud untuk perangkat yang tidak terhubung via LAN. */
  async pollStatuses(silent = false): Promise<void> {
    const cloud = this.deps.getCloud()
    if (!cloud) return
    const targets = [...this.records.values()].filter((r) => r.lanState !== 'connected')
    if (targets.length === 0) return
    try {
      const rows = await cloud.getStatusBatch(targets.map((t) => t.id))
      for (const row of rows) {
        this.applyStatus(row.id, Object.fromEntries((row.status ?? []).map((s) => [s.code, s.value])), silent)
      }
    } catch (err) {
      // Cadangan: per perangkat (endpoint batch bisa saja tidak tersedia di proyek).
      this.log('warn', `Status massal gagal (${(err as Error).message}); membaca per perangkat`)
      await mapLimit(targets, 4, async (rec) => {
        try {
          const items = await cloud.getStatus(rec.id)
          this.applyStatus(rec.id, Object.fromEntries(items.map((s) => [s.code, s.value])), silent)
        } catch (e) {
          this.log('warn', `Status ${rec.name}: ${(e as Error).message}`)
        }
      })
    }
  }

  startPolling(): void {
    this.stopPolling()
    const loop = async (): Promise<void> => {
      const settings = this.deps.getSettings()
      const base = Math.max(5, settings.pollIntervalSec) * 1000
      try {
        this.pollCount += 1
        // Tiap beberapa putaran, segarkan juga daftar (status online, nama).
        if (this.pollCount % 6 === 0) {
          const cloud = this.deps.getCloud()
          if (cloud) this.mergeList(await cloud.listDevices(settings.appUid || undefined))
        }
        await this.pollStatuses()
      } catch (err) {
        this.log('warn', `Polling gagal: ${(err as Error).message}`)
      }
      this.pollTimer = setTimeout(() => void loop(), this.realtimeActive ? base * 6 : base)
    }
    this.pollTimer = setTimeout(() => void loop(), Math.max(5, this.deps.getSettings().pollIntervalSec) * 1000)
  }

  stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
  }

  setRealtimeActive(active: boolean): void {
    this.realtimeActive = active
  }

  /** Event dari Message Service. */
  handleRealtime(ev: PulsarEvent): void {
    const rec = this.records.get(ev.devId)
    if (!rec) return
    if (ev.bizCode === 'online' || ev.bizCode === 'offline') {
      const online = ev.bizCode === 'online'
      if (rec.online !== online) {
        rec.online = online
        this.emitDevice(rec)
      }
    }
    if (ev.status?.length) {
      this.applyStatus(ev.devId, Object.fromEntries(ev.status.map((s) => [s.code, s.value])))
    }
  }

  // ───────────────────────── LAN ─────────────────────────

  /** Buat/hentikan koneksi LAN sesuai pengaturan dan hasil discovery. */
  syncLan(): void {
    const enabled = this.deps.getSettings().lanEnabled && !!this.deps.discovery
    for (const rec of this.records.values()) {
      if (!enabled || !rec.localKey || rec.codeToDp.size === 0) {
        if (rec.link) {
          rec.link.stop()
          rec.link = undefined
        }
        rec.lanState = 'off'
        continue
      }
      const found = this.deps.discovery!.get(rec.id)
      if (!found) {
        rec.lanState = rec.link?.isConnected ? 'connected' : 'searching'
        continue
      }
      this.attachLink(rec, found)
    }
    this.emit('lan-count', this.lanConnectedCount())
  }

  /** Dipanggil saat discovery menemukan/memperbarui perangkat. */
  onFound(found: FoundDevice): void {
    const rec = this.records.get(found.id)
    if (!rec || !this.deps.getSettings().lanEnabled || !rec.localKey || rec.codeToDp.size === 0) return
    this.attachLink(rec, found)
    this.emit('lan-count', this.lanConnectedCount())
  }

  private attachLink(rec: DeviceRecord, found: FoundDevice): void {
    const target: LanTarget = { id: rec.id, key: rec.localKey, ip: found.ip, version: found.version }
    if (rec.link) {
      rec.link.update(target)
      return
    }
    const link = this.linkFactory(target)
    rec.link = link
    rec.lanState = 'connecting'
    link.on('state', (state: string) => {
      const next: LanState = state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : 'searching'
      if (rec.lanState !== next) {
        rec.lanState = next
        this.emitDevice(rec)
        this.emit('lan-count', this.lanConnectedCount())
      }
    })
    link.on('dps', (dps: Record<string, unknown>) => {
      const partial: Record<string, unknown> = {}
      for (const [dpId, raw] of Object.entries(dps)) {
        const code = rec.dpToCode.get(Number(dpId))
        if (code) partial[code] = fromLocalValue(code, raw)
      }
      if (Object.keys(partial).length) this.applyStatus(rec.id, partial)
    })
    link.on('warn', (msg: string) => this.log('warn', msg))
    link.start()
  }

  stopLan(): void {
    for (const rec of this.records.values()) {
      rec.link?.stop()
      rec.link = undefined
      rec.lanState = 'off'
    }
    this.emit('lan-count', 0)
  }

  // ───────────────────────── Kontrol ─────────────────────────

  async setDps(id: string, values: Record<string, unknown>): Promise<{ via: 'lan' | 'cloud' }> {
    const rec = this.records.get(id)
    if (!rec) throw new Error('Perangkat tidak ditemukan')
    const codes = Object.keys(values)
    if (codes.length === 0) throw new Error('Tidak ada nilai untuk dikirim')

    // 1) Jalur LAN bila terhubung dan semua kode punya nomor DP.
    if (rec.link?.isConnected && codes.every((c) => rec.codeToDp.has(c))) {
      try {
        const dps: Record<string, unknown> = {}
        for (const c of codes) dps[String(rec.codeToDp.get(c))] = toLocalValue(c, values[c])
        await rec.link.setDps(dps)
        this.applyStatus(id, values)
        return { via: 'lan' }
      } catch (err) {
        this.log('warn', `Kontrol LAN ${rec.name} gagal (${(err as Error).message}); memakai cloud`)
      }
    }

    // 2) Jalur cloud.
    const cloud = this.deps.getCloud()
    if (!cloud) throw new Error('Tidak ada koneksi: perangkat tidak terjangkau via LAN dan kredensial cloud belum diisi')
    await cloud.sendCommands(
      id,
      codes.map((code) => ({ code, value: values[code] }))
    )
    this.applyStatus(id, values)
    setTimeout(() => void this.confirmStatus(id), this.confirmDelay).unref?.()
    return { via: 'cloud' }
  }

  private async confirmStatus(id: string): Promise<void> {
    const cloud = this.deps.getCloud()
    if (!cloud) return
    try {
      const items = await cloud.getStatus(id)
      this.applyStatus(id, Object.fromEntries(items.map((s) => [s.code, s.value])))
    } catch {
      /* status akan dikoreksi pada polling berikutnya */
    }
  }

  // ───────────────────────── Scene ─────────────────────────

  async listHomes(): Promise<HomeInfo[]> {
    const cloud = this.deps.getCloud()
    if (!cloud) throw new Error('Kredensial cloud belum diisi')
    const names = new Map<string, string>()
    const uid = this.deps.getSettings().appUid
    if (uid) {
      try {
        for (const h of await cloud.listHomes(uid)) names.set(String(h.home_id), h.name)
      } catch (err) {
        this.log('warn', `Daftar rumah gagal: ${(err as Error).message}`)
      }
    }
    // Rumah juga dapat diturunkan dari perangkat (owner_id = home_id).
    for (const rec of this.records.values()) {
      if (rec.homeId && !names.has(rec.homeId)) names.set(rec.homeId, `Rumah ${rec.homeId}`)
    }
    return [...names].map(([id, name]) => ({ id, name }))
  }

  async listScenes(): Promise<{ scenes: SceneInfo[]; message?: string }> {
    const cloud = this.deps.getCloud()
    if (!cloud) throw new Error('Kredensial cloud belum diisi')
    const homes = await this.listHomes()
    if (homes.length === 0) {
      return { scenes: [], message: 'Belum ada rumah terdeteksi. Muat perangkat dulu, atau isi UID akun aplikasi di Pengaturan.' }
    }
    const scenes: SceneInfo[] = []
    const errors: string[] = []
    for (const home of homes) {
      try {
        for (const s of await cloud.listScenes(home.id)) {
          scenes.push({ id: String(s.scene_id), homeId: home.id, homeName: home.name, name: s.name, enabled: s.enabled !== false })
        }
      } catch (err) {
        errors.push(`${home.name}: ${(err as Error).message}`)
      }
    }
    return { scenes, message: errors.length ? errors.join(' • ') : undefined }
  }

  async triggerScene(homeId: string, sceneId: string): Promise<void> {
    const cloud = this.deps.getCloud()
    if (!cloud) throw new Error('Kredensial cloud belum diisi')
    await cloud.triggerScene(homeId, sceneId)
  }

  // ───────────────────────── Siklus hidup ─────────────────────────

  dispose(): void {
    this.stopPolling()
    this.stopLan()
  }
}
