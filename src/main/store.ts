import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type Schedule, type Secrets, type Settings } from '../shared/types'

/** Abstraksi enkripsi (Electron `safeStorage` / DPAPI di Windows). */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** Fungsi cache yang disimpan: spesifikasi & pemetaan DP per perangkat. */
export interface CachedDevice {
  specs: import('../shared/types').DpSpec[]
  fetchedAt: number
}

interface SecretsFile {
  encrypted: boolean
  /** base64 dari data terenkripsi, atau JSON apa adanya bila enkripsi tidak tersedia. */
  data: string
}

function writeAtomic(file: string, content: string | Buffer, mode?: number): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, mode ? { mode } : undefined)
  renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/**
 * Penyimpanan JSON sederhana di direktori data aplikasi.
 * Kredensial dienkripsi dengan cipher OS; sisanya teks biasa.
 */
export class Store {
  constructor(
    private readonly dir: string,
    private readonly cipher: SecretCipher
  ) {
    mkdirSync(dir, { recursive: true })
  }

  private file(name: string): string {
    return path.join(this.dir, name)
  }

  // ── Pengaturan ──

  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(this.file('settings.json'), {}) }
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch }
    writeAtomic(this.file('settings.json'), JSON.stringify(next, null, 2))
    return next
  }

  // ── Kredensial ──

  getSecrets(): Secrets | null {
    const raw = readJson<SecretsFile | null>(this.file('secrets.json'), null)
    if (!raw) return null
    try {
      const json = raw.encrypted ? this.cipher.decrypt(Buffer.from(raw.data, 'base64')) : raw.data
      const parsed = JSON.parse(json) as Secrets
      return parsed.accessId && parsed.accessSecret ? parsed : null
    } catch {
      return null
    }
  }

  /** @returns true bila disimpan terenkripsi. */
  saveSecrets(secrets: Secrets | null): boolean {
    const file = this.file('secrets.json')
    if (!secrets) {
      rmSync(file, { force: true })
      return true
    }
    const json = JSON.stringify(secrets)
    const encrypted = this.cipher.isAvailable()
    const content: SecretsFile = encrypted
      ? { encrypted: true, data: this.cipher.encrypt(json).toString('base64') }
      : { encrypted: false, data: json }
    writeAtomic(file, JSON.stringify(content), 0o600)
    return encrypted
  }

  secretsEncrypted(): boolean {
    const raw = readJson<SecretsFile | null>(this.file('secrets.json'), null)
    return raw ? raw.encrypted : this.cipher.isAvailable()
  }

  // ── Jadwal ──

  getSchedules(): Schedule[] {
    return readJson<Schedule[]>(this.file('schedules.json'), [])
  }

  saveSchedules(schedules: Schedule[]): void {
    writeAtomic(this.file('schedules.json'), JSON.stringify(schedules, null, 2))
  }

  // ── Cache spesifikasi perangkat ──

  getDeviceCache(): Record<string, CachedDevice> {
    return readJson<Record<string, CachedDevice>>(this.file('device-cache.json'), {})
  }

  saveDeviceCache(cache: Record<string, CachedDevice>): void {
    writeAtomic(this.file('device-cache.json'), JSON.stringify(cache))
  }
}

export function maskAccessId(id: string): string {
  if (id.length <= 8) return id ? '••••' : ''
  return `${id.slice(0, 4)}••••${id.slice(-4)}`
}
