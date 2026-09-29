import type { Invoice } from '../types'
import { StatusBadge } from './ui'

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** A pre-drafted invoice as the customer would see it. */
export function InvoicePreview({ inv }: { inv: Invoice }) {
  const tone = inv.status === 'Sent' ? 'good' : inv.status === 'Void' ? 'neutral' : 'warning'
  return (
    <section className="rounded-[14px] border border-line bg-surface" aria-label={`Invoice ${inv.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">Invoice {inv.id}</div>
          <div className="text-[12px] text-muted">ThiboLiSoft · billed monthly in advance</div>
        </div>
        <StatusBadge tone={tone}>{inv.status === 'Draft' ? 'Draft, not sent' : inv.status === 'Sent' ? `Sent ${date(inv.sentAt ?? inv.issueDate)}` : 'Void'}</StatusBadge>
      </header>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 px-4 py-3 text-[13px] sm:grid-cols-4">
        <div className="col-span-2 min-w-0">
          <dt className="text-muted">Bill to</dt>
          <dd className="text-ink">{inv.billTo.name}</dd>
          <dd className="break-words text-ink-2">
            {inv.billTo.contact} · {inv.billTo.email}
          </dd>
          <dd className="text-ink-2">{inv.billTo.location}</dd>
        </div>
        <div>
          <dt className="text-muted">Issued</dt>
          <dd className="tabular text-ink">{date(inv.issueDate)}</dd>
          <dt className="mt-1.5 text-muted">Due</dt>
          <dd className="tabular text-ink">
            {date(inv.dueDate)} <span className="text-muted">({inv.paymentTerms})</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Service period</dt>
          <dd className="tabular text-ink">
            {date(inv.periodStart)} to {date(inv.periodEnd)}
          </dd>
        </div>
      </dl>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="px-4 py-2 font-normal">Item</th>
              <th className="px-3 py-2 text-right font-normal">Qty</th>
              <th className="px-3 py-2 text-right font-normal">Unit price</th>
              <th className="px-4 py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.productId} className="border-t border-line">
                <td className="px-4 py-2 text-ink">
                  {l.description}
                  <span className="block text-[12px] text-muted">per {l.unitLabel.replace(' / mo', '')}, monthly</span>
                </td>
                <td className="tabular px-3 py-2 text-right text-ink">{l.units.toLocaleString('en-US')}</td>
                <td className="tabular px-3 py-2 text-right text-ink">
                  {usd(l.unitPrice)}
                  {l.unitPrice !== l.previousUnitPrice && <span className="block text-[12px] text-muted">was {usd(l.previousUnitPrice)}</span>}
                </td>
                <td className="tabular px-4 py-2 text-right text-ink">{usd(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={3} className="px-4 py-2.5 text-right text-ink-2">
                Total due <span className="text-muted">(was {usd(inv.previousTotal)} a month)</span>
              </td>
              <td className="tabular px-4 py-2.5 text-right text-[15px] font-medium text-ink">{usd(inv.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">{inv.memo}</p>
    </section>
  )
}
