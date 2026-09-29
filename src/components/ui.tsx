import { useState, type ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, CloudRain, Snowflake, Sun, Wind, type LucideIcon } from 'lucide-react'
import type { WeatherRisk } from '../lib/weather'
import type { Health } from '../lib/scoring'

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent'
export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--color-good)',
  warning: 'var(--color-warning)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
  neutral: 'var(--color-muted)',
  accent: 'var(--color-accent)',
}
const TONE_ICON: Record<Tone, LucideIcon> = { good: CheckCircle2, warning: AlertTriangle, serious: AlertTriangle, critical: AlertOctagon, neutral: CircleDot, accent: CircleDot }

export function Card({ children, className = '', title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink" style={tone && tone !== 'neutral' ? { color: TONE_COLOR[tone] } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

/** Status label: always icon + text, never color alone. */
export function StatusBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  const Icon = TONE_ICON[tone]
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink" title={title}>
      <Icon size={14} style={{ color: TONE_COLOR[tone] }} aria-hidden />
      {children}
    </span>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'dim' }) {
  const cls = tone === 'accent' ? 'bg-accent-soft text-accent' : tone === 'dim' ? 'bg-surface-2 text-muted' : 'bg-surface-2 text-ink-2'
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

export function HealthBadge({ h }: { h?: Health }) {
  if (!h) return <span className="text-xs text-muted">—</span>
  const tone: Tone = h.level === 'Healthy' ? 'good' : h.level === 'Watch' ? 'warning' : 'critical'
  return (
    <StatusBadge tone={tone} title={h.parts.map((p) => `${p.label}: ${p.value}`).join('\n')}>
      {h.level} <span className="tabular text-muted">{h.score}</span>
    </StatusBadge>
  )
}

const KIND_ICON = { heat: Sun, cold: Snowflake, rain: CloudRain, dry: Wind }
export function weatherTone(risk: number): Tone {
  return risk >= 70 ? 'critical' : risk >= 45 ? 'serious' : risk >= 22 ? 'warning' : 'good'
}
export function WeatherBadge({ w, compact }: { w?: WeatherRisk; compact?: boolean }) {
  if (!w) return <span className="text-xs text-muted">—</span>
  const tone = weatherTone(w.risk)
  const Icon = w.kind ? KIND_ICON[w.kind] : CheckCircle2
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink" title={w.detail}>
      <Icon size={14} style={{ color: TONE_COLOR[tone] }} aria-hidden />
      {compact ? (w.kind ? w.label.split(' (')[0] : 'Normal') : w.label}
      <span className="tabular text-muted">{w.risk}</span>
    </span>
  )
}

export function Pill({ children, active, onClick, title }: { children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong'}`}
    >
      {children}
    </button>
  )
}

export function Select<T extends string>({ value, onChange, options, label, className = '' }: { value: T; onChange: (v: T) => void; options: (T | { value: T; label: string })[]; label?: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-ink-2 ${className}`}>
      {label && <span className="font-medium">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent">
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value
          return (
            <option key={v} value={v}>
              {typeof o === 'string' ? o : o.label}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export function TextInput({ value, onChange, placeholder, label, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-ink-2 ${className}`}>
      {label && <span className="font-medium">{label}</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent" />
    </label>
  )
}

export function Button({ children, onClick, variant = 'secondary', size = 'md', title, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; title?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  const v = {
    primary: 'bg-accent text-white hover:opacity-90 border-transparent',
    secondary: 'bg-surface text-ink border-line hover:border-line-strong',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-surface-2',
    danger: 'bg-surface text-critical border-line hover:border-critical',
  }[variant]
  const s = size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm'
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition disabled:opacity-40 ${v} ${s}`}>
      {children}
    </button>
  )
}

export interface BarDatum {
  key: string
  label: ReactNode
  value: number
  display?: string
  color?: string
  sub?: string
}

/** Horizontal bar list: thin rounded bars; hover dims the others. */
export function BarList({ data, max }: { data: BarDatum[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value))
  const [hover, setHover] = useState<string | null>(null)
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.key} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink">{d.label}</span>
            <span className="tabular shrink-0 text-ink-2">
              {d.display ?? d.value.toLocaleString()}
              {d.sub && <span className="ml-1 text-muted">{d.sub}</span>}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-2">
            <div className="h-2 rounded-full transition-[width]" style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / m) * 100)}%`, background: d.color ?? 'var(--color-accent)', opacity: hover && hover !== d.key ? 0.55 : 1 }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.value ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
