import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CloudSun, FileSignature, Flame, Landmark, Mail, Newspaper, Pencil, Plane, RotateCcw, Tags, TriangleAlert, Wallet } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { SEGMENT_FACTORS, useCrm } from '../store'
import { OPP_STAGES, isOpenStage, type Opportunity } from '../types'
import { STATES } from '../data/geo'
import { money, num } from '../lib/format'
import { winProbability } from '../lib/scoring'
import { findReconnects } from '../lib/reconnects'
import { rankCustomers } from '../lib/unitPricing'
import { useWeatherImpact } from '../lib/weatherImpact'
import { inputClass } from '../components/ui'
import { weekStart } from './Signals'
import { localDay } from '../lib/tripPlanner'
import { purchaseLapse } from '../lib/grantDrafts'

/** Default monthly sales target (booked ARR) until the user sets one. */
export const DEFAULT_MONTHLY_TARGET = 125_000
const DAY = 86400000
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
/** When a won deal was won: the stage change, or its close date for seeded history. */
export const wonAt = (o: { stage: string; stageChangedAt?: string; closeDate: string }) => (o.stage === 'Closed Won' ? new Date(o.stageChangedAt ?? o.closeDate) : null)

/** Small clickable box: label, one figure, one line of context. */
function Tile({ to, label, value, sub, icon, highlight }: { to: string; label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; highlight?: boolean }) {
  return (
    <Link
      to={to}
      className={`group flex min-w-0 flex-col rounded-[var(--radius-card)] px-4 py-3.5 transition-colors ${highlight ? 'bg-lime text-on-lime' : 'border border-line bg-surface hover:border-line-strong'}`}
    >
      <span className={`flex items-center gap-2 text-[13px] ${highlight ? 'text-black/70' : 'text-ink-2'}`}>
        <span aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ArrowUpRight size={14} className="shrink-0 opacity-40 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="figure mt-2 truncate text-[30px] leading-none">{value}</span>
      {sub && <span className={`mt-2 line-clamp-2 text-[12px] leading-snug ${highlight ? 'text-black/65' : 'text-muted'}`}>{sub}</span>}
    </Link>
  )
}

