import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ConnectionStatus, DeviceView, Schedule, SettingsState } from '../../shared/types'
import { api, errorMessage } from './api'
import { Icon } from './icons'
import logoUrl from './logo.svg'
import { ToastProvider, useToast } from './toast'
import { DevicesView } from './views/DevicesView'
import { ScenesView } from './views/ScenesView'
import { SchedulesView } from './views/SchedulesView'
import { SettingsView } from './views/SettingsView'

type Tab = 'devices' | 'scenes' | 'schedules' | 'settings'

const NAV: Array<{ id: Tab; label: string; icon: () => JSX.Element }> = [
  { id: 'devices', label: 'Perangkat', icon: Icon.devices },
  { id: 'scenes', label: 'Scene', icon: Icon.scene },
  { id: 'schedules', label: 'Jadwal', icon: Icon.clock },
  { id: 'settings', label: 'Pengaturan', icon: Icon.settings }
]

function StatusPanel({ status }: { status: ConnectionStatus | null }): JSX.Element {
  if (!status) return <div className="status" />
  const cloud = { unconfigured: ['off', 'Belum dikonfigurasi'], connecting: ['warn', 'Menghubungkan…'], ok: ['ok', 'Terhubung'], error: ['err', 'Gagal'] }[status.cloud]
  const rt = { off: ['off', 'Nonaktif'], connecting: ['warn', 'Menghubungkan…'], connected: ['ok', 'Terhubung'], error: ['err', 'Gagal'] }[status.realtime]
  return (
    <div className="status" aria-label="Status koneksi">
      <div title={status.cloudMessage}>
        <span className={`dot ${cloud[0]}`} /> Cloud <em>{cloud[1]}</em>
      </div>
      <div>
        <span className={`dot ${status.lanDevices > 0 ? 'ok' : 'off'}`} /> LAN <em>{status.lanDevices} perangkat</em>
      </div>
      <div title={status.realtimeMessage}>
        <span className={`dot ${rt[0]}`} /> Realtime <em>{rt[1]}</em>
      </div>
    </div>
  )
}

function Shell(): JSX.Element {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('devices')
  const [devices, setDevices] = useState<Record<string, DeviceView>>({})
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(false)

  const replaceDevices = useCallback((list: DeviceView[]) => setDevices(Object.fromEntries(list.map((d) => [d.id, d]))), [])

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getStatus().then(setStatus)
    void api.listDevices().then(replaceDevices)
    void api.listSchedules().then(setSchedules)
    const offs = [
      api.onDevice((d) => setDevices((cur) => ({ ...cur, [d.id]: d }))),
      api.onDevices(replaceDevices),
      api.onStatus(setStatus),
      api.onSchedules(setSchedules)
    ]
    return () => offs.forEach((off) => off())
  }, [replaceDevices])

  const list = useMemo(() => Object.values(devices).sort((a, b) => a.name.localeCompare(b.name)), [devices])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      replaceDevices(await api.refreshDevices())
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [replaceDevices, toast])

  const hasCredentials = settings?.hasCredentials ?? false
  const busy = loading || status?.cloud === 'connecting'

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <img src={logoUrl} alt="" width={28} height={28} />
          <span>Tuya Desktop</span>
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <button type="button" className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
                <n.icon /> {n.label}
              </button>
            </li>
          ))}
        </ul>
        <StatusPanel status={status} />
      </nav>
      <main>
        {tab === 'devices' && <DevicesView devices={list} status={status} hasCredentials={hasCredentials} loading={busy} onRefresh={() => void refresh()} onGoSettings={() => setTab('settings')} />}
        {tab === 'scenes' && <ScenesView hasCredentials={hasCredentials} deviceCount={list.length} />}
        {tab === 'schedules' && <SchedulesView schedules={schedules} devices={list} />}
        {tab === 'settings' && settings && <SettingsView state={settings} onSaved={setSettings} />}
      </main>
    </div>
  )
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
