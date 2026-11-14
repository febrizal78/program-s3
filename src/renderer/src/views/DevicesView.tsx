import { useMemo, useState, type JSX } from 'react'
import { gangSwitches, labelForCode, primarySwitch } from '../../../shared/dp'
import type { ConnectionStatus, DeviceView, DpSpec } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { DpControl, formatValue, Toggle } from '../controls'
import { categoryIcon, Icon } from '../icons'
import { useToast } from '../toast'

// ───────────────────────── Util ─────────────────────────

/** DP yang tidak berguna sebagai kontrol manual. */
const HIDDEN = /^(countdown|cycle_time|random_time|scene_data|music_data|control_data|rhythm_mode|sleep_mode|wakeup_mode|do_not_disturb|light_mode|relay_status)/

const PRIORITY = ['switch_led', 'switch', 'work_mode', 'bright_value', 'bright_value_v2', 'temp_value', 'temp_value_v2', 'colour_data', 'colour_data_v2']

function sortSpecs(specs: DpSpec[]): DpSpec[] {
  const rank = (s: DpSpec): number => {
    const i = PRIORITY.indexOf(s.code)
    if (i >= 0) return i
    if (/^switch_\d+$/.test(s.code)) return 1
    return 100
  }
  return [...specs].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
}

export function controllableSpecs(device: DeviceView): DpSpec[] {
  return sortSpecs(device.specs.filter((s) => s.mode !== 'ro' && !HIDDEN.test(s.code) && s.type !== 'raw' && s.type !== 'bitmap'))
}

function readonlySpecs(device: DeviceView): DpSpec[] {
  return sortSpecs(
    device.specs.filter((s) => s.mode === 'ro' && !HIDDEN.test(s.code) && s.type !== 'raw' && s.type !== 'bitmap' && s.type !== 'json' && device.status[s.code] !== undefined)
  )
}

/** Perangkat dianggap menyala bila saklar utamanya (atau salah satu gang) aktif. */
function isOn(device: DeviceView): boolean {
  const sw = primarySwitch(device.specs)
  if (sw) return device.status[sw.code] === true
  return gangSwitches(device.specs).some((g) => device.status[g.code] === true)
}

function summary(device: DeviceView): string {
  const bright = device.specs.find((s) => /^bright_value/.test(s.code))
  const sw = primarySwitch(device.specs)
  const gangs = gangSwitches(device.specs)
  const parts: string[] = []
  if (gangs.length > 1) parts.push(`${gangs.filter((g) => device.status[g.code] === true).length}/${gangs.length} saklar nyala`)
  if (sw && device.status[sw.code] === true && bright && typeof device.status[bright.code] === 'number') parts.push(formatValue(bright, device.status[bright.code]))
  for (const code of ['cur_power', 'va_temperature', 'temp_current', 'va_humidity', 'battery_percentage', 'percent_state']) {
    const spec = device.specs.find((s) => s.code === code)
    if (spec && device.status[code] !== undefined) parts.push(`${labelForCode(spec)} ${formatValue(spec, device.status[code])}`)
  }
  return parts.slice(0, 2).join(' · ')
}

function useSend(): (device: DeviceView, values: Record<string, unknown>) => Promise<void> {
  const toast = useToast()
  return async (device, values) => {
    try {
      await api.setDp(device.id, values)
    } catch (err) {
      toast(`${device.name}: ${errorMessage(err)}`, 'error')
    }
  }
}

// ───────────────────────── Kartu ─────────────────────────

function DeviceCard({ device, onOpen }: { device: DeviceView; onOpen: () => void }): JSX.Element {
  const send = useSend()
  const sw = primarySwitch(device.specs)
  const on = isOn(device)
  return (
    <article className={`card device ${device.online ? '' : 'offline'} ${on ? 'is-on' : ''}`}>
      <button type="button" className="card-main" onClick={onOpen} aria-label={`Buka ${device.name}`}>
        <span className="device-icon">{categoryIcon(device.category)}</span>
        <span className="device-text">
          <strong>{device.name}</strong>
          <small>{device.online ? summary(device) || device.productName : 'Offline'}</small>
        </span>
      </button>
      <div className="card-foot">
        <span className="badges">
          <span className={`dot ${device.online ? 'ok' : 'off'}`} title={device.online ? 'Online' : 'Offline'} />
          {device.lanReady && <span className="badge lan">LAN</span>}
        </span>
        {sw && <Toggle checked={on} disabled={!device.online} label={`Daya ${device.name}`} onChange={(v) => void send(device, { [sw.code]: v })} />}
      </div>
    </article>
  )
}

