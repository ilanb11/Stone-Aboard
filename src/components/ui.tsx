import { useState, type ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDot, CloudRain, Snowflake, Sun, Wind, type LucideIcon } from 'lucide-react'
import type { WeatherRisk } from '../lib/weather'
import type { Health } from '../lib/scoring'

// Design system primitives. Visual language: black ink on white, pill controls,
// 20px cards with hairline borders and no shadows, serif figures for key numbers,
// lime reserved for the one thing that should catch the eye.

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent'
export const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--color-good)',
  warning: 'var(--color-warning)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
  neutral: 'var(--color-muted)',
  accent: 'var(--color-ink)',
}
const TONE_ICON: Record<Tone, LucideIcon> = { good: CheckCircle2, warning: AlertTriangle, serious: AlertTriangle, critical: AlertOctagon, neutral: CircleDot, accent: CircleDot }

/** Section container. Title is plain sentence-case text; action sits right. */
export function Card({ children, className = '', title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={`min-w-0 rounded-[var(--radius-card)] border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'px-5 pb-5 pt-3' : 'pb-2'}>{children}</div>
    </section>
  )
}

/** Inline text link used for card actions ("See all"). No arrows. */
export function TextLink({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">{children}</span>
}

/** Key figure: serif numerals, quiet label above. */
export function Stat({ label, value, sub, tone, highlight }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; highlight?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[var(--radius-card)] px-5 py-4 ${highlight ? 'bg-lime text-on-lime' : 'border border-line bg-surface'}`}>
      <div className={`text-[13px] ${highlight ? 'text-black/70' : 'text-ink-2'}`}>{label}</div>
      <div className="figure mt-2 text-[44px]" style={tone && tone !== 'neutral' && !highlight ? { color: TONE_COLOR[tone] } : undefined}>
        {value}
      </div>
      {sub && <div className={`mt-1.5 text-[13px] ${highlight ? 'text-black/65' : 'text-muted'}`}>{sub}</div>}
    </div>
  )
}

/** Status label: always icon + text, never color alone. */
export function StatusBadge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  const Icon = TONE_ICON[tone]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink" title={title}>
      <Icon size={14} strokeWidth={2.25} style={{ color: TONE_COLOR[tone] }} aria-hidden />
      {children}
    </span>
  )
}

/** Small pill label. `accent` = solid ink, `lime` = the signal color, `dim` = retired/secondary. */
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'dim' | 'lime' }) {
  const cls =
    tone === 'accent'
      ? 'bg-accent text-on-accent'
      : tone === 'lime'
        ? 'bg-lime text-on-lime'
        : tone === 'dim'
          ? 'bg-accent-soft text-muted'
          : 'bg-accent-soft text-ink'
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${cls}`}>{children}</span>
}

export function HealthBadge({ h }: { h?: Health }) {
  if (!h) return <span className="text-[13px] text-muted">None</span>
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
  if (!w) return <span className="text-[13px] text-muted">None</span>
  const tone = weatherTone(w.risk)
  const Icon = w.kind ? KIND_ICON[w.kind] : CheckCircle2
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink" title={w.detail}>
      <Icon size={14} strokeWidth={2.25} style={{ color: TONE_COLOR[tone] }} aria-hidden />
      {compact ? (w.kind ? w.label.split(' (')[0] : 'Normal') : w.label}
      <span className="tabular text-muted">{w.risk}</span>
    </span>
  )
}

/** Toggle pill (filters, segmented choices). Active = solid ink. */
export function Pill({ children, active, onClick, title }: { children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors ${active ? 'bg-accent text-on-accent' : 'bg-accent-soft text-ink hover:bg-accent-soft-2'}`}
    >
      {children}
    </button>
  )
}

const fieldCls = 'h-9 rounded-[var(--radius-field)] border border-transparent bg-accent-soft px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-muted hover:bg-accent-soft-2 focus:border-line-strong focus:bg-surface'

export function Select<T extends string>({ value, onChange, options, label, className = '' }: { value: T; onChange: (v: T) => void; options: (T | { value: T; label: string })[]; label?: string; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 text-[13px] text-ink-2 ${className}`}>
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${fieldCls} pr-8`}>
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
    <label className={`flex min-w-0 flex-col gap-1.5 text-[13px] text-ink-2 ${className}`}>
      {label && <span>{label}</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={fieldCls} />
    </label>
  )
}

export const inputClass = fieldCls

/** Pill buttons. primary = solid ink, secondary = soft fill, ghost = text, danger = critical text. */
export function Button({ children, onClick, variant = 'secondary', size = 'md', title, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'lime'; size?: 'sm' | 'md'; title?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  const v = {
    primary: 'bg-accent text-on-accent hover:opacity-85',
    lime: 'bg-lime text-on-lime hover:brightness-95',
    secondary: 'bg-accent-soft text-ink hover:bg-accent-soft-2',
    ghost: 'bg-transparent text-ink-2 hover:bg-accent-soft hover:text-ink',
    danger: 'bg-accent-soft text-critical hover:bg-accent-soft-2',
  }[variant]
  const s = size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-9 px-4 text-[14px]'
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${s}`}>
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

/** Horizontal bar list: thin rounded ink bars on a soft track; hover dims the others. */
export function BarList({ data, max }: { data: BarDatum[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value))
  const [hover, setHover] = useState<string | null>(null)
  return (
    <ul className="flex flex-col gap-3">
      {data.map((d) => (
        <li key={d.key} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} title={`${typeof d.label === 'string' ? d.label : d.key}: ${d.display ?? d.value.toLocaleString()}${d.sub ? ` (${d.sub})` : ''}`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="truncate text-ink">{d.label}</span>
            <span className="tabular shrink-0 text-ink">
              {d.display ?? d.value.toLocaleString()}
              {d.sub && <span className="ml-1.5 text-muted">{d.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-accent-soft">
            <div className="h-1.5 rounded-full transition-[width,opacity]" style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / m) * 100)}%`, background: d.color ?? 'var(--color-ink)', opacity: hover && hover !== d.key ? 0.35 : 1 }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-[14px] text-muted">{children}</div>
}

/** Page title: large, light, tightly tracked. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="display text-[40px] text-ink sm:text-[48px]">{title}</h1>
        {subtitle && <div className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`max-h-[90vh] w-full overflow-y-auto rounded-[var(--radius-card)] bg-surface p-6 ${wide ? 'max-w-3xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="display mb-4 text-[24px] text-ink">{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** Segmented pill tabs, like the reference's category pills. */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`h-9 rounded-full px-4 text-[14px] transition-colors ${value === t.value ? 'bg-accent text-on-accent' : 'bg-accent-soft text-ink hover:bg-accent-soft-2'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Inline notice (toasts, flashes). */
export function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex items-center gap-2 rounded-full bg-lime px-4 py-2 text-[14px] text-on-lime">{children}</div>
}

/** Mark for Lucas the Hog: a lime disc with a pig glyph. Replaces emoji. */
export function LucasMark({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-lime text-on-lime" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 11c0-3.3 3.1-6 7-6s7 2.7 7 6-3.1 6-7 6-7-2.7-7-6Z" />
        <path d="M6.5 6.5 5 4M17.5 6.5 19 4" />
        <ellipse cx="12" cy="12.3" rx="2.4" ry="1.6" />
        <path d="M11.2 12.3h.01M12.8 12.3h.01" />
        <path d="M9 9.2h.01M15 9.2h.01" />
        <path d="M9 16.5 8.5 19.5M15 16.5l.5 3" />
      </svg>
    </span>
  )
}
