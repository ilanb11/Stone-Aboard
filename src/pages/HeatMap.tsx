import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBook, signals } from '../lib/useData'
import { STATES, STATE_LIST } from '../data/geo'
import { OPERATION_OPTIONS, OPERATION_TYPES, isOpenStage, type Account, type Species } from '../types'
import { USMap, type MapPoint } from '../components/USMap'
import { Card, Chip, PageHeader, Pill, Select, TextLink } from '../components/ui'
import { money, num, shortDate, sizeLabel } from '../lib/format'
import { mrr } from '../lib/pricing'

type Metric = 'market' | 'customers' | 'arr' | 'prospects' | 'penetration' | 'pipeline' | 'signals'
type Filter = 'All' | Species

const MARKET_LABEL: Record<Filter, string> = {
  Hog: 'Hog inventory (market size)',
  Cattle: 'Cattle inventory (market size)',
  Grain: 'Crop acres planted (market size)',
  All: 'Share of U.S. hogs, cattle and crop acres',
}
const metricsFor = (f: Filter): { value: Metric; label: string }[] => [
  { value: 'market', label: MARKET_LABEL[f] },
  { value: 'prospects', label: 'Prospects (white space)' },
  { value: 'customers', label: 'Customers' },
  { value: 'arr', label: 'Customer ARR' },
  { value: 'penetration', label: f === 'Grain' ? 'Market penetration (% of crop acres)' : f === 'All' ? 'Market penetration (average %)' : 'Market penetration (% of head)' },
  { value: 'pipeline', label: 'Open pipeline ARR' },
  { value: 'signals', label: 'Change signals (30 days)' },
]
// Written out in full: Tailwind only emits theme variables it finds literally in source.
const SEQ = ['var(--color-seq-1)', 'var(--color-seq-2)', 'var(--color-seq-3)', 'var(--color-seq-4)', 'var(--color-seq-5)']

// Map markers: hog = lime, cattle = white, field crops = ink with a light ring.
const MARKER: Record<Species, { color: string; ring?: string }> = {
  Hog: { color: 'var(--color-cat-2)' },
  Cattle: { color: 'var(--color-cat-3)' },
  Grain: { color: 'var(--color-cat-1)', ring: 'var(--color-surface)' },
}
const MARKER_LABEL: Record<Species, string> = { Hog: 'Hog', Cattle: 'Cattle', Grain: 'Field crops' }

/** State market size in the operation's own unit (million head or million acres). */
const market = (code: string, sp: Species) => (sp === 'Hog' ? STATES[code].hogs : sp === 'Cattle' ? STATES[code].cattle : STATES[code].crops)
const US_TOTAL: Record<Species, number> = Object.fromEntries(OPERATION_TYPES.map((sp) => [sp, STATE_LIST.reduce((s, st) => s + market(st.code, sp), 0)])) as Record<Species, number>
/** Customer size in the same unit as `market` (a sow farm's pigs = sows x 11). */
const units = (a: Account) => (a.species === 'Grain' ? a.acres : a.segment === 'Sow Farm' ? a.headCount * 11 : a.headCount)

const nameLink = 'text-ink underline-offset-4 hover:underline'

/** A labelled group of map controls, so pills line up with the metric select. */
function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={label}>
      <span className="text-[13px] text-ink-2" aria-hidden>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

/** One figure in the state summary: serif numerals, label below. */
function StateFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="figure truncate text-[28px] text-ink">{value}</div>
      <div className="mt-1 text-[12px] text-muted">{label}</div>
    </div>
  )
}

