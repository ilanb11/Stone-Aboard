import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileSignature, Sparkles } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { useCrm } from '../store'
import { OPEN_OPP_STAGES } from '../types'
import { BarList, Button, Card, Chip, HealthBadge, PageHeader, Stat, WeatherBadge } from '../components/ui'
import { money, num, relDays } from '../lib/format'
import { SignalRow } from './Signals'

export default function Dashboard() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const m = useMemo(() => {
    const arr = book.customers.reduce((s, a) => s + a.subscriptions.reduce((x, l) => x + l.units * l.unitPrice, 0) * 12, 0)
    const open = book.opportunities.filter((o) => OPEN_OPP_STAGES.includes(o.stage))
    const uplift = Object.values(book.pricing).reduce((s, p) => s + p.upliftArr, 0)
    const underpriced = Object.values(book.pricing).filter((p) => p.status === 'Under-priced').length
    const support = book.customers
      .filter((a) => book.health[a.id]?.level === 'At risk' || book.weatherRisk[a.id]?.risk >= 45)
      .sort((a, b) => (book.weatherRisk[b.id]?.risk ?? 0) - (book.weatherRisk[a.id]?.risk ?? 0) || (book.health[a.id]?.score ?? 0) - (book.health[b.id]?.score ?? 0))
    const week = signals.filter((s) => Date.now() - new Date(s.date).getTime() < 7 * 86400000)
    const byStage = OPEN_OPP_STAGES.map((st) => {
      const os = open.filter((o) => o.stage === st)
      return { st, n: os.length, v: os.reduce((s, o) => s + o.arr, 0) }
    })
    const negotiating = book.contracts.filter((c) => c.status === 'In Negotiation')
    return { arr, open, uplift, underpriced, support, week, byStage, negotiating }
  }, [book])
  const drafts = outreach.filter((o) => o.status === 'Draft').length

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${num(book.customers.length)} customers and ${num(book.accounts.filter((a) => a.status === 'Prospect').length)} prospects across hog and cattle operations`}
        actions={
          <Link to="/signals?tab=newsletter">
            <Button variant="primary"><Sparkles size={14} /> This week's newsletter</Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Customer ARR" value={money(m.arr)} sub={`${book.customers.length} customers`} />
        <Stat label="Open pipeline" value={money(m.open.reduce((s, o) => s + o.arr, 0))} sub={`${m.open.length} opportunities`} />
        <Stat label="Price normalization" value={money(m.uplift)} sub={`${m.underpriced} under-priced accounts`} tone="good" />
        <Stat label="Need support" value={m.support.length} sub="Weather or health risk" tone={m.support.length ? 'serious' : undefined} />
        <Stat label="Signals this week" value={m.week.length} sub="Org & market changes" />
        <Stat label="Outreach awaiting approval" value={drafts} sub={<Link to="/outreach" className="text-accent">Review queue →</Link>} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Top-ranked opportunities" pad={false} action={<Link to="/opportunities" className="text-xs font-medium text-accent">All ranked →</Link>}>
          <ul className="divide-y divide-line">
            {book.ranked.slice(0, 8).map((r, i) => (
              <li key={r.key} className="flex items-start gap-3 px-4 py-2.5">
                <span className="tabular mt-0.5 w-5 text-right text-xs font-semibold text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/accounts/${r.account.id}`} className="text-sm font-medium text-ink hover:text-accent">{r.account.name}</Link>
                    <Chip tone={r.type === 'Price Normalization' ? 'accent' : 'neutral'}>{r.type}</Chip>
                    <span className="text-xs text-muted">{r.stage}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-2">{r.reasons[0] ?? `${r.account.segment} · ${num(r.account.headCount)} head`}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-sm font-semibold text-ink">{money(r.arr)}</div>
                  <div className="tabular text-[11px] text-muted">score {r.priority}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Customers who need support this week" pad={false} action={<Link to="/weather" className="text-xs font-medium text-accent">Weather & health →</Link>}>
          <div className="px-4 pt-2 text-[11px] text-muted">{book.weather.status === 'loading' ? 'Loading forecast…' : `${book.weather.source}`}</div>
          <ul className="divide-y divide-line">
            {m.support.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <Link to={`/accounts/${a.id}`} className="block truncate text-sm font-medium text-ink hover:text-accent">{a.name}</Link>
                  <div className="text-xs text-muted">{a.segment} · {a.county} Co., {a.state}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <WeatherBadge w={book.weatherRisk[a.id]} compact />
                  <HealthBadge h={book.health[a.id]} />
                </div>
              </li>
            ))}
            {!m.support.length && <li className="px-4 py-6 text-center text-sm text-muted">No customers flagged.</li>}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Pipeline by stage" action={<Link to="/opportunities?view=board" className="text-xs font-medium text-accent">Board →</Link>}>
          <BarList data={m.byStage.map((s) => ({ key: s.st, label: s.st, value: s.v, display: money(s.v), sub: `${s.n}` }))} />
        </Card>
        <Card title="Biggest pricing moves" pad={false} action={<Link to="/pricing" className="text-xs font-medium text-accent">Pricing →</Link>}>
          <ul className="divide-y divide-line">
            {Object.entries(book.pricing)
              .filter(([, p]) => p.upliftArr > 0)
              .sort((a, b) => b[1].upliftArr - a[1].upliftArr)
              .slice(0, 5)
              .map(([id, p]) => (
                <li key={id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <Link to={`/accounts/${id}`} className="block truncate font-medium text-ink hover:text-accent">{book.byId[id].name}</Link>
                    <div className="text-xs text-muted">+{p.recommendedPct.toFixed(1)}% at {p.ability?.window.toLowerCase()} · {p.ability && new Date(p.ability.effectiveDate).toLocaleDateString()}</div>
                  </div>
                  <span className="tabular shrink-0 text-good-text">+{money(p.upliftArr)}</span>
                </li>
              ))}
          </ul>
        </Card>
        <Card title="Lucas the Hog: contracts in negotiation" pad={false} action={<Link to="/contracts" className="text-xs font-medium text-accent">Contracts →</Link>}>
          <ul className="divide-y divide-line">
            {m.negotiating.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{book.byId[c.accountId].name}</div>
                  <div className="text-xs text-muted">{c.redlines.length} redlines</div>
                </div>
                <Link to={`/contracts/${c.id}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
                  <FileSignature size={13} /> Review <ArrowRight size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title="Latest changes across hog & cattle operations" pad={false} action={<Link to="/signals" className="text-xs font-medium text-accent">All signals →</Link>}>
        <ul className="divide-y divide-line">
          {signals.slice(0, 6).map((s) => <SignalRow key={s.id} s={s} compact />)}
        </ul>
        <div className="px-4 py-2 text-[11px] text-muted">Updated {relDays(signals[0]?.date ?? new Date().toISOString())}</div>
      </Card>
    </div>
  )
}
