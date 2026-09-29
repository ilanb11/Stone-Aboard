import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Account, Contract } from '../types'
import { Button, Card, PageHeader, Pill, Stat, StatusBadge, Tabs } from '../components/ui'
import { money, num, shortDate } from '../lib/format'
import { CPI_ESTIMATE, type PricingAnalysis, type PriceStatus } from '../lib/pricing'
import { pickContact } from '../lib/outreach'

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

export function BandBar({ pa }: { pa: PricingAnalysis }) {
  const max = 0.5
  const pos = (d: number) => `${Math.min(100, Math.max(0, (d / max) * 100))}%`
  const color = pa.status === 'In band' ? 'var(--color-good)' : pa.status === 'Under-priced' ? 'var(--color-warning)' : 'var(--color-serious)'
  return (
    <div className="w-full min-w-40">
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 rounded-full bg-good/25" style={{ left: pos(pa.bandLow), width: `calc(${pos(pa.bandHigh)} - ${pos(pa.bandLow)})` }} />
        <div className="absolute -top-1 h-4.5 w-1.5 -translate-x-1/2 rounded-full border-2 border-surface" style={{ left: pos(pa.actualDiscount), background: color }} title={`Actual discount ${(pa.actualDiscount * 100).toFixed(0)}%`} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted"><span>0% discount</span><span>band {(pa.bandLow * 100).toFixed(0)}–{(pa.bandHigh * 100).toFixed(0)}%</span><span>50%</span></div>
    </div>
  )
}

export function PriceAnalysisPanel({ pa, contract }: { a: Account; pa: PricingAnalysis; contract?: Contract }) {
  const tone = pa.status === 'In band' ? 'good' : pa.status === 'Under-priced' ? 'warning' : 'serious'
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge tone={tone}>{pa.status}</StatusBadge>
        <span className="tabular text-xs text-ink-2">
          Current {money(pa.currentMrr)}/mo · list {money(pa.listMrr)}/mo · discount {(pa.actualDiscount * 100).toFixed(1)}%
        </span>
      </div>
      <BandBar pa={pa} />
      {contract && (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <div className="mb-0.5 font-medium text-ink">Can we change the price? {contract.id}: {contract.price.mechanism}{contract.price.capPct ? `, cap ${contract.price.capPct}%` : ''}</div>
          {pa.ability?.explanation}
        </div>
      )}
      <p className="text-ink">{pa.recommendation}</p>
      {pa.upliftArr > 0 && <div className="tabular text-xs text-good-text">+{money(pa.upliftArr)} ARR from this adjustment</div>}
    </div>
  )
}