function SalesBar() {
  const book = useBook()
  const targets = useCrm((s) => s.salesTargets)
  const setSalesTarget = useCrm((s) => s.setSalesTarget)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const now = new Date()
  const key = monthKey(now)
  const target = targets[key] ?? DEFAULT_MONTHLY_TARGET
  const won = book.opportunities.filter((o) => {
    const d = wonAt(o)
    return d && monthKey(d) === key
  })
  const booked = won.reduce((s, o) => s + o.arr, 0)
  const byType = ['New Logo', 'Expansion', 'Renewal'].map((t) => ({ t, v: won.filter((o) => o.type === t).reduce((s, o) => s + o.arr, 0) }))
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pace = now.getDate() / days
  const pct = target ? booked / target : 0
  const ahead = pct >= pace
  const left = days - now.getDate()
  const commit = () => {
    const v = Number(draft.replace(/[$,\s]/g, ''))
    if (Number.isFinite(v) && v > 0) setSalesTarget(key, Math.round(v))
    setEditing(false)
  }
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4" aria-label="Sales against target this month">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[13px] text-ink-2">Sales this month · {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <span className="figure text-[34px] leading-none text-ink">{money(booked)}</span>
          <span className="text-[14px] text-ink-2">
            of{' '}
            {editing ? (
              <input
                autoFocus
                aria-label="Monthly sales target"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' ? setEditing(false) : undefined)}
                className={`${inputClass} tabular h-8 w-28`}
              />
            ) : (
              <button type="button" className="inline-flex items-center gap-1 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" onClick={() => { setDraft(String(target)); setEditing(true) }} title="Change this month's target">
                {money(target)} target <Pencil size={11} aria-hidden />
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
          <span className={`tabular font-medium ${ahead ? 'text-good-text' : 'text-ink'}`}>{Math.round(pct * 100)}% of target</span>
          <span className="text-muted">
            {ahead ? 'Ahead of' : 'Behind'} pace ({money(target * pace)} by today) · {left} {left === 1 ? 'day' : 'days'} left
          </span>
          <Link to="/pipeline?view=table&stage=Closed%20Won&close=month" className="text-ink underline underline-offset-4">
            {num(won.length)} {won.length === 1 ? 'deal' : 'deals'}
          </Link>
        </div>
      </div>
      <div className="relative mt-3 h-3 rounded-full bg-accent-soft" role="img" aria-label={`${money(booked)} booked of ${money(target)}, ${Math.round(pct * 100)}%. Pace for today is ${Math.round(pace * 100)}%.`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-ink transition-[width]" style={{ width: `${Math.min(100, pct * 100)}%` }} />
        <div className="absolute -inset-y-1 w-0.5 rounded-full bg-lime ring-2 ring-surface" style={{ left: `${pace * 100}%` }} title={`Pace: ${Math.round(pace * 100)}% by today`} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {byType.map(({ t, v }) => (
          <span key={t}>
            {t} <span className="tabular text-ink-2">{money(v)}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-0.5 rounded-full bg-lime ring-1 ring-line-strong" aria-hidden /> Pace for today
        </span>
      </div>
    </section>
  )
}

export default function Dashboard() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const activities = useCrm((s) => s.activities)
  const invoices = useCrm((s) => s.invoices)
  const grants = useCrm((s) => s.grantApplications)
  const trips = useCrm((s) => s.trips)
  const model = useCrm((s) => s.pricingModel)
  const priceList = useCrm((s) => s.priceList)
  // Email tracking (Lucas the Hog inbox): proposed contract changes waiting for a person.
  const mailToReview = useCrm((s) => s.mailProposals.filter((p) => p.status === 'Proposed' && !p.auto).length)
  const impact = useWeatherImpact(book.accounts)

  const m = useMemo(() => {
    const now = Date.now()
    const open = book.opportunities.filter((o) => isOpenStage(o.stage))
    const prob = new Map(book.ranked.filter((r) => r.opp).map((r) => [r.opp!.id, winProbability(r)]))
    const weighted = open.reduce((s, o) => s + o.arr * (prob.get(o.id) ?? 0), 0)
    const won90 = book.opportunities.filter((o) => {
      const d = wonAt(o)
      return d && now - d.getTime() < 90 * DAY
    })
    const lastAct: Record<string, number> = {}
    for (const v of activities) lastAct[v.accountId] = Math.max(lastAct[v.accountId] ?? 0, new Date(v.date).getTime())
    // Whole days, as Pipeline Review counts them, so the tile matches /pipeline?flag=attention.
    const daysSince = (t: number) => Math.floor((now - t) / DAY)
    const isPastDue = (o: Opportunity) => daysSince(new Date(o.closeDate).getTime()) > 0
    const isStale = (o: Opportunity) => {
      const a = book.byId[o.accountId]
      return daysSince(Math.max(new Date(o.stageChangedAt ?? o.createdAt).getTime(), new Date(a.lastContact).getTime(), lastAct[a.id] ?? 0)) > 30
    }
    const pastDue = open.filter(isPastDue).length
    const stale = open.filter(isStale).length
    const attention = open.filter((o) => isStale(o) || isPastDue(o)).length
    const byStage = OPP_STAGES.map((st) => {
      const os = book.opportunities.filter((o) => o.stage === st)
      return { st, n: os.length, v: os.reduce((s, o) => s + o.arr, 0) }
    })
    const reconnectsNow = findReconnects(book.opportunities, book.byId, activities, signals).filter((r) => r.timing === 'Now')
    // Same window as the Pricing rank: the renewal that's up (current term end) within 90 days.
    const renewals = rankCustomers(book.customers, book.contractById, model, SEGMENT_FACTORS).filter((r) => {
      const d = r.renewal ? new Date(r.renewal.termEnd).getTime() - now : -1
      return d >= 0 && d <= 90 * DAY && r.upliftArr >= 1
    })
    // Rolling 7 days to match Signals' "Last 7 days"; the newsletter counts its own Monday-start issue.
    const orgWeek = signals.filter((s) => s.type !== 'Regulatory' && now - new Date(s.date).getTime() < 7 * DAY)
    const issueStart = weekStart(new Date(now)).getTime()
    const issue = signals.filter((s) => new Date(s.date).getTime() >= issueStart)
    const negotiating = book.contracts.filter((c) => c.status === 'In Negotiation')
    const lucasDrafts = book.contracts.filter((c) => c.status === 'Draft')
    return { open, weighted, won90, pastDue, stale, attention, byStage, reconnectsNow, renewals, issue, orgWeek, negotiating, lucasDrafts }
  }, [book, activities, model, priceList])

  const drafts = outreach.filter((o) => o.status === 'Draft')
  const priceDrafts = invoices.filter((i) => i.status === 'Draft').length
  // R&D tax-credit notes aren't held to the 50% coverage rule, so they don't count as grants.
  // Drafts whose purchase fell through (deal lost, account churned) no longer count.
  const live = grants.filter((g) => g.status === 'Draft' && book.byId[g.accountId] && purchaseLapse(g, book.byId[g.accountId], book.opportunities) === null)
  const grantDrafts = live.filter((g) => g.kind === 'Grant').length
  const taxNotes = live.filter((g) => g.kind === 'Tax credit').length
  const today = localDay()
  const trip = trips.find((t) => t.end >= today)
  const weather = impact.groups
  const severe = weather.filter((g) => g.severity === 'Severe').length

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[40px] text-ink sm:text-[48px]">Dashboard</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            {num(book.customers.length)} customers and {num(book.accounts.filter((a) => a.status === 'Prospect').length)} prospects across hog, cattle and field-crop operations.
          </p>
        </div>
      </div>

      <SalesBar />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Tile to="/pipeline" icon={<Flame size={14} />} label="Open pipeline" value={money(m.open.reduce((s, o) => s + o.arr, 0))} sub={`${num(m.open.length)} deals · ${money(m.weighted)} weighted by win probability`} />
        <Tile to="/pipeline?view=table&stage=Closed%20Won&close=closed90" icon={<Wallet size={14} />} label="Won in the last 90 days" value={money(m.won90.reduce((s, o) => s + o.arr, 0))} sub={`${num(m.won90.length)} ${m.won90.length === 1 ? 'deal' : 'deals'}`} />
        <Tile highlight to="/pricing" icon={<Tags size={14} />} label="Renewal price uplift" value={money(m.renewals.reduce((s, r) => s + r.upliftArr, 0))} sub={`${num(m.renewals.length)} renewals to notify in the next 90 days${priceDrafts ? ` · ${priceDrafts} drafts waiting` : ''}`} />
        <Tile to="/outreach" icon={<Mail size={14} />} label="Outreach awaiting approval" value={num(drafts.length)} sub={drafts.length ? `${num(drafts.filter((o) => o.invoiceId).length)} price changes, ${num(drafts.filter((o) => o.playbook === 'trip-meeting').length)} meeting requests, ${num(drafts.filter((o) => o.playbook === 'reconnect').length)} reconnects` : 'Nothing waiting'} />

        <Tile to={mailToReview ? "/contracts?tab=mail" : "/contracts"} icon={<FileSignature size={14} />} label="Legal: Lucas the Hog" value={num(m.negotiating.length)} sub={`contracts in negotiation · ${num(m.lucasDrafts.length)} drafts to review${mailToReview ? ` · ${num(mailToReview)} email changes to confirm` : ''}`} />
        <Tile to="/pipeline?view=reconnects" icon={<RotateCcw size={14} />} label="Reconnects due now" value={num(m.reconnectsNow.length)} sub={m.reconnectsNow[0] ? `Top: ${m.reconnectsNow[0].account.name}` : 'Lost and on-ice deals worth another try'} />
        <Tile to="/pipeline?flag=attention" icon={<TriangleAlert size={14} />} label="Deals needing attention" value={num(m.attention)} sub={`${num(m.stale)} stale for more than 30 days · ${num(m.pastDue)} past their close date`} />
        <Tile to="/map#trip" icon={<Plane size={14} />} label="Next trip" value={trip ? `${trip.county ? `${trip.county}, ` : ''}${trip.state}` : 'None'} sub={trip ? `${new Date(trip.start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(trip.end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${STATES[trip.state]?.name}` : 'Plan one under the heat map'} />

        <Tile to="/signals?days=7" icon={<Newspaper size={14} />} label="Org changes, last 7 days" value={num(m.orgWeek.length)} sub={m.orgWeek[0]?.headline ?? 'No new changes'} />
        <Tile to="/signals?tab=weather" icon={<CloudSun size={14} />} label="Weather impact" value={impact.status === 'ready' ? num(weather.length) : '…'} sub={impact.status === 'ready' ? `${num(severe)} severe · ${num(new Set(weather.flatMap((g) => g.accounts.map((a) => a.id))).size)} accounts affected` : 'Checking the forecast'} />
        <Tile to="/signals?tab=grants" icon={<Landmark size={14} />} label="Grant applications" value={num(grantDrafts)} sub={`drafts that cover at least half of a purchase${taxNotes ? ` · ${num(taxNotes)} R&D tax-credit ${taxNotes === 1 ? 'note' : 'notes'}` : ''}`} />
        <Tile to="/signals?tab=newsletter" icon={<Newspaper size={14} />} label="This week’s newsletter" value={num(m.issue.length)} sub="changes in The Hog, Herd & Field Brief" />
      </div>

      <nav className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Pipeline by stage">
        {m.byStage.map((s) => (
          <Link
            key={s.st}
            to={`/pipeline?view=table&stage=${encodeURIComponent(s.st)}`}
            aria-label={`${s.st}: ${s.n} deals, open in Pipeline Review`}
            className={`min-w-0 rounded-[14px] px-3 py-2.5 transition-colors ${isOpenStage(s.st) ? 'bg-accent-soft hover:bg-accent-soft-2' : 'border border-line hover:border-line-strong'}`}
          >
            <span className="block truncate text-[12px] text-ink-2">{s.st}</span>
            <span className="tabular block text-[15px] text-ink">{money(s.v)}</span>
            <span className="text-[12px] text-muted">{num(s.n)} deals</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
