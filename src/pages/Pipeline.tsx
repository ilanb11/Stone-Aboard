import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, FileSignature, Landmark } from 'lucide-react'
import { lawChanges, useBook } from '../lib/useData'
import { COVERAGE_THRESHOLD, deadlineText, grantMatchesForAccount, purchaseFromDeal, type AccountGrantMatch } from '../lib/grants'
import { grantApplicationId } from '../lib/grantDrafts'
import { Reconnects } from './pipeline/Reconnects'
import { useCrm } from '../store'
import { TEAM } from '../data/generate'
import { REGIONS } from '../data/geo'
import { PRODUCT } from '../data/products'
import { OPERATION_LABEL, OPERATION_OPTIONS, OPP_STAGES, isClosedStage, isOpenStage, type Account, type Opportunity, type OppStage } from '../types'
import { Button, Chip, PageHeader, Pill, Select, StatusBadge, Tabs, TextInput, inputClass } from '../components/ui'
import { initials, money, num, shortDate } from '../lib/format'
import { winProbability } from '../lib/scoring'

// Pipeline Review: the six-stage board and a filterable table over the same deals.
// All filters live in the URL, so links from the home page land already filtered.

const DAY = 86400000
const SIZE_OPTIONS = [
  { value: 'all', label: 'Any size' },
  { value: 'lt10', label: 'Under $10K' },
  { value: '10to50', label: '$10K to $50K' },
  { value: '50to100', label: '$50K to $100K' },
  { value: 'gt100', label: '$100K and up' },
]
const CLOSE_OPTIONS = [
  { value: 'all', label: 'Any date' },
  { value: 'past', label: 'Past due (open deals)' },
  { value: '30', label: 'Next 30 days' },
  { value: '90', label: 'Next 90 days' },
  { value: 'later', label: 'More than 90 days out' },
  { value: 'closed90', label: 'Closed in the last 90 days' },
  { value: 'month', label: 'Closed this month' },
]
const STALE_OPTIONS = [
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
]
type SortKey = 'account' | 'stage' | 'arr' | 'prob' | 'weighted' | 'close' | 'touch'
const STAGE_RANK = Object.fromEntries(OPP_STAGES.map((s, i) => [s, i])) as Record<OppStage, number>

export interface Deal {
  o: Opportunity
  a: Account
  open: boolean
  /** Win probability 0..1 (open deals only; the home page score read as a probability). */
  p?: number
  weighted: number
  lastTouch: number
  idleDays: number
  stale: boolean
  overdueDays: number
  /** Grant programs paying at least COVERAGE_THRESHOLD / 2 of this open deal's annual cost (drafts need the full threshold). */
  grants: AccountGrantMatch[]
}

/** Grant programs that can pay for part of one open deal, with any rule change behind them. */
function DealGrants({ d, apps }: { d: Deal; apps: Set<string> }) {
  if (!d.grants.length) return null
  return (
    <details className="mt-1.5 text-[12px]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ink underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
        <Landmark size={11} aria-hidden /> Grant funding: {d.grants.length} {d.grants.length === 1 ? 'program' : 'programs'}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5 border-l border-line pl-2.5">
        {d.grants.map((m) => {
          const dl = deadlineText(m.grant.deadline)
          const id = grantApplicationId(m.grant.id, d.a.id)
          return (
            <li key={m.grant.id} className="text-ink-2">
              <span className="text-ink">{m.grant.shortName}</span> · covers {Math.round(m.coverage.coverage * 100)}% of this deal ({money(m.coverage.funded)})
              <span className="block text-muted">
                {dl.date ? `Deadline ${dl.date}` : dl.label}
                {m.changes[0] ? ` · ${m.changes[0].label}` : ''}
                {apps.has(id) && (
                  <>
                    {' · '}
                    <Link to={`/grants/${id}`} className="text-ink underline underline-offset-4">Draft ready</Link>
                  </>
                )}
              </span>
            </li>
          )
        })}
        <li>
          <Link to={`/signals?tab=grants&account=${d.a.id}`} className="text-ink underline underline-offset-4">Eligibility and applications</Link>
        </li>
      </ul>
    </details>
  )
}

