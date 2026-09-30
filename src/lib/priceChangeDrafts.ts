import type { Account, Contract, Invoice, InvoiceLine, Outreach } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT, unitLabel } from '../data/products'
import { pickContact } from './outreach'
import { repriceLines, type RepricedLine, type UnitRank } from './unitPricing'
import type { PricingAnalysis } from './pricing'

// Price change at renewal: the email that explains it and the first invoice at the new
// rate. Pure functions; the store keeps both as drafts in the outreach approval queue,
// and nothing goes out until someone approves it.

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

const invoiceLines = (repriced: RepricedLine[]): InvoiceLine[] =>
  repriced.map((l) => {
    const p = PRODUCT[l.productId]
    return { productId: l.productId, description: p?.name ?? l.productId, units: l.units, unitLabel: p ? unitLabel(p.unit) : 'month', unitPrice: l.newPrice, previousUnitPrice: l.currentPrice, listPrice: l.listPrice, amount: Math.round(l.units * l.newPrice * 100) / 100 }
  })

const changeLines = (lines: InvoiceLine[]) =>
  lines.map((l) => (l.unitPrice !== l.previousUnitPrice ? `• ${l.description}: ${l.units.toLocaleString('en-US')} × ${usd(l.unitPrice)} per ${l.unitLabel.replace(' / mo', '')} a month (was ${usd(l.previousUnitPrice)})` : `• ${l.description}: unchanged at ${usd(l.unitPrice)}`))

/**
 * Pricing normalization (the discount-band check): a revised-pricing email and the revised
 * invoice, at the window the contract allows (anniversary clause, or renewal when the
 * agreement is about to expire). Returns null when there is no increase to make.
 */
export function draftBandNotice(a: Account, pa: PricingAnalysis, contract: Contract | undefined, today = new Date()): PriceChangeDraft | null {
  const ab = pa.ability
  if (pa.status !== 'Under-priced' || !ab || !ab.canActNow || pa.recommendedPct < 0.1) return null
  const c = pickContact(a, ['CFO', 'Owner', 'GM'])
  const repriced = repriceLines(a.subscriptions, pa.currentMrr * (1 + pa.recommendedPct / 100))
  const lines = invoiceLines(repriced)
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const previousTotal = Math.round(repriced.reduce((s, l) => s + l.units * l.currentPrice, 0) * 100) / 100
  if (total <= previousTotal + 0.5) return null
  const pct = (total / previousTotal - 1) * 100
  const eff = ab.effectiveDate
  const terms = contract?.paymentTerms ?? 'Net 30'
  const why =
    ab.window === 'Anniversary'
      ? `Section 2 (Fees & Price Adjustments) of our agreement provides for an annual adjustment${contract?.price.capPct ? ` of up to ${contract.price.capPct}%` : ''} on ${contract?.price.noticeDays ?? 60} days’ notice`
      : `your agreement ${contract && !contract.autoRenew ? 'ends' : 'renews'} on ${long(eff)}, when pricing is set for the next term`
  // A contract without auto-renew can still be repriced after its notice date, up to the term end.
  const replyBy = new Date(ab.noticeBy) < today ? `before ${long(eff)}` : `by ${long(ab.noticeBy)}`
  const body = [
    `Hi ${c.name.split(' ')[0]},`,
    '',
    `Thank you for working with ThiboLiSoft. As ${why}, this is our notice of a ${pct.toFixed(1)}% adjustment to your subscription, effective ${long(eff)}. It brings your pricing in line with operations of a similar size.`,
    '',
    `Your monthly total moves to ${usd(total)}, from ${usd(previousTotal)}:`,
    ...changeLines(lines),
    '',
    `The revised invoice for the first month at the new rate is attached (${usd(total)}, dated ${long(eff)}, ${terms.toLowerCase()}). Everything else in the agreement stays the same.`,
    '',
    `If you have questions, reply ${replyBy} and I’ll walk you through it. An annual prepay is also an option.`,
    '',
    'Best,',
    a.rep,
    'ThiboLiSoft',
  ].join('\n')
  return {
    email: { accountId: a.id, trigger: `Pricing normalization (+${pct.toFixed(1)}% at ${ab.window.toLowerCase()})`, playbook: 'price-change', contactName: c.name, contactEmail: c.email, subject: `${a.name}: revised pricing from ${long(eff)}`, body, auto: false },
    invoice: {
      id: invoiceIdFor(a.id, eff),
      accountId: a.id,
      status: 'Draft',
      issueDate: eff,
      dueDate: new Date(new Date(eff).getTime() + netDays(terms) * 86400000).toISOString(),
      periodStart: eff,
      periodEnd: addMonths(eff, 1),
      paymentTerms: terms,
      billTo: { name: a.name, contact: `${c.name}, ${c.title}`, email: c.email, location: `${a.county} County, ${STATES[a.state]?.name ?? a.state}` },
      lines,
      total,
      previousTotal,
      memo: `Revised monthly invoice at the pricing effective ${long(eff)}, billed in advance. Sales tax, if any, is added at billing. Prepared ${long(today.toISOString())}.`,
    },
  }
}

/** Both drafts for one ranked account. Returns null when the model calls for no change. */
export function draftPriceChange(r: UnitRank, today = new Date(), basis: 'target' | 'catalog' = 'target'): PriceChangeDraft | null {
  const a: Account = r.account
  if (r.upliftArr < 1 || !r.renewal) return null
  const rw = r.renewal
  const c = pickContact(a, ['CFO', 'Owner', 'GM'])
  const first = c.name.split(' ')[0]
  const curM = r.currentArr / 12
  const newM = r.renewalArr / 12
  const pct = (r.renewalArr / r.currentArr - 1) * 100

  const lines = invoiceLines(r.lines)
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const previousTotal = Math.round(r.lines.reduce((s, l) => s + l.units * l.currentPrice, 0) * 100) / 100
  const changed = lines.filter((l) => l.unitPrice !== l.previousUnitPrice)
  const issue = rw.date
  const due = new Date(new Date(issue).getTime() + netDays(rw.paymentTerms) * 86400000).toISOString()
  const id = invoiceIdFor(a.id, issue)

  // Short and plain: when the price starts, the new prices, the new total, and when to reply by.
  const when = rw.rolled
    ? `Your ThiboLiSoft agreement renews on ${long(rw.termEnd)} at your current pricing. Here is your pricing from the next renewal on ${long(rw.date)}:`
    : rw.pastNotice
      ? `Your ThiboLiSoft agreement ends on ${long(rw.date)} and doesn't renew automatically. Here is your pricing for the next term:`
      : `Your ThiboLiSoft agreement renews on ${long(rw.date)}. Here is your pricing for the next term:`
  // Past the notice date (no auto-renew), questions can still come in until the term ends.
  const replyBy = rw.pastNotice ? `before ${long(rw.date)}` : `by ${long(rw.noticeBy)}`
  const body = [
    `Hi ${first},`,
    '',
    when,
    '',
    ...changeLines(lines),
    '',
    `Your monthly total moves from ${usd(curM)} to ${usd(newM)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%), starting ${long(rw.date)}. The invoice at the new rate is attached.`,
    '',
    `Questions? Reply ${replyBy} and I'll walk you through it.`,
    '',
    'Best,',
    a.rep,
    'ThiboLiSoft',
  ].join('\n')

  return {
    email: {
      accountId: a.id,
      trigger: `Price change at renewal${basis === 'catalog' ? ' to the price list' : ''} (${changed.length} ${changed.length === 1 ? 'line' : 'lines'}, +${pct.toFixed(1)}%)`,
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
