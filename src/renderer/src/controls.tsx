import { useEffect, useRef, useState, type JSX } from 'react'
import {
  colourScale,
  hexColorToHsv,
  hsvToHexColor,
  isColourCode,
  labelForCode,
  toDisplayNumber,
  type Hsv
} from '../../shared/dp'
import type { DpSpec } from '../../shared/types'

// ───────────────────────── Format tampilan ─────────────────────────

const ENUM_LABELS: Record<string, string> = {
  white: 'Putih',
  colour: 'Warna',
  scene: 'Scene',
  music: 'Musik',
  open: 'Buka',
  close: 'Tutup',
  stop: 'Berhenti',
  cold: 'Dingin',
  hot: 'Panas',
  auto: 'Otomatis',
  manual: 'Manual',
  low: 'Rendah',
  mid: 'Sedang',
  high: 'Tinggi',
  on: 'Nyala',
  off: 'Mati'
}

export const enumLabel = (v: string): string => ENUM_LABELS[v] ?? v.replace(/_/g, ' ')

/** Kecerahan/suhu warna lebih enak dibaca sebagai persen. */
function isPercentLike(spec: DpSpec): boolean {
  return /^(bright_value|temp_value)/.test(spec.code) && typeof spec.min === 'number' && typeof spec.max === 'number'
}

export function formatValue(spec: DpSpec | undefined, value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Aktif' : 'Mati'
  if (typeof value === 'number') {
    if (spec && isPercentLike(spec)) {
      const pct = ((value - spec.min!) / (spec.max! - spec.min!)) * 100
      return `${Math.round(pct)}%`
    }
    const n = toDisplayNumber(value, spec?.scale ?? 0)
    const text = Number.isInteger(n) ? String(n) : n.toFixed(spec?.scale ?? 1)
    return spec?.unit ? `${text} ${spec.unit}` : text
  }
  if (typeof value === 'string') return spec?.type === 'enum' ? enumLabel(value) : value
  return JSON.stringify(value)
}

// ───────────────────────── Toggle ─────────────────────────

export function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  )
}

// ───────────────────────── Slider (integer) ─────────────────────────

function RangeControl({ spec, value, disabled, onCommit }: { spec: DpSpec; value: unknown; disabled?: boolean; onCommit: (v: number) => void }): JSX.Element {
  const min = spec.min ?? 0
  const max = spec.max ?? 100
  const step = Math.max(spec.step ?? 1, 1)
  const raw = typeof value === 'number' ? value : min
  const [local, setLocal] = useState<number>(raw)
  const dragging = useRef(false)

  // Ikuti nilai dari perangkat selama tidak sedang digeser.
  useEffect(() => {
    if (!dragging.current) setLocal(raw)
  }, [raw])

  const commit = (): void => {
    dragging.current = false
    if (local !== raw) onCommit(local)
  }

  return (
    <div className="range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, local))}
        disabled={disabled}
        aria-label={labelForCode(spec)}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          dragging.current = true
          setLocal(Number(e.target.value))
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="range-value">{formatValue(spec, local)}</span>
    </div>
  )
}

// ───────────────────────── Warna ─────────────────────────

const SWATCHES: Hsv[] = [
  { h: 0, s: 1, v: 1 },
  { h: 30, s: 1, v: 1 },
  { h: 60, s: 1, v: 1 },
  { h: 120, s: 1, v: 1 },
  { h: 180, s: 1, v: 1 },
  { h: 240, s: 1, v: 1 },
  { h: 285, s: 1, v: 1 },
  { h: 330, s: 0.7, v: 1 }
]

function ColourControl({ spec, value, disabled, onCommit }: { spec: DpSpec; value: unknown; disabled?: boolean; onCommit: (v: Hsv) => void }): JSX.Element {
  const scale = colourScale(spec.code)
  const hsv: Hsv = value && typeof value === 'object' ? (value as Hsv) : { h: 0, s: 0, v: scale }
  const current = hsvToHexColor(hsv, scale)
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])

  const send = (hex: string): void => {
    const next = hexColorToHsv(hex, scale)
    // Pertahankan kecerahan bila warna yang dipilih sangat gelap.
    onCommit({ h: next.h, s: next.s, v: Math.max(next.v, Math.round(scale * 0.1)) })
  }

  return (
    <div className="colour">
      <input type="color" value={draft} disabled={disabled} aria-label="Pilih warna" onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== current && send(draft)} />
      <div className="swatches">
        {SWATCHES.map((sw) => {
          const hex = hsvToHexColor({ h: sw.h, s: sw.s * scale, v: sw.v * scale }, scale)
          return <button key={hex} type="button" className="swatch" style={{ background: hex }} disabled={disabled} aria-label={`Warna ${hex}`} onClick={() => send(hex)} />
        })}
      </div>
    </div>
  )
}

// ───────────────────────── Kontrol generik ─────────────────────────

export function DpControl({ spec, value, disabled, onChange }: { spec: DpSpec; value: unknown; disabled?: boolean; onChange: (v: unknown) => void }): JSX.Element {
  if (spec.type === 'boolean') {
    return <Toggle checked={value === true} disabled={disabled} label={labelForCode(spec)} onChange={onChange} />
  }
  if (spec.type === 'enum' && spec.range?.length) {
    if (spec.range.length <= 4) {
      return (
        <div className="segmented" role="group" aria-label={labelForCode(spec)}>
          {spec.range.map((opt) => (
            <button key={opt} type="button" disabled={disabled} className={value === opt ? 'active' : ''} onClick={() => onChange(opt)}>
              {enumLabel(opt)}
            </button>
          ))}
        </div>
      )
    }
    return (
      <select value={typeof value === 'string' ? value : ''} disabled={disabled} aria-label={labelForCode(spec)} onChange={(e) => onChange(e.target.value)}>
        {typeof value !== 'string' && <option value="">—</option>}
        {spec.range.map((opt) => (
          <option key={opt} value={opt}>
            {enumLabel(opt)}
          </option>
        ))}
      </select>
    )
  }
  if (spec.type === 'integer' && typeof spec.min === 'number' && typeof spec.max === 'number') {
    return <RangeControl spec={spec} value={value} disabled={disabled} onCommit={onChange} />
  }
  if (isColourCode(spec.code)) {
    return <ColourControl spec={spec} value={value} disabled={disabled} onCommit={onChange} />
  }
  return <span className="muted">{formatValue(spec, value)}</span>
}
