import { createContext, useCallback, useContext, useState, type JSX, type ReactNode } from 'react'

type Kind = 'ok' | 'error' | 'info'
interface Toast {
  id: number
  kind: Kind
  text: string
}

const ToastCtx = createContext<(text: string, kind?: Kind) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = (): ((text: string, kind?: Kind) => void) => useContext(ToastCtx)
