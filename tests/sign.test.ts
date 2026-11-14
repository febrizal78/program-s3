import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EMPTY_BODY_SHA256, buildStringToSign, canonicalUrl, sha256Hex, signRequest } from '../src/main/tuya/sign'

describe('sign', () => {
  it('konstanta hash body kosong benar', () => {
    expect(EMPTY_BODY_SHA256).toBe(createHash('sha256').update('').digest('hex'))
    expect(sha256Hex('')).toBe(EMPTY_BODY_SHA256)
  })

  it('canonicalUrl mengurutkan query & membuang nilai kosong', () => {
    expect(canonicalUrl('/v1.0/x')).toBe('/v1.0/x')
    expect(canonicalUrl('/v1.0/x', { b: 2, a: 'z', c: undefined, d: '' })).toBe('/v1.0/x?a=z&b=2')
  })

  it('stringToSign: METHOD, hash body, baris kosong, url', () => {
    expect(buildStringToSign('get', '/v1.0/token?grant_type=1')).toBe(`GET\n${EMPTY_BODY_SHA256}\n\n/v1.0/token?grant_type=1`)
    const body = '{"commands":[]}'
    expect(buildStringToSign('POST', '/v1.0/devices/1/commands', body)).toBe(`POST\n${sha256Hex(body)}\n\n/v1.0/devices/1/commands`)
  })

  it('tanda tangan token = HMAC(clientId + t + nonce + stringToSign), huruf besar', () => {
    const input = { clientId: 'cid', secret: 'sec', t: '1700000000000', nonce: 'n1', method: 'GET', url: '/v1.0/token?grant_type=1' }
    const expected = createHmac('sha256', 'sec')
      .update('cid' + '1700000000000' + 'n1' + buildStringToSign('GET', input.url))
      .digest('hex')
      .toUpperCase()
    expect(signRequest(input)).toBe(expected)
    expect(signRequest(input)).toMatch(/^[0-9A-F]{64}$/)
  })

  it('tanda tangan bisnis menyertakan access_token', () => {
    const base = { clientId: 'cid', secret: 'sec', t: '1', nonce: 'n', method: 'GET', url: '/v1.0/devices/1/status' }
    const withToken = signRequest({ ...base, accessToken: 'tok' })
    const expected = createHmac('sha256', 'sec')
      .update('cid' + 'tok' + '1' + 'n' + buildStringToSign('GET', base.url))
      .digest('hex')
      .toUpperCase()
    expect(withToken).toBe(expected)
    expect(withToken).not.toBe(signRequest(base))
  })
})
