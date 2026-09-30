import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Account, Contract, Invoice } from '../types'
import { Send } from 'lucide-react'
import { Button, Card, Modal, PageHeader, Pill, StatusBadge, Tabs, TextLink, inputClass } from '../components/ui'
import { InvoicePreview } from '../components/InvoicePreview'
import { LiveEmailNote } from '../components/LiveEmail'
import { deliverOutreach } from '../lib/liveMail'
import { Pager } from '../components/Pager'
import { draftBandNotice, type PriceChangeDraft } from '../lib/priceChangeDrafts'
import { money, num, shortDate } from '../lib/format'
import { CPI_ESTIMATE, type PricingAnalysis, type PriceStatus } from '../lib/pricing'
import { PricingRank } from './pricing/PricingRank'

/** Discount track: the grey segment marks the normal band, the ink tick marks the actual discount. */
export function BandBar({ pa }: { pa: PricingAnalysis }) {
  const max = 0.5
  const pos = (d: number) => `${Math.min(100, Math.max(0, (d / max) * 100))}%`
  const low = (pa.bandLow * 100).toFixed(0)
  const high = (pa.bandHigh * 100).toFixed(0)
  const actual = (pa.actualDiscount * 100).toFixed(0)
  return (
    <div className="w-full min-w-40" role="img" aria-label={`Actual discount ${actual}%, normal band ${low} to ${high}%`}>
      <div className="relative h-2.5 rounded-full bg-accent-soft">
        <div className="absolute inset-y-0 rounded-full bg-seq-2" style={{ left: pos(pa.bandLow), width: `calc(${pos(pa.bandHigh)} - ${pos(pa.bandLow)})` }} />
        <div className="absolute -top-1 h-4.5 w-1.5 -translate-x-1/2 rounded-full border-2 border-surface bg-ink" style={{ left: pos(pa.actualDiscount) }} title={`Actual discount ${actual}%`} />
      </div>
      <div className="tabular mt-1.5 flex justify-between gap-2 whitespace-nowrap text-[11px] text-muted">
        <span>0% discount</span>
        <span>
          Band {low}–{high}%
        </span>
        <span>50%</span>
      </div>
    </div>
  )
}

export function PriceAnalysisPanel({ pa, contract }: { a: Account; pa: PricingAnalysis; contract?: Contract }) {
  const tone = pa.status === 'In band' ? 'good' : pa.status === 'Under-priced' ? 'warning' : 'serious'
  return (
    <div className="flex flex-col gap-4 text-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StatusBadge tone={tone}>{pa.status}</StatusBadge>
        <div className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-ink-2">
          <span>Current {money(pa.currentMrr)}/mo</span>
          <span>List {money(pa.listMrr)}/mo</span>
          <span>Discount {(pa.actualDiscount * 100).toFixed(1)}%</span>
        </div>
      </div>
      <BandBar pa={pa} />
      {contract && (
        <div className="rounded-[14px] bg-accent-soft px-4 py-3 text-[13px] text-ink-2">
          <div className="font-medium text-ink">Can we change the price?</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="meta text-muted">{contract.id}</span>
            <span className="text-ink">
              {contract.price.mechanism}
              {contract.price.capPct ? `, cap ${contract.price.capPct}%` : ''}
            </span>
          </div>
          {pa.ability?.explanation && <p className="mt-1.5 leading-relaxed">{pa.ability.explanation}</p>}
        </div>
      )}
      <p className="leading-relaxed text-ink">{pa.recommendation}</p>
      {pa.upliftArr > 0 && <div className="tabular text-[13px] text-good-text">+{money(pa.upliftArr)} ARR from this adjustment</div>}
    </div>
  )
}

const th = 'whitespace-nowrap px-4 py-3 text-left text-[13px] font-normal text-muted first:pl-5 last:pr-5'
const thNum = 'whitespace-nowrap px-4 py-3 text-right text-[13px] font-normal text-muted first:pl-5 last:pr-5'
const td = 'px-4 py-4 first:pl-5 last:pr-5'
const none = <span className="text-muted">—</span>

export default function Pricing() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'band' ? 'band' : 'rank'
  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="Two lenses on every customer's price. Pricing rank compares what each one pays per hog, head or acre with the targets you set and drafts the renewal change. The band check compares its discount with peers of its size against what its contract allows."
      />
      <Tabs
        value={view}
        onChange={(v) => setParams(v === 'rank' ? {} : { view: v }, { replace: true })}
        tabs={[
          { value: 'rank', label: 'Pricing rank' },
          { value: 'band', label: 'Discount band and contract check' },
        ]}
      />
      {view === 'rank' ? <PricingRank /> : <BandCheck />}
    </div>
  )
}

