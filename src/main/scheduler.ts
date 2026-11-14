import { EventEmitter } from 'node:events'
import type { Schedule, ScheduleAction } from '../shared/types'

export type ActionRunner = (action: ScheduleAction) => Promise<void>

export interface SchedulerOptions {
  /** Interval pemeriksaan (ms). */
  tickMs?: number
  now?: () => Date
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validateSchedule(s: Schedule): string | null {
  if (!s.name.trim()) return 'Nama jadwal wajib diisi'
  if (s.kind === 'daily') {
    if (!HHMM.test(s.time)) return 'Jam harus berformat HH:MM'
    if (!s.days.length) return 'Pilih minimal satu hari'
    if (s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Hari tidak valid'
  } else if (!s.fireAt || !Number.isFinite(s.fireAt)) {
    return 'Waktu eksekusi wajib diisi'
  }
  if (s.action.type === 'dp') {
    if (!s.action.deviceId) return 'Pilih perangkat'
    if (Object.keys(s.action.values).length === 0) return 'Aksi perangkat kosong'
  } else if (!s.action.homeId || !s.action.sceneId) {
    return 'Pilih scene'
  }
  return null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Kunci menit (`YYYY-MM-DD HH:MM`) untuk mencegah eksekusi ganda dalam satu menit. */
export function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Apakah jadwal jatuh tempo pada waktu `now`? */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false
  if (s.kind === 'once') return typeof s.fireAt === 'number' && now.getTime() >= s.fireAt
  if (!s.days.includes(now.getDay())) return false
  return s.time === `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * Penjadwal di dalam aplikasi. Berjalan selama aplikasi hidup (tray menjaga proses
 * tetap berjalan saat jendela ditutup). Jadwal yang terlewat saat aplikasi mati
 * tidak dijalankan — kecuali jadwal sekali jalan, yang dijalankan saat aplikasi
 * hidup lagi selama belum lewat 10 menit.
 *
 * Event: `changed` (Schedule[]), `log` (string)
 */
export class Scheduler extends EventEmitter {
  private timer?: ReturnType<typeof setInterval>
  private lastKey = new Map<string, string>()
  private running = false
  private readonly now: () => Date
  private readonly tickMs: number

  constructor(
    private schedules: Schedule[],
    private readonly persist: (s: Schedule[]) => void,
    private readonly run: ActionRunner,
    opts: SchedulerOptions = {}
  ) {
    super()
    this.now = opts.now ?? (() => new Date())
    this.tickMs = opts.tickMs ?? 15_000
  }

  list(): Schedule[] {
    return this.schedules
  }

  start(): void {
    if (this.timer) return
    const safeTick = (): void => {
      this.tick().catch((err: Error) => this.emit('log', `Penjadwal error: ${err.message}`))
    }
    this.timer = setInterval(safeTick, this.tickMs)
    safeTick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  upsert(schedule: Schedule): Schedule[] {
    const err = validateSchedule(schedule)
    if (err) throw new Error(err)
    const idx = this.schedules.findIndex((s) => s.id === schedule.id)
    if (idx >= 0) this.schedules[idx] = schedule
    else this.schedules.push(schedule)
    this.lastKey.delete(schedule.id)
    this.commit()
    return this.schedules
  }

  remove(id: string): Schedule[] {
    this.schedules = this.schedules.filter((s) => s.id !== id)
    this.lastKey.delete(id)
    this.commit()
    return this.schedules
  }

  private commit(): void {
    this.persist(this.schedules)
    this.emit('changed', this.schedules)
  }

  /** Dipanggil berkala; diekspos untuk pengujian. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = this.now()
      const key = minuteKey(now)
      for (const s of [...this.schedules]) {
        if (!isDue(s, now)) continue
        if (s.kind === 'once' && s.fireAt && now.getTime() - s.fireAt > 10 * 60_000) {
          // Terlalu lama terlewat — matikan tanpa menjalankan.
          s.enabled = false
          s.lastResult = 'Dilewati (aplikasi tidak aktif saat waktunya tiba)'
          this.commit()
          continue
        }
        if (this.lastKey.get(s.id) === key) continue
        this.lastKey.set(s.id, key)
        await this.fire(s, now)
      }
    } finally {
      this.running = false
    }
  }

  private async fire(s: Schedule, now: Date): Promise<void> {
    try {
      await this.run(s.action)
      s.lastResult = 'Berhasil'
      this.emit('log', `Jadwal "${s.name}" dijalankan`)
    } catch (err) {
      s.lastResult = `Gagal: ${(err as Error).message}`
      this.emit('log', `Jadwal "${s.name}" gagal: ${(err as Error).message}`)
    }
    s.lastRunAt = now.getTime()
    if (s.kind === 'once') s.enabled = false
    this.commit()
  }
}
