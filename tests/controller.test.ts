import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppController, resolveEndpoint, resolvePulsarBase, sanitizeSettings } from '../src/main/controller'
import { Store, type SecretCipher } from '../src/main/store'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8'),
  decrypt: (b) => b.toString('utf8')
}
const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'tuya-ctl-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('sanitizeSettings', () => {
  it('membatasi interval polling & menormalkan boolean', () => {
    expect(sanitizeSettings({ pollIntervalSec: 1 }).pollIntervalSec).toBe(5)
    expect(sanitizeSettings({ pollIntervalSec: 99999 }).pollIntervalSec).toBe(600)
    expect(sanitizeSettings({ pollIntervalSec: NaN }).pollIntervalSec).toBe(DEFAULT_SETTINGS.pollIntervalSec)
    expect(sanitizeSettings({ lanEnabled: 0 as unknown as boolean }).lanEnabled).toBe(false)
  })

  it('endpoint kustom harus https; Message Service harus wss', () => {
    expect(sanitizeSettings({ endpointOverride: ' https://openapi.tuyaeu.com/ ' }).endpointOverride).toBe('https://openapi.tuyaeu.com')
    expect(() => sanitizeSettings({ endpointOverride: 'http://evil.example.com' })).toThrow(/https/)
    expect(() => sanitizeSettings({ endpointOverride: 'https://a.com/path?x=1' })).toThrow(/https/)
    expect(sanitizeSettings({ endpointOverride: '' }).endpointOverride).toBe('')
    expect(() => sanitizeSettings({ pulsarOverride: 'ws://x' })).toThrow(/wss/)
    expect(sanitizeSettings({ pulsarOverride: 'wss://mqe.tuyaeu.com:8285/' }).pulsarOverride).toBe('wss://mqe.tuyaeu.com:8285/')
  })

  it('wilayah tidak dikenal jatuh ke default; resolveEndpoint/resolvePulsarBase', () => {
    expect(sanitizeSettings({ region: 'xx' as never }).region).toBe('eu')
    expect(resolveEndpoint({ ...DEFAULT_SETTINGS, region: 'us' })).toBe('https://openapi.tuyaus.com')
    expect(resolveEndpoint({ ...DEFAULT_SETTINGS, endpointOverride: 'https://custom.example.com' })).toBe('https://custom.example.com')
    expect(resolvePulsarBase({ ...DEFAULT_SETTINGS, region: 'sg' })).toBe('')
    expect(resolvePulsarBase({ ...DEFAULT_SETTINGS, region: 'sg', pulsarOverride: 'wss://m.example.com:8285/' })).toBe('wss://m.example.com:8285/')
  })
})