const millions = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)}M`

export default function HeatMap() {
  const book = useBook()
  const nav = useNavigate()
  const [metric, setMetric] = useState<Metric>('market')
  const [filter, setFilter] = useState<Filter>('Hog')
  const [dots, setDots] = useState<'none' | 'Customer' | 'Prospect'>('Customer')
  const [sel, setSel] = useState<string>('IA')
  const inFilter = (sp: Species) => filter === 'All' || sp === filter

  const agg = useMemo(() => {
    type Row = { customers: number; prospects: number; arr: number; custUnits: Record<Species, number>; pipeline: number; signals: number }
    const out: Record<string, Row> = {}
    for (const s of STATE_LIST) out[s.code] = { customers: 0, prospects: 0, arr: 0, custUnits: { Hog: 0, Cattle: 0, Grain: 0 }, pipeline: 0, signals: 0 }
    for (const a of book.accounts) {
      if (!inFilter(a.species)) continue
      const g = out[a.state]
      if (a.status === 'Customer') {
        g.customers++
        g.arr += mrr(a) * 12
        g.custUnits[a.species] += units(a)
      } else if (a.status === 'Prospect') g.prospects++
    }
    for (const o of book.opportunities) {
      const a = book.byId[o.accountId]
      if (isOpenStage(o.stage) && inFilter(a.species)) out[a.state].pipeline += o.arr
    }
    const cutoff = Date.now() - 30 * 86400000
    for (const s of signals) if (s.state && new Date(s.date).getTime() > cutoff && (!s.accountId || inFilter(book.byId[s.accountId].species))) out[s.state].signals++
    return out
  }, [book, filter])

  const kinds: Species[] = filter === 'All' ? [...OPERATION_TYPES] : [filter]
  const value = (code: string): number => {
    const g = agg[code]
    switch (metric) {
      case 'market':
        // One type: its own unit. All: the state's average share of the U.S. total, in %.
        return filter === 'All' ? (kinds.reduce((s, sp) => s + market(code, sp) / US_TOTAL[sp], 0) / kinds.length) * 100 : market(code, filter)
      case 'penetration': {
        const shares = kinds.filter((sp) => market(code, sp) > 0).map((sp) => (g.custUnits[sp] / (market(code, sp) * 1e6)) * 100)
        return shares.length ? shares.reduce((s, x) => s + x, 0) / shares.length : 0
      }
      case 'customers': return g.customers
      case 'arr': return g.arr
      case 'prospects': return g.prospects
      case 'pipeline': return g.pipeline
      case 'signals': return g.signals
    }
  }
  const vals = STATE_LIST.map((s) => value(s.code)).sort((a, b) => a - b)
  const nonzero = vals.filter((v) => v > 0)
  const q = (p: number) => nonzero[Math.floor(p * (nonzero.length - 1))] ?? 0
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8)]
  const fill = (code: string) => {
    const v = value(code)
    if (v <= 0) return 'var(--color-surface-2)'
    return SEQ[breaks.filter((b) => v > b).length]
  }
  const fmt = (v: number) => {
    if (metric === 'market') {
      if (filter === 'All') return `${v.toFixed(1)}%`
      const unit = filter === 'Grain' ? 'acres' : 'head'
      return v < 1 ? `${Math.round(v * 1000)}K ${unit}` : `${v.toFixed(1)}M ${unit}`
    }
    if (metric === 'arr' || metric === 'pipeline') return money(v)
    if (metric === 'penetration') return `${v.toFixed(2)}%`
    return num(v)
  }
  const metrics = metricsFor(filter)
  const metricLabel = metrics.find((m) => m.value === metric)!.label

  const points: MapPoint[] = useMemo(
    () =>
      dots === 'none'
        ? []
        : book.accounts
            .filter((a) => a.status === dots && inFilter(a.species))
            .map((a) => ({ id: a.id, lon: a.lon, lat: a.lat, r: Math.max(2.5, Math.min(7, Math.log10((a.species === 'Grain' ? a.acres * 2 : a.headCount) + 10) * 1.4)), ...MARKER[a.species] })),
    [book, dots, filter],
  )

  const st = STATES[sel]
  const g = agg[sel]
  const stateAccounts = book.accounts.filter((a) => a.state === sel && inFilter(a.species))
  const top = book.ranked.filter((r) => r.account.state === sel && inFilter(r.account.species)).slice(0, 5)
  const stateSignals = signals.filter((s) => s.state === sel).slice(0, 5)

  return (
    <div>
      <PageHeader title="Heat map" subtitle="Where the herds and crop acres are, where we already sell, and where the opportunity is. Select a state to see its details." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="self-start" pad={false}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 pt-5">
            <Select label="Color states by" value={metric} onChange={setMetric} options={metrics} className="w-full sm:w-auto" />
            <Control label="Operation">
              {OPERATION_OPTIONS.map((o) => (
                <Pill key={o.value} active={filter === o.value} onClick={() => setFilter(o.value)}>
                  {o.value === 'All' ? 'All' : o.label}
                </Pill>
              ))}
            </Control>
            <Control label="Markers">
              {(['Customer', 'Prospect', 'none'] as const).map((d) => (
                <Pill key={d} active={dots === d} onClick={() => setDots(d)}>
                  {d === 'none' ? 'Hide' : `${d}s`}
                </Pill>
              ))}
            </Control>
          </div>
          <div className="px-3 pb-3 pt-4 sm:px-5">
            <USMap
              fill={fill}
              selected={sel}
              onStateClick={setSel}
              stateTooltip={(code) => (
                <div>
                  <div className="font-medium">{STATES[code].name}</div>
                  <div className="text-ink-2">
                    {metricLabel}: {fmt(value(code))}
                  </div>
                  <div className="text-muted">
                    {agg[code].customers} customers, {agg[code].prospects} prospects
                  </div>
                </div>
              )}
              points={points}
              onPointClick={(id) => nav(`/accounts/${id}`)}
              pointTooltip={(id) => {
                const a = book.byId[id]
                return (
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-ink-2">
                      {a.segment}, {sizeLabel(a)}
                    </div>
                    <div className="text-muted">
                      {a.county} Co., {a.state}
                    </div>
                  </div>
                )
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 px-1 text-[12px] text-ink-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-ink">{metricLabel}</span>
                <span className="inline-flex items-center gap-2">
                  <span className="tabular">{fmt(nonzero[0] ?? 0)}</span>
                  <span className="flex overflow-hidden rounded-full" aria-hidden>
                    {SEQ.map((c) => (
                      <span key={c} className="h-2.5 w-7" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="tabular">{fmt(vals[vals.length - 1])}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border border-line-strong bg-surface-2" aria-hidden />
                  None
                </span>
              </div>
              {dots !== 'none' && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {kinds.map((sp) => (
                    <span key={sp} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: MARKER[sp].color }} aria-hidden />
                      {MARKER_LABEL[sp]}
                    </span>
                  ))}
                  <span className="text-muted">Marker size shows head count or acres</span>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="display text-[32px] text-ink">{st.name}</h2>
            <div className="mt-1.5 text-[13px] text-muted">{st.region}</div>
            <div className="mt-5 grid grid-cols-3 gap-x-4 gap-y-5">
              <StateFigure label="Hogs (head)" value={millions(st.hogs)} />
              <StateFigure label="Cattle (head)" value={millions(st.cattle)} />
              <StateFigure label="Crop acres" value={millions(st.crops)} />
              <StateFigure label="Customers" value={g.customers} />
              <StateFigure label="ARR" value={money(g.arr)} />
              <StateFigure label="Pipeline" value={money(g.pipeline)} />
            </div>
            <Link to={`/accounts?state=${sel}`} className="mt-5 inline-block">
              <TextLink>
                View {stateAccounts.length} {stateAccounts.length === 1 ? 'account' : 'accounts'}, including {g.prospects} {g.prospects === 1 ? 'prospect' : 'prospects'}
              </TextLink>
            </Link>
          </section>

          <Card title="Top opportunities" pad={false}>
            <ul className="divide-y divide-line">
              {top.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/accounts/${r.account.id}`} className={`block truncate text-[14px] ${nameLink}`}>
                      {r.account.name}
                    </Link>
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                      <span>{r.type}</span>
                      <span className="max-w-full truncate">{r.reasons[0] ?? r.account.segment}</span>
                    </div>
                  </div>
                  <span className="tabular shrink-0 text-[14px] text-ink">{money(r.arr)}</span>
                </li>
              ))}
              {!top.length && <li className="px-5 pb-3 pt-2 text-[14px] text-muted">No open opportunities in {st.name}.</li>}
            </ul>
          </Card>

          <Card title="Recent signals" pad={false}>
            <ul className="divide-y divide-line">
              {stateSignals.map((s) => (
                <li key={s.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Chip>{s.type}</Chip>
                    <span className="meta text-muted">{shortDate(s.date)}</span>
                  </div>
                  <div className="mt-1.5 text-[14px] text-ink">{s.headline}</div>
                </li>
              ))}
              {!stateSignals.length && <li className="px-5 pb-3 pt-2 text-[14px] text-muted">No recent signals in {st.name}.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
