import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Compact pagination for long lists: "21–40 of 128" with previous and next. Hidden when one page is enough. */
export function Pager({ page, pages, onPage, total, size, noun = 'items', className = '' }: { page: number; pages: number; onPage: (p: number) => void; total?: number; size?: number; noun?: string; className?: string }) {
  if (pages <= 1) return null
  // Lists shrink under an open page (edits, store changes, URL filters): show the last real page, never "41–40 of 40".
  const cur = Math.min(Math.max(0, page), pages - 1)
  const per = size ?? (total ? Math.ceil(total / pages) : 0)
  const from = cur * per + 1
  const to = total ? Math.min(total, (cur + 1) * per) : 0
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-ink transition-colors hover:bg-accent-soft-2 disabled:opacity-40 disabled:hover:bg-accent-soft'
  return (
    <nav className={`flex items-center justify-end gap-2 border-t border-line px-5 py-2.5 text-[13px] text-ink-2 ${className}`} aria-label={`${noun} pages`}>
      <span className="tabular">{total && per ? `${from}–${to} of ${total.toLocaleString('en-US')} ${noun}` : `Page ${cur + 1} of ${pages}`}</span>
      <button type="button" className={btn} disabled={cur === 0} onClick={() => onPage(cur - 1)} aria-label="Previous page">
        <ChevronLeft size={15} />
      </button>
      <button type="button" className={btn} disabled={cur >= pages - 1} onClick={() => onPage(cur + 1)} aria-label="Next page">
        <ChevronRight size={15} />
      </button>
    </nav>
  )
}

export const pageCount = (n: number, size: number) => Math.max(1, Math.ceil(n / size))
/** Slice helper so every list pages the same way. A page past the end falls back to the last one. */
export const pageOf = <T,>(list: T[], page: number, size: number) => {
  const p = Math.min(Math.max(0, page), pageCount(list.length, size) - 1)
  return list.slice(p * size, p * size + size)
}
