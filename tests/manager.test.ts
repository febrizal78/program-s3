import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DeviceManager, type CloudApi } from '../src/main/manager'
import type { LanLink, LanTarget } from '../src/main/tuya/local'
import { DEFAULT_SETTINGS, type DeviceView, type Settings } from '../src/shared/types'

const KEY = '0123456789abcdef'

function makeCloud(over: Partial<Record<keyof CloudApi, unknown>> = {}) {
  const base = {
    listDevices: vi.fn(async () => [
      { id: 'd1', name: 'Lampu', category: 'dj', product_name: 'Bulb', online: true, local_key: KEY, owner_id: '100' },
      { id: 'd2', name: 'Colokan', category: 'cz', product_name: 'Plug', online: false, local_key: KEY, owner_id: '100' }
    ]),
    getSpecifications: vi.fn(async (id: string) =>
      id === 'd1'
        ? {
            functions: [
              { code: 'switch_led', type: 'Boolean', values: '{}' },
              { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"step":1}' },
              { code: 'colour_data_v2', type: 'Json', values: '{}' }
            ],
            status: [
              { code: 'switch_led', type: 'Boolean', values: '{}' },
              { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"step":1}' },
              { code: 'colour_data_v2', type: 'Json', values: '{}' }
            ]
          }
        : { functions: [{ code: 'switch_1', type: 'Boolean', values: '{}' }], status: [{ code: 'switch_1', type: 'Boolean', values: '{}' }] }
    ),
    getDpProperties: vi.fn(async (id: string) =>
      id === 'd1'
        ? [
            { code: 'switch_led', dp_id: 20 },
            { code: 'bright_value_v2', dp_id: 22 },
            { code: 'colour_data_v2', dp_id: 24 }
          ]
        : [{ code: 'switch_1', dp_id: 1 }]
    ),
    getStatusBatch: vi.fn(async () => [
      { id: 'd1', status: [{ code: 'switch_led', value: true }, { code: 'colour_data_v2', value: '{"h":10,"s":500,"v":900}' }] },
      { id: 'd2', status: [{ code: 'switch_1', value: false }] }
    ]),
    getStatus: vi.fn(async () => [{ code: 'switch_led', value: false }]),
    sendCommands: vi.fn(async () => undefined),
    listHomes: vi.fn(async () => [{ home_id: 100, name: 'Rumah Utama' }]),
    listScenes: vi.fn(async () => [{ scene_id: 'sc1', name: 'Pagi', enabled: true }]),
    triggerScene: vi.fn(async () => undefined)
  }
  // `over` menimpa mock bawaan; tipe tetap mengikuti `base` agar `.mockClear()` dst. tersedia.
  return { ...base, ...over } as typeof base
}

class FakeLink extends EventEmitter {
  connected = false
  started = false
  setDps = vi.fn(async () => undefined)
  update = vi.fn()
  stop = vi.fn()
  start = vi.fn(() => {
    this.started = true
  })
  get isConnected(): boolean {
    return this.connected
  }
}

function setup(opts: { cloud?: ReturnType<typeof makeCloud> | null; settings?: Partial<Settings>; found?: boolean } = {}) {
  const cloud = opts.cloud === undefined ? makeCloud() : opts.cloud
  const links = new Map<string, FakeLink>()
  const store = { getDeviceCache: vi.fn(() => ({})), saveDeviceCache: vi.fn() }
  const manager = new DeviceManager({
    getCloud: () => cloud as unknown as CloudApi | null,
    getSettings: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }),
    store,
    discovery: { get: (id: string) => (opts.found === false ? undefined : { id, ip: '192.168.1.10', version: '3.3' }) },
    linkFactory: (t: LanTarget) => {
      const l = new FakeLink()
      links.set(t.id, l)
      return l as unknown as LanLink
    },
    confirmDelayMs: 0
  })
  return { cloud, manager, links, store }
}

const view = (m: DeviceManager, id: string): DeviceView => m.views().find((v) => v.id === id)!

