import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Account, Contract } from '../types'
import { Button, Card, PageHeader, Pill, Stat, StatusBadge, Tabs, TextLink } from '../components/ui'
import { money, num, shortDate } from '../lib/format'
import { CPI_ESTIMATE, type PricingAnalysis, type PriceStatus } from '../lib/pricing'
import { pickContact } from '../lib/outreach'
import { PricingRank } from './pricing/PricingRank'

export function priceNoticeDraft(a: Account, pa: PricingAnalysis) {
  const c = pickContact(a, ['CFO', 'Owner', 'GM'])
  const eff = pa.ability ? new Date(pa.ability.effectiveDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'your next renewal'
  const clause = pa.ability?.window === 'Anniversary' ? 'Section 2 (Fees & Price Adjustments) of our agreement' : 'your upcoming renewal'
  return {
    accountId: a.id,
    trigger: 'Price normalization',
    playbook: 'pricing',
    contactName: c.name,
    contactEmail: c.email,
    subject: `${a.name}: pricing update effective ${eff}`,
    body: `Hi ${c.name.split(' ')[0]},\n\nThank you for working with ThiboLiSoft. In line with ${clause}, we're writing to let you know about a ${pa.recommendedPct.toFixed(1)}% adjustment to your subscription fees, effective ${eff}. Your new monthly total will be about ${money(pa.currentMrr * (1 + pa.recommendedPct / 100))}.\n\nThis keeps your pricing in line with operations of a similar size, and it funds this year's work on HerdTrack closeouts and BarnSense alarm routing. I'm happy to walk through the details, or look at options such as an annual prepay, on a quick call.\n\nBest,\n${a.rep}\nThiboLiSoft`,
  }
}

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

function BandCheck() {
  const book = useBook()
  const proposePrice = useCrm((s) => s.proposePrice)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const proposals = useCrm((s) => s.priceProposals)
  const [tab, setTab] = useState<PriceStatus | 'All'>('Under-priced')
  const [windowFilter, setWindowFilter] = useState<'all' | 'now'>('all')

  const rows = useMemo(() => {
    return book.customers
      .map((a) => ({ a, pa: book.pricing[a.id], c: a.contractId ? book.contractById[a.contractId] : undefined }))
      .filter((r) => r.pa && (tab === 'All' || r.pa.status === tab))
      .filter((r) => windowFilter === 'all' || (r.pa.ability?.canActNow && new Date(r.pa.ability.noticeBy).getTime() - Date.now() < 90 * 86400000))
      .sort((x, y) => y.pa.upliftArr - x.pa.upliftArr || Math.abs(y.pa.neededPct) - Math.abs(x.pa.neededPct))
  }, [book, tab, windowFilter])

  const all = Object.values(book.pricing)
  const under = all.filter((p) => p.status === 'Under-priced')
  const over = all.filter((p) => p.status === 'Over-priced')
  const soon = under.filter((p) => p.ability?.canActNow && new Date(p.ability.noticeBy).getTime() - Date.now() < 90 * 86400000)

  return (
    <div>
      <p className="mb-5 max-w-[80ch] text-[14px] leading-relaxed text-ink-2">Each current customer's discount against the normal band for its size. Herdbook checks every suggestion against the contract's price clause, so you only see changes the contract allows.</p>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Under-priced customers" value={under.length} sub={`${money(under.reduce((s, p) => s + p.upliftArr, 0))} ARR recoverable`} />
          <Stat label="Actionable in the next 90 days" value={soon.length} sub={`${money(soon.reduce((s, p) => s + p.upliftArr, 0))} ARR with notice windows open`} highlight />
          <Stat label="Over-priced, churn risk" value={over.length} sub={`${money(over.reduce((s, p) => s + p.currentMrr * 12, 0))} ARR exposed`} tone={over.length ? 'serious' : undefined} />
          <Stat label="In band" value={all.length - under.length - over.length} sub={`of ${num(all.length)} customers`} />
        </div>

        <Card pad={false}>
          <div className="px-5 pt-5">
            <Tabs value={tab} onChange={setTab} tabs={(['Under-priced', 'Over-priced', 'In band', 'All'] as const).map((t) => ({ value: t, label: t }))} />
            <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Notice window">
              <Pill active={windowFilter === 'all'} onClick={() => setWindowFilter('all')}>
                Any window
              </Pill>
              <Pill active={windowFilter === 'now'} onClick={() => setWindowFilter('now')}>
                Notice due within 90 days
              </Pill>
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
                {rows.slice(0, 150).map(({ a, pa, c }) => (
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
                            {pa.ability.canActNow ? (
                              <span className="text-ink-2">
                                Notice by <span className="whitespace-nowrap">{shortDate(pa.ability.noticeBy)}</span>
                              </span>
                            ) : (
                              <StatusBadge tone="critical" title="The notice deadline has passed. This change moves to the next window.">Notice missed</StatusBadge>
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
                        proposals[a.id] ? (
                          <StatusBadge tone="good">Proposed</StatusBadge>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              proposePrice(a.id, pa.recommendedPct, pa.ability!.effectiveDate)
                              queueOutreach({ ...priceNoticeDraft(a, pa), auto: false, status: 'Draft' })
                            }}
                          >
                            Propose +{pa.recommendedPct.toFixed(1)}%
                          </Button>
                        )
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
                {windowFilter === 'now' ? 'No customers in this status have a notice due within 90 days. Switch to Any window to see them all.' : 'No customers in this status.'}
              </div>
            )}
          </div>
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
                Annual-increase and CPI clauses allow increases up to the cap at the anniversary, with notice (CPI estimate {CPI_ESTIMATE}%). Fixed-term, lock and renegotiation clauses only allow resets at renewal or after the lock ends. A missed notice window pushes the move to the next one.
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
