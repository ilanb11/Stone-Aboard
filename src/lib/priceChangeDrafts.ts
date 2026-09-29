import type { Account, Invoice, InvoiceLine, Outreach } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT, unitLabel } from '../data/products'
import { pickContact } from './outreach'
import { UNIT_WORD, unitMoney, type UnitRank } from './unitPricing'

// Price change at renewal: the email that explains it and the first invoice at the new
// rate. Pure functions; the store keeps both as drafts in the outreach approval queue,
// and nothing goes out until someone approves it.

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const whole = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const long = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + n)
  return d.toISOString()
}
const netDays = (terms: string) => Number(terms.match(/\d+/)?.[0] ?? 30)

export const invoiceIdFor = (accountId: string, renewalDate: string) => `IV-${accountId}-${renewalDate.slice(0, 7).replace('-', '')}`

export interface PriceChangeDraft {
  email: Omit<Outreach, 'id' | 'createdAt' | 'status' | 'invoiceId'>
  invoice: Omit<Invoice, 'outreachId' | 'createdAt' | 'emailGenerated'>
}

/** Both drafts for one ranked account. Returns null when the model calls for no change. */
export function draftPriceChange(r: UnitRank, today = new Date()): PriceChangeDraft | null {
  const a: Account = r.account
  if (r.upliftArr < 1 || !r.renewal) return null
  const rw = r.renewal
  const c = pickContact(a, ['CFO', 'Owner', 'GM'])
  const first = c.name.split(' ')[0]
  const [one] = UNIT_WORD[r.volume.unit]
  const units = UNIT_WORD[r.volume.unit][r.volume.qty === 1 ? 0 : 1]
  const curM = r.currentArr / 12
  const newM = r.renewalArr / 12
  const pct = (r.renewalArr / r.currentArr - 1) * 100
  const newPerUnit = r.renewalArr / r.volume.qty

  const lines: InvoiceLine[] = r.lines.map((l) => {
    const p = PRODUCT[l.productId]
    return { productId: l.productId, description: p?.name ?? l.productId, units: l.units, unitLabel: p ? unitLabel(p.unit) : 'month', unitPrice: l.newPrice, previousUnitPrice: l.currentPrice, listPrice: l.listPrice, amount: Math.round(l.units * l.newPrice * 100) / 100 }
  })
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const previousTotal = Math.round(r.lines.reduce((s, l) => s + l.units * l.currentPrice, 0) * 100) / 100
  const changed = lines.filter((l) => l.unitPrice !== l.previousUnitPrice)
  const issue = rw.date
  const due = new Date(new Date(issue).getTime() + netDays(rw.paymentTerms) * 86400000).toISOString()
  const id = invoiceIdFor(a.id, issue)

  const when = rw.rolled
    ? `Your agreement renewed on current pricing on ${long(rw.termEnd)} because that notice window had passed, so this change takes effect at the following renewal on ${long(rw.date)}.`
    : `Your ThiboLiSoft agreement renews on ${long(rw.date)}.`
  const body = [
    `Hi ${first},`,
    '',
    `${when} Ahead of the ${rw.noticeDays}-day renewal notice window in the agreement, here is the pricing for the next term.`,
    '',
    `Today your subscription works out to ${unitMoney(r.currentPerUnit)} per ${one} a year across ${r.volume.qty.toLocaleString('en-US')} ${units}. For ${a.segment.toLowerCase()} operations we price at ${unitMoney(r.targetPerUnit)} per ${one}${r.cappedAtList ? ', and your new rate stops at our standard list price' : ''}. From ${long(rw.date)}, your subscription moves to ${usd(newM)} a month (${whole(r.renewalArr)} a year), up from ${usd(curM)}, a ${pct.toFixed(1)}% change. That's ${unitMoney(newPerUnit)} per ${one}.`,
    '',
    'What changes:',
    ...lines.map((l) => (l.unitPrice !== l.previousUnitPrice ? `• ${l.description}: ${l.units.toLocaleString('en-US')} × ${usd(l.unitPrice)} per ${l.unitLabel.replace(' / mo', '')} a month (was ${usd(l.previousUnitPrice)})` : `• ${l.description}: unchanged at ${usd(l.unitPrice)}`)),
    '',
    `Everything else in the agreement stays the same. Your first invoice at the new rate is attached for reference: ${usd(total)}, dated ${long(issue)}, ${rw.paymentTerms.toLowerCase()}.`,
    '',
    `Please reply by ${long(rw.noticeBy)} with any questions. I'm happy to walk through the numbers on a quick call, or look at an annual prepay.`,
    '',
    'Best,',
    a.rep,
    'ThiboLiSoft',
  ].join('\n')

  return {
    email: {
      accountId: a.id,
      trigger: `Price change at renewal (${changed.length} ${changed.length === 1 ? 'line' : 'lines'}, +${pct.toFixed(1)}%)`,
      playbook: 'price-change',
      contactName: c.name,
      contactEmail: c.email,
      subject: `${a.name}: pricing for your ${long(rw.date)} renewal`,
      body,
      // Drafted on request from Pricing rank, not by a playbook, and never auto-sent.
      auto: false,
    },
    invoice: {
      id,
      accountId: a.id,
      status: 'Draft',
      issueDate: issue,
      dueDate: due,
      periodStart: issue,
      periodEnd: addMonths(issue, 1),
      paymentTerms: rw.paymentTerms,
      billTo: { name: a.name, contact: `${c.name}, ${c.title}`, email: c.email, location: `${a.county} County, ${STATES[a.state]?.name ?? a.state}` },
      lines,
      total,
      previousTotal,
      memo: `First monthly invoice at the pricing effective ${long(issue)}, billed in advance. Sales tax, if any, is added at billing. Prepared ${long(today.toISOString())}; not sent.`,
    },
  }
}
