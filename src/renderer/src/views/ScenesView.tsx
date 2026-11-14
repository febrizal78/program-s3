import { useCallback, useEffect, useState, type JSX } from 'react'
import type { SceneInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Icon } from '../icons'
import { useToast } from '../toast'

export function ScenesView({ hasCredentials, deviceCount }: { hasCredentials: boolean; deviceCount: number }): JSX.Element {
  const toast = useToast()
  const [scenes, setScenes] = useState<SceneInfo[]>([])
  const [message, setMessage] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listScenes()
      setScenes(res.scenes)
      setMessage(res.message)
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Muat ulang setelah daftar perangkat tersedia (rumah diturunkan dari perangkat).
  useEffect(() => {
    if (hasCredentials) void load()
  }, [hasCredentials, deviceCount, load])

  const run = async (scene: SceneInfo): Promise<void> => {
    setRunning(scene.id)
    try {
      await api.triggerScene(scene.homeId, scene.id)
      toast(`Scene "${scene.name}" dijalankan`, 'ok')
    } catch (err) {
      toast(`Scene gagal: ${errorMessage(err)}`, 'error')
    } finally {
      setRunning(null)
    }
  }

  if (!hasCredentials) {
    return (
      <div className="empty">
        <Icon.scene />
        <h2>Scene membutuhkan koneksi cloud</h2>
        <p>Isi kredensial di Pengaturan terlebih dahulu.</p>
      </div>
    )
  }

  const byHome = new Map<string, SceneInfo[]>()
  for (const s of scenes) byHome.set(s.homeName, [...(byHome.get(s.homeName) ?? []), s])

  return (
    <>
      <div className="toolbar">
        <h2 className="title">Scene "Tap-to-Run"</h2>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <Icon.refresh /> {loading ? 'Memuat…' : 'Segarkan'}
        </button>
      </div>
      {message && <p className="notice">{message}</p>}
      {scenes.length === 0 && !loading && !message && <p className="muted">Belum ada scene. Buat scene "Tap-to-Run" di aplikasi Smart Life.</p>}
      {[...byHome].map(([home, list]) => (
        <section key={home}>
          <h3>{home}</h3>
          <div className="grid">
            {list.map((s) => (
              <article className="card scene" key={`${s.homeId}-${s.id}`}>
                <span className="device-icon">
                  <Icon.scene />
                </span>
                <span className="device-text">
                  <strong>{s.name}</strong>
                  <small>{s.enabled ? 'Aktif' : 'Nonaktif'}</small>
                </span>
                <button type="button" className="btn primary" disabled={!s.enabled || running === s.id} onClick={() => void run(s)}>
                  <Icon.play /> Jalankan
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
