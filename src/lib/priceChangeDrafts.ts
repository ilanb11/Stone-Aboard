import type { Account, Contract, Invoice, InvoiceLine, Outreach } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT, unitLabel } from '../data/products'
import { pickContact } from './outreach'
import { UNIT_WORD, repriceLines, unitMoney, type RepricedLine, type UnitRank } from './unitPricing'
import type { PricingAnalysis } from './pricing'

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
  const [one] = UNIT_WORD[r.volume.unit]
  const units = UNIT_WORD[r.volume.unit][r.volume.qty === 1 ? 0 : 1]
  const curM = r.currentArr / 12
  const newM = r.renewalArr / 12
  const pct = (r.renewalArr / r.currentArr - 1) * 100
  const newPerUnit = r.renewalArr / r.volume.qty

  const lines = invoiceLines(r.lines)
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const previousTotal = Math.round(r.lines.reduce((s, l) => s + l.units * l.currentPrice, 0) * 100) / 100
  const changed = lines.filter((l) => l.unitPrice !== l.previousUnitPrice)
  const issue = rw.date
  const due = new Date(new Date(issue).getTime() + netDays(rw.paymentTerms) * 86400000).toISOString()
  const id = invoiceIdFor(a.id, issue)

  const ahead = `Ahead of the ${rw.noticeDays}-day renewal notice window in the agreement, here is the pricing for the next term.`
  const when = rw.rolled
    ? `Your agreement renews on current pricing on ${long(rw.termEnd)} because its notice window has passed, so this change takes effect at the following renewal on ${long(rw.date)}. ${ahead}`
    : rw.pastNotice
      ? `Your ThiboLiSoft agreement ends on ${long(rw.date)} and doesn't renew automatically, so here is the pricing for the next term.`
      : `Your ThiboLiSoft agreement renews on ${long(rw.date)}. ${ahead}`
  // Past the notice date (no auto-renew), questions can still come in until the term ends.
  const replyBy = rw.pastNotice ? `before ${long(rw.date)}` : `by ${long(rw.noticeBy)}`
  const body = [
    `Hi ${first},`,
    '',
    when,
    '',
    // The target follows this account's own product and site mix, so it isn't a price for the whole segment.
    `Today your subscription works out to ${unitMoney(r.currentPerUnit)} per ${one} a year across ${r.volume.qty.toLocaleString('en-US')} ${units}. ${
      basis === 'catalog'
        ? `At our standard price list, your products and sites come to ${unitMoney(r.targetPerUnit)} per ${one}${r.renewalArr < r.listArr - 1 ? ', and we are moving you part of the way this renewal' : ', and that is where your new rate lands'}`
        : `For an operation with your products and sites, our target is ${unitMoney(r.targetPerUnit)} per ${one}${r.cappedAtList ? ', and your new rate stops at our standard list price' : ''}`
    }. From ${long(rw.date)}, your subscription moves to ${usd(newM)} a month (${whole(r.renewalArr)} a year), up from ${usd(curM)}, a ${pct.toFixed(1)}% change. That's ${unitMoney(newPerUnit)} per ${one}.`,
    '',
    'What changes:',
    ...changeLines(lines),
    '',
    `Everything else in the agreement stays the same. Your first invoice at the new rate is attached for reference: ${usd(total)}, dated ${long(issue)}, ${rw.paymentTerms.toLowerCase()}.`,
    '',
    `Please reply ${replyBy} with any questions. I'm happy to walk through the numbers on a quick call, or look at an annual prepay.`,
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
