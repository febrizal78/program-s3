import { useEffect, useMemo, useState, type JSX } from 'react'
import { labelForCode } from '../../../shared/dp'
import type { DeviceView, DpSpec, SceneInfo, Schedule, ScheduleAction } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { DpControl, formatValue, Toggle } from '../controls'
import { Icon } from '../icons'
import { useToast } from '../toast'
import { controllableSpecs } from './DevicesView'

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

const uid = (): string => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

function defaultValue(spec: DpSpec): unknown {
  if (spec.type === 'boolean') return true
  if (spec.type === 'enum') return spec.range?.[0] ?? ''
  if (spec.type === 'integer') return spec.max ?? spec.min ?? 0
  if (spec.code.startsWith('colour_data')) return { h: 0, s: spec.code === 'colour_data' ? 255 : 1000, v: spec.code === 'colour_data' ? 255 : 1000 }
  return ''
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function describeWhen(s: Schedule): string {
  if (s.kind === 'once') return s.fireAt ? new Date(s.fireAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const days = s.days.length === 7 ? 'Setiap hari' : [...s.days].sort().map((d) => DAY_NAMES[d]).join(', ')
  return `${days} • ${s.time}`
}

function describeAction(a: ScheduleAction, devices: DeviceView[]): string {
  if (a.type === 'scene') return `Scene: ${a.sceneName ?? a.sceneId}`
  const dev = devices.find((d) => d.id === a.deviceId)
  const parts = Object.entries(a.values).map(([code, v]) => {
    const spec = dev?.specs.find((s) => s.code === code)
    return `${spec ? labelForCode(spec) : code} = ${formatValue(spec, v)}`
  })
  return `${dev?.name ?? 'Perangkat tidak ditemukan'}: ${parts.join(', ')}`
}

// ───────────────────────── Editor ─────────────────────────

function ScheduleEditor({ initial, devices, onSave, onCancel }: { initial: Schedule; devices: DeviceView[]; onSave: (s: Schedule) => Promise<void>; onCancel: () => void }): JSX.Element {
  const [s, setS] = useState<Schedule>(initial)
  const [scenes, setScenes] = useState<SceneInfo[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const patch = (p: Partial<Schedule>): void => setS((cur) => ({ ...cur, ...p }))

  useEffect(() => {
    if (s.action.type === 'scene' && scenes.length === 0) {
      api
        .listScenes()
        .then((r) => setScenes(r.scenes))
        .catch(() => undefined)
    }
  }, [s.action.type, scenes.length])

  const action = s.action
  const device = action.type === 'dp' ? devices.find((d) => d.id === action.deviceId) : undefined
  const specs = useMemo(() => (device ? controllableSpecs(device) : []), [device])
  const dpCode = action.type === 'dp' ? Object.keys(action.values)[0] : undefined
  const spec = specs.find((x) => x.code === dpCode)

  const setDevice = (deviceId: string): void => {
    const dev = devices.find((d) => d.id === deviceId)
    const first = dev ? controllableSpecs(dev)[0] : undefined
    patch({ action: { type: 'dp', deviceId, values: first ? { [first.code]: defaultValue(first) } : {} } })
  }
  const setCode = (code: string): void => {
    const sp = specs.find((x) => x.code === code)
    if (sp && action.type === 'dp') patch({ action: { ...action, values: { [code]: defaultValue(sp) } } })
  }

  const submit = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await onSave(s)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="modal" role="dialog" aria-label="Editor jadwal">
        <h2>{initial.name ? 'Ubah jadwal' : 'Jadwal baru'}</h2>

        <div className="field">
          <label htmlFor="sch-name">Nama</label>
          <input id="sch-name" value={s.name} onChange={(e) => patch({ name: e.target.value })} placeholder="mis. Lampu kamar nyala pagi" />
        </div>

        <div className="field">
          <label>Kapan</label>
          <div className="segmented">
            <button type="button" className={s.kind === 'daily' ? 'active' : ''} onClick={() => patch({ kind: 'daily' })}>
              Berulang
            </button>
            <button type="button" className={s.kind === 'once' ? 'active' : ''} onClick={() => patch({ kind: 'once', fireAt: s.fireAt ?? Date.now() + 30 * 60_000 })}>
              Sekali
            </button>
          </div>
        </div>

        {s.kind === 'daily' ? (
          <>
            <div className="field">
              <label htmlFor="sch-time">Jam</label>
              <input id="sch-time" type="time" value={s.time} onChange={(e) => patch({ time: e.target.value })} />
            </div>
            <div className="field">
              <label>Hari</label>
              <div className="chips">
                {DAY_NAMES.map((name, i) => (
                  <button key={name} type="button" className={`chip ${s.days.includes(i) ? 'active' : ''}`} onClick={() => patch({ days: s.days.includes(i) ? s.days.filter((d) => d !== i) : [...s.days, i] })}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="sch-at">Tanggal & jam</label>
            <input id="sch-at" type="datetime-local" value={s.fireAt ? toLocalInput(s.fireAt) : ''} onChange={(e) => patch({ fireAt: e.target.value ? new Date(e.target.value).getTime() : undefined })} />
          </div>
        )}

        <div className="field">
          <label>Aksi</label>
          <div className="segmented">
            <button type="button" className={action.type === 'dp' ? 'active' : ''} onClick={() => patch({ action: { type: 'dp', deviceId: '', values: {} } })}>
              Kontrol perangkat
            </button>
            <button type="button" className={action.type === 'scene' ? 'active' : ''} onClick={() => patch({ action: { type: 'scene', homeId: '', sceneId: '' } })}>
              Jalankan scene
            </button>
          </div>
        </div>

        {action.type === 'dp' ? (
          <>
            <div className="field">
              <label htmlFor="sch-dev">Perangkat</label>
              <select id="sch-dev" value={action.deviceId} onChange={(e) => setDevice(e.target.value)}>
                <option value="">Pilih perangkat…</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {device && specs.length > 0 && (
              <div className="field">
                <label htmlFor="sch-code">Fungsi</label>
                <select id="sch-code" value={dpCode ?? ''} onChange={(e) => setCode(e.target.value)}>
                  {specs.map((x) => (
                    <option key={x.code} value={x.code}>
                      {labelForCode(x)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {spec && dpCode && (
              <div className="field">
                <label>Nilai</label>
                <DpControl spec={spec} value={action.values[dpCode]} onChange={(v) => patch({ action: { ...action, values: { [dpCode]: v } } })} />
              </div>
            )}
          </>
        ) : (
          <div className="field">
            <label htmlFor="sch-scene">Scene</label>
            <select
              id="sch-scene"
              value={action.sceneId ? `${action.homeId}|${action.sceneId}` : ''}
              onChange={(e) => {
                const [homeId, sceneId] = e.target.value.split('|')
                const sc = scenes.find((x) => x.homeId === homeId && x.id === sceneId)
                patch({ action: { type: 'scene', homeId: homeId ?? '', sceneId: sceneId ?? '', sceneName: sc?.name } })
              }}
            >
              <option value="">Pilih scene…</option>
              {scenes.map((sc) => (
                <option key={`${sc.homeId}|${sc.id}`} value={`${sc.homeId}|${sc.id}`}>
                  {sc.name} ({sc.homeName})
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="notice error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Batal
          </button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={saving}>
            Simpan
          </button>
        </div>
      </div>
    </>
  )
}

// ───────────────────────── Daftar ─────────────────────────

export function SchedulesView({ schedules, devices }: { schedules: Schedule[]; devices: DeviceView[] }): JSX.Element {
  const toast = useToast()
  const [editing, setEditing] = useState<Schedule | null>(null)

  const blank = (): Schedule => ({
    id: uid(),
    name: '',
    enabled: true,
    kind: 'daily',
    time: '07:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    action: { type: 'dp', deviceId: '', values: {} }
  })

  const save = async (s: Schedule): Promise<void> => {
    await api.saveSchedule({ ...s, name: s.name.trim() })
    setEditing(null)
    toast('Jadwal disimpan', 'ok')
  }

  const toggle = async (s: Schedule, enabled: boolean): Promise<void> => {
    try {
      await api.saveSchedule({ ...s, enabled })
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <>
      <div className="toolbar">
        <h2 className="title">Jadwal</h2>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => setEditing(blank())}>
          <Icon.plus /> Tambah jadwal
        </button>
      </div>
      <p className="muted small">Jadwal dijalankan oleh aplikasi ini, jadi aplikasi harus tetap terbuka (boleh diminimalkan ke tray).</p>

      {schedules.length === 0 ? (
        <div className="empty small">
          <Icon.clock />
          <p>Belum ada jadwal.</p>
        </div>
      ) : (
        <ul className="list">
          {schedules.map((s) => (
            <li key={s.id} className={`card row-card ${s.enabled ? '' : 'disabled'}`}>
              <div className="grow">
                <strong>{s.name}</strong>
                <div className="muted small">{describeWhen(s)}</div>
                <div className="small">{describeAction(s.action, devices)}</div>
                {s.lastRunAt && (
                  <div className="muted small">
                    Terakhir: {new Date(s.lastRunAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })} — {s.lastResult}
                  </div>
                )}
              </div>
              <Toggle checked={s.enabled} label={`Aktifkan ${s.name}`} onChange={(v) => void toggle(s, v)} />
              <button type="button" className="icon-btn" aria-label="Ubah" onClick={() => setEditing(s)}>
                ✎
              </button>
              <button type="button" className="icon-btn danger" aria-label={`Hapus ${s.name}`} onClick={() => void api.deleteSchedule(s.id).then(() => toast('Jadwal dihapus', 'ok'))}>
                <Icon.trash />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <ScheduleEditor initial={editing} devices={devices} onSave={save} onCancel={() => setEditing(null)} />}
    </>
  )
}
