import type { Account, Contract, Opportunity, OrderLine, Outreach } from '../types'
import { OPERATION_LABEL } from '../types'
import { CLAUSES, TEMPLATE_VERSION, renderClause } from '../data/contracts'
import { PRODUCT, unitLabel } from '../data/products'
import { STATES } from '../data/geo'
import { analyzePricing, listMonthly } from './pricing'
import { bandPrice } from './pipeline'
import { pickContact } from './outreach'
import { num, sizeLabel } from './format'

// Lucas the Hog: draft generation.
// Pure functions that turn CRM data (account, deal, pricing, rep) into a contract
// and the email that introduces it. Nothing here stores or sends anything; the
// store decides when to call it and keeps the results as drafts for review.

/** One draft per deal: ids derive from the opportunity, so a deal can never get two. */
export const draftContractId = (opportunityId: string) => `KD-${opportunityId}`
export const draftEmailId = (opportunityId: string) => `MD-${opportunityId}`

export interface DraftContext {
  account: Account
  opportunity: Opportunity
  /** The account's current signed contract, if any (renewals reprice against it). */
  activeContract?: Contract
  /** All customers and contracts, which the pricing module needs for MFN checks. */
  customers: Account[]
  contractsById: Record<string, Contract>
  today?: Date
}

export interface PricedOrder {
  lines: OrderLine[]
  /** Plain-language note on where the prices came from. */
  basis: string
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`
/** Exact dollars for contract figures. */
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

/** Order-form prices from the Pricing module: band pricing for new business, band-normalized renewals. */
export function priceOrderForm(ctx: DraftContext): PricedOrder {
  const { account: a, opportunity: o } = ctx
  if (o.type === 'Renewal') {
    const pa = analyzePricing(a, ctx.activeContract, ctx.customers, ctx.contractsById, ctx.today)
    const lift = pa.status === 'Under-priced' ? pa.neededPct / 100 : 0
    const lines = a.subscriptions.map((s) => ({ productId: s.productId, units: s.units, unitPrice: Math.round(s.unitPrice * (1 + lift) * 100) / 100, listPrice: PRODUCT[s.productId].listPrice }))
    const basis =
      pa.status === 'Under-priced'
        ? `Renewal moves pricing up ${pa.neededPct.toFixed(1)}% to the normal band for an account this size (Pricing module). Renewal is a repricing window, so no escalator cap applies.`
        : pa.status === 'Over-priced'
          ? 'Kept at current prices. The account pays above band, so the Pricing module recommends holding price and adding value rather than cutting.'
          : 'Kept at current prices, which are inside the normal band for an account this size.'
    return { lines, basis }
  }
  const existing = o.type === 'Expansion' ? listMonthly(a) : 0
  const { lines, discount } = bandPrice(a, o.products, existing)
  const basis =
    o.type === 'Expansion'
      ? `Band pricing on the combined subscription: a volume discount of ${pct(discount)}, the normal level for an account this size (Pricing module).`
      : `Band pricing for a new customer this size: a volume discount of ${pct(discount)} off list (Pricing module).`
  return { lines, basis }
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}
/** First of the month after a three-week lead time. */
const startDate = (today: Date) => {
  const d = new Date(today.getTime() + 21 * 86400000)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

export const annualValue = (lines: OrderLine[]) => lines.reduce((s, l) => s + l.units * l.unitPrice, 0) * 12

/** A draft Master Subscription Agreement built from the deal, with playbook-standard terms. */
export function draftContract(ctx: DraftContext): { contract: Contract; basis: string } {
  const { account: a, opportunity: o } = ctx
  const today = ctx.today ?? new Date()
  const { lines, basis } = priceOrderForm(ctx)
  const annual = annualValue(lines)
  // Playbook standard is 24 months; large deals go to 36, renewals keep the current term.
  const termMonths = o.type === 'Renewal' && ctx.activeContract ? ctx.activeContract.termMonths : annual >= 100_000 ? 36 : 24
  const start = o.type === 'Renewal' && ctx.activeContract ? new Date(ctx.activeContract.end) : startDate(today)
  const contract: Contract = {
    id: draftContractId(o.id),
    accountId: a.id,
    template: TEMPLATE_VERSION,
    status: 'Draft',
    start: start.toISOString(),
    end: addMonths(start, termMonths).toISOString(),
    termMonths,
    autoRenew: true,
    renewalNoticeDays: 60,
    paymentTerms: 'Net 30',
    price: { mechanism: 'Annual increase with notice', capPct: 5, noticeDays: 60 },
    mfn: false,
    assignmentOnChangeOfControl: 'Consent required',
    redlines: [],
    opportunityId: o.id,
    orderForm: lines,
    draft: { by: 'Lucas the Hog', at: today.toISOString(), opportunityId: o.id, emailId: draftEmailId(o.id) },
  }
  return { contract, basis }
}

const words: Record<string, string> = { 'Net 30': 'thirty (30)', 'Net 45': 'forty-five (45)', 'Net 60': 'sixty (60)' }
const long = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** Clause text with this contract's terms filled in. */
export function contractClauses(c: Contract): { number: number; title: string; text: string }[] {
  const vars = { termMonths: c.termMonths, renewalNoticeDays: c.renewalNoticeDays, capPct: c.price.capPct ?? 5, noticeDays: c.price.noticeDays }
  return CLAUSES.map((cl) => {
    let text = renderClause(cl, vars)
    if (cl.id === 'payment' && words[c.paymentTerms]) text = text.replace('thirty (30)', words[c.paymentTerms])
    return { number: cl.number, title: cl.title, text }
  })
}

/** The full agreement as plain text, for review, copying or export. */
export function renderContractDocument(c: Contract, a: Account, rep: string, basis?: string): string {
  const st = STATES[a.state]?.name ?? a.state
  const lines = c.orderForm ?? []
  const orderRows = lines.map((l) => {
    const p = PRODUCT[l.productId]
    return `  ${p.name}: ${num(l.units)} x $${l.unitPrice.toFixed(2)} per ${unitLabel(p.unit)} (list $${l.listPrice}) = ${usd(l.units * l.unitPrice)} per month`
  })
  const crops = a.species === 'Grain' && a.crops?.length ? `, growing ${a.crops.join(', ').toLowerCase()}` : ''
  return [
    `${c.template}`,
    `Master Subscription Agreement between ThiboLiSoft and ${a.name}`,
    `Draft ${c.id}, prepared by Lucas the Hog for ${rep} on ${long(c.draft?.at ?? new Date().toISOString())}. Not yet sent.`,
    '',
    'Parties',
    `ThiboLiSoft ("ThiboLiSoft") and ${a.name} ("Customer"), ${a.county} County, ${st}.`,
    '',
    'Customer operation',
    `${OPERATION_LABEL[a.species]} operation (${a.segment}) of ${sizeLabel(a)}${crops}, with ${a.sites} ${a.sites === 1 ? 'site' : 'sites'}${a.barns ? ` and ${a.barns} ${a.species === 'Grain' ? (a.barns === 1 ? 'grain bin' : 'grain bins') : a.barns === 1 ? 'barn' : 'barns'}` : ''}.`,
    '',
    'Order form',
    ...orderRows,
    `  Annual subscription fees: ${usd(annualValue(lines))}, billed monthly in advance.`,
    ...(basis ? [`  Pricing basis: ${basis}`] : []),
    '',
    'Term',
    `  Starts ${long(c.start)}. Initial term of ${c.termMonths} months, ending ${long(c.end)}. ${c.autoRenew ? `Renews automatically for 12-month terms unless either party gives notice at least ${c.renewalNoticeDays} days before the end of a term.` : 'Does not renew automatically.'}`,
    '',
    'Terms and conditions',
    ...contractClauses(c).flatMap((cl) => [`${cl.number}. ${cl.title}`, `  ${cl.text}`]),
    '',
    `Account owner: ${rep}, ThiboLiSoft`,
  ].join('\n')
}

/** The customer email that introduces the draft contract. Always a draft. */
export function draftContractEmail(ctx: DraftContext, c: Contract): Omit<Outreach, 'createdAt'> {
  const { account: a, opportunity: o } = ctx
  const contact = pickContact(a, ['Owner', 'GM', 'CFO'])
  const first = contact.name.split(' ')[0]
  const lines = c.orderForm ?? []
  const names = lines.map((l) => PRODUCT[l.productId].name)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'your subscription'
  const what = o.type === 'Renewal' ? `your renewal of ${list}` : o.type === 'Expansion' ? `adding ${list}` : list
  const body = [
    `Hi ${first},`,
    '',
    `Thanks for the time with our team. As promised, here is the proposed agreement for ${what} at ${a.name}.`,
    '',
    'The short version:',
    `• ${c.termMonths}-month term starting ${long(c.start)}`,
    `• ${usd(annualValue(lines))} a year, billed monthly, covering ${sizeLabel(a)}`,
    `• ${c.paymentTerms} payment, with any annual price change capped at ${c.price.capPct ?? 5}% on ${c.price.noticeDays} days' notice`,
    `• Renews for 12-month terms; either side can opt out with ${c.renewalNoticeDays} days' notice`,
    '',
    "The full agreement is attached. Mark up anything that doesn't work for your operation and I'll turn it around quickly. If it's easier, I'm happy to walk through it on a 20-minute call this week.",
    '',
    'Best,',
    a.rep,
    'ThiboLiSoft',
  ].join('\n')
  return {
    id: draftEmailId(o.id),
    accountId: a.id,
    trigger: 'Deal moved to Negotiation',
    playbook: 'lucas-contract',
    contactName: contact.name,
    contactEmail: contact.email,
    subject: `Proposed agreement for ${a.name}`,
    body,
    status: 'Draft',
    auto: true,
    contractId: c.id,
  }
}

/** Everything Lucas the Hog prepares when a deal first reaches Negotiation. */
export function draftNegotiationPackage(ctx: DraftContext) {
  const { contract, basis } = draftContract(ctx)
  const email = draftContractEmail(ctx, contract)
  return { contract, email, basis }
}

/** Re-derive the pricing note for a stored draft (the contract keeps only the numbers). */
export function pricingBasis(ctx: DraftContext): string {
  return priceOrderForm(ctx).basis
}

