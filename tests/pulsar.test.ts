import { EventEmitter } from 'node:events'
import { createCipheriv, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { PulsarClient, buildPulsarUrl, decodePulsarFrame, decryptPulsarData, derivePulsarPassword } from '../src/main/tuya/pulsar'

const ACCESS_ID = 'abc123'
const ACCESS_KEY = '0123456789abcdefghijklmnopqrstuv'

const md5 = (s: string): string => createHash('md5').update(s).digest('hex')

function encrypt(plain: string, accessKey = ACCESS_KEY): string {
  const c = createCipheriv('aes-128-ecb', Buffer.from(accessKey.slice(8, 24)), null)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64')
}

function frame(messageId: string, data: unknown): string {
  const inner = JSON.stringify({ data: encrypt(JSON.stringify(data)), protocol: 4, pv: '2.0', t: 1 })
  return JSON.stringify({ messageId, payload: Buffer.from(inner).toString('base64') })
}

describe('pulsar helpers', () => {
  it('kata sandi = md5(id + md5(key))[8..24]', () => {
    const pw = derivePulsarPassword(ACCESS_ID, ACCESS_KEY)
    expect(pw).toBe(md5(ACCESS_ID + md5(ACCESS_KEY)).slice(8, 24))
    expect(pw).toHaveLength(16)
  })

  it('URL', () => {
    expect(buildPulsarUrl('wss://mqe.tuyaeu.com:8285', ACCESS_ID)).toBe(
      'wss://mqe.tuyaeu.com:8285/ws/v2/consumer/persistent/abc123/out/event/abc123-sub?ackTimeoutMillis=3000&subscriptionType=Failover'
    )
  })

  it('dekripsi AES-ECB dengan kunci accessKey[8..24]', () => {
    expect(decryptPulsarData(encrypt('{"hello":"dunia"}'), ACCESS_KEY)).toBe('{"hello":"dunia"}')
  })

  it('decodePulsarFrame: laporan status', () => {
    const d = decodePulsarFrame(frame('m1', { devId: 'dev1', status: [{ code: 'switch_led', value: true, t: 1 }] }), ACCESS_KEY)
    expect(d).toEqual({ messageId: 'm1', event: { devId: 'dev1', status: [{ code: 'switch_led', value: true, t: 1 }], bizCode: undefined } })
  })

  it('decodePulsarFrame: bizCode online dan input rusak', () => {
    const d = decodePulsarFrame(frame('m2', { devId: 'dev1', bizCode: 'offline', bizData: { time: 1 } }), ACCESS_KEY)
    expect(d?.event?.bizCode).toBe('offline')
    expect(decodePulsarFrame('bukan json', ACCESS_KEY)).toBeNull()
    expect(decodePulsarFrame(JSON.stringify({ messageId: 'x', payload: 'bukan-base64-json' }), ACCESS_KEY)).toEqual({ messageId: 'x', event: null })
    // kunci salah → event null, tetap bisa di-ack
    expect(decodePulsarFrame(frame('m3', { devId: 'd' }), 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')?.event).toBeNull()
  })
})

describe('PulsarClient', () => {
  class FakeWs extends EventEmitter {
    send = vi.fn()
    close = vi.fn()
  }

  it('menyambung dengan header kredensial, mengirim ack, dan memancarkan event', () => {
    const ws = new FakeWs()
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const client = new PulsarClient({
      accessId: ACCESS_ID,
      accessKey: ACCESS_KEY,
      wsBase: 'wss://mqe.example.com:8285/',
      createSocket: (url, headers) => {
        seenUrl = url
        seenHeaders = headers
        return ws as unknown as WebSocket
      }
    })
    const events: unknown[] = []
    const states: string[] = []
    client.on('event', (e) => events.push(e))
    client.on('state', (s) => states.push(s))
    client.start()
    expect(seenUrl).toContain('/ws/v2/consumer/persistent/abc123/')
    expect(seenHeaders.username).toBe(ACCESS_ID)
    expect(seenHeaders.password).toBe(derivePulsarPassword(ACCESS_ID, ACCESS_KEY))

    ws.emit('open')
    ws.emit('message', Buffer.from(frame('m1', { devId: 'dev1', status: [{ code: 'switch_led', value: false }] })))
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ messageId: 'm1' }))
    expect(events).toEqual([{ devId: 'dev1', status: [{ code: 'switch_led', value: false }], bizCode: undefined }])
    expect(states).toEqual(['connecting', 'connected'])

    client.stop()
    expect(ws.close).toHaveBeenCalled()
    expect(states.at(-1)).toBe('stopped')
  })

  it('menjadwalkan sambung ulang setelah koneksi tertutup', () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeWs[] = []
      const client = new PulsarClient({
        accessId: ACCESS_ID,
        accessKey: ACCESS_KEY,
        wsBase: 'wss://x/',
        reconnectMs: 1000,
        createSocket: () => {
          const s = new FakeWs()
          sockets.push(s)
          return s as unknown as WebSocket
        }
      })
      const states: string[] = []
      client.on('state', (s) => states.push(s))
      client.start()
      sockets[0].emit('close')
      expect(states.at(-1)).toBe('error')
      vi.advanceTimersByTime(1000)
      expect(sockets).toHaveLength(2)
      client.stop()
      sockets[1].emit('close')
      vi.advanceTimersByTime(200_000)
      expect(sockets).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