describe('AppController', () => {
  const makeCloud = () => ({
    getToken: vi.fn(async () => ({ uid: 'u' })),
    listDevices: vi.fn(async () => []),
    getSpecifications: vi.fn(),
    getStatus: vi.fn(),
    getStatusBatch: vi.fn(async () => []),
    getDpProperties: vi.fn(),
    sendCommands: vi.fn(),
    listHomes: vi.fn(),
    listScenes: vi.fn(),
    triggerScene: vi.fn()
  })

  it('state awal: tanpa kredensial', () => {
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null })
    expect(ctl.getSettingsState()).toMatchObject({ hasCredentials: false, accessIdMasked: '' })
    ctl.start()
    expect(ctl.getStatus().cloud).toBe('unconfigured')
    ctl.dispose()
  })

  it('menyimpan kredensial (rahasia tidak pernah dikembalikan) dan memuat perangkat', async () => {
    const cloud = makeCloud()
    const factory = vi.fn(() => cloud)
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null, cloudFactory: factory })
    const state = ctl.saveSettings({ settings: { region: 'us' }, credentials: { accessId: 'ABCDEFGHIJKL', accessSecret: 'S3CR3T-VALUE' } })
    expect(state.hasCredentials).toBe(true)
    expect(state.accessIdMasked).toBe('ABCD••••IJKL')
    expect(JSON.stringify(state)).not.toContain('S3CR3T-VALUE')
    expect(factory).toHaveBeenCalledWith({ accessId: 'ABCDEFGHIJKL', accessSecret: 'S3CR3T-VALUE' }, 'https://openapi.tuyaus.com')
    await vi.waitFor(() => expect(ctl.getStatus().cloud).toBe('ok'))
    ctl.dispose()
  })

  it('menolak kredensial kosong; clearCredentials menghapus', () => {
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null, cloudFactory: () => makeCloud() })
    expect(() => ctl.saveSettings({ settings: {}, credentials: { accessId: ' ', accessSecret: 'x' } })).toThrow(/wajib/)
    ctl.saveSettings({ settings: {}, credentials: { accessId: 'idididid1', accessSecret: 'sec' } })
    expect(ctl.getSettingsState().hasCredentials).toBe(true)
    ctl.saveSettings({ settings: {}, clearCredentials: true })
    expect(ctl.getSettingsState().hasCredentials).toBe(false)
    expect(ctl.getStatus().cloud).toBe('unconfigured')
    ctl.dispose()
  })

  it('testCloud: sukses, gagal, dan tanpa kredensial', async () => {
    const cloud = makeCloud()
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null, cloudFactory: () => cloud })
    expect((await ctl.testCloud()).ok).toBe(false)
    expect(await ctl.testCloud({ credentials: { accessId: 'a', accessSecret: 'b' } })).toMatchObject({ ok: true })
    cloud.getToken.mockRejectedValueOnce(new Error('sign invalid'))
    expect(await ctl.testCloud({ credentials: { accessId: 'a', accessSecret: 'b' } })).toEqual({ ok: false, message: 'sign invalid' })
    ctl.dispose()
  })

  it('realtime aktif tanpa endpoint diketahui (Singapura) → status error dengan petunjuk', () => {
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null, cloudFactory: () => makeCloud() })
    ctl.saveSettings({ settings: { region: 'sg', realtimeEnabled: true }, credentials: { accessId: 'idididid1', accessSecret: 'sec' } })
    expect(ctl.getStatus()).toMatchObject({ realtime: 'error' })
    expect(ctl.getStatus().realtimeMessage).toMatch(/manual/)
    ctl.dispose()
  })

  it('cloud tidak terjangkau saat start/simpan → status error, tanpa unhandled rejection', async () => {
    const down = () => ({ ...makeCloud(), listDevices: vi.fn(async () => Promise.reject(new Error('Tidak dapat menghubungi server Tuya'))) })
    const store = new Store(tmp(), cipher)
    store.saveSecrets({ accessId: 'idididid1', accessSecret: 'sec' })
    const ctl = new AppController(store, { discovery: null, cloudFactory: down })
    ctl.start() // memanggil loadDevices di latar belakang
    await vi.waitFor(() => expect(ctl.getStatus().cloud).toBe('error'))
    expect(ctl.getStatus().cloudMessage).toMatch(/Tuya/)
    ctl.saveSettings({ settings: { region: 'us' } }) // memicu pemuatan ulang di latar belakang
    await vi.waitFor(() => expect(ctl.getLogs().filter((l) => l.level === 'error').length).toBeGreaterThanOrEqual(2))
    ctl.dispose()
  })

  it('aksi jadwal dijalankan lewat manager', async () => {
    const ctl = new AppController(new Store(tmp(), cipher), { discovery: null, cloudFactory: () => makeCloud() })
    const setDps = vi.spyOn(ctl.manager, 'setDps').mockResolvedValue({ via: 'cloud' })
    const trigger = vi.spyOn(ctl.manager, 'triggerScene').mockResolvedValue(undefined)
    const run = (ctl as unknown as { runAction: (a: unknown) => Promise<void> }).runAction.bind(ctl)
    await run({ type: 'dp', deviceId: 'd1', values: { switch_led: true } })
    await run({ type: 'scene', homeId: 'h', sceneId: 's' })
    expect(setDps).toHaveBeenCalledWith('d1', { switch_led: true })
    expect(trigger).toHaveBeenCalledWith('h', 's')
    ctl.dispose()
  })
})