// ───────────────────────── Panel detail ─────────────────────────

function DevicePanel({ device, onClose }: { device: DeviceView; onClose: () => void }): JSX.Element {
  const send = useSend()
  const controls = controllableSpecs(device)
  const readonly = readonlySpecs(device)
  return (
    <aside className="drawer" role="dialog" aria-label={device.name}>
      <header className="drawer-head">
        <span className="device-icon big">{categoryIcon(device.category)}</span>
        <div>
          <h2>{device.name}</h2>
          <p className="muted">
            {device.productName || device.category} · {device.online ? 'Online' : 'Offline'}
            {device.lanReady ? ' · LAN' : ''}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">
          <Icon.close />
        </button>
      </header>

      {!device.online && <p className="notice">Perangkat sedang offline. Perintah mungkin gagal.</p>}

      <section>
        <h3>Kontrol</h3>
        {controls.length === 0 && <p className="muted">Tidak ada kontrol yang tersedia untuk perangkat ini.</p>}
        {controls.map((spec) => (
          <div className="row" key={spec.code}>
            <label>{labelForCode(spec)}</label>
            <DpControl spec={spec} value={device.status[spec.code]} disabled={!device.online} onChange={(v) => void send(device, { [spec.code]: v })} />
          </div>
        ))}
      </section>

      {readonly.length > 0 && (
        <section>
          <h3>Status</h3>
          <dl className="kv">
            {readonly.map((spec) => (
              <div key={spec.code}>
                <dt>{labelForCode(spec)}</dt>
                <dd>{formatValue(spec, device.status[spec.code])}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <footer className="muted small">
        ID: <code>{device.id}</code>
      </footer>
    </aside>
  )
}

// ───────────────────────── Tampilan utama ─────────────────────────

export function DevicesView({
  devices,
  status,
  hasCredentials,
  loading,
  onRefresh,
  onGoSettings
}: {
  devices: DeviceView[]
  status: ConnectionStatus | null
  hasCredentials: boolean
  loading: boolean
  onRefresh: () => void
  onGoSettings: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [onlyOnline, setOnlyOnline] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices.filter((d) => (!onlyOnline || d.online) && (!q || d.name.toLowerCase().includes(q) || d.productName.toLowerCase().includes(q)))
  }, [devices, query, onlyOnline])

  const open = devices.find((d) => d.id === openId) ?? null

  if (!hasCredentials) {
    return (
      <div className="empty">
        <Icon.devices />
        <h2>Hubungkan akun Tuya Anda</h2>
        <p>Masukkan Access ID & Access Secret proyek Tuya IoT Platform Anda untuk memuat perangkat.</p>
        <button type="button" className="btn primary" onClick={onGoSettings}>
          Buka Pengaturan
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Cari perangkat…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Cari perangkat" />
        <label className="check">
          <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} /> Online saja
        </label>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
          <Icon.refresh /> {loading ? 'Memuat…' : 'Segarkan'}
        </button>
      </div>

      {status?.cloud === 'error' && (
        <p className="notice error">
          Gagal memuat dari cloud: {status.cloudMessage}{' '}
          <button type="button" className="link" onClick={onGoSettings}>
            Periksa pengaturan
          </button>
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="empty small">
          <p>{devices.length === 0 ? (loading ? 'Memuat perangkat…' : 'Belum ada perangkat. Pastikan akun aplikasi Smart Life sudah ditautkan ke proyek cloud.') : 'Tidak ada perangkat yang cocok.'}</p>
        </div>
      ) : (
        <div className="grid">
          {filtered.map((d) => (
            <DeviceCard key={d.id} device={d} onOpen={() => setOpenId(d.id)} />
          ))}
        </div>
      )}

      {open && (
        <>
          <div className="scrim" onClick={() => setOpenId(null)} />
          <DevicePanel device={open} onClose={() => setOpenId(null)} />
        </>
      )}
    </>
  )
}