function inSize(arr: number, size: string) {
  switch (size) {
    case 'lt10': return arr < 10_000
    case '10to50': return arr >= 10_000 && arr < 50_000
    case '50to100': return arr >= 50_000 && arr < 100_000
    case 'gt100': return arr >= 100_000
    default: return true
  }
}
function inClose(d: Deal, close: string, now: number) {
  const t = new Date(d.o.closeDate).getTime()
  switch (close) {
    case 'past': return d.overdueDays > 0
    case '30': return d.open && t >= now && t <= now + 30 * DAY
    case '90': return d.open && t >= now && t <= now + 90 * DAY
    case 'later': return d.open && t > now + 90 * DAY
    case 'closed90': return isClosedStage(d.o.stage) && t >= now - 90 * DAY && t <= now
    case 'month': {
      const n = new Date(now)
      const at = new Date(d.o.stage === 'Closed Won' || d.o.stage === 'Closed Lost' ? d.o.stageChangedAt ?? d.o.closeDate : d.o.closeDate)
      return isClosedStage(d.o.stage) && at.getFullYear() === n.getFullYear() && at.getMonth() === n.getMonth()
    }
    default: return true
  }
}

/** Flags on a deal: stale (no stage change or contact in X days) and past its expected close. */
function Flags({ d, staleAfter }: { d: Deal; staleAfter: number }) {
  if (!d.stale && !d.overdueDays) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {d.overdueDays > 0 && <StatusBadge tone="critical" title={`Expected close was ${shortDate(d.o.closeDate)}`}>Past due {d.overdueDays}d</StatusBadge>}
      {d.stale && <StatusBadge tone="warning" title={`No stage change or contact in ${d.idleDays} days (threshold ${staleAfter})`}>Stale {d.idleDays}d</StatusBadge>}
    </div>
  )
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="figure mt-2 text-[34px] text-ink">{value}</dd>
      {sub && <dd className="mt-1 text-[12px] text-muted">{sub}</dd>}
    </div>
  )
}

