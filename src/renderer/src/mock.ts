import { DEFAULT_SETTINGS, type ConnectionStatus, type DeviceView, type LogEntry, type SceneInfo, type Schedule, type SettingsState, type TuyaBridge } from '../../shared/types'

/**
 * Implementasi tiruan `window.tuya` untuk menjalankan UI di browser biasa
 * (pengembangan & uji visual tanpa Electron / perangkat sungguhan).
 */
export function createMockBridge(): TuyaBridge {
  const listeners = {
    device: new Set<(d: DeviceView) => void>(),
    devices: new Set<(d: DeviceView[]) => void>(),
    status: new Set<(s: ConnectionStatus) => void>(),
    schedules: new Set<(s: Schedule[]) => void>(),
    log: new Set<(l: LogEntry) => void>()
  }
  const sub = <T>(set: Set<(v: T) => void>, cb: (v: T) => void) => {
    set.add(cb)
    return () => void set.delete(cb)
  }

  const devices: DeviceView[] = [
    {
      id: 'mock-bulb-1',
      name: 'Lampu Kamar',
      category: 'dj',
      productName: 'Smart RGBCW Bulb',
      online: true,
      homeId: '1001',
      lan: 'connected',
      lanReady: true,
      status: { switch_led: true, work_mode: 'colour', bright_value_v2: 640, temp_value_v2: 300, colour_data_v2: { h: 24, s: 880, v: 760 } },
      specs: [
        { code: 'switch_led', type: 'boolean', mode: 'rw' },
        { code: 'work_mode', type: 'enum', mode: 'rw', range: ['white', 'colour', 'scene', 'music'] },
        { code: 'bright_value_v2', type: 'integer', mode: 'rw', min: 10, max: 1000, step: 1 },
        { code: 'temp_value_v2', type: 'integer', mode: 'rw', min: 0, max: 1000, step: 1 },
        { code: 'colour_data_v2', type: 'json', mode: 'rw' }
      ]
    },
    {
      id: 'mock-plug-1',
      name: 'Stopkontak Meja Kerja',
      category: 'cz',
      productName: 'Smart Socket 2-gang',
      online: true,
      homeId: '1001',
      lan: 'searching',
      lanReady: false,
      status: { switch_1: true, switch_2: false, cur_power: 1260, cur_voltage: 2305, cur_current: 548, add_ele: 12 },
      specs: [
        { code: 'switch_1', type: 'boolean', mode: 'rw' },
        { code: 'switch_2', type: 'boolean', mode: 'rw' },
        { code: 'cur_power', type: 'integer', mode: 'ro', min: 0, max: 99999, scale: 1, unit: 'W' },
        { code: 'cur_voltage', type: 'integer', mode: 'ro', min: 0, max: 5000, scale: 1, unit: 'V' },
        { code: 'cur_current', type: 'integer', mode: 'ro', min: 0, max: 30000, scale: 0, unit: 'mA' }
      ]
    },
    {
      id: 'mock-curtain-1',
      name: 'Tirai Ruang Tamu',
      category: 'cl',
      productName: 'Curtain Motor',
      online: true,
      homeId: '1001',
      lan: 'off',
      lanReady: false,
      status: { control: 'stop', percent_control: 40, percent_state: 40 },
      specs: [
        { code: 'control', type: 'enum', mode: 'rw', range: ['open', 'stop', 'close'] },
        { code: 'percent_control', type: 'integer', mode: 'rw', min: 0, max: 100, step: 1, unit: '%' },
        { code: 'percent_state', type: 'integer', mode: 'ro', min: 0, max: 100, unit: '%' }
      ]
    },
    {
      id: 'mock-sensor-1',
      name: 'Sensor Suhu Dapur',
      category: 'wsdcg',
      productName: 'Temp & Humidity Sensor',
      online: true,
      homeId: '1001',
      lan: 'off',
      lanReady: false,
      status: { va_temperature: 289, va_humidity: 64, battery_percentage: 87 },
      specs: [
        { code: 'va_temperature', type: 'integer', mode: 'ro', min: -400, max: 1200, scale: 1, unit: '°C' },
        { code: 'va_humidity', type: 'integer', mode: 'ro', min: 0, max: 100, unit: '%' },
        { code: 'battery_percentage', type: 'integer', mode: 'ro', min: 0, max: 100, unit: '%' }
      ]
    },
    {
      id: 'mock-strip-1',
      name: 'LED Strip TV',
      category: 'dd',
      productName: 'LED Strip',
      online: false,
      homeId: '1001',
      lan: 'off',
      lanReady: false,
      status: { switch_led: false },
      specs: [{ code: 'switch_led', type: 'boolean', mode: 'rw' }]
    }
  ]

  let settingsState: SettingsState = { settings: { ...DEFAULT_SETTINGS }, hasCredentials: true, accessIdMasked: 'abcd••••wxyz', secretsEncrypted: true }
  let schedules: Schedule[] = [
    { id: 's1', name: 'Lampu kamar nyala pagi', enabled: true, kind: 'daily', time: '06:30', days: [1, 2, 3, 4, 5], action: { type: 'dp', deviceId: 'mock-bulb-1', values: { switch_led: true } }, lastRunAt: Date.now() - 3600_000, lastResult: 'Berhasil' },
    { id: 's2', name: 'Matikan semua malam', enabled: false, kind: 'daily', time: '23:00', days: [0, 1, 2, 3, 4, 5, 6], action: { type: 'scene', homeId: '1001', sceneId: 'sc2', sceneName: 'Selamat tidur' } }
  ]
  const scenes: SceneInfo[] = [
    { id: 'sc1', homeId: '1001', homeName: 'Rumah Saya', name: 'Selamat pagi', enabled: true },
    { id: 'sc2', homeId: '1001', homeName: 'Rumah Saya', name: 'Selamat tidur', enabled: true },
    { id: 'sc3', homeId: '1001', homeName: 'Rumah Saya', name: 'Nonton film', enabled: true }
  ]
  const logs: LogEntry[] = [
    { at: Date.now() - 60_000, level: 'info', message: `${devices.length} perangkat dimuat` },
    { at: Date.now() - 30_000, level: 'warn', message: 'LAN mock-plug-1: gagal tersambung: timeout' }
  ]
  const status: ConnectionStatus = { cloud: 'ok', realtime: 'off', lanDevices: 1 }

  const clone = (d: DeviceView): DeviceView => ({ ...d, status: { ...d.status } })
  const wait = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms))

  return {
    getSettings: async () => settingsState,
    saveSettings: async (input) => {
      settingsState = {
        ...settingsState,
        settings: { ...settingsState.settings, ...input.settings },
        hasCredentials: input.clearCredentials ? false : settingsState.hasCredentials || !!input.credentials
      }
      return settingsState
    },
    testCloud: async () => {
      await wait(500)
      return { ok: true, message: 'Berhasil terhubung ke Tuya Cloud. (mock)' }
    },
    listDevices: async () => devices.map(clone),
    refreshDevices: async () => {
      await wait(400)
      return devices.map(clone)
    },
    setDp: async (id, values) => {
      await wait()
      const dev = devices.find((d) => d.id === id)
      if (!dev) throw new Error('Perangkat tidak ditemukan')
      Object.assign(dev.status, values)
      listeners.device.forEach((cb) => cb(clone(dev)))
      return { via: dev.lanReady ? 'lan' : 'cloud' }
    },
    listScenes: async () => ({ scenes }),
    triggerScene: async () => wait(300),
    listSchedules: async () => schedules,
    saveSchedule: async (s) => {
      schedules = schedules.some((x) => x.id === s.id) ? schedules.map((x) => (x.id === s.id ? s : x)) : [...schedules, s]
      listeners.schedules.forEach((cb) => cb(schedules))
      return schedules
    },
    deleteSchedule: async (id) => {
      schedules = schedules.filter((x) => x.id !== id)
      listeners.schedules.forEach((cb) => cb(schedules))
      return schedules
    },
    getStatus: async () => status,
    getLogs: async () => logs,
    onDevice: (cb) => sub(listeners.device, cb),
    onDevices: (cb) => sub(listeners.devices, cb),
    onStatus: (cb) => sub(listeners.status, cb),
    onSchedules: (cb) => sub(listeners.schedules, cb),
    onLog: (cb) => sub(listeners.log, cb)
  }
}
