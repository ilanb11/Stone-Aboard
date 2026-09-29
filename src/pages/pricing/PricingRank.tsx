import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileText, RotateCcw } from 'lucide-react'
import type { Species } from '../../types'
import { OPERATION_LABEL, OPERATION_OPTIONS } from '../../types'
import { TEAM } from '../../data/generate'
import { PRODUCTS, baseListPrice, unitLabel } from '../../data/products'
import { useBook } from '../../lib/useData'
import { SEGMENT_FACTORS, useCrm } from '../../store'
import { Button, Card, Notice, Pill, Select, StatusBadge, TextInput, inputClass } from '../../components/ui'
import { Pager } from '../../components/Pager'
import { money, num, shortDate } from '../../lib/format'
import { MAX_RENEWAL_INCREASE, UNIT_WORD, operationTarget, rankCustomers, segmentKey, targetFor, unitFor, unitMoney, type GrainBasis, type UnitRank } from '../../lib/unitPricing'

const SPECIES: Species[] = ['Hog', 'Cattle', 'Grain']
const PAGE = 15
const DAY = 86400000
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** A number field that keeps what the user types and commits only valid positive numbers, so edits apply live. */
function NumberField({ value, onCommit, label, step = 0.01, className = '', prefix = '$' }: { value: number; onCommit: (v: number) => void; label: string; step?: number; className?: string; prefix?: string }) {
  const [text, setText] = useState(String(value))
  // Follow outside changes (reset, basis switch) without fighting the user's typing.
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(Number(value.toFixed(4)))))
  }, [value])
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      {prefix && <span className="pointer-events-none absolute left-3 text-[14px] text-muted">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v) && v > 0) onCommit(v)
        }}
        className={`${inputClass} tabular w-full ${prefix ? 'pl-6' : ''} text-right`}
      />
    </span>
  )
}