export default function Pipeline() {
  const book = useBook()
  const activities = useCrm((s) => s.activities)
  const moveOpp = useCrm((s) => s.moveOpp)
  const [params, setParams] = useSearchParams()
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<OppStage | null>(null)
  const [page, setPage] = useState(0)

  const get = (k: string, d: string) => params.get(k) ?? d
  const v0 = get('view', 'board')
  const view: 'board' | 'table' | 'reconnects' = v0 === 'table' || v0 === 'reconnects' ? v0 : 'board'
  const stage = get('stage', 'All') as 'All' | OppStage
  const rep = get('rep', 'All')
  const op = get('op', 'All')
  const region = get('region', 'All')
  const size = get('size', 'all')
  const close = get('close', 'all')
  const flag = get('flag', 'all') as 'all' | 'attention' | 'stale' | 'overdue' | 'grants'
  const grantApps = useCrm((s) => s.grantApplications)
  const appIds = useMemo(() => new Set(grantApps.map((g) => g.id)), [grantApps])
  const staleAfter = Number(get('staleAfter', '30'))
  const q = get('q', '')
  const sortKey = get('sort', 'prob') as SortKey
  const sortDir = get('dir', 'desc') === 'asc' ? 1 : -1
  const update = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '' || v === 'All' || v === 'all') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )
    setPage(0)
  }

  const now = Date.now()
  const deals: Deal[] = useMemo(() => {
    const prob = new Map(book.ranked.filter((r) => r.opp).map((r) => [r.opp!.id, winProbability(r)]))
    const lastAct: Record<string, number> = {}
    for (const v of activities) {
      const t = new Date(v.date).getTime()
      if (t > (lastAct[v.accountId] ?? 0)) lastAct[v.accountId] = t
    }
    // Grant programs that can pay for part of this deal (open deals only; that's the purchase).
    const grantsFor = (a: (typeof book.accounts)[number], o: (typeof book.opportunities)[number]) => grantMatchesForAccount(a, lawChanges, purchaseFromDeal(a, o)).filter((m) => m.coverage.coverage >= COVERAGE_THRESHOLD / 2)
    return book.opportunities.map((o) => {
      const a = book.byId[o.accountId]
      const open = isOpenStage(o.stage)
      const p = open ? prob.get(o.id) : undefined
      const lastTouch = Math.max(new Date(o.stageChangedAt ?? o.createdAt).getTime(), new Date(a.lastContact).getTime(), lastAct[a.id] ?? 0)
      const idleDays = Math.max(0, Math.floor((now - lastTouch) / DAY))
      const closeT = new Date(o.closeDate).getTime()
      return { o, a, open, p, weighted: open ? o.arr * (p ?? 0) : 0, lastTouch, idleDays, stale: open && idleDays > staleAfter, overdueDays: open && closeT < now ? Math.floor((now - closeT) / DAY) : 0, grants: open ? grantsFor(a, o) : [] }
    })
  }, [book, activities, staleAfter, now])

  // Everything except the stage filter (the summary always shows every stage).
  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return deals.filter((d) => {
      if (rep !== 'All' && d.o.owner !== rep) return false
      if (op !== 'All' && d.a.species !== op) return false
      if (region !== 'All' && d.a.region !== region) return false
      if (!inSize(d.o.arr, size)) return false
      if (!inClose(d, close, now)) return false
      if (flag === 'attention' && !d.stale && !d.overdueDays) return false
      if (flag === 'stale' && !d.stale) return false
      if (flag === 'overdue' && !d.overdueDays) return false
      if (flag === 'grants' && !d.grants.length) return false
      if (s && !`${d.a.name} ${d.a.county} ${d.a.state} ${d.o.type}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [deals, rep, op, region, size, close, flag, q, now])
  const shown = stage === 'All' ? base : base.filter((d) => d.o.stage === stage)

  const summary = useMemo(() => {
    const byStage = OPP_STAGES.map((st) => {
      const ds = base.filter((d) => d.o.stage === st)
      return { st, n: ds.length, v: ds.reduce((s, d) => s + d.o.arr, 0) }
    })
    const open = base.filter((d) => d.open)
    const openValue = open.reduce((s, d) => s + d.o.arr, 0)
    const weighted = open.reduce((s, d) => s + d.weighted, 0)
    const year = now - 365 * DAY
    const closed = base.filter((d) => isClosedStage(d.o.stage) && new Date(d.o.closeDate).getTime() >= year)
    const won = closed.filter((d) => d.o.stage === 'Closed Won').length
    const week = now - 7 * DAY
    const added = base.filter((d) => new Date(d.o.createdAt).getTime() >= week).length
    const moved = base.filter((d) => d.o.stageChangedAt && new Date(d.o.stageChangedAt).getTime() >= week && new Date(d.o.stageChangedAt).getTime() > new Date(d.o.createdAt).getTime() + 1000).length
    return { byStage, openValue, weighted, openCount: open.length, winRate: closed.length ? won / closed.length : 0, won, closed: closed.length, added, moved, attention: base.filter((d) => d.stale || d.overdueDays).length, stale: base.filter((d) => d.stale).length, overdue: base.filter((d) => d.overdueDays).length, grants: base.filter((d) => d.grants.length).length }
  }, [base, now])

  const sorted = useMemo(() => {
    const v = (d: Deal): number | string => {
      switch (sortKey) {
        case 'account': return d.a.name
        case 'stage': return STAGE_RANK[d.o.stage]
        case 'arr': return d.o.arr
        case 'prob': return d.p ?? -1
        case 'weighted': return d.weighted
        case 'close': return new Date(d.o.closeDate).getTime()
        case 'touch': return d.lastTouch
      }
    }
    return [...shown].sort((x, y) => {
      const a = v(x), b = v(y)
      return (typeof a === 'string' ? a.localeCompare(b as string) : a - (b as number)) * sortDir
    })
  }, [shown, sortKey, sortDir])

  const drop = (st: OppStage) => {
    if (drag) moveOpp(drag, st) // same store action as Accounts: Negotiation fires Lucas the Hog
    setDrag(null)
    setOver(null)
  }

  const th = (label: string, k?: SortKey, right?: boolean, title?: string) => {
    const active = k === sortKey
    const Icon = active ? (sortDir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th key={label} title={title} className={`whitespace-nowrap px-2.5 py-3 text-[13px] font-normal text-muted first:pl-5 last:pr-5 ${right ? 'text-right' : 'text-left'}`} aria-sort={active ? (sortDir === 1 ? 'ascending' : 'descending') : undefined}>
        {k ? (
          <button type="button" className={`inline-flex items-center gap-1.5 hover:text-ink ${active ? 'text-ink' : ''}`} onClick={() => update({ sort: k, dir: active ? (sortDir === 1 ? 'desc' : 'asc') : k === 'account' || k === 'close' ? 'asc' : 'desc' })}>
            {label} <Icon size={12} className={active ? 'text-ink' : 'text-muted'} aria-hidden />
          </button>
        ) : label}
      </th>
    )
  }

  const PAGE = 50
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE))
  // Moving a deal out of a stage-filtered table can shrink it below the current page.
  const cur = Math.min(page, pages - 1)
  const pageRows = sorted.slice(cur * PAGE, cur * PAGE + PAGE)
  const visibleStages = stage === 'All' ? OPP_STAGES : [stage]
  const td = 'px-2.5 py-3 align-top first:pl-5 last:pr-5'

  return (
    <div>
      <PageHeader
        title="Pipeline Review"
        subtitle="Every deal by stage. Drag a card to move it: the first move into Negotiation has Lucas the Hog draft the contract and intro email for your review, as it does from Accounts. Win probability is the score from the home page."
      />

      {/* Summary */}
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6" aria-label="Pipeline summary">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Figure label="Open pipeline" value={money(summary.openValue)} sub={`${num(summary.openCount)} open ${summary.openCount === 1 ? 'deal' : 'deals'}`} />
          <Figure label="Weighted pipeline" value={money(summary.weighted)} sub={summary.openValue ? `${Math.round((summary.weighted / summary.openValue) * 100)}% of open value, by win probability` : 'No open deals'} />
          <Figure label="Win rate" value={summary.closed ? `${Math.round(summary.winRate * 100)}%` : '—'} sub={summary.closed ? `${summary.won} won of ${summary.closed} closed in the last 12 months` : 'No deals closed in the last 12 months match these filters'} />
          <Figure label="This week" value={`${summary.added + summary.moved}`} sub={`${summary.added} added, ${summary.moved} moved stage`} />
        </dl>
        <div className="mt-6 grid grid-cols-2 gap-2 border-t border-line pt-5 sm:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Totals by stage">
          {summary.byStage.map((s) => {
            const active = stage === s.st
            return (
              <button
                key={s.st}
                type="button"
                aria-pressed={active}
                aria-label={`${s.st}: ${money(s.v)} across ${s.n} ${s.n === 1 ? 'deal' : 'deals'}. ${active ? 'Showing only this stage' : 'Show only this stage'}`}
                onClick={() => update({ stage: active ? null : s.st })}
                className={`min-w-0 rounded-[14px] px-3.5 py-3 text-left transition-colors ${active ? 'bg-accent text-on-accent' : 'bg-accent-soft text-ink hover:bg-accent-soft-2'}`}
              >
                <div className={`text-[13px] ${active ? '' : 'text-ink-2'}`}>{s.st}</div>
                <div className="tabular mt-1 text-[18px]">{money(s.v)}</div>
                <div className={`text-[12px] ${active ? 'opacity-70' : 'text-muted'}`}>{num(s.n)} {s.n === 1 ? 'deal' : 'deals'}</div>
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span>Flags:</span>
          <Pill active={flag === 'attention'} onClick={() => update({ flag: flag === 'attention' ? null : 'attention' })}>Needs attention {summary.attention}</Pill>
          <Pill active={flag === 'stale'} onClick={() => update({ flag: flag === 'stale' ? null : 'stale' })}>Stale {summary.stale}</Pill>
          <Pill active={flag === 'overdue'} onClick={() => update({ flag: flag === 'overdue' ? null : 'overdue' })}>Past due {summary.overdue}</Pill>
          <Pill active={flag === 'grants'} onClick={() => update({ flag: flag === 'grants' ? null : 'grants' })}>Grant funding {summary.grants}</Pill>
          <label className="ml-1 inline-flex items-center gap-2">
            Stale after
            <select
              value={String(staleAfter)}
              onChange={(e) => update({ staleAfter: e.target.value === '30' ? null : e.target.value })}
              className={`${inputClass} h-8 pr-8 text-[13px]`}
            >
              {STALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <span className="basis-full text-muted sm:basis-auto">Stale: an open deal with no stage change or contact in more than {staleAfter} days. Past due: an open deal beyond its expected close date. Needs attention: stale, past due or both. Grant funding: a program would pay at least {Math.round((COVERAGE_THRESHOLD / 2) * 100)}% of this open deal's annual cost (drafts are prepared at {Math.round(COVERAGE_THRESHOLD * 100)}%).</span>
        </div>
      </section>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={view} onChange={(v) => update({ view: v === 'board' ? null : v })} tabs={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }, { value: 'reconnects', label: 'Reconnects' }]} />
      </div>
      {view === 'reconnects' ? (
        <Reconnects />
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 min-[1680px]:grid-cols-8">
        <TextInput className="col-span-2" label="Search" value={q} onChange={(v) => update({ q: v })} placeholder="Account, place or deal type" />
        <Select label="Sales rep" value={rep} onChange={(v) => update({ rep: v })} options={['All', ...TEAM]} />
        <Select label="Operation" value={op} onChange={(v) => update({ op: v })} options={OPERATION_OPTIONS} />
        <Select label="Region" value={region} onChange={(v) => update({ region: v })} options={['All', ...REGIONS]} />
        <Select label="Deal size" value={size} onChange={(v) => update({ size: v })} options={SIZE_OPTIONS} />
        <Select label="Close date" value={close} onChange={(v) => update({ close: v })} options={CLOSE_OPTIONS} />
        <Select label="Stage" value={stage} onChange={(v) => update({ stage: v })} options={['All', ...OPP_STAGES]} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
        <span>
          <span className="tabular text-ink">{num(shown.length)}</span> {shown.length === 1 ? 'deal' : 'deals'} shown
        </span>
        {params.toString() && params.toString() !== 'view=table' && (
          <button type="button" className="text-ink underline underline-offset-4" onClick={() => setParams(view === 'table' ? { view: 'table' } : {}, { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {view === 'board' ? (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-4" aria-label="Pipeline board">
          {visibleStages.map((st) => {
            const col = shown
              .filter((d) => d.o.stage === st)
              .sort((x, y) => (isOpenStage(st) ? (y.p ?? 0) - (x.p ?? 0) : y.o.closeDate.localeCompare(x.o.closeDate)))
            const value = col.reduce((s, d) => s + d.o.arr, 0)
            const weighted = col.reduce((s, d) => s + d.weighted, 0)
            return (
              <div
                key={st}
                data-stage={st}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (over !== st) setOver(st)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === st ? null : o))
                }}
                onDrop={() => drop(st)}
                className={`flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] transition-colors ${over === st ? 'bg-accent-soft-2 ring-2 ring-inset ring-ink' : 'bg-accent-soft'}`}
              >
                <div className="px-4 pb-3 pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-ink">
                      {st} <span className="meta ml-1 font-normal text-muted">{col.length}</span>
                    </span>
                    <span className="tabular text-[13px] text-ink-2">{money(value)}</span>
                  </div>
                  {isOpenStage(st) && <div className="mt-0.5 text-[12px] text-muted">Weighted {money(weighted)}</div>}
                </div>
                <div className="flex max-h-[calc(100vh-260px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {!col.length && <div className="px-2 py-6 text-center text-[13px] text-muted">{drag ? 'Drop here' : 'No deals in this stage'}</div>}
                  {col.map((d) => (
                    <article
                      key={d.o.id}
                      data-opp={d.o.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', d.o.id)
                        setDrag(d.o.id)
                      }}
                      onDragEnd={() => {
                        setDrag(null)
                        setOver(null)
                      }}
                      className={`cursor-grab rounded-[14px] border bg-surface p-4 active:cursor-grabbing ${d.overdueDays || d.stale ? 'border-line-strong' : 'border-line'} ${drag === d.o.id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/accounts/${d.a.id}`} className="min-w-0 text-[14px] font-medium leading-snug text-ink underline-offset-4 hover:underline">
                          {d.a.name}
                        </Link>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-on-accent" title={d.o.owner}>
                          {initials(d.o.owner)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {OPERATION_LABEL[d.a.species]}, {d.a.state}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Chip>{d.o.type}</Chip>
                        <span className="tabular text-[14px] font-medium text-ink">{money(d.o.arr)}</span>
                      </div>
                      {d.p !== undefined && (
                        <div className="mt-2">
                          <div className="flex justify-between text-[12px] text-ink-2">
                            <span>Win probability</span>
                            <span className="tabular">{Math.round(d.p * 100)}%</span>
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-accent-soft-2">
                            <div className="h-1 rounded-full bg-ink" style={{ width: `${d.p * 100}%` }} />
                          </div>
                        </div>
                      )}
                      <div className="meta mt-2 text-muted">
                        {isClosedStage(d.o.stage) ? 'Closed' : d.o.stage === 'On Ice' ? 'Revisit' : 'Closes'} {shortDate(d.o.closeDate)}
                      </div>
                      {d.o.reason && !isOpenStage(d.o.stage) && <div className="mt-1.5 text-[12px] text-ink-2">{d.o.reason}</div>}
                      {d.grants.length > 0 && (
                        <Link to={`/signals?tab=grants&account=${d.a.id}`} className="mt-2 flex items-center gap-1.5 text-[12px] text-ink underline-offset-4 hover:underline" title={d.grants.map((m) => `${m.grant.shortName}: covers ${Math.round(m.coverage.coverage * 100)}% of this deal`).join(', ')}>
                          <Landmark size={12} aria-hidden />
                          <span className="truncate">
                            {d.grants[0].grant.shortName}
                            {d.grants.length > 1 ? ` +${d.grants.length - 1}` : ''} · covers {Math.round(d.grants[0].coverage.coverage * 100)}%
                          </span>
                        </Link>
                      )}
                      <div className="mt-2">
                        <Flags d={d} staleAfter={staleAfter} />
                      </div>
                      {d.o.contractId && (
                        <Link to={`/contracts/${d.o.contractId}`} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink underline-offset-4 hover:underline">
                          <FileSignature size={12} aria-hidden /> {d.o.contractId.startsWith('KD-') ? 'Lucas draft' : 'Contract in Lucas the Hog'}
                        </Link>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full min-w-[980px] text-[14px]">
              <thead>
                <tr>
                  {th('Deal', 'account')}
                  {th('Operation')}
                  {th('Stage', 'stage')}
                  {th('ARR', 'arr', true)}
                  {th('Win prob.', 'prob', true, 'Win probability: the score from the home page')}
                  {th('Weighted', 'weighted', true, 'ARR times win probability')}
                  {th('Close date', 'close')}
                  {th('Last touch', 'touch', false, 'Latest stage change or contact')}
                  {th('Sales rep')}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((d) => (
                  <tr key={d.o.id} className="border-t border-line hover:bg-accent-soft/60">
                    <td className={`${td} min-w-[220px] max-w-[270px]`}>
                      <Link to={`/accounts/${d.a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{d.a.name}</Link>
                      <div className="mt-0.5 truncate text-[12px] text-muted" title={d.o.products.map((p) => PRODUCT[p]?.name).join(', ')}>
                        {d.o.type} · {d.o.products.map((p) => PRODUCT[p]?.name).join(', ')}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
                        {(d.stale || d.overdueDays > 0) && <Flags d={d} staleAfter={staleAfter} />}
                        {d.o.contractId && (
                          <Link to={`/contracts/${d.o.contractId}`} className="inline-flex items-center gap-1 text-[12px] text-ink underline-offset-4 hover:underline">
                            <FileSignature size={11} aria-hidden /> {d.o.contractId.startsWith('KD-') ? 'Lucas draft' : 'Contract'}
                          </Link>
                        )}
                      </div>
                      <DealGrants d={d} apps={appIds} />
                    </td>
                    <td className={`${td} min-w-[120px] max-w-[170px]`}>
                      <span className="text-ink">{OPERATION_LABEL[d.a.species]}</span>
                      <div className="text-[12px] text-muted">{d.a.county}, {d.a.state} · {d.a.region}</div>
                    </td>
                    <td className={td}>
                      <select
                        id={`deal-stage-${d.o.id}`}
                        aria-label={`Stage for ${d.a.name}, ${d.o.type}`}
                        value={d.o.stage}
                        onChange={(e) => moveOpp(d.o.id, e.target.value as OppStage)}
                        className="h-8 rounded-full border border-transparent bg-accent-soft pl-3 pr-7 text-[13px] text-ink outline-none transition-colors hover:bg-accent-soft-2 focus:border-line-strong focus:bg-surface"
                      >
                        {OPP_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {d.o.reason && !isOpenStage(d.o.stage) && <div className="mt-1 max-w-44 text-[12px] text-muted">{d.o.reason}</div>}
                    </td>
                    <td className={`${td} tabular text-right text-ink`}>{money(d.o.arr)}</td>
                    <td className={`${td} tabular text-right text-ink`}>{d.p !== undefined ? `${Math.round(d.p * 100)}%` : <span className="text-muted">—</span>}</td>
                    <td className={`${td} tabular text-right text-ink`}>{d.open ? money(d.weighted) : <span className="text-muted">—</span>}</td>
                    <td className={`${td} meta whitespace-nowrap ${d.overdueDays > 0 ? 'text-critical' : 'text-ink'}`}>{shortDate(d.o.closeDate)}</td>
                    <td className={`${td} whitespace-nowrap text-ink`}>{d.idleDays === 0 ? 'Today' : `${d.idleDays}d ago`}</td>
                    <td className={`${td} min-w-[80px] text-[13px] text-ink-2`}>{d.o.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pageRows.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No deals match these filters. Clear the filters to see the whole pipeline.</div>}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button>
            <span className="tabular px-1 text-[13px] text-ink-2">Page {cur + 1} of {pages}</span>
            <Button size="sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button>
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
