import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC, type SaveSettingsInput, type Schedule, type Secrets, type Settings } from '../shared/types'
import type { AppController } from './controller'

export interface IpcHooks {
  /** Dipanggil setelah pengaturan tersimpan (mis. untuk login otomatis Windows). */
  onSettingsSaved?: (settings: Settings) => void
  /** Memeriksa bahwa pengirim IPC adalah halaman aplikasi kita sendiri. */
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** Daftarkan semua handler IPC. Setiap handler memvalidasi pengirim & bentuk argumen. */
export function registerIpc(app: AppController, hooks: IpcHooks): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, async (e, ...args) => {
      if (!hooks.isTrustedSender(e)) throw new Error('Pengirim IPC tidak dipercaya')
      return fn(...(args as A))
    })
  }

  handle(IPC.getSettings, () => app.getSettingsState())
  handle(IPC.saveSettings, (input: SaveSettingsInput) => {
    if (!input || typeof input !== 'object') throw new Error('Masukan tidak valid')
    const state = app.saveSettings(input)
    hooks.onSettingsSaved?.(state.settings)
    return state
  })
  handle(IPC.testCloud, (input?: { credentials?: Secrets; settings?: Partial<Settings> }) => app.testCloud(input))

  handle(IPC.listDevices, () => app.manager.views())
  handle(IPC.refreshDevices, () => app.loadDevices(true))
  handle(IPC.setDp, (deviceId: string, values: Record<string, unknown>) => {
    if (!isString(deviceId) || !values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Argumen tidak valid')
    return app.manager.setDps(deviceId, values)
  })

  handle(IPC.listScenes, () => app.manager.listScenes())
  handle(IPC.triggerScene, (homeId: string, sceneId: string) => {
    if (!isString(homeId) || !isString(sceneId)) throw new Error('Argumen tidak valid')
    return app.manager.triggerScene(homeId, sceneId)
  })

  handle(IPC.listSchedules, () => app.scheduler.list())
  handle(IPC.saveSchedule, (schedule: Schedule) => {
    if (!schedule || typeof schedule !== 'object' || !isString(schedule.id)) throw new Error('Jadwal tidak valid')
    return app.scheduler.upsert(schedule)
  })
  handle(IPC.deleteSchedule, (id: string) => {
    if (!isString(id)) throw new Error('Argumen tidak valid')
    return app.scheduler.remove(id)
  })

  handle(IPC.getStatus, () => app.getStatus())
  handle(IPC.getLogs, () => app.getLogs())
}
