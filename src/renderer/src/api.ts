import type { TuyaBridge } from '../../shared/types'

declare global {
  interface Window {
    tuya?: TuyaBridge
  }
}

let bridge: TuyaBridge | undefined

/** Di Electron `window.tuya` disediakan preload; di browser biasa (dev/uji UI) dipakai mock. */
export async function loadBridge(): Promise<void> {
  if (window.tuya) {
    bridge = window.tuya
    return
  }
  const { createMockBridge } = await import('./mock')
  bridge = createMockBridge()
}

export const api: TuyaBridge = new Proxy({} as TuyaBridge, {
  get: (_t, prop: string) => {
    if (!bridge) throw new Error('Bridge belum siap')
    return (bridge as unknown as Record<string, unknown>)[prop]
  }
})

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron membungkus error IPC: "Error invoking remote method 'x': Error: pesan"
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
