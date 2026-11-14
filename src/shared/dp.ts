import type { DpSpec, DpType } from './types'

// ───────────────────────── Spesifikasi DP ─────────────────────────

const TYPE_MAP: Record<string, DpType> = {
  boolean: 'boolean',
  bool: 'boolean',
  enum: 'enum',
  integer: 'integer',
  value: 'integer',
  string: 'string',
  json: 'json',
  raw: 'raw',
  bitmap: 'bitmap',
  bitmask: 'bitmap'
}

export function normalizeDpType(type: unknown): DpType {
  return TYPE_MAP[String(type ?? '').toLowerCase()] ?? 'raw'
}

/** `values` pada spesifikasi cloud berupa string JSON (atau objek). */
export function parseSpecValues(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

interface RawSpecItem {
  code?: string
  type?: string
  values?: unknown
  name?: string
  desc?: string
  dp_id?: number
}

/** Gabungkan daftar `functions` (bisa ditulis) dan `status` (bisa dibaca) dari cloud. */
export function mergeSpecs(functions: RawSpecItem[] = [], status: RawSpecItem[] = []): DpSpec[] {
  const out = new Map<string, { spec: DpSpec; write: boolean; read: boolean }>()
  const add = (item: RawSpecItem, write: boolean, read: boolean): void => {
    if (!item.code) return
    const entry = out.get(item.code) ?? {
      spec: { code: item.code, name: item.name || item.desc || undefined, type: normalizeDpType(item.type), mode: 'ro' as const },
      write: false,
      read: false
    }
    const values = parseSpecValues(item.values)
    const spec = entry.spec
    if (Array.isArray(values.range)) spec.range = values.range.map(String)
    for (const key of ['min', 'max', 'step', 'scale'] as const) {
      if (typeof values[key] === 'number') spec[key] = values[key] as number
    }
    if (typeof values.unit === 'string' && values.unit) spec.unit = values.unit
    entry.write ||= write
    entry.read ||= read
    spec.mode = entry.write && entry.read ? 'rw' : entry.write ? 'wo' : 'ro'
    out.set(item.code, entry)
  }
  for (const f of functions) add(f, true, false)
  for (const s of status) add(s, false, true)
  return [...out.values()].map((e) => e.spec)
}

// ───────────────────────── Nilai ─────────────────────────

/** Nilai integer Tuya disimpan dikali 10^scale; kembalikan nilai tampilan. */
export function toDisplayNumber(raw: number, scale = 0): number {
  return scale > 0 ? raw / 10 ** scale : raw
}

export function fromDisplayNumber(display: number, scale = 0): number {
  return scale > 0 ? Math.round(display * 10 ** scale) : Math.round(display)
}

/** Normalisasi nilai dari cloud: DP warna datang sebagai string JSON. */
export function normalizeCloudValue(code: string, value: unknown): unknown {
  if (isColourCode(code) && typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

export function isColourCode(code: string): boolean {
  return code === 'colour_data' || code === 'colour_data_v2'
}

// ───────────────────────── Warna ─────────────────────────

export interface Hsv {
  h: number
  s: number
  v: number
}

/** Skala S/V: 1000 untuk `colour_data_v2`, 255 untuk `colour_data`. */
export function colourScale(code: string): number {
  return code === 'colour_data' ? 255 : 1000
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  // h: 0-360, s/v: 0-1
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h: Math.round(h) % 360, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHexColor(hsv: Hsv, scale: number): string {
  const [r, g, b] = hsvToRgb(hsv.h, hsv.s / scale, hsv.v / scale)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

export function hexColorToHsv(hex: string, scale: number): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { h: 0, s: 0, v: scale }
  const n = parseInt(m[1], 16)
  const { h, s, v } = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255)
  return { h, s: Math.round(s * scale), v: Math.round(v * scale) }
}

const hex = (n: number, width: number): string => Math.round(n).toString(16).padStart(width, '0')

/**
 * Konversi nilai DP warna (objek HSV) ke string heksadesimal yang dipakai
 * perangkat di LAN: v2 = `hhhhssssvvvv`, v1 = `rrggbb` + `hhhhssvv`.
 */
export function colourToLocal(code: string, value: unknown): string {
  const hsv = (typeof value === 'string' ? JSON.parse(value) : value) as Hsv
  if (code === 'colour_data') {
    const [r, g, b] = hsvToRgb(hsv.h, hsv.s / 255, hsv.v / 255)
    return hex(r, 2) + hex(g, 2) + hex(b, 2) + hex(hsv.h, 4) + hex(hsv.s, 2) + hex(hsv.v, 2)
  }
  return hex(hsv.h, 4) + hex(hsv.s, 4) + hex(hsv.v, 4)
}

export function colourFromLocal(code: string, raw: unknown): unknown {
  if (typeof raw !== 'string' || !/^[0-9a-f]+$/i.test(raw)) return raw
  if (code === 'colour_data' && raw.length === 14) {
    return { h: parseInt(raw.slice(6, 10), 16), s: parseInt(raw.slice(10, 12), 16), v: parseInt(raw.slice(12, 14), 16) }
  }
  if (code === 'colour_data_v2' && raw.length === 12) {
    return { h: parseInt(raw.slice(0, 4), 16), s: parseInt(raw.slice(4, 8), 16), v: parseInt(raw.slice(8, 12), 16) }
  }
  return raw
}

/** Nilai format-cloud → nilai yang dikirim ke perangkat via LAN. */
export function toLocalValue(code: string, value: unknown): unknown {
  return isColourCode(code) ? colourToLocal(code, value) : value
}

/** Nilai mentah dari perangkat (LAN) → format-cloud. */
export function fromLocalValue(code: string, raw: unknown): unknown {
  return isColourCode(code) ? colourFromLocal(code, raw) : raw
}

// ───────────────────────── Heuristik UI ─────────────────────────

/** Kode DP yang dianggap saklar utama, berurutan dari yang paling diutamakan. */
const PRIMARY_SWITCH_CODES = ['switch_led', 'switch', 'switch_1', 'led_switch', 'master_switch']

/** Saklar-saklar bernomor (`switch_1`, `switch_2`, …) yang bisa ditulis — perangkat multi-gang. */
export function gangSwitches(specs: DpSpec[]): DpSpec[] {
  return specs.filter((s) => /^switch_\d+$/.test(s.code) && s.type === 'boolean' && s.mode !== 'ro')
}

/**
 * Saklar utama untuk toggle cepat di kartu. Perangkat multi-gang tidak punya
 * saklar utama (satu toggle akan menyesatkan); kontrolnya ada di panel detail.
 */
export function primarySwitch(specs: DpSpec[]): DpSpec | undefined {
  if (gangSwitches(specs).length > 1) return undefined
  for (const code of PRIMARY_SWITCH_CODES) {
    const found = specs.find((s) => s.code === code && s.type === 'boolean' && s.mode !== 'ro')
    if (found) return found
  }
  return undefined
}

const CODE_LABELS: Record<string, string> = {
  switch_led: 'Daya',
  switch: 'Daya',
  switch_1: 'Saklar 1',
  switch_2: 'Saklar 2',
  switch_3: 'Saklar 3',
  switch_4: 'Saklar 4',
  switch_5: 'Saklar 5',
  switch_6: 'Saklar 6',
  work_mode: 'Mode',
  bright_value: 'Kecerahan',
  bright_value_v2: 'Kecerahan',
  temp_value: 'Suhu warna',
  temp_value_v2: 'Suhu warna',
  colour_data: 'Warna',
  colour_data_v2: 'Warna',
  scene_data: 'Data scene',
  scene_data_v2: 'Data scene',
  countdown_1: 'Hitung mundur',
  countdown: 'Hitung mundur',
  cur_power: 'Daya listrik',
  cur_voltage: 'Tegangan',
  cur_current: 'Arus',
  add_ele: 'Energi terakumulasi',
  battery_percentage: 'Baterai',
  va_temperature: 'Suhu',
  va_humidity: 'Kelembapan',
  temp_current: 'Suhu saat ini',
  temp_set: 'Suhu target',
  control: 'Kontrol',
  percent_control: 'Posisi (%)',
  percent_state: 'Posisi saat ini (%)'
}

export function labelForCode(spec: Pick<DpSpec, 'code' | 'name'>): string {
  return CODE_LABELS[spec.code] ?? spec.name ?? spec.code.replace(/_/g, ' ')
}
