import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import parserModule from 'tuyapi/lib/message-parser'
import configModule from 'tuyapi/lib/config'
import { LanLink, parseBroadcast, type TuyaSocket } from '../src/main/tuya/local'

const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

class FakeSocket extends EventEmitter {
  connect = vi.fn(async () => true)
  disconnect = vi.fn()
  isConnected = vi.fn(() => true)
  get = vi.fn(async () => ({ dps: { '20': true, '22': 500 } }))
  set = vi.fn(async () => ({}))
}

const target = { id: 'dev1', key: '0123456789abcdef', ip: '192.168.1.20', version: '3.3' }

function setup(opts: { failConnect?: boolean } = {}) {
  const sockets: FakeSocket[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const factory = vi.fn(() => {
    const s = new FakeSocket()
    if (opts.failConnect) s.connect = vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    sockets.push(s)
    return s as unknown as TuyaSocket
  })
  const link = new LanLink(target, {
    factory,
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeoutFn: () => undefined
  })
  return { link, sockets, timers, factory }
}

describe('LanLink', () => {
  it('tersambung, membaca status awal, lalu meneruskan perubahan DP', async () => {
    const { link, sockets } = setup()
    const states: string[] = []
    const dps: Array<Record<string, unknown>> = []
    link.on('state', (s) => states.push(s))
    link.on('dps', (d) => dps.push(d))
    link.start()
    await flush()
    expect(states).toEqual(['connecting', 'connected'])
    expect(link.isConnected).toBe(true)
    expect(dps[0]).toEqual({ '20': true, '22': 500 })
    sockets[0].emit('data', { dps: { '20': false } })
    sockets[0].emit('dp-refresh', { dps: { '22': 100 } })
    sockets[0].emit('data', { notdps: 1 })
    expect(dps.slice(1)).toEqual([{ '20': false }, { '22': 100 }])
  })

  it('setDps mengirim multi-DP dan menolak saat belum tersambung', async () => {
    const { link, sockets } = setup()
    await expect(link.setDps({ '20': true })).rejects.toThrow(/belum tersambung/)
    link.start()
    await flush()
    await link.setDps({ '20': true, '22': 300 })
    expect(sockets[0].set).toHaveBeenCalledWith({ multiple: true, data: { '20': true, '22': 300 }, shouldWaitForResponse: false })
  })

  it('terputus → status disconnected → sambung ulang dengan jeda', async () => {
    const { link, sockets, timers, factory } = setup()
    const states: string[] = []
    link.on('state', (s) => states.push(s))
    link.start()
    await flush()
    sockets[0].emit('disconnected')
    expect(states.at(-1)).toBe('disconnected')
    expect(link.isConnected).toBe(false)
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(2000)
    timers[0].fn()
    await flush()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(link.isConnected).toBe(true)
  })

  it('gagal sambung → backoff berlipat ganda hingga batas', async () => {
    const { link, timers } = setup({ failConnect: true })
    const warns: string[] = []
    link.on('warn', (m) => warns.push(m))
    link.start()
    await flush()
    expect(warns[0]).toMatch(/ECONNREFUSED/)
    for (let i = 0; i < 7; i++) {
      timers.at(-1)!.fn()
      await flush()
    }
    expect(timers.map((t) => t.ms)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  })

  it('factory yang melempar (mis. kunci tidak valid) → warning + coba lagi, bukan unhandled rejection', async () => {
    const timers: Array<{ ms: number }> = []
    const link = new LanLink(target, {
      factory: () => {
        throw new Error('Key must be 16 bytes')
      },
      setTimeoutFn: (_fn, ms) => {
        timers.push({ ms })
        return 1 as unknown as ReturnType<typeof setTimeout>
      }
    })
    const warns: string[] = []
    link.on('warn', (m) => warns.push(m))
    link.start()
    await flush()
    expect(warns[0]).toMatch(/Key must be 16 bytes/)
    expect(timers).toHaveLength(1)
  })

  it('stop menghentikan koneksi dan tidak menjadwalkan sambung ulang', async () => {
    const { link, sockets, timers } = setup()
    link.start()
    await flush()
    link.stop()
    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(link.isConnected).toBe(false)
    expect(timers).toHaveLength(0)
  })

  it('update dengan IP baru menyambung ulang ke target baru', async () => {
    const { link, factory, sockets } = setup()
    link.start()
    await flush()
    link.update({ ...target, ip: '192.168.1.99' })
    await flush()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(link.currentTarget.ip).toBe('192.168.1.99')
    // target sama → tidak ada sambungan ulang
    link.update({ ...target, ip: '192.168.1.99' })
    await flush()
    expect(factory).toHaveBeenCalledTimes(2)
  })
})

describe('parseBroadcast', () => {
  it('mendekode paket broadcast Tuya (dibuat dengan encoder tuyapi)', () => {
    const { MessageParser } = parserModule
    const { UDP_KEY } = configModule
    const parser = new MessageParser({ key: UDP_KEY, version: '3.1' })
    const frame = parser.encode({ data: { ip: '192.168.1.50', gwId: 'abc123', version: '3.3', productKey: 'pk' }, encrypted: false, commandByte: 0, sequenceN: 1 })
    expect(parseBroadcast(frame)).toEqual({ id: 'abc123', ip: '192.168.1.50', version: '3.3' })
  })

  it('mengabaikan sampah tanpa melempar error', () => {
    expect(parseBroadcast(Buffer.from('halo dunia'))).toBeNull()
    expect(parseBroadcast(Buffer.alloc(0))).toBeNull()
  })
})