const DAY = 86400000
const BAND_PAGE = 15

function MiniStat({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[var(--radius-card)] px-4 py-3 ${highlight ? 'bg-lime text-on-lime' : 'border border-line bg-surface'}`}>
      <div className={`text-[13px] ${highlight ? 'text-black/70' : 'text-ink-2'}`}>{label}</div>
      <div className="figure mt-1 text-[30px] leading-none">{value}</div>
      <div className={`mt-1 text-[12px] ${highlight ? 'text-black/65' : 'text-muted'}`}>{sub}</div>
    </div>
  )
}

/** Each account's newest price-change invoice that isn't void. */
export function lastNotices(invoices: Invoice[]) {
  const m = new Map<string, Invoice>()
  for (const i of invoices) if (i.status !== 'Void' && (!m.has(i.accountId) || i.createdAt > m.get(i.accountId)!.createdAt)) m.set(i.accountId, i)
  return m
}

/** The action for an under-priced account whose window is open. The band check and the account page share it. */
export function NoticeAction({ a, pa, contract, last, onPreview, primary }: { a: Account; pa: PricingAnalysis; contract?: Contract; last?: Invoice; onPreview: (d: PriceChangeDraft) => void; primary?: boolean }) {
  // A sent notice blocks another only until it takes effect; then any remaining gap can be noticed.
  if (last?.status === 'Sent' && !last.appliedAt) return <StatusBadge tone="good">Notice sent {shortDate(last.sentAt ?? '')}</StatusBadge>
  if (last?.status === 'Draft')
    return (
      <Link to={`/outreach?kind=price&account=${a.id}`}>
        <StatusBadge tone="warning">Draft awaiting approval</StatusBadge>
      </Link>
    )
  const draft = draftBandNotice(a, pa, contract)
  return (
    <Button size={primary ? 'md' : 'sm'} variant={primary ? 'primary' : 'secondary'} onClick={() => draft && onPreview(draft)} disabled={!draft} title="Preview the revised-pricing email and invoice, then send">
      <Send size={12} /> Notify +{pa.recommendedPct.toFixed(1)}%
    </Button>
  )
}

/** Preview of the revised-pricing email and invoice; sending is the approval. */
export function NoticeModal({ draft, onClose }: { draft: PriceChangeDraft; onClose: () => void }) {
  const pushPriceChange = useCrm((s) => s.pushPriceChange)
  const [subject, setSubject] = useState(draft.email.subject)
  const [body, setBody] = useState(draft.email.body)
  const d = { ...draft, email: { ...draft.email, subject, body } }
  const inv = { ...draft.invoice, outreachId: '', createdAt: new Date().toISOString(), emailGenerated: { subject, body } }
  return (
    <Modal open onClose={onClose} title={`Revised pricing for ${draft.invoice.billTo.name}`} wide>
      <div className="flex flex-col gap-3">
        <div className="text-[13px] text-ink-2">
          To {draft.email.contactName} &lt;{draft.email.contactEmail}&gt;. Sending here sends the email with the revised invoice (simulated unless Real email is on in Automated outreach).
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputClass} w-full font-medium`} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
          <span>Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={`${inputClass.replace('h-9', 'py-2.5')} w-full resize-y leading-relaxed`} />
        </label>
        <div className="text-[13px] text-ink-2">Revised invoice</div>
        <InvoicePreview inv={inv} />
        <LiveEmailNote />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { pushPriceChange(d, false); onClose() }}>Save as draft for approval</Button>
          <Button variant="primary" onClick={() => { const id = pushPriceChange(d, true); void deliverOutreach(id); onClose() }}>
            <Send size={13} /> Send email and invoice
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function BandCheck() {
  const book = useBook()
  const invoices = useCrm((s) => s.invoices)
  const [tab, setTab] = useState<PriceStatus | 'All'>('Under-priced')
  // Pricing opportunities: a change that takes effect in the next 30, 60 or 90 days, most imminent notice first.
  const [windowDays, setWindowDays] = useState<'30' | '60' | '90' | 'all'>('90')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState<PriceChangeDraft | null>(null)
  const noticeT = (pa: PricingAnalysis) => (pa.ability ? new Date(pa.ability.noticeBy).getTime() : Infinity)
  const inWindow = (pa: PricingAnalysis) => {
    if (windowDays === 'all') return true
    if (!pa.ability) return false
    const d = new Date(pa.ability.effectiveDate).getTime() - Date.now()
    return d >= 0 && d <= Number(windowDays) * DAY
  }

  const rows = useMemo(() => {
    return book.customers
      .map((a) => ({ a, pa: book.pricing[a.id], c: a.contractId ? book.contractById[a.contractId] : undefined }))
      .filter((r) => r.pa && (tab === 'All' || r.pa.status === tab))
      .filter((r) => inWindow(r.pa))
      // Windows that can still be noticed come first; missed notices and locks go last.
      .sort((x, y) => (windowDays === 'all' ? y.pa.upliftArr - x.pa.upliftArr || Math.abs(y.pa.neededPct) - Math.abs(x.pa.neededPct) : Number(!x.pa.ability?.canActNow) - Number(!y.pa.ability?.canActNow) || noticeT(x.pa) - noticeT(y.pa)))
  }, [book, tab, windowDays])
  const lastNotice = useMemo(() => lastNotices(invoices), [invoices])
  const pages = Math.max(1, Math.ceil(rows.length / BAND_PAGE))
  const cur = Math.min(page, pages - 1)

  const all = Object.values(book.pricing)
  const under = all.filter((p) => p.status === 'Under-priced')
  const over = all.filter((p) => p.status === 'Over-priced')
  const soon = under.filter((p) => inWindow(p) && (windowDays === 'all' || !!p.ability?.canActNow))

  return (
    <div>
      <p className="mb-5 max-w-[80ch] text-[14px] leading-relaxed text-ink-2">Each current customer's discount against the normal band for its size. Herdbook checks every suggestion against the contract's price clause, so you only see changes the contract allows.</p>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MiniStat highlight label={windowDays === 'all' ? 'Under-priced, any window' : `Under-priced, can change in the next ${windowDays} days`} value={num(soon.length)} sub={`${money(soon.reduce((s, p) => s + p.upliftArr, 0))} ARR to recover`} />
          <MiniStat label="Under-priced customers" value={num(under.length)} sub={`${money(under.reduce((s, p) => s + p.upliftArr, 0))} ARR in total`} />
          <MiniStat label="Over-priced, churn risk" value={num(over.length)} sub={`${money(over.reduce((s, p) => s + p.currentMrr * 12, 0))} ARR exposed`} />
          <MiniStat label="In band" value={num(all.length - under.length - over.length)} sub={`of ${num(all.length)} customers`} />
        </div>

        <Card pad={false}>
          <div className="px-5 pt-5">
            <Tabs value={tab} onChange={(v) => { setTab(v); setPage(0) }} tabs={(['Under-priced', 'Over-priced', 'In band', 'All'] as const).map((t) => ({ value: t, label: t }))} />
            <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Pricing window">
              {(['30', '60', '90', 'all'] as const).map((w) => (
                <Pill key={w} active={windowDays === w} onClick={() => { setWindowDays(w); setPage(0) }}>
                  {w === 'all' ? 'Any window' : `Next ${w} days`}
                </Pill>
              ))}
              <span className="ml-1 text-[13px] text-muted">{windowDays === 'all' ? 'Largest uplift first' : 'Most imminent notice first'}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-[14px]">
              <thead>
                <tr>
                  <th className={`min-w-[180px] ${th}`}>Customer</th>
                  <th className={th}>Sales rep</th>
                  <th className={thNum}>MRR</th>
                  <th className={`min-w-[190px] ${th}`}>Discount vs. normal band</th>
                  <th className={`min-w-[160px] ${th}`}>Price clause</th>
                  <th className={`min-w-[150px] ${th}`}>Window</th>
                  <th className={thNum}>Needed</th>
                  <th className={thNum}>Uplift ARR</th>
                  {/* relative keeps the hidden label inside the scrolling table instead of widening the page */}
                  <th className={`relative ${thNum}`}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(cur * BAND_PAGE, cur * BAND_PAGE + BAND_PAGE).map(({ a, pa, c }) => (
                  <tr key={a.id} className="border-t border-line align-top hover:bg-accent-soft/60">
                    <td className={td}>
                      <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {a.name}
                      </Link>
                      <div className="mt-0.5 text-[13px] text-muted">
                        {a.segment}, {a.state}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-[13px] text-ink-2`}>{a.rep}</td>
                    <td className={`${td} tabular text-right`}>{money(pa.currentMrr)}</td>
                    <td className={td}>
                      <BandBar pa={pa} />
                    </td>
                    <td className={`${td} text-[13px]`}>
                      {c ? (
                        <>
                          <div className="text-ink">
                            {c.price.mechanism}
                            {c.price.capPct ? `, cap ${c.price.capPct}%` : ''}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                            {c.mfn && <span>MFN</span>}
                            <span>{c.autoRenew ? 'Auto-renews' : 'No auto-renew'}</span>
                            <span>Ends {shortDate(c.end)}</span>
                          </div>
                        </>
                      ) : (
                        none
                      )}
                    </td>
                    <td className={`${td} text-[13px]`}>
                      {pa.ability ? (
                        <>
                          <div className="text-ink">
                            {pa.ability.window}, <span className="whitespace-nowrap">{shortDate(pa.ability.effectiveDate)}</span>
                          </div>
                          <div className="mt-0.5">
                            {!pa.ability.canActNow ? (
                              pa.ability.window === 'Locked' ? (
                                <span className="text-muted">Price locked</span>
                              ) : (
                                <StatusBadge tone="critical" title="The notice deadline has passed. This change moves to the next window.">Notice missed</StatusBadge>
                              )
                            ) : new Date(pa.ability.noticeBy).getTime() < Date.now() ? (
                              <StatusBadge tone="warning" title="The notice date has passed, but the contract doesn't auto-renew, so the renewal can still carry new pricing.">Notify now</StatusBadge>
                            ) : (
                              <span className="text-ink-2">
                                Notice by <span className="whitespace-nowrap">{shortDate(pa.ability.noticeBy)}</span>
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        none
                      )}
                    </td>
                    <td className={`${td} tabular text-right`}>
                      <div>
                        {pa.neededPct >= 0 ? '+' : ''}
                        {pa.neededPct.toFixed(1)}%
                      </div>
                      {pa.status === 'Under-priced' && (
                        <div className="mt-0.5 whitespace-nowrap text-[13px] text-muted">{pa.ability?.maxIncreasePct == null ? 'Market reset' : `Max +${pa.ability.maxIncreasePct.toFixed(1)}%`}</div>
                      )}
                    </td>
                    <td className={`${td} tabular text-right text-good-text`}>{pa.upliftArr > 0 ? `+${money(pa.upliftArr)}` : none}</td>
                    <td className={`${td} text-right`}>
                      {pa.status === 'Under-priced' && pa.ability?.canActNow ? (
                        <NoticeAction a={a} pa={pa} contract={c} last={lastNotice.get(a.id)} onPreview={setNotice} />
                      ) : pa.status === 'Over-priced' ? (
                        <Link to={`/accounts/${a.id}`} className="whitespace-nowrap">
                          <TextLink>Retention plan</TextLink>
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">
                {windowDays !== 'all' ? `No customers in this status can change price in the next ${windowDays} days. Widen the window to see more.` : 'No customers in this status.'}
              </div>
            )}
          </div>
          <Pager page={cur} pages={pages} onPage={setPage} total={rows.length} size={BAND_PAGE} noun="customers" />
          {notice && <NoticeModal draft={notice} onClose={() => setNotice(null)} />}
        </Card>

        <Card title="How normalization works">
          <ul className="grid gap-3 md:grid-cols-3">
            <li className="min-w-0 rounded-[14px] bg-accent-soft p-4">
              <h3 className="text-[14px] font-medium text-ink">Normal band</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                Each customer's list value sets the volume discount a peer would normally get (5% under $2K/mo, rising to 30% above $40K/mo), plus or minus 5 points.
              </p>
            </li>
            <li className="min-w-0 rounded-[14px] bg-accent-soft p-4">
              <h3 className="text-[14px] font-medium text-ink">Contract check</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                Annual-increase and CPI clauses allow increases up to the cap at the anniversary, with notice (CPI estimate {CPI_ESTIMATE}%). Fixed-term, lock and renegotiation clauses only allow resets at renewal or after the lock ends. A missed notice window pushes the move to the next one, unless the contract doesn't auto-renew.
              </p>
            </li>
            <li className="min-w-0 rounded-[14px] bg-accent-soft p-4">
              <h3 className="text-[14px] font-medium text-ink">Over-priced accounts</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                Don't cut list price. Offer a value bundle, or reset at renewal. MFN clauses on similar accounts are flagged because a discount could cascade.
              </p>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
