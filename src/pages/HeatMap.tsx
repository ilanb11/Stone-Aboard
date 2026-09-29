import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CloudRain } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { STATES, STATE_LIST } from '../data/geo'
import { OPEN_OPP_STAGES, type Species } from '../types'
import { USMap, type MapPoint } from '../components/USMap'
import { Card, Chip, PageHeader, Pill, Select, TextLink, WeatherBadge } from '../components/ui'
import { money, num, shortDate } from '../lib/format'
import { toF, thi } from '../lib/weather'
import { mrr } from '../lib/pricing'

type Metric = 'inventory' | 'customers' | 'arr' | 'whitespace' | 'penetration' | 'pipeline' | 'signals' | 'weather'
const METRICS: { value: Metric; label: string }[] = [
  { value: 'inventory', label: 'Animal inventory (market size)' },
  { value: 'whitespace', label: 'Prospect head count (white space)' },
  { value: 'customers', label: 'Customers' },
  { value: 'arr', label: 'Customer ARR' },
  { value: 'penetration', label: 'Market penetration (% of head)' },
  { value: 'pipeline', label: 'Open pipeline ARR' },
  { value: 'signals', label: 'Change signals (30 days)' },
  { value: 'weather', label: 'Weather risk (next 7 days)' },
]
// Written out in full: Tailwind only emits theme variables it finds literally in source.
const SEQ = ['var(--color-seq-1)', 'var(--color-seq-2)', 'var(--color-seq-3)', 'var(--color-seq-4)', 'var(--color-seq-5)']
const WARM = ['var(--color-warm-1)', 'var(--color-warm-2)', 'var(--color-warm-3)', 'var(--color-warm-4)', 'var(--color-warm-5)']

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

