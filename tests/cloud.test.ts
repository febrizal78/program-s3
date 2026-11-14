import { describe, expect, it, vi } from 'vitest'
import { TuyaApiError, TuyaCloud, parseDevicePage } from '../src/main/tuya/cloud'
import { signRequest } from '../src/main/tuya/sign'

type Call = { url: string; init: RequestInit }

function fakeFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const body = handler(String(url), init ?? {})
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const tokenOk = { success: true, result: { access_token: 'TOK', refresh_token: 'R', expire_time: 7200, uid: 'U1' } }

function make(handler: (url: string, init: RequestInit) => unknown, now = () => 1_700_000_000_000) {
  const f = fakeFetch(handler)
  const cloud = new TuyaCloud({ accessId: 'AID', accessSecret: 'SEC', endpoint: 'https://openapi.example.com/', fetchImpl: f.impl, now, nonce: () => 'NONCE' })
  return { cloud, ...f }
}

describe('TuyaCloud', () => {
  it('mengambil token dengan header tanda tangan yang benar', async () => {
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: [] }))
    await cloud.getToken()
    const [call] = calls
    expect(call.url).toBe('https://openapi.example.com/v1.0/token?grant_type=1')
    const h = call.init.headers as Record<string, string>
    expect(h.client_id).toBe('AID')
    expect(h.sign_method).toBe('HMAC-SHA256')
    expect(h.t).toBe('1700000000000')
    expect(h.access_token).toBeUndefined()
    expect(h.sign).toBe(signRequest({ clientId: 'AID', secret: 'SEC', t: '1700000000000', nonce: 'NONCE', method: 'GET', url: '/v1.0/token?grant_type=1' }))
  })

  it('request bisnis memakai access_token & di-cache (token tidak diambil ulang)', async () => {
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: [{ code: 'switch_led', value: true }] }))
    await cloud.getStatus('dev1')
    await cloud.getStatus('dev1')
    const tokenCalls = calls.filter((c) => c.url.includes('/v1.0/token'))
    expect(tokenCalls).toHaveLength(1)
    const biz = calls.filter((c) => c.url.includes('/status'))
    expect(biz).toHaveLength(2)
    expect((biz[0].init.headers as Record<string, string>).access_token).toBe('TOK')
  })

  it('mengambil token baru saat hampir kedaluwarsa', async () => {
    let t = 1_700_000_000_000
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: [] }), () => t)
    await cloud.getStatus('a')
    t += 7200 * 1000 - 30_000 // sisa 30 dtk < margin 60 dtk
    await cloud.getStatus('a')
    expect(calls.filter((c) => c.url.includes('/v1.0/token'))).toHaveLength(2)
  })

  it('mengulang sekali bila token ditolak (1010)', async () => {
    let first = true
    const { cloud, calls } = make((url) => {
      if (url.includes('/v1.0/token')) return tokenOk
      if (first) {
        first = false
        return { success: false, code: 1010, msg: 'token invalid' }
      }
      return { success: true, result: [] }
    })
    await expect(cloud.getStatus('x')).resolves.toEqual([])
    expect(calls.filter((c) => c.url.includes('/v1.0/token'))).toHaveLength(2)
  })

  it('menerjemahkan error 1004 menjadi pesan ramah', async () => {
    const { cloud } = make(() => ({ success: false, code: 1004, msg: 'sign invalid' }))
    await expect(cloud.getToken()).rejects.toThrow(/Access ID\/Secret/)
    await expect(cloud.getToken(true)).rejects.toBeInstanceOf(TuyaApiError)
  })

  it('error jaringan dibungkus TuyaApiError', async () => {
    const cloud = new TuyaCloud({ accessId: 'a', accessSecret: 'b', endpoint: 'https://x', fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch })
    await expect(cloud.getToken()).rejects.toThrow(/ECONNREFUSED/)
  })

  it('sendCommands mengirim body JSON & menandatanganinya', async () => {
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: true }))
    await cloud.sendCommands('dev1', [{ code: 'switch_led', value: true }])
    const call = calls.find((c) => c.url.endsWith('/v1.0/devices/dev1/commands'))!
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe('{"commands":[{"code":"switch_led","value":true}]}')
    const h = call.init.headers as Record<string, string>
    expect(h.sign).toBe(
      signRequest({ clientId: 'AID', secret: 'SEC', accessToken: 'TOK', t: '1700000000000', nonce: 'NONCE', method: 'POST', url: '/v1.0/devices/dev1/commands', body: call.init.body as string })
    )
  })

  it('listDevices(uid) memakai /v1.0/users/{uid}/devices', async () => {
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: [{ id: 'd1', name: 'A', category: 'dj' }] }))
    const list = await cloud.listDevices('U 1')
    expect(list).toHaveLength(1)
    expect(calls.some((c) => c.url.endsWith('/v1.0/users/U%201/devices'))).toBe(true)
  })

  it('listDevices tanpa uid membaca halaman demi halaman', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, name: `n${i}`, category: 'dj' }))
    const page2 = [{ id: 'd20', name: 'n20', category: 'dj' }]
    const { cloud, calls } = make((url) => {
      if (url.includes('/v1.0/token')) return tokenOk
      return { success: true, result: url.includes('last_id=d19') ? page2 : page1 }
    })
    const list = await cloud.listDevices()
    expect(list).toHaveLength(21)
    expect(calls.filter((c) => c.url.includes('/v2.0/cloud/thing/device'))).toHaveLength(2)
  })

  it('getStatusBatch memecah per 20 id', async () => {
    const { cloud, calls } = make((url) => (url.includes('/v1.0/token') ? tokenOk : { success: true, result: [] }))
    await cloud.getStatusBatch(Array.from({ length: 45 }, (_, i) => `d${i}`))
    expect(calls.filter((c) => c.url.includes('/v1.0/devices/status'))).toHaveLength(3)
  })

  it('parseDevicePage menerima array maupun objek', () => {
    expect(parseDevicePage([{ id: 'a' }]).items).toHaveLength(1)
    expect(parseDevicePage({ list: [{ id: 'a' }], last_id: 'z' })).toEqual({ items: [{ id: 'a' }], next: 'z' })
    expect(parseDevicePage(null).items).toEqual([])
  })
})
