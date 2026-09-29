export function money(v: number, digits = 1): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${Math.round(a)}`
}

export const num = (v: number) => Math.round(v).toLocaleString('en-US')
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function relDays(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${(d / 365).toFixed(1)}y ago`
}

export const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))

export function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
}

/** True when running inside a sandboxed frame (the published link), where downloads are blocked. */
export function isFramed(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/**
 * Save text as a file. Inside a sandboxed frame downloads are inert, so the text
 * is copied to the clipboard instead. Returns what happened so the UI can say so.
 */
export async function saveText(filename: string, text: string, type = 'text/plain'): Promise<'downloaded' | 'copied' | 'failed'> {
  if (isFramed()) {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      return 'failed'
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  return 'downloaded'
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return saveText(filename, rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv')
}