export default function HeatMap() {
  const book = useBook()
  const nav = useNavigate()
  const [metric, setMetric] = useState<Metric>('inventory')
  const [species, setSpecies] = useState<'All' | Species>('Hog')
  const [dots, setDots] = useState<'none' | 'Customer' | 'Prospect'>('Customer')
  const [sel, setSel] = useState<string>('IA')

  const agg = useMemo(() => {
    const out: Record<string, { customers: number; prospects: number; arr: number; custHead: number; prospectHead: number; pipeline: number; signals: number; weather: number; wn: number }> = {}
    for (const s of STATE_LIST) out[s.code] = { customers: 0, prospects: 0, arr: 0, custHead: 0, prospectHead: 0, pipeline: 0, signals: 0, weather: 0, wn: 0 }
    const inSpecies = (sp: Species) => species === 'All' || sp === species
    for (const a of book.accounts) {
      if (!inSpecies(a.species)) continue
      const g = out[a.state]
      if (a.status === 'Customer') {
        g.customers++
        g.arr += mrr(a) * 12
        g.custHead += a.segment === 'Sow Farm' ? a.headCount * 11 : a.headCount
        g.weather += book.weatherRisk[a.id]?.risk ?? 0
        g.wn++
      } else if (a.status === 'Prospect') {
        g.prospects++
        g.prospectHead += a.headCount
      }
    }
    for (const o of book.opportunities) {
      const a = book.byId[o.accountId]
      if (OPEN_OPP_STAGES.includes(o.stage) && inSpecies(a.species)) out[a.state].pipeline += o.arr
    }
    const cutoff = Date.now() - 30 * 86400000
    for (const s of signals) if (s.state && new Date(s.date).getTime() > cutoff && (!s.accountId || inSpecies(book.byId[s.accountId].species))) out[s.state].signals++
    return out
  }, [book, species])

  const inventory = (code: string) => (species === 'Hog' ? STATES[code].hogs : species === 'Cattle' ? STATES[code].cattle : STATES[code].hogs + STATES[code].cattle)
  const value = (code: string): number => {
    const g = agg[code]
    switch (metric) {
      case 'inventory': return inventory(code)
      case 'customers': return g.customers
      case 'arr': return g.arr
      case 'whitespace': return g.prospectHead
      case 'penetration': return inventory(code) > 0 ? (g.custHead / (inventory(code) * 1e6)) * 100 : 0
      case 'pipeline': return g.pipeline
      case 'signals': return g.signals
      case 'weather': return g.wn ? g.weather / g.wn : 0
    }
  }
  const vals = STATE_LIST.map((s) => value(s.code)).sort((a, b) => a - b)
  const nonzero = vals.filter((v) => v > 0)
  const q = (p: number) => nonzero[Math.floor(p * (nonzero.length - 1))] ?? 0
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8)]
  const ramp = metric === 'weather' ? WARM : SEQ
  const fill = (code: string) => {
    const v = value(code)
    if (v <= 0) return 'var(--color-surface-2)'
    return ramp[breaks.filter((b) => v > b).length]
  }
  const fmt = (v: number) =>
    metric === 'inventory' ? (v < 1 ? `${Math.round(v * 1000)}K head` : `${v.toFixed(1)}M head`) : metric === 'arr' || metric === 'pipeline' ? money(v) : metric === 'penetration' ? `${v.toFixed(2)}%` : metric === 'weather' ? v.toFixed(0) : num(v)
  const metricLabel = METRICS.find((m) => m.value === metric)!.label

  const points: MapPoint[] = useMemo(
    () =>
      dots === 'none'
        ? []
        : book.accounts
            .filter((a) => a.status === dots && (species === 'All' || a.species === species))
            .map((a) => ({ id: a.id, lon: a.lon, lat: a.lat, r: Math.max(2.5, Math.min(7, Math.log10(a.headCount + 10) * 1.4)), color: a.species === 'Hog' ? 'var(--color-cat-2)' : 'var(--color-cat-3)' })),
    [book, dots, species],
  )

  const st = STATES[sel]
  const g = agg[sel]
  const stateAccounts = book.accounts.filter((a) => a.state === sel && (species === 'All' || a.species === species))
  const top = book.ranked.filter((r) => r.account.state === sel && (species === 'All' || r.account.species === species)).slice(0, 5)
  const stateSignals = signals.filter((s) => s.state === sel).slice(0, 5)
  const forecast = book.weather.byState[sel]

  return (
    <div>
      <PageHeader title="Heat map" subtitle="Where the animals are, where we already sell, and where the opportunity is. Select a state to see its details." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="self-start" pad={false}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 pt-5">
            <Select label="Color states by" value={metric} onChange={setMetric} options={METRICS} className="w-full sm:w-auto" />
            <Control label="Species">
              {(['Hog', 'Cattle', 'All'] as const).map((s) => (
                <Pill key={s} active={species === s} onClick={() => setSpecies(s)}>
                  {s === 'All' ? 'Hog and cattle' : s}
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
                      {a.segment}, {num(a.headCount)} head
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
                    {ramp.map((c) => (
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
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: 'var(--color-cat-2)' }} aria-hidden />
                    Hog
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: 'var(--color-cat-3)' }} aria-hidden />
                    Cattle
                  </span>
                  <span className="text-muted">Marker size shows head count</span>
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
              <StateFigure label="Hogs" value={`${st.hogs.toFixed(st.hogs < 1 ? 2 : 1)}M`} />
              <StateFigure label="Cattle" value={`${st.cattle.toFixed(1)}M`} />
              <StateFigure label="ARR" value={money(g.arr)} />
              <StateFigure label="Customers" value={g.customers} />
              <StateFigure label="Prospects" value={g.prospects} />
              <StateFigure label="Pipeline" value={money(g.pipeline)} />
            </div>
            <Link to={`/accounts?state=${sel}`} className="mt-5 inline-block">
              <TextLink>
                View {stateAccounts.length} {stateAccounts.length === 1 ? 'account' : 'accounts'}
              </TextLink>
            </Link>
          </section>

          {forecast && (
            <Card title="7-day outlook">
              <ol className="grid grid-cols-7 gap-1.5 text-center" aria-label="7-day forecast">
                {forecast.map((d) => {
                  const weekday = new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })
                  return (
                    <li
                      key={d.date}
                      className="min-w-0 rounded-[14px] bg-accent-soft px-0.5 py-2.5"
                      title={`${weekday}: high ${toF(d.tmax)}°F, low ${toF(d.tmin)}°F, THI ${Math.round(thi(d.tmax, d.rh))}`}
                    >
                      <div className="text-[12px] text-muted">{weekday}</div>
                      <div className="tabular mt-1 text-[15px] text-ink">{toF(d.tmax)}°</div>
                      <div className="tabular text-[12px] text-muted">{toF(d.tmin)}°</div>
                      <div className="tabular mx-1.5 mt-1.5 border-t border-line pt-1.5 text-[12px] text-ink-2">{Math.round(thi(d.tmax, d.rh))}</div>
                      {d.precip >= 5 && (
                        <div className="tabular mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-ink" title="Rain">
                          <CloudRain size={10} strokeWidth={2.25} aria-hidden />
                          {(d.precip / 25.4).toFixed(1)}"
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              <p className="mt-2 text-[12px] text-muted">Daily high, low and THI.{forecast.some((d) => d.precip >= 5) ? ' Rain in inches.' : ''}</p>
              <div className="meta mt-1 text-muted">{book.weather.source}</div>
            </Card>
          )}

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

          {stateAccounts.some((a) => a.status === 'Customer') && (
            <Card title="Customers by weather risk" pad={false}>
              <ul className="divide-y divide-line">
                {stateAccounts
                  .filter((a) => a.status === 'Customer')
                  .sort((a, b) => (book.weatherRisk[b.id]?.risk ?? 0) - (book.weatherRisk[a.id]?.risk ?? 0))
                  .slice(0, 5)
                  .map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
                      <Link to={`/accounts/${a.id}`} className={`min-w-0 truncate ${nameLink}`}>
                        {a.name}
                      </Link>
                      <WeatherBadge w={book.weatherRisk[a.id]} compact />
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