describe('DeviceManager.refresh', () => {
  it('memuat perangkat, spesifikasi, pemetaan DP, dan status (warna dinormalkan)', async () => {
    const { manager, store } = setup()
    const views = await manager.refresh()
    expect(views.map((v) => v.name)).toEqual(['Colokan', 'Lampu'])
    const lamp = view(manager, 'd1')
    expect(lamp.specs.find((s) => s.code === 'bright_value_v2')).toMatchObject({ dpId: 22, min: 10, max: 1000, mode: 'rw' })
    expect(lamp.status.switch_led).toBe(true)
    expect(lamp.status.colour_data_v2).toEqual({ h: 10, s: 500, v: 900 })
    expect(lamp.homeId).toBe('100')
    expect(store.saveDeviceCache).toHaveBeenCalled()
  })

  it('tanpa kredensial cloud → error yang jelas', async () => {
    const { manager } = setup({ cloud: null })
    await expect(manager.refresh()).rejects.toThrow(/Kredensial/)
  })

  it('gagal memuat spesifikasi satu perangkat tidak menggagalkan semuanya', async () => {
    const cloud = makeCloud({
      getSpecifications: vi.fn(async (id: string) => {
        if (id === 'd2') throw new Error('boom')
        return { functions: [{ code: 'switch_led', type: 'Boolean', values: '{}' }], status: [] }
      })
    })
    const { manager } = setup({ cloud })
    const logs: string[] = []
    manager.on('log', (e: { message: string }) => logs.push(e.message))
    await manager.refresh()
    expect(view(manager, 'd1').specs).toHaveLength(1)
    expect(view(manager, 'd2').specs).toHaveLength(0)
    expect(logs.join()).toMatch(/Colokan/)
  })

  it('status massal gagal → membaca per perangkat', async () => {
    const cloud = makeCloud({ getStatusBatch: vi.fn(async () => Promise.reject(new Error('404'))) })
    const { manager } = setup({ cloud })
    await manager.refresh()
    expect(cloud.getStatus).toHaveBeenCalledTimes(2)
  })
})

describe('DeviceManager.setDps', () => {
  it('memakai LAN bila tersambung, memetakan kode → nomor DP dan mengonversi warna', async () => {
    const { manager, links, cloud } = setup()
    await manager.refresh()
    const link = links.get('d1')!
    expect(link.started).toBe(true)
    link.connected = true
    link.emit('state', 'connected')
    expect(view(manager, 'd1').lan).toBe('connected')

    const res = await manager.setDps('d1', { switch_led: false, colour_data_v2: { h: 120, s: 1000, v: 1000 } })
    expect(res.via).toBe('lan')
    expect(link.setDps).toHaveBeenCalledWith({ '20': false, '24': '007803e803e8' })
    expect(cloud!.sendCommands).not.toHaveBeenCalled()
    expect(view(manager, 'd1').status.switch_led).toBe(false)
  })

  it('LAN gagal → otomatis jatuh ke cloud', async () => {
    const { manager, links, cloud } = setup()
    await manager.refresh()
    const link = links.get('d1')!
    link.connected = true
    link.setDps.mockRejectedValueOnce(new Error('timeout'))
    const res = await manager.setDps('d1', { switch_led: true })
    expect(res.via).toBe('cloud')
    expect(cloud!.sendCommands).toHaveBeenCalledWith('d1', [{ code: 'switch_led', value: true }])
  })

  it('kode tanpa nomor DP → cloud walau LAN tersambung', async () => {
    const { manager, links, cloud } = setup()
    await manager.refresh()
    links.get('d1')!.connected = true
    const res = await manager.setDps('d1', { tidak_dikenal: 1 })
    expect(res.via).toBe('cloud')
    expect(cloud!.sendCommands).toHaveBeenCalled()
  })

  it('LAN dinonaktifkan di pengaturan → tidak ada koneksi LAN', async () => {
    const { manager, links } = setup({ settings: { lanEnabled: false } })
    await manager.refresh()
    expect(links.size).toBe(0)
    expect(view(manager, 'd1').lan).toBe('off')
  })

  it('perangkat belum ditemukan di LAN → status "searching", lalu tersambung saat ditemukan', async () => {
    const { manager, links } = setup({ found: false })
    await manager.refresh()
    expect(view(manager, 'd1').lan).toBe('searching')
    manager.onFound({ id: 'd1', ip: '192.168.1.77', version: '3.4' })
    expect(links.get('d1')?.started).toBe(true)
    expect(view(manager, 'd1').lan).toBe('connecting')
  })

  it('error untuk perangkat tidak dikenal / nilai kosong', async () => {
    const { manager } = setup()
    await manager.refresh()
    await expect(manager.setDps('nope', { a: 1 })).rejects.toThrow(/tidak ditemukan/)
    await expect(manager.setDps('d1', {})).rejects.toThrow(/Tidak ada nilai/)
  })

  it('tanpa LAN & tanpa cloud → error', async () => {
    let current: CloudApi | null = makeCloud() as unknown as CloudApi
    const manager = new DeviceManager({
      getCloud: () => current,
      getSettings: () => DEFAULT_SETTINGS,
      store: { getDeviceCache: () => ({}), saveDeviceCache: () => undefined }
    })
    await manager.refresh()
    current = null // kredensial cloud dihapus setelah perangkat dimuat
    await expect(manager.setDps('d1', { switch_led: true })).rejects.toThrow(/Tidak ada koneksi/)
  })
})

