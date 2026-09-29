import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, X } from 'lucide-react'
import { useCrm } from '../store'
import { LucasMark } from './ui'

/** App-wide toast, bottom right. Stays up long enough to act on its link. */
export function Toaster() {
  const toast = useCrm((s) => s.toast)
  const dismiss = useCrm((s) => s.dismissToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, 10000)
    return () => clearTimeout(t)
  }, [toast, dismiss])
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:inset-x-auto sm:right-6 sm:bottom-6" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[18px] bg-accent p-4 text-on-accent shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]">
          {toast.mark === 'grants' ? (
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-lime text-on-lime" aria-hidden>
              <Landmark size={15} />
            </span>
          ) : (
            <LucasMark size={30} />
          )}
          <div className="min-w-0 flex-1 text-[14px] leading-snug">
            <p>{toast.text}</p>
            {toast.link && (
              <Link to={toast.link.to} onClick={dismiss} className="mt-2 inline-flex h-8 items-center rounded-full bg-lime px-3.5 text-[13px] font-medium text-on-lime transition hover:brightness-95">
                {toast.link.label}
              </Link>
            )}
          </div>
          <button type="button" onClick={dismiss} className="-m-1 rounded-full p-1 opacity-70 transition hover:opacity-100" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
