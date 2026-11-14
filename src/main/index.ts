import { app, BrowserWindow, Menu, nativeImage, nativeTheme, safeStorage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import iconPath from '../../resources/icon.png?asset'
import { IPC, type Settings } from '../shared/types'
import { AppController } from './controller'
import { registerIpc } from './ipc'
import { Store, type SecretCipher } from './store'

const APP_ID = 'id.tuya-desktop.app'
const devUrl = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let controller: AppController | null = null
let quitting = false

// Satu instance saja — instance kedua hanya memunculkan jendela yang sudah ada.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId(APP_ID)

  const cipher: SecretCipher = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
  const store = new Store(app.getPath('userData'), cipher)
  controller = new AppController(store)

  const rendererOrigin = devUrl ? new URL(devUrl).origin : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  registerIpc(controller, {
    isTrustedSender: (e) => {
      const url = e.senderFrame?.url ?? ''
      return devUrl ? url.startsWith(rendererOrigin) : url === rendererOrigin
    },
    onSettingsSaved: applyLoginItem
  })

  const forward = (channel: string) => (payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }
  controller.on('device', forward(IPC.evDevice))
  controller.on('devices', forward(IPC.evDevices))
  controller.on('status', forward(IPC.evStatus))
  controller.on('schedules', forward(IPC.evSchedules))
  controller.on('log', forward(IPC.evLog))

  createWindow()
  createTray()
  applyLoginItem(controller.getSettings())
  controller.start()

  app.on('activate', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
    controller?.dispose()
  })
  // Aplikasi tetap hidup di tray; keluar hanya lewat menu tray / Ctrl+Q.
  app.on('window-all-closed', () => undefined)
}

function applyLoginItem(settings: Settings): void {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: settings.launchAtLogin ? ['--hidden'] : [] })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Tuya Desktop',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151c' : '#f4f5f8',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWindow?.show()
  })

  // Tutup = sembunyikan ke tray agar jadwal tetap berjalan.
  mainWindow.on('close', (e) => {
    if (!quitting && controller?.getSettings().closeToTray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Blokir navigasi keluar & jendela baru; tautan https dibuka di browser sistem.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) e.preventDefault()
  })

  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
  tray.setToolTip('Tuya Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Tampilkan', click: () => showWindow() },
      {
        label: 'Segarkan perangkat',
        click: () => {
          controller?.loadDevices(true).catch(() => undefined)
        }
      },
      { type: 'separator' },
      {
        label: 'Keluar',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showWindow())
}
