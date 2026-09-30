import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import type { Account, Contract } from '../../types'
import { PRODUCT } from '../../data/products'
import { SEGMENT_FACTORS, useCrm } from '../../store'
import { Button, Card, Pill, StatusBadge } from '../../components/ui'
import { catalogRank, rankAccount } from '../../lib/unitPricing'
import { draftPriceChange } from '../../lib/priceChangeDrafts'
import { shortDate } from '../../lib/format'
import { NoticeModal, lastNotices } from '../Pricing'

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Account page: the renewal email and invoice for this customer. It shows what they pay now against
 * the price catalog, and drafts the email with the revised invoice attached, either at the unit-economics
 * target (what Pricing rank uses) or all the way to the catalog. Sending goes through the same preview
 * as the Pricing page: nothing goes out until someone approves it.
 */
export function RenewalPricing({ a, contract }: { a: Account; contract?: Contract }) {
  const model = useCrm((s) => s.pricingModel)
  const invoices = useCrm((s) => s.invoices)
  const [basis, setBasis] = useState<'target' | 'catalog'>('target')
  const [open, setOpen] = useState<ReturnType<typeof draftPriceChange>>(null)
  const rank = useMemo(() => {
    const r = rankAccount(a, contract, model, SEGMENT_FACTORS)
    return r && { ...r, rank: 0 }
  }, [a, contract, model])
  if (a.status !== 'Customer' || !rank) return null
  const r = basis === 'catalog' ? catalogRank(rank) : rank
  const draft = draftPriceChange(r, new Date(), basis)
  const last = lastNotices(invoices).get(a.id)
  const sent = last?.status === 'Sent' && !last.appliedAt ? last : undefined
  const queued = last?.status === 'Draft' ? last : undefined
  const pct = rank.currentArr ? (r.renewalArr / rank.currentArr - 1) * 100 : 0
  const rw = rank.renewal

  return (
    <Card title="Renewal pricing">
      <p className="max-w-[70ch] text-[14px] leading-relaxed text-ink-2">
        {rw ? (
          <>
            {contract?.id} {rw.rolled ? 'renews on current pricing' : 'ends'} {shortDate(rw.termEnd)}
            {rw.pastNotice || rw.rolled ? '' : `; notice is due by ${shortDate(rw.noticeBy)}`}. Draft the renewal email with the revised invoice attached; it lands in Automated outreach for your approval.
          </>
        ) : (
          'This customer has no active contract with a renewal date, so there is nothing to draft an invoice against.'
        )}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1.5 pr-3 font-normal">Product</th>
              <th className="px-3 py-1.5 text-right font-normal">Units</th>
              <th className="px-3 py-1.5 text-right font-normal">Pays now</th>
              <th className="px-3 py-1.5 text-right font-normal">Catalog</th>
              <th className="py-1.5 pl-3 text-right font-normal">New price</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.productId} className="border-t border-line">
                <td className="py-2 pr-3 text-ink">{PRODUCT[l.productId]?.name ?? l.productId}</td>
                <td className="tabular px-3 py-2 text-right text-ink-2">{l.units.toLocaleString('en-US')}</td>
                <td className="tabular px-3 py-2 text-right text-ink-2">{usd(l.currentPrice)}</td>
                <td className="tabular px-3 py-2 text-right text-ink-2">{usd(l.listPrice)}</td>
                <td className="tabular py-2 pl-3 text-right font-medium text-ink">{usd(l.newPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Move to">
          <span className="mr-1 text-[12px] text-muted">Move to</span>
          <Pill active={basis === 'target'} onClick={() => setBasis('target')} title="What Pricing rank proposes: the unit-economics target, capped at list and at +25%">Target price</Pill>
          <Pill active={basis === 'catalog'} onClick={() => setBasis('catalog')} title="Every product to its catalog list price, in one step of at most +25%">Full catalog price</Pill>
        </div>
        <span className="tabular text-[13px] text-ink-2">
          {usd(rank.currentArr / 12)} → <span className="text-ink">{usd(r.renewalArr / 12)}</span> a month ({pct >= 0 ? '+' : ''}
          {pct.toFixed(1)}%)
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sent ? (
          <StatusBadge tone="good">Notice sent {shortDate(sent.sentAt ?? sent.issueDate)}</StatusBadge>
        ) : queued ? (
          <Link to={`/outreach?kind=price&account=${a.id}`}>
            <StatusBadge tone="warning">Draft awaiting approval</StatusBadge>
          </Link>
        ) : (
          <>
            <Button variant="primary" disabled={!draft} onClick={() => setOpen(draft)} title="Preview the renewal email and the revised invoice, then save it for approval or send it">
              <Send size={13} /> Draft renewal email and invoice
            </Button>
            {!draft && <span className="text-[13px] text-muted">{rw ? 'Already at this price, so there is no increase to send.' : 'No renewal date to price against.'}</span>}
          </>
        )}
      </div>
      {open && <NoticeModal draft={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}
