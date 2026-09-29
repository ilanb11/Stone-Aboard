import type { Account, Contract, OrderLine } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT, unitLabel } from '../data/products'
import { CLAUSE } from '../data/contracts'
import { contractClauses } from './lucasDrafts'
import { pickContact } from './outreach'

// The signed agreement as a PDF: parties, term, order form at the signed prices, every
// clause with this contract's values, the negotiated changes, and the signature block.
// jsPDF loads on demand so it stays out of the main bundle.

const DAY = 86400000
const long = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + n)
  return d
}

// Clause ids by number, to match negotiated changes and the contract's own terms to clauses.
const CLAUSES_BY_NUMBER: Record<number, string> = Object.fromEntries(Object.values(CLAUSE).map((c) => [c.number, c.id]))

export interface SignedContractInput {
  account: Account
  contract: Contract
  rep: string
  /** When both sides signed. */
  signedAt: string
  /** Negotiated clause changes that made it into the final text. */
  agreedChanges?: { clauseId: string; text: string }[]
}

/** Order lines at the signed prices: the contract's order form, else the account's subscriptions. */
export function signedOrder(a: Account, c: Contract): OrderLine[] {
  if (c.orderForm?.length) return c.orderForm
  return a.subscriptions.map((s) => ({ productId: s.productId, units: s.units, unitPrice: s.unitPrice, listPrice: PRODUCT[s.productId]?.listPrice ?? s.unitPrice }))
}

/** The term as signed. Agreements that have renewed since keep their original initial term and show the current one. */
function termText(c: Contract): string {
  const initialEnd = addMonths(c.start, c.termMonths)
  // Seeded end dates are approximate to a day or two; only a longer gap means the agreement renewed.
  const renewed = new Date(c.end).getTime() - initialEnd.getTime() > 7 * DAY
  const renewal = c.autoRenew ? `Renews automatically for 12-month terms unless either party gives notice at least ${c.renewalNoticeDays} days before the end of a term.` : 'Does not renew automatically.'
  return `Initial term of ${c.termMonths} months, from ${long(c.start)} to ${long(renewed ? initialEnd.toISOString() : c.end)}.${renewed ? ` The current term ends ${long(c.end)}.` : ''} ${renewal} Payment terms: ${c.paymentTerms}.`
}

/** Clause text for the terms this contract sets itself (renewal, price adjustment, assignment); null keeps the template. */
function ownTerms(c: Contract, clauseId: string): string | null {
  const { mechanism, capPct, noticeDays, lockUntil } = c.price
  const notice = `${noticeDays} days’ prior written notice`
  if (clauseId === 'term' && !c.autoRenew) return `The initial term is ${c.termMonths} months from the Effective Date. This Agreement does not renew automatically; any renewal term must be agreed by both parties in writing before the end of the then-current term.`
  if (clauseId === 'fees') {
    if (mechanism === 'Annual CPI escalator') return `Fees are set out in the Order Form. On each anniversary of the Effective Date, Fees adjust by the change in the Consumer Price Index (CPI-U)${capPct ? `, capped at ${capPct}%,` : ''} on ${notice}.`
    if (mechanism === 'Fixed for term') return `Fees are set out in the Order Form and are fixed for the term. ThiboLiSoft may propose new Fees for a renewal term in writing at least ${noticeDays} days before the end of the then-current term.`
    if (mechanism === 'Renegotiate at renewal') return `Fees are set out in the Order Form and do not change during a term. Fees for each renewal term are agreed by the parties; ThiboLiSoft will propose them in writing at least ${noticeDays} days before the end of the then-current term.`
    if (mechanism === 'Multi-year price lock') return `Fees are set out in the Order Form and are locked until ${lockUntil ? long(lockUntil) : 'the end of the initial term'}. After that, on each anniversary of the Effective Date, ThiboLiSoft may increase Fees ${capPct ? `by up to ${capPct}%` : 'by up to the change in CPI-U'} on ${notice}.`
  }
  if (clauseId === 'assignment' && c.assignmentOnChangeOfControl === 'Permitted with notice') return 'Either party may assign this Agreement on written notice to an affiliate, or to a successor or acquirer of all or substantially all of the relevant business or operations. Any other assignment requires the other party’s prior written consent.'
  return null
}

const MFN_CLAUSE = 'If ThiboLiSoft offers lower per-unit Fees for the same Services to a customer of comparable segment, volume and term, Customer’s per-unit Fees are reduced to match from the next invoice.'

/** The clauses as signed: negotiated text first, then this contract's own terms, then the template. */
export function signedClauses(c: Contract, agreedChanges: { clauseId: string; text: string }[] = []) {
  const changed = new Map(agreedChanges.map((x) => [x.clauseId, x.text]))
  const out = contractClauses(c).map((cl) => {
    const id = CLAUSES_BY_NUMBER[cl.number]
    const agreed = changed.get(id)
    return { number: cl.number, title: cl.title, text: agreed ?? ownTerms(c, id) ?? cl.text, negotiated: agreed !== undefined }
  })
  if (c.mfn) out.push({ number: out.length + 1, title: 'Most Favored Customer', text: MFN_CLAUSE, negotiated: false })
  return out
}