function TargetBlock({ species, ranks }: { species: Species; ranks: UnitRank[] }) {
  const model = useCrm((s) => s.pricingModel)
  const setPricingModel = useCrm((s) => s.setPricingModel)
  const setSegmentTarget = useCrm((s) => s.setSegmentTarget)
  const basis = model.grainBasis
  const unit = unitFor(species, basis)
  const mine = ranks.filter((r) => r.account.species === species)
  const segments = [...new Set(mine.map((r) => r.account.segment))].sort()
  const target = operationTarget(model, species)
  const step = unit === 'bushel' ? 0.001 : 0.05
  const commit = (v: number) => setPricingModel(species === 'Hog' ? { hog: v } : species === 'Cattle' ? { cattle: v } : basis === 'acre' ? { grainAcre: v } : { grainBushel: v })
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-accent-soft p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-medium text-ink">{OPERATION_LABEL[species]}</h3>
        {species === 'Grain' && (
          <div className="flex gap-1" role="group" aria-label="Grain pricing basis">
            {(['acre', 'bushel'] as GrainBasis[]).map((b) => (
              <Pill key={b} active={basis === b} onClick={() => setPricingModel({ grainBasis: b })}>
                Per {b}
              </Pill>
            ))}
          </div>
        )}
      </div>
      <label className="flex items-center gap-3 text-[13px] text-ink-2">
        <NumberField value={target} step={step} onCommit={commit} label={`Target price per ${UNIT_WORD[unit][0]} per year for ${OPERATION_LABEL[species].toLowerCase()}`} className="w-32" />
        <span>per {UNIT_WORD[unit][0]} per year</span>
      </label>
      <div className="text-[12px] text-muted">
        Book today: median {unitMoney(median(mine.map((r) => r.currentPerUnit)))} per {UNIT_WORD[unit][0]} · {num(mine.length)} customers · {num(mine.filter((r) => r.status === 'Under target').length)} under target
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">Targets by segment</summary>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Segments follow the operation target through a factor calibrated from the current book (a sow farm costs more to serve per hog than a finisher). Type a segment target to set it directly.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {segments.map((seg) => {
            const key = segmentKey(seg, species, basis)
            const t = targetFor({ species, segment: seg }, model, SEGMENT_FACTORS)
            const factor = SEGMENT_FACTORS[species === 'Grain' ? basis : 'acre'][seg] ?? 1
            return (
              <li key={seg} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-ink">
                  {seg}
                  <span className="ml-2 text-[12px] text-muted">{t.overridden ? 'set directly' : `×${factor}`}</span>
                </span>
                <span className="flex items-center gap-2">
                  <NumberField value={t.value} step={step} onCommit={(v) => setSegmentTarget(key, v)} label={`Target per ${UNIT_WORD[unit][0]} for ${seg}`} className="w-28" />
                  {t.overridden && (
                    <button type="button" className="text-muted hover:text-ink" onClick={() => setSegmentTarget(key, null)} aria-label={`Reset ${seg} to the operation target`} title="Follow the operation target">
                      <RotateCcw size={13} />
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}

function PriceListCard() {
  const priceList = useCrm((s) => s.priceList)
  const setListPrice = useCrm((s) => s.setListPrice)
  const resetPriceList = useCrm((s) => s.resetPriceList)
  const edited = Object.keys(priceList).length
  return (
    <details className="rounded-[var(--radius-card)] border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="text-[15px] font-medium text-ink">Price list</span>
        <span className="text-[13px] text-muted">
          {PRODUCTS.length} products{edited ? ` · ${edited} edited` : ''} · list price is the ceiling for any renewal price
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[620px] text-[14px]">
          <thead>
            <tr className="text-left text-[13px] text-muted">
              <th className="px-5 py-3 font-normal">Product</th>
              <th className="px-3 py-3 font-normal">Priced per</th>
              <th className="px-3 py-3 font-normal">For</th>
              <th className="px-3 py-3 text-right font-normal">List price per month</th>
              <th className="px-5 py-3 text-right font-normal">Base</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTS.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-5 py-2.5 text-ink">{p.name}</td>
                <td className="px-3 py-2.5 text-ink-2">{unitLabel(p.unit).replace(' / mo', '')}</td>
                <td className="px-3 py-2.5 text-[13px] text-muted">{p.species.map((s) => OPERATION_LABEL[s]).join(', ')}</td>
                <td className="px-3 py-2.5 text-right">
                  <NumberField value={priceList[p.id] ?? baseListPrice(p.id)} step={1} onCommit={(v) => setListPrice(p.id, v)} label={`List price for ${p.name}`} className="w-28" />
                </td>
                <td className="tabular px-5 py-2.5 text-right text-[13px] text-muted">
                  {priceList[p.id] !== undefined ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setListPrice(p.id, null)} title="Back to the base price">
                      <RotateCcw size={12} /> ${baseListPrice(p.id)}
                    </button>
                  ) : (
                    `$${baseListPrice(p.id)}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edited > 0 && (
        <div className="border-t border-line px-5 py-3">
          <Button size="sm" variant="ghost" onClick={resetPriceList}>
            <RotateCcw size={12} /> Reset the price list
          </Button>
        </div>
      )}
    </details>
  )
}

/** Current price against target: bar left of center is under target, right is over. */
function GapBar({ gap }: { gap: number }) {
  const w = Math.min(1, Math.abs(gap)) * 50
  const under = gap < 0
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-16 shrink-0 rounded-full bg-accent-soft" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <div className="absolute inset-y-0 rounded-full" style={{ left: under ? `${50 - w}%` : '50%', width: `${w}%`, background: under ? 'var(--color-warm-4)' : 'var(--color-seq-3)' }} />
      </div>
      <span className="tabular w-10 text-right text-[13px] text-ink">
        {gap > 0 ? '+' : gap < 0 ? '−' : ''}
        {Math.round(Math.abs(gap) * 100)}%
      </span>
    </div>
  )
}

export function PricingRank() {
  const book = useBook()
  const model = useCrm((s) => s.pricingModel)
  const priceList = useCrm((s) => s.priceList)
  const invoices = useCrm((s) => s.invoices)
  const resetPricingModel = useCrm((s) => s.resetPricingModel)
  const setPricingModel = useCrm((s) => s.setPricingModel)
  const draftPriceChanges = useCrm((s) => s.draftPriceChanges)
  const [op, setOp] = useState<'All' | Species>('All')
  const [status, setStatus] = useState<'All' | UnitRank['status']>('All')
  const [rep, setRep] = useState('All')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'notice' | 'rank' | 'uplift'>('notice')
  // Pricing opportunities: renewals in the next 30, 60 or 90 days, most imminent notice first.
  const [windowDays, setWindowDays] = useState('90')
  const [modelOpen, setModelOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  // priceList is a dependency on purpose: list prices cap the renewal price.
  const ranks = useMemo(() => rankCustomers(book.customers, book.contractById, model, SEGMENT_FACTORS), [book, model, priceList])
  const draftFor = useMemo(() => {
    const m = new Map<string, (typeof invoices)[number]>()
    for (const i of invoices) if (i.status !== 'Void' && (!m.has(i.accountId) || i.status === 'Draft')) m.set(i.accountId, i)
    return m
  }, [invoices])
  const now = Date.now()
  // The window is on the renewal that's up (the current term end), even when its notice was missed.
  const inWindow = (r: UnitRank) => {
    if (windowDays === 'all') return true
    if (!r.renewal) return false
    const d = new Date(r.renewal.termEnd).getTime() - now
    return d >= 0 && d <= Number(windowDays) * DAY
  }
  // A contract past its notice date without auto-renew sorts first (act now); a missed auto-renewal sorts
  // last, as its change waits for the renewal after.
  const noticeT = (r: UnitRank) => (r.renewal ? new Date(r.renewal.noticeBy).getTime() : Infinity)
  const windowed = ranks.filter(inWindow)
  const shown = windowed
    .filter((r) => (op === 'All' || r.account.species === op) && (status === 'All' || r.status === status) && (rep === 'All' || r.account.rep === rep) && (!q || r.account.name.toLowerCase().includes(q.toLowerCase())))
    .sort((x, y) => (sort === 'uplift' ? y.upliftArr - x.upliftArr || x.rank - y.rank : sort === 'notice' ? noticeT(x) - noticeT(y) || x.rank - y.rank : x.rank - y.rank))
  // A sent change still waiting for its effective date blocks another draft for that account.
  const eligible = (r: UnitRank) => r.upliftArr >= 1 && !!r.renewal && !(draftFor.get(r.account.id)?.status === 'Sent' && !draftFor.get(r.account.id)?.appliedAt)
  // Uplift in a window only counts renewals that can still take the change.
  const under = windowed.filter((r) => r.status === 'Under target' && (windowDays === 'all' || !r.renewal?.rolled))
  const over = windowed.filter((r) => r.status === 'Over target')
  const pickedRanks = ranks.filter((r) => picked.has(r.account.id))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  // Target and list-price edits change the list without touching the filters, so keep the page in range.
  const cur = Math.min(page, pages - 1)
  const pageRows = shown.slice(cur * PAGE, cur * PAGE + PAGE)
  const togglePick = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const pageEligible = pageRows.filter(eligible)
  const allPagePicked = pageEligible.length > 0 && pageEligible.every((r) => picked.has(r.account.id))

  const draft = () => {
    const ids = pickedRanks.filter(eligible).map((r) => r.account.id)
    const c = draftPriceChanges(ids)
    const parts = [c.created && `${c.created} new`, c.updated && `${c.updated} updated`, c.kept && `${c.kept} kept (edited by hand or a band-check notice)`, c.skipped && `${c.skipped} skipped (no change to make)`].filter(Boolean)
    setNote(`Price-change drafts: ${parts.join(', ')}. Each is an email plus an invoice, waiting in the approval queue. Nothing has been sent.`)
    setPicked(new Set())
  }
  const td = 'px-3 py-3 align-top first:pl-5 last:pr-5'

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <button type="button" className="flex min-w-0 items-center gap-2 text-left" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)}>
            {modelOpen ? <ChevronDown size={16} className="shrink-0 text-ink" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-ink" aria-hidden />}
            <span className="text-[15px] font-medium text-ink">Target price per unit</span>
            <span className="tabular truncate text-[13px] text-muted">
              Hog {unitMoney(model.hog)} · Cattle {unitMoney(model.cattle)} · Field crops {unitMoney(model.grainBasis === 'acre' ? model.grainAcre : model.grainBushel)} per {model.grainBasis} · per year
            </span>
          </button>
          {modelOpen && <Button size="sm" variant="ghost" onClick={resetPricingModel}><RotateCcw size={12} /> Reset targets</Button>}
        </div>
        {modelOpen && (
        <div className="border-t border-line px-5 pb-5 pt-4">
        <p className="mb-4 max-w-[80ch] text-[14px] leading-relaxed text-ink-2">
          What a customer should pay a year for each hog, head of cattle, or acre or bushel of grain. Each account’s own target follows the products and sites it subscribes to, so a customer with one module isn’t compared with one running the full suite. Under-target accounts move toward target at renewal, by at most {Math.round(MAX_RENEWAL_INCREASE * 100)}% and not above the price list. Change a target and the ranking, uplift and any open drafts update right away.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {SPECIES.map((s) => (
            <TargetBlock key={s} species={s} ranks={ranks} />
          ))}
        </div>
        <label className="mt-4 flex max-w-[80ch] cursor-pointer items-start gap-2.5 text-[14px] text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={model.capAtList !== false} onChange={(e) => setPricingModel({ capAtList: e.target.checked })} />
          <span>
            Renewal price stops at list price
            <span className="block text-[13px] text-ink-2">
              On: under-target accounts move toward target, up to the price list. Off: they can go above list, still by at most {Math.round(MAX_RENEWAL_INCREASE * 100)}% per renewal.
            </span>
          </span>
        </label>
        </div>
        )}
      </section>

      <PriceListCard />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-[var(--radius-card)] bg-lime px-4 py-3 text-on-lime">
          <div className="text-[13px] text-black/70">{windowDays === 'all' ? 'All customers' : `Renewing in the next ${windowDays} days`}</div>
          <div className="figure mt-1 text-[30px] leading-none">{money(under.reduce((s, r) => s + r.upliftArr, 0))}</div>
          <div className="mt-1 text-[12px] text-black/65">uplift at renewal from {num(under.length)} under-target {under.length === 1 ? 'account' : 'accounts'}</div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <div className="text-[13px] text-ink-2">Renewals in the window</div>
          <div className="figure mt-1 text-[30px] leading-none text-ink">{num(windowed.length)}</div>
          <div className="mt-1 text-[12px] text-muted">{num(windowed.filter((r) => r.status === 'At target').length)} at target (within 5%)</div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <div className="text-[13px] text-ink-2">Over target</div>
          <div className="figure mt-1 text-[30px] leading-none text-ink">{num(over.length)}</div>
          <div className="mt-1 text-[12px] text-muted">{money(over.reduce((s, r) => s + (r.currentArr - r.targetArr), 0))} above target, held at renewal</div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
          <div className="text-[13px] text-ink-2">Stopped by the list price</div>
          <div className="figure mt-1 text-[30px] leading-none text-ink">{num(under.filter((r) => r.cappedAtList).length)}</div>
          <div className="mt-1 text-[12px] text-muted">{model.capAtList !== false ? 'Raise list prices to close more of the gap' : 'List cap is off'}</div>
        </div>
      </div>

      <Card pad={false} title={`Pricing opportunities · ${num(shown.length)} ${shown.length === 1 ? 'renewal' : 'renewals'}`}>
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 pt-2 md:grid-cols-6">
          <Select label="Renewing" value={windowDays} onChange={(v) => { setWindowDays(v); setPage(0) }} options={[{ value: '30', label: 'Next 30 days' }, { value: '60', label: 'Next 60 days' }, { value: '90', label: 'Next 90 days' }, { value: 'all', label: 'All customers' }]} />
          <TextInput label="Customer" value={q} onChange={(v) => { setQ(v); setPage(0) }} placeholder="Search" />
          <Select label="Operation" value={op} onChange={(v) => { setOp(v); setPage(0) }} options={OPERATION_OPTIONS} />
          <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0) }} options={['All', 'Under target', 'At target', 'Over target']} />
          <Select label="Sales rep" value={rep} onChange={(v) => { setRep(v); setPage(0) }} options={['All', ...TEAM]} />
          <Select label="Sort" value={sort} onChange={setSort} options={[{ value: 'notice', label: 'Notice due soonest' }, { value: 'rank', label: 'Furthest under target' }, { value: 'uplift', label: 'Largest uplift' }]} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-accent-soft/60 px-5 py-3 text-[13px]">
          <span className="text-ink">
            <span className="tabular font-medium">{num(pickedRanks.length)}</span> selected
            {pickedRanks.length > 0 && <span className="text-ink-2"> · {money(pickedRanks.reduce((s, r) => s + r.upliftArr, 0))} uplift</span>}
          </span>
          <Button size="sm" variant="primary" disabled={!pickedRanks.some(eligible)} onClick={draft}>
            <FileText size={12} /> Draft emails and invoices
          </Button>
          <button type="button" className="text-ink underline underline-offset-4" onClick={() => setPicked(new Set(shown.filter(eligible).map((r) => r.account.id)))}>
            Select all {num(shown.filter(eligible).length)} with an uplift
          </button>
          {pickedRanks.length > 0 && (
            <button type="button" className="text-ink-2 underline underline-offset-4" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
          <span className="text-muted">Drafts wait in <Link to="/outreach?kind=price" className="text-ink underline underline-offset-4">Automated outreach</Link> for approval. Nothing sends on its own.</span>
        </div>
        {note && (
          <div className="px-5 pt-3">
            <Notice>
              {note} <Link to="/outreach?kind=price" className="underline underline-offset-4">Open the approval queue</Link>
            </Notice>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-[14px]">
            <thead>
              <tr className="text-left text-[13px] text-muted">
                <th className="py-3 pl-5 pr-2 font-normal">
                  <input type="checkbox" className="h-4 w-4" aria-label="Select this page's accounts with an uplift" checked={allPagePicked} disabled={!pageEligible.length} onChange={(e) => setPicked((prev) => { const next = new Set(prev); for (const r of pageEligible) { if (e.target.checked) next.add(r.account.id); else next.delete(r.account.id) } return next })} />
                </th>
                {['Customer', 'Sales rep', 'Per unit a year', 'Against target', 'ARR now → at renewal', 'Uplift at renewal', 'Renewal', 'Drafts'].map((h) => (
                  <th key={h} className={`px-3 py-3 align-bottom font-normal leading-tight last:pr-5 ${['Per unit a year', 'Uplift at renewal'].includes(h) ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const a = r.account
                const [one, many] = UNIT_WORD[r.volume.unit]
                const d = draftFor.get(a.id)
                const ok = eligible(r)
                return (
                  <tr key={a.id} className={`border-t border-line hover:bg-accent-soft/60 ${picked.has(a.id) ? 'bg-accent-soft/60' : ''}`}>
                    <td className="py-3 pl-5 pr-2 align-top">
                      <input type="checkbox" className="h-4 w-4" aria-label={`Select ${a.name}`} checked={picked.has(a.id)} disabled={!ok} title={ok ? undefined : 'No price change to draft'} onChange={(e) => togglePick(a.id, e.target.checked)} />
                    </td>
                    <td className={`${td} min-w-[220px]`}>
                      <div className="flex items-baseline gap-2">
                        <span className="tabular w-8 shrink-0 text-right text-[12px] text-muted" title="Rank: 1 is furthest under target">#{r.rank}</span>
                        <span className="min-w-0">
                          <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{a.name}</Link>
                          <span className="mt-0.5 block text-[12px] text-muted" title={r.volume.note}>
                            {a.segment}, {a.state} · {num(r.volume.qty)} {r.volume.qty === 1 ? one : many}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className={`${td} min-w-[80px] text-[13px] text-ink-2`}>{a.rep}</td>
                    <td className={`${td} tabular whitespace-nowrap text-right`}>
                      <span className="text-ink">{unitMoney(r.currentPerUnit)}</span>
                      <span className="block text-[12px] text-muted">
                        target {unitMoney(r.targetPerUnit)}
                        {r.targetOverridden ? ' (segment)' : ''}
                      </span>
                    </td>
                    <td className={td}>
                      <GapBar gap={r.gap} />
                      <div className="mt-1 text-[12px] text-muted">{r.status}</div>
                    </td>
                    <td className={`${td} tabular whitespace-nowrap text-ink`}>
                      {money(r.currentArr)} → {money(r.renewalArr)}
                      {r.cappedAtList && <div className="text-[12px] text-muted">stops at list</div>}
                    </td>
                    <td className={`${td} tabular whitespace-nowrap text-right`}>
                      <span className={r.upliftArr >= 1 ? 'text-good-text' : 'text-muted'}>{r.upliftArr >= 1 ? `+${money(r.upliftArr)} (+${((r.renewalArr / r.currentArr - 1) * 100).toFixed(1)}%)` : '—'}</span>
                      {r.toTargetArr >= 1 && <span className="block text-[12px] text-muted">{money(r.toTargetArr)} to reach target</span>}
                    </td>
                    <td className={`${td} min-w-[100px] text-[13px]`}>
                      {r.renewal?.rolled ? (
                        <>
                          <span className="whitespace-nowrap text-ink">{shortDate(r.renewal.termEnd)}</span>
                          <div>
                            <StatusBadge tone="critical" title={`The notice date has passed, so this renewal keeps current pricing. A change here takes effect at the renewal after it, ${shortDate(r.renewal.date)}.`}>Notice missed</StatusBadge>
                          </div>
                          <div className="text-[12px] text-muted">Change from {shortDate(r.renewal.date)}</div>
                        </>
                      ) : r.renewal ? (
                        <>
                          <span className="whitespace-nowrap text-ink">{shortDate(r.renewal.date)}</span>
                          {r.renewal.pastNotice ? (
                            <div>
                              <StatusBadge tone="warning" title="The notice date has passed, but the contract doesn't auto-renew, so the renewal can still carry new pricing.">Notify now</StatusBadge>
                            </div>
                          ) : (
                            <div className="text-muted">Notice by {shortDate(r.renewal.noticeBy)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">No contract</span>
                      )}
                    </td>
                    <td className={`${td} text-[13px]`}>
                      {d ? (
                        <Link to={`/outreach?kind=price&account=${a.id}`} className="underline-offset-4 hover:underline">
                          <StatusBadge tone={d.status === 'Sent' ? 'good' : d.stale ? 'serious' : 'warning'}>{d.status === 'Sent' ? 'Sent' : d.stale ? 'Needs a look' : 'Awaiting approval'}</StatusBadge>
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!shown.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No customers match these filters.</div>}
        </div>
        <Pager page={cur} pages={pages} onPage={setPage} total={shown.length} size={PAGE} noun="renewals" />
      </Card>
    </div>
  )
}
