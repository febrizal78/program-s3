import { useEffect, useState, type JSX } from 'react'
import { REGIONS } from '../../../shared/regions'
import type { LogEntry, Settings, SettingsState } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Toggle } from '../controls'
import { useToast } from '../toast'

function Logs(): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  useEffect(() => {
    void api.getLogs().then(setLogs)
    return api.onLog((e) => setLogs((l) => [...l.slice(-199), e]))
  }, [])
  return (
    <div className="logs" role="log" aria-label="Log aplikasi">
      {logs.length === 0 && <span className="muted">Belum ada log.</span>}
      {[...logs].reverse().map((l, i) => (
        <div key={`${l.at}-${i}`} className={`log ${l.level}`}>
          <time>{new Date(l.at).toLocaleTimeString('id-ID')}</time> {l.message}
        </div>
      ))}
    </div>
  )
}

export function SettingsView({ state, onSaved }: { state: SettingsState; onSaved: (s: SettingsState) => void }): JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<Settings>(state.settings)
  const [accessId, setAccessId] = useState('')
  const [accessSecret, setAccessSecret] = useState('')
  const [replaceCreds, setReplaceCreds] = useState(!state.hasCredentials)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)

  useEffect(() => {
    setForm(state.settings)
    setReplaceCreds(!state.hasCredentials)
  }, [state])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setForm((f) => ({ ...f, [key]: value }))
  const credentials = replaceCreds && accessId.trim() && accessSecret.trim() ? { accessId: accessId.trim(), accessSecret: accessSecret.trim() } : undefined

  const test = async (): Promise<void> => {
    setBusy('test')
    try {
      const res = await api.testCloud({ credentials, settings: form })
      toast(res.message, res.ok ? 'ok' : 'error')
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      const next = await api.saveSettings({ settings: form, credentials })
      setAccessId('')
      setAccessSecret('')
      onSaved(next)
      toast('Pengaturan disimpan', 'ok')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removeCreds = async (): Promise<void> => {
    if (!confirm('Hapus kredensial tersimpan? Daftar perangkat akan dikosongkan.')) return
    onSaved(await api.saveSettings({ settings: {}, clearCredentials: true }))
    toast('Kredensial dihapus', 'ok')
  }

  return (
    <div className="settings">
      <section className="card">
        <h3>Akun Tuya Cloud</h3>
        {state.hasCredentials && !replaceCreds ? (
          <div className="row">
            <div>
              <label>Access ID</label>
              <div>
                <code>{state.accessIdMasked}</code> <span className="muted small">— secret tersimpan{state.secretsEncrypted ? ' (terenkripsi)' : ' (TANPA enkripsi — enkripsi OS tidak tersedia)'}</span>
              </div>
            </div>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setReplaceCreds(true)}>
              Ganti
            </button>
            <button type="button" className="btn danger" onClick={() => void removeCreds()}>
              Hapus
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="aid">Access ID / Client ID</label>
              <input id="aid" value={accessId} onChange={(e) => setAccessId(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label htmlFor="asec">Access Secret / Client Secret</label>
              <input id="asec" type="password" value={accessSecret} onChange={(e) => setAccessSecret(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="region">Data center (harus sama dengan proyek di iot.tuya.com)</label>
          <select id="region" value={form.region} onChange={(e) => set('region', e.target.value as Settings['region'])}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="uid">UID akun aplikasi (opsional)</label>
          <input id="uid" value={form.appUid} onChange={(e) => set('appUid', e.target.value)} placeholder="Kosongkan untuk memuat semua perangkat proyek" spellCheck={false} />
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void test()} disabled={busy !== null}>
            {busy === 'test' ? 'Menguji…' : 'Uji koneksi'}
          </button>
        </div>
        <details>
          <summary>Cara mendapatkan kredensial</summary>
          <ol className="steps">
            <li>Masuk ke <b>iot.tuya.com</b> → Cloud → Development → Create Cloud Project (pilih data center & layanan Smart Home).</li>
            <li>Salin <b>Access ID</b> dan <b>Access Secret</b> dari tab Overview proyek.</li>
            <li>Tab Devices → <b>Link Tuya App Account</b> → Add App Account, lalu scan QR dengan aplikasi Smart Life (Me → ikon scan).</li>
            <li>Jika muncul error <i>permission deny</i>, subscribe API terkait di tab Service API (mis. IoT Core, Authorization Token Management, Device Status Notification, Smart Home Scene Linkage).</li>
          </ol>
        </details>
      </section>

      <section className="card">
        <h3>Jaringan lokal (LAN)</h3>
        <div className="row">
          <div className="grow">
            <label>Kontrol & status lewat LAN</label>
            <p className="muted small">Lebih cepat dan tetap bekerja walau internet putus. Windows mungkin meminta izin firewall untuk menerima broadcast perangkat.</p>
          </div>
          <Toggle checked={form.lanEnabled} label="LAN" onChange={(v) => set('lanEnabled', v)} />
        </div>
      </section>

      <section className="card">
        <h3>Pembaruan status</h3>
        <div className="field">
          <label htmlFor="poll">Interval polling cloud (detik, 5–600)</label>
          <input id="poll" type="number" min={5} max={600} value={form.pollIntervalSec} onChange={(e) => set('pollIntervalSec', Number(e.target.value))} />
        </div>
        <div className="row">
          <div className="grow">
            <label>Message Service (push realtime) — eksperimental</label>
            <p className="muted small">Perlu layanan Message Service aktif di proyek cloud. Jika gagal, aplikasi tetap memakai polling.</p>
          </div>
          <Toggle checked={form.realtimeEnabled} label="Realtime" onChange={(v) => set('realtimeEnabled', v)} />
        </div>
        {form.realtimeEnabled && (
          <div className="field">
            <label htmlFor="pulsar">Endpoint Message Service (opsional)</label>
            <input id="pulsar" value={form.pulsarOverride} onChange={(e) => set('pulsarOverride', e.target.value)} placeholder="wss://mqe.tuyaeu.com:8285/" spellCheck={false} />
          </div>
        )}
        <div className="field">
          <label htmlFor="ep">Endpoint API kustom (opsional)</label>
          <input id="ep" value={form.endpointOverride} onChange={(e) => set('endpointOverride', e.target.value)} placeholder="https://openapi.tuyaeu.com" spellCheck={false} />
        </div>
      </section>

      <section className="card">
        <h3>Aplikasi</h3>
        <div className="row">
          <div className="grow">
            <label>Tutup ke tray</label>
            <p className="muted small">Menutup jendela tidak menghentikan aplikasi, sehingga jadwal tetap berjalan.</p>
          </div>
          <Toggle checked={form.closeToTray} label="Tutup ke tray" onChange={(v) => set('closeToTray', v)} />
        </div>
        <div className="row">
          <div className="grow">
            <label>Jalankan saat Windows dimulai</label>
          </div>
          <Toggle checked={form.launchAtLogin} label="Jalankan otomatis" onChange={(v) => set('launchAtLogin', v)} />
        </div>
      </section>

      <div className="save-bar">
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy !== null}>
          {busy === 'save' ? 'Menyimpan…' : 'Simpan pengaturan'}
        </button>
      </div>

      <section className="card">
        <h3>Log</h3>
        <Logs />
      </section>
    </div>
  )
}