const productName = (l: OrderLine) => {
  const p = PRODUCT[l.productId]
  return `${p?.name ?? l.productId} (per ${p ? unitLabel(p.unit).replace(' / mo', '') : 'month'})`
}
const parties = (a: Account, c: Contract) => `This agreement is between ThiboLiSoft ("ThiboLiSoft") and ${a.name} ("Customer"), ${a.county} County, ${STATES[a.state]?.name ?? a.state}, and takes effect on ${long(c.start)} (the Effective Date).`
const totalText = (monthly: number) => `Total ${usd(monthly)} a month (${usd(monthly * 12)} a year), billed monthly in advance.`
const recordText = (c: Contract, signedAt: string) => `Signature record ${c.id}-${new Date(signedAt).getTime().toString(36).toUpperCase()}. Demo document generated by Herdbook from CRM data; it is not a legal instrument.`

/** The same executed copy as plain text, for where the PDF viewer can't open (a sandboxed frame). */
export function signedContractText({ account: a, contract: c, rep, signedAt, agreedChanges = [] }: SignedContractInput): string {
  const customer = pickContact(a, ['Owner', 'GM', 'CFO'])
  const order = signedOrder(a, c)
  const monthly = order.reduce((s, l) => s + l.units * l.unitPrice, 0)
  return [
    'MASTER SUBSCRIPTION AGREEMENT',
    `${c.template} · Agreement ${c.id} · Executed copy`,
    '',
    parties(a, c),
    '',
    'Term',
    termText(c),
    '',
    'Order form',
    ...order.map((l) => `  ${productName(l)}: ${l.units.toLocaleString('en-US')} × ${usd(l.unitPrice)} = ${usd(l.units * l.unitPrice)} a month`),
    `  ${totalText(monthly)}`,
    '',
    'Terms and conditions',
    ...signedClauses(c, agreedChanges).flatMap((cl) => [`${cl.number}. ${cl.title}${cl.negotiated ? ' (as negotiated)' : ''}`, `  ${cl.text}`]),
    '',
    'Signatures',
    `For ${a.name}: ${customer.name}, ${customer.title}. Signed electronically ${long(signedAt)}.`,
    `For ThiboLiSoft: ${rep}, Account Executive. Signed electronically ${long(signedAt)}.`,
    '',
    recordText(c, signedAt),
  ].join('\n')
}

export async function signedContractPdf({ account: a, contract: c, rep, signedAt, agreedChanges = [] }: SignedContractInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 56
  const width = W - M * 2
  let y = M

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const text = (t: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 4, color = 20) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color)
    const lines = doc.splitTextToSize(t, width) as string[]
    const lh = size * 1.35
    for (const line of lines) {
      ensure(lh)
      doc.text(line, M, y + size)
      y += lh
    }
    y += gap
  }
  const rule = () => {
    ensure(12)
    doc.setDrawColor(200)
    doc.line(M, y + 4, W - M, y + 4)
    y += 14
  }

  const customer = pickContact(a, ['Owner', 'GM', 'CFO'])
  const order = signedOrder(a, c)
  const monthly = order.reduce((s, l) => s + l.units * l.unitPrice, 0)

  // Header
  doc.setFillColor(199, 255, 159)
  doc.rect(0, 0, W, 8, 'F')
  text('MASTER SUBSCRIPTION AGREEMENT', 16, 'bold', 2)
  text(`${c.template} · Agreement ${c.id} · Executed copy`, 9, 'normal', 10, 90)
  text(parties(a, c), 10, 'normal', 8)

  rule()
  text('Term', 11, 'bold', 2)
  text(termText(c), 10, 'normal', 8)

  text('Order form', 11, 'bold', 4)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const cols = [M, M + 250, M + 320, M + 420]
  ensure(16)
  ;['Product', 'Units', 'Unit price / mo', 'Monthly'].forEach((h, i) => doc.text(h, cols[i], y + 9))
  y += 16
  doc.setFont('helvetica', 'normal')
  for (const l of order) {
    ensure(14)
    doc.text(productName(l), cols[0], y + 9)
    doc.text(l.units.toLocaleString('en-US'), cols[1], y + 9)
    doc.text(usd(l.unitPrice), cols[2], y + 9)
    doc.text(usd(l.units * l.unitPrice), cols[3], y + 9)
    y += 14
  }
  ensure(18)
  doc.setFont('helvetica', 'bold')
  doc.text(totalText(monthly), M, y + 11)
  y += 24

  rule()
  text('Terms and conditions', 11, 'bold', 4)
  for (const cl of signedClauses(c, agreedChanges)) {
    text(`${cl.number}. ${cl.title}${cl.negotiated ? ' (as negotiated)' : ''}`, 10, 'bold', 1)
    text(cl.text, 9.5, 'normal', 6, 40)
  }

  // Signatures
  ensure(150)
  rule()
  text('Signatures', 11, 'bold', 6)
  const sigY = y
  const half = width / 2 - 10
  const block = (x: number, heading: string, name: string, title: string) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text(heading, x, sigY + 10)
    doc.setFont('times', 'italic')
    doc.setFontSize(20)
    doc.setTextColor(20)
    doc.text(name, x, sigY + 44)
    doc.setDrawColor(120)
    doc.line(x, sigY + 50, x + half, sigY + 50)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${name}, ${title}`, x, sigY + 64)
    doc.text(`Signed electronically ${long(signedAt)}`, x, sigY + 77)
  }
  block(M, `FOR ${a.name.toUpperCase()}`, customer.name, customer.title)
  block(M + half + 20, 'FOR THIBOLISOFT', rep, 'Account Executive')
  y = sigY + 96
  text(recordText(c, signedAt), 8, 'normal', 0, 120)

  return doc.output('blob')
}