export default function Pricing() {
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
      <PageHeader title="Pricing" subtitle="Live pricing for every current customer, compared with the normal band for its size. Each suggestion is checked against the contract's price clause, so you only see moves you can actually make." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Under-priced customers" value={under.length} sub={`${money(under.reduce((s, p) => s + p.upliftArr, 0))} ARR recoverable`} tone="good" />
        <Stat label="Actionable in next 90 days" value={soon.length} sub={`${money(soon.reduce((s, p) => s + p.upliftArr, 0))} ARR, notice windows open`} />
        <Stat label="Over-priced (churn risk)" value={over.length} sub={`${money(over.reduce((s, p) => s + p.currentMrr * 12, 0))} ARR exposed`} tone={over.length ? 'serious' : undefined} />
        <Stat label="In band" value={all.length - under.length - over.length} sub={`of ${num(all.length)} customers`} />
      </div>

      <Card className="mt-4" pad={false}>
        <div className="px-4 pt-3">
          <Tabs value={tab} onChange={setTab} tabs={(['Under-priced', 'Over-priced', 'In band', 'All'] as const).map((t) => ({ value: t, label: t }))} />
          <div className="mb-3 flex items-center gap-2">
            <Pill active={windowFilter === 'all'} onClick={() => setWindowFilter('all')}>Any window</Pill>
            <Pill active={windowFilter === 'now'} onClick={() => setWindowFilter('now')}>Notice due within 90 days</Pill>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-y border-line text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">MRR</th>
                <th className="w-56 px-3 py-2 text-left font-medium">Discount vs. normal band</th>
                <th className="px-3 py-2 text-left font-medium">Contract price clause</th>
                <th className="px-3 py-2 text-left font-medium">Window</th>
                <th className="px-3 py-2 text-right font-medium">Needed</th>
                <th className="px-3 py-2 text-right font-medium">Allowed</th>
                <th className="px-3 py-2 text-right font-medium">Uplift ARR</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 150).map(({ a, pa, c }) => (
                <tr key={a.id} className="align-top hover:bg-surface-2/50">
                  <td className="px-4 py-2">
                    <Link to={`/accounts/${a.id}`} className="font-medium text-ink hover:text-accent">{a.name}</Link>
                    <div className="text-xs text-muted">{a.segment} · {a.state}</div>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{money(pa.currentMrr)}</td>
                  <td className="px-3 py-2"><BandBar pa={pa} /></td>
                  <td className="px-3 py-2 text-xs">
                    <div className="text-ink">{c?.price.mechanism}{c?.price.capPct ? ` · cap ${c.price.capPct}%` : ''}</div>
                    <div className="text-muted">{c?.mfn ? 'MFN · ' : ''}{c?.autoRenew ? 'auto-renew' : 'no auto-renew'} · ends {c && shortDate(c.end)}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {pa.ability ? (
                      <>
                        <div className="text-ink">{pa.ability.window} · {shortDate(pa.ability.effectiveDate)}</div>
                        <div className={pa.ability.canActNow ? 'text-ink-2' : 'text-critical'}>{pa.ability.canActNow ? `notice by ${shortDate(pa.ability.noticeBy)}` : 'notice window missed'}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{pa.neededPct >= 0 ? '+' : ''}{pa.neededPct.toFixed(1)}%</td>
                  <td className="tabular px-3 py-2 text-right">{pa.status !== 'Under-priced' ? '—' : pa.ability?.maxIncreasePct == null ? 'market' : `≤ ${pa.ability.maxIncreasePct.toFixed(1)}%`}</td>
                  <td className="tabular px-3 py-2 text-right text-good-text">{pa.upliftArr > 0 ? `+${money(pa.upliftArr)}` : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {pa.status === 'Under-priced' && pa.ability?.canActNow ? (
                      proposals[a.id] ? <span className="text-xs text-good-text">Proposed ✓</span> : (
                        <Button size="sm" variant="primary" onClick={() => { proposePrice(a.id, pa.recommendedPct, pa.ability!.effectiveDate); queueOutreach({ ...priceNoticeDraft(a, pa), auto: false, status: 'Draft' }) }}>
                          Propose +{pa.recommendedPct.toFixed(1)}%
                        </Button>
                      )
                    ) : pa.status === 'Over-priced' ? <Link to={`/accounts/${a.id}`} className="text-xs font-medium text-accent">Retention plan →</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="p-8 text-center text-sm text-muted">Nothing here.</div>}
        </div>
      </Card>

      <Card className="mt-4" title={<span className="inline-flex items-center gap-1.5"><Info size={14} /> How normalization works</span>}>
        <ul className="grid gap-2 text-sm text-ink-2 md:grid-cols-3">
          <li><b className="text-ink">Normal band.</b> Each customer's list value sets the volume discount a peer would normally get (5% under $2K/mo, rising to 30% above $40K/mo), ±5 points.</li>
          <li><b className="text-ink">Contract check.</b> Annual-increase and CPI clauses allow increases up to the cap at the anniversary, with notice (CPI est. {CPI_ESTIMATE}%). Fixed-term, lock and renegotiation clauses only allow resets at renewal or after the lock ends, and a missed notice window pushes the move to the next one.</li>
          <li><b className="text-ink">Over-priced accounts.</b> Don't cut list price. Offer a value bundle, or reset at renewal. MFN clauses on similar accounts are flagged because a discount could cascade.</li>
        </ul>
      </Card>
    </div>
  )
}
