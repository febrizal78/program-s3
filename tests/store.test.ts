import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { Store, maskAccessId, type SecretCipher } from '../src/main/store'

const xorCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8')
}
const noCipher: SecretCipher = { ...xorCipher, isAvailable: () => false }

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'tuya-store-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('Store', () => {
  it('pengaturan: default, lalu digabung dengan perubahan', () => {
    const s = new Store(tmp(), xorCipher)
    expect(s.getSettings()).toEqual(DEFAULT_SETTINGS)
    s.saveSettings({ region: 'sg', pollIntervalSec: 45 })
    expect(s.getSettings()).toMatchObject({ region: 'sg', pollIntervalSec: 45, lanEnabled: true })
  })

  it('kredensial disimpan terenkripsi dan tidak muncul sebagai teks biasa', () => {
    const dir = tmp()
    const s = new Store(dir, xorCipher)
    expect(s.getSecrets()).toBeNull()
    expect(s.saveSecrets({ accessId: 'ID123456789', accessSecret: 'SUPERSECRET' })).toBe(true)
    expect(readFileSync(path.join(dir, 'secrets.json'), 'utf8')).not.toContain('SUPERSECRET')
    expect(s.getSecrets()).toEqual({ accessId: 'ID123456789', accessSecret: 'SUPERSECRET' })
    expect(s.secretsEncrypted()).toBe(true)
  })

  it('tanpa enkripsi OS: tersimpan apa adanya dan ditandai tidak terenkripsi', () => {
    const s = new Store(tmp(), noCipher)
    expect(s.saveSecrets({ accessId: 'a', accessSecret: 'b' })).toBe(false)
    expect(s.getSecrets()).toEqual({ accessId: 'a', accessSecret: 'b' })
    expect(s.secretsEncrypted()).toBe(false)
  })

  it('file rusak tidak membuat crash', () => {
    const dir = tmp()
    const s = new Store(dir, xorCipher)
    s.saveSecrets({ accessId: 'a', accessSecret: 'b' })
    writeFileSync(path.join(dir, 'secrets.json'), '{rusak')
    expect(s.getSecrets()).toBeNull()
  })

  it('jadwal & cache perangkat', () => {
    const s = new Store(tmp(), xorCipher)
    expect(s.getSchedules()).toEqual([])
    s.saveSchedules([{ id: '1', name: 'x', enabled: true, kind: 'daily', time: '07:00', days: [1], action: { type: 'scene', homeId: 'h', sceneId: 's' } }])
    expect(s.getSchedules()).toHaveLength(1)
    s.saveDeviceCache({ d1: { specs: [], fetchedAt: 1 } })
    expect(s.getDeviceCache().d1.fetchedAt).toBe(1)
  })

  it('maskAccessId', () => {
    expect(maskAccessId('abcdefghijklmnop')).toBe('abcd••••mnop')
    expect(maskAccessId('abc')).toBe('••••')
    expect(maskAccessId('')).toBe('')
  })
})
