import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBook, signals } from '../lib/useData'
import { STATES, STATE_LIST } from '../data/geo'
import { OPEN_OPP_STAGES, type Species } from '../types'
import { USMap, type MapPoint } from '../components/USMap'
import { Card, Chip, PageHeader, Pill, Select, WeatherBadge } from '../components/ui'
import { money, num } from '../lib/format'
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
const SEQ = [1, 2, 3, 4, 5].map((i) => `var(--color-seq-${i})`)
const WARM = [1, 2, 3, 4, 5].map((i) => `var(--color-warm-${i})`)

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
      <PageHeader title="Heat Map" subtitle="Where the animals are, where we already sell, and where the opportunity is. Click a state for details." />
      <div className="grid gap-4 xl:grid-cols-[1fr_390px]">
        <Card
          pad={false}
          title={
            <div className="flex flex-wrap items-center gap-3">
              <Select value={metric} onChange={setMetric} options={METRICS} />
              <div className="flex items-center gap-1.5">
                {(['Hog', 'Cattle', 'All'] as const).map((s) => <Pill key={s} active={species === s} onClick={() => setSpecies(s)}>{s === 'All' ? 'Hog + Cattle' : s}</Pill>)}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-ink-2">Dots:</span>
                {(['Customer', 'Prospect', 'none'] as const).map((d) => <Pill key={d} active={dots === d} onClick={() => setDots(d)}>{d === 'none' ? 'Hide' : `${d}s`}</Pill>)}
              </div>
            </div>
          }
        >
          <div className="p-3">
            <USMap
              fill={fill}
              selected={sel}
              onStateClick={setSel}
              stateTooltip={(code) => (
                <div>
                  <div className="font-semibold">{STATES[code].name}</div>
                  <div className="text-ink-2">{METRICS.find((m) => m.value === metric)!.label}: {fmt(value(code))}</div>
                  <div className="text-muted">{agg[code].customers} customers · {agg[code].prospects} prospects</div>
                </div>
              )}
              points={points}
              onPointClick={(id) => nav(`/accounts/${id}`)}
              pointTooltip={(id) => {
                const a = book.byId[id]
                return (
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-ink-2">{a.segment} · {num(a.headCount)} head</div>
                    <div className="text-muted">{a.county} Co., {a.state}</div>
                  </div>
                )
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-ink-2">
              <span className="inline-flex items-center gap-2">
                <span className="font-medium">{METRICS.find((m) => m.value === metric)!.label}</span>
                <span className="tabular">{fmt(nonzero[0] ?? 0)}</span>
                <span className="flex">{ramp.map((c) => <span key={c} className="h-3 w-7" style={{ background: c }} />)}</span>
                <span className="tabular">{fmt(vals[vals.length - 1])}</span>
              </span>
              {dots !== 'none' && (
                <span className="inline-flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--color-cat-2)' }} />Hog</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--color-cat-3)' }} />Cattle</span>
                  <span className="text-muted">size = head count</span>
                </span>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title={`${st.name} · ${st.region}`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-lg font-semibold">{st.hogs.toFixed(st.hogs < 1 ? 2 : 1)}M</div><div className="text-xs text-muted">hogs</div></div>
              <div><div className="text-lg font-semibold">{st.cattle.toFixed(1)}M</div><div className="text-xs text-muted">cattle</div></div>
              <div><div className="text-lg font-semibold">{money(g.arr)}</div><div className="text-xs text-muted">ARR</div></div>
              <div><div className="text-lg font-semibold">{g.customers}</div><div className="text-xs text-muted">customers</div></div>
              <div><div className="text-lg font-semibold">{g.prospects}</div><div className="text-xs text-muted">prospects</div></div>
              <div><div className="text-lg font-semibold">{money(g.pipeline)}</div><div className="text-xs text-muted">pipeline</div></div>
            </div>
            <Link to={`/accounts?state=${sel}`} className="mt-3 block text-xs font-medium text-accent">View {stateAccounts.length} accounts →</Link>
          </Card>
          {forecast && (
            <Card title="7-day outlook">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {forecast.map((d) => (
                  <div key={d.date} className="rounded-md bg-surface-2 px-0.5 py-1.5">
                    <div className="text-muted">{new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div className="tabular font-semibold text-ink">{toF(d.tmax)}°</div>
                    <div className="tabular text-muted">{toF(d.tmin)}°</div>
                    <div className="tabular text-ink-2" title="Temperature-humidity index">THI {Math.round(thi(d.tmax, d.rh))}</div>
                    {d.precip >= 5 && <div className="tabular text-accent">{(d.precip / 25.4).toFixed(1)}"</div>}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-muted">{book.weather.source}</div>
            </Card>
          )}
          <Card title="Top opportunities" pad={false}>
            <ul className="divide-y divide-line">
              {top.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0">
                    <Link to={`/accounts/${r.account.id}`} className="block truncate text-sm font-medium text-ink hover:text-accent">{r.account.name}</Link>
                    <div className="truncate text-xs text-muted">{r.type} · {r.reasons[0] ?? r.account.segment}</div>
                  </div>
                  <span className="tabular shrink-0 text-sm text-ink">{money(r.arr)}</span>
                </li>
              ))}
              {!top.length && <li className="px-4 py-4 text-sm text-muted">No open opportunities.</li>}
            </ul>
          </Card>
          <Card title="Recent signals" pad={false}>
            <ul className="divide-y divide-line">
              {stateSignals.map((s) => (
                <li key={s.id} className="px-4 py-2">
                  <div className="flex items-center gap-2"><Chip>{s.type}</Chip><span className="text-[11px] text-muted">{new Date(s.date).toLocaleDateString()}</span></div>
                  <div className="mt-1 text-sm text-ink">{s.headline}</div>
                </li>
              ))}
              {!stateSignals.length && <li className="px-4 py-4 text-sm text-muted">No recent signals.</li>}
            </ul>
          </Card>
          {stateAccounts.some((a) => a.status === 'Customer') && (
            <Card title="Customers by weather risk" pad={false}>
              <ul className="divide-y divide-line">
                {stateAccounts.filter((a) => a.status === 'Customer').sort((a, b) => (book.weatherRisk[b.id]?.risk ?? 0) - (book.weatherRisk[a.id]?.risk ?? 0)).slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link to={`/accounts/${a.id}`} className="truncate text-ink hover:text-accent">{a.name}</Link>
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