describe('DeviceManager status & realtime', () => {
  it('LAN → dps (nomor DP) dipetakan ke kode, warna dikonversi ke format cloud', async () => {
    const { manager, links } = setup()
    await manager.refresh()
    const seen: DeviceView[] = []
    manager.on('device', (d: DeviceView) => seen.push(d))
    links.get('d1')!.emit('dps', { '20': false, '22': 321, '24': '007803e803e8', '99': 'abaikan' })
    const s = view(manager, 'd1').status
    expect(s.switch_led).toBe(false)
    expect(s.bright_value_v2).toBe(321)
    expect(s.colour_data_v2).toEqual({ h: 120, s: 1000, v: 1000 })
    expect(s['99']).toBeUndefined()
    expect(seen.length).toBeGreaterThan(0)
  })

  it('polling melewati perangkat yang terhubung via LAN', async () => {
    const { manager, links, cloud } = setup()
    await manager.refresh()
    links.get('d1')!.emit('state', 'connected')
    cloud!.getStatusBatch.mockClear()
    await manager.pollStatuses()
    expect(cloud!.getStatusBatch).toHaveBeenCalledWith(['d2'])
  })

  it('event realtime: status & online/offline', async () => {
    const { manager } = setup()
    await manager.refresh()
    manager.handleRealtime({ devId: 'd1', status: [{ code: 'bright_value_v2', value: 777 }] })
    expect(view(manager, 'd1').status.bright_value_v2).toBe(777)
    manager.handleRealtime({ devId: 'd1', bizCode: 'offline' })
    expect(view(manager, 'd1').online).toBe(false)
    manager.handleRealtime({ devId: 'tidak-ada', bizCode: 'online' }) // tidak melempar
  })

  it('applyStatus hanya memancarkan event bila ada perubahan', async () => {
    const { manager } = setup()
    await manager.refresh()
    const seen: DeviceView[] = []
    manager.on('device', (d: DeviceView) => seen.push(d))
    expect(manager.applyStatus('d1', { switch_led: true })).toBe(false)
    expect(manager.applyStatus('d1', { switch_led: false })).toBe(true)
    expect(seen).toHaveLength(1)
  })
})

describe('DeviceManager scene', () => {
  it('menurunkan rumah dari perangkat & nama dari API rumah', async () => {
    const { manager, cloud } = setup({ settings: { appUid: 'u1' } })
    await manager.refresh()
    const res = await manager.listScenes()
    expect(res.scenes).toEqual([{ id: 'sc1', homeId: '100', homeName: 'Rumah Utama', name: 'Pagi', enabled: true }])
    expect(cloud!.listScenes).toHaveBeenCalledWith('100')
    await manager.triggerScene('100', 'sc1')
    expect(cloud!.triggerScene).toHaveBeenCalledWith('100', 'sc1')
  })

  it('tanpa UID, nama rumah memakai id; error satu rumah dilaporkan sebagai pesan', async () => {
    const cloud = makeCloud({ listScenes: vi.fn(async () => Promise.reject(new Error('izin ditolak'))) })
    const { manager } = setup({ cloud })
    await manager.refresh()
    const res = await manager.listScenes()
    expect(res.scenes).toEqual([])
    expect(res.message).toMatch(/Rumah 100.*izin ditolak/)
  })
})
