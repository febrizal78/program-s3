import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TuyaBridge } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const bridge: TuyaBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (input) => ipcRenderer.invoke(IPC.saveSettings, input),
  testCloud: (input) => ipcRenderer.invoke(IPC.testCloud, input),

  listDevices: () => ipcRenderer.invoke(IPC.listDevices),
  refreshDevices: () => ipcRenderer.invoke(IPC.refreshDevices),
  setDp: (deviceId, values) => ipcRenderer.invoke(IPC.setDp, deviceId, values),

  listScenes: () => ipcRenderer.invoke(IPC.listScenes),
  triggerScene: (homeId, sceneId) => ipcRenderer.invoke(IPC.triggerScene, homeId, sceneId),

  listSchedules: () => ipcRenderer.invoke(IPC.listSchedules),
  saveSchedule: (schedule) => ipcRenderer.invoke(IPC.saveSchedule, schedule),
  deleteSchedule: (id) => ipcRenderer.invoke(IPC.deleteSchedule, id),

  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  getLogs: () => ipcRenderer.invoke(IPC.getLogs),

  onDevice: (cb) => subscribe(IPC.evDevice, cb),
  onDevices: (cb) => subscribe(IPC.evDevices, cb),
  onStatus: (cb) => subscribe(IPC.evStatus, cb),
  onSchedules: (cb) => subscribe(IPC.evSchedules, cb),
  onLog: (cb) => subscribe(IPC.evLog, cb)
}

contextBridge.exposeInMainWorld('tuya', bridge)
