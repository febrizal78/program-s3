import { describe, expect, it, vi } from 'vitest'
import { Scheduler, isDue, minuteKey, validateSchedule } from '../src/main/scheduler'
import type { Schedule } from '../src/shared/types'

const base = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1',
  name: 'Tes',
  enabled: true,
  kind: 'daily',
  time: '07:00',
  days: [1, 2, 3, 4, 5],
  action: { type: 'dp', deviceId: 'd1', values: { switch_led: true } },
  ...over
})

// 2025-01-06 adalah hari Senin (getDay() = 1)
const monday = (h: number, m: number, s = 0): Date => new Date(2025, 0, 6, h, m, s)
const sunday = (h: number, m: number): Date => new Date(2025, 0, 5, h, m)

describe('validateSchedule', () => {
  it('menerima jadwal valid', () => expect(validateSchedule(base())).toBeNull())
  it('menolak nama kosong, jam salah, hari kosong, aksi kosong', () => {
    expect(validateSchedule(base({ name: ' ' }))).toMatch(/Nama/)
    expect(validateSchedule(base({ time: '7:00' }))).toMatch(/HH:MM/)
    expect(validateSchedule(base({ time: '25:00' }))).toMatch(/HH:MM/)
    expect(validateSchedule(base({ days: [] }))).toMatch(/hari/)
    expect(validateSchedule(base({ days: [9] }))).toMatch(/Hari/)
    expect(validateSchedule(base({ action: { type: 'dp', deviceId: '', values: {} } }))).toMatch(/perangkat/)
    expect(validateSchedule(base({ action: { type: 'dp', deviceId: 'd', values: {} } }))).toMatch(/kosong/)
    expect(validateSchedule(base({ action: { type: 'scene', homeId: '', sceneId: '' } }))).toMatch(/scene/i)
    expect(validateSchedule(base({ kind: 'once', fireAt: undefined }))).toMatch(/Waktu/)
  })
})

describe('isDue', () => {
  it('cocok pada hari & menit yang tepat', () => {
    expect(isDue(base(), monday(7, 0, 30))).toBe(true)
    expect(isDue(base(), monday(7, 1))).toBe(false)
    expect(isDue(base(), sunday(7, 0))).toBe(false)
    expect(isDue(base({ enabled: false }), monday(7, 0))).toBe(false)
  })
  it('sekali jalan jatuh tempo setelah fireAt', () => {
    const s = base({ kind: 'once', fireAt: monday(8, 0).getTime() })
    expect(isDue(s, monday(7, 59))).toBe(false)
    expect(isDue(s, monday(8, 0))).toBe(true)
  })
  it('minuteKey', () => expect(minuteKey(monday(7, 5))).toBe('2025-01-06 07:05'))
})

describe('Scheduler', () => {
  const setup = (schedules: Schedule[], nowRef: { d: Date }, run = vi.fn(async () => undefined)) => {
    const persist = vi.fn()
    const sch = new Scheduler(schedules, persist, run, { now: () => nowRef.d })
    return { sch, persist, run }
  }

  it('menjalankan aksi sekali per menit', async () => {
    const now = { d: monday(7, 0, 5) }
    const { sch, run } = setup([base()], now)
    await sch.tick()
    await sch.tick() // menit yang sama → tidak dobel
    expect(run).toHaveBeenCalledTimes(1)
    now.d = monday(7, 1)
    await sch.tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(sch.list()[0].lastResult).toBe('Berhasil')
  })

  it('jadwal sekali jalan dinonaktifkan setelah dijalankan', async () => {
    const now = { d: monday(8, 0, 10) }
    const { sch, run } = setup([base({ kind: 'once', fireAt: monday(8, 0).getTime() })], now)
    await sch.tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(sch.list()[0].enabled).toBe(false)
    await sch.tick()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('jadwal sekali jalan yang terlewat >10 menit dilewati tanpa eksekusi', async () => {
    const now = { d: monday(9, 0) }
    const { sch, run } = setup([base({ kind: 'once', fireAt: monday(8, 0).getTime() })], now)
    await sch.tick()
    expect(run).not.toHaveBeenCalled()
    expect(sch.list()[0].enabled).toBe(false)
    expect(sch.list()[0].lastResult).toMatch(/Dilewati/)
  })

  it('mencatat kegagalan tanpa menghentikan penjadwal', async () => {
    const now = { d: monday(7, 0) }
    const run = vi.fn(async () => {
      throw new Error('offline')
    })
    const { sch } = setup([base(), base({ id: 's2', name: 'Kedua' })], now, run)
    await sch.tick()
    expect(run).toHaveBeenCalledTimes(2)
    expect(sch.list()[0].lastResult).toBe('Gagal: offline')
  })

  it('upsert memvalidasi, menyimpan, dan memancarkan perubahan; remove menghapus', () => {
    const now = { d: monday(6, 0) }
    const { sch, persist } = setup([], now)
    const changed = vi.fn()
    sch.on('changed', changed)
    expect(() => sch.upsert(base({ name: '' }))).toThrow(/Nama/)
    sch.upsert(base())
    sch.upsert(base({ name: 'Ganti' }))
    expect(sch.list()).toHaveLength(1)
    expect(sch.list()[0].name).toBe('Ganti')
    expect(persist).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenCalledTimes(2)
    sch.remove('s1')
    expect(sch.list()).toHaveLength(0)
  })
})
