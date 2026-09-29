import type { Account, Contract } from '../types'
import { PRODUCT } from '../data/products'

export const CPI_ESTIMATE = 2.9 // % used for CPI-linked escalators
const DAY = 86400000

/** Volume-based discount a peer of this size would normally get (fraction). */
export function expectedDiscount(listMonthly: number): number {
  if (listMonthly < 2000) return 0.05
  if (listMonthly < 6000) return 0.11
  if (listMonthly < 15000) return 0.18
  if (listMonthly < 40000) return 0.24
  return 0.3
}
export const BAND_HALF_WIDTH = 0.05

export const listMonthly = (a: Account) => a.subscriptions.reduce((s, x) => s + x.units * PRODUCT[x.productId].listPrice, 0)
export const mrr = (a: Account) => a.subscriptions.reduce((s, x) => s + x.units * x.unitPrice, 0)

export interface Ability {
  window: 'Anniversary' | 'Renewal' | 'Locked'
  effectiveDate: string
  noticeBy: string
  maxIncreasePct: number | null // null = no contractual cap (market repricing at renewal)
  canActNow: boolean
  explanation: string
}

function nextAnniversary(start: Date, after: Date): Date {
  const d = new Date(start)
  while (d <= after) d.setFullYear(d.getFullYear() + 1)
  return d
}

export function contractAbility(c: Contract, today = new Date()): Ability {
  const end = new Date(c.end)
  const renewalNotice = new Date(end.getTime() - c.renewalNoticeDays * DAY)
  const renewal = (why: string): Ability => {
    const noticeBy = renewalNotice
    const late = noticeBy < today
    return {
      window: 'Renewal',
      effectiveDate: end.toISOString(),
      noticeBy: noticeBy.toISOString(),
      maxIncreasePct: null,
      canActNow: !late,
      explanation: late
        ? `${why} The renewal notice window (${c.renewalNoticeDays} days before ${end.toLocaleDateString()}) has passed${c.autoRenew ? ', so the contract auto-renews at current pricing. Next opportunity is the following renewal.' : '. Renegotiate as part of the renewal conversation.'}`
        : `${why} Pricing can be reset at renewal on ${end.toLocaleDateString()}; propose new pricing by ${noticeBy.toLocaleDateString()}.`,
    }
  }
  const { mechanism, capPct, noticeDays, lockUntil } = c.price
  if (mechanism === 'Multi-year price lock' && lockUntil && new Date(lockUntil) > today) {
    const lu = new Date(lockUntil)
    if (lu >= end) return { ...renewal(`Price is locked until ${lu.toLocaleDateString()}.`), window: 'Locked' }
    return { window: 'Locked', effectiveDate: lu.toISOString(), noticeBy: new Date(lu.getTime() - noticeDays * DAY).toISOString(), maxIncreasePct: capPct ?? CPI_ESTIMATE, canActNow: false, explanation: `Price is locked until ${lu.toLocaleDateString()}. After that, increases up to ${capPct ?? CPI_ESTIMATE}% are allowed on ${noticeDays} days' notice.` }
  }
  if (mechanism === 'Fixed for term' || mechanism === 'Renegotiate at renewal' || mechanism === 'Multi-year price lock') {
    return renewal(mechanism === 'Fixed for term' ? 'Fees are fixed for the term, so no mid-term increase is allowed.' : 'The contract reserves pricing changes for renewal.')
  }
  // Anniversary-based mechanisms
  let ann = nextAnniversary(new Date(c.start), today)
  let noticeBy = new Date(ann.getTime() - noticeDays * DAY)
  if (noticeBy < today) {
    ann = nextAnniversary(new Date(c.start), ann)
    noticeBy = new Date(ann.getTime() - noticeDays * DAY)
  }
  if (ann >= end) return renewal('No anniversary falls before the term ends.')
  const max = mechanism === 'Annual CPI escalator' ? Math.min(capPct ?? CPI_ESTIMATE, CPI_ESTIMATE) : capPct ?? 5
  return {
    window: 'Anniversary',
    effectiveDate: ann.toISOString(),
    noticeBy: noticeBy.toISOString(),
    maxIncreasePct: max,
    canActNow: true,
    explanation:
      mechanism === 'Annual CPI escalator'
        ? `CPI escalator: up to ${max.toFixed(1)}% (CPI est. ${CPI_ESTIMATE}%, cap ${capPct}%) effective ${ann.toLocaleDateString()}; notice due by ${noticeBy.toLocaleDateString()}.`
        : `Annual increase clause: up to ${max}% effective ${ann.toLocaleDateString()} with ${noticeDays} days' notice (send by ${noticeBy.toLocaleDateString()}).`,
  }
}

export type PriceStatus = 'Under-priced' | 'In band' | 'Over-priced'

export interface PricingAnalysis {
  status: PriceStatus
  listMrr: number
  currentMrr: number
  actualDiscount: number
  bandLow: number // min discount (highest acceptable price)
  bandHigh: number // max discount (lowest acceptable price)
  normalizedMrr: number // price at nearest band edge
  neededPct: number // % change to reach the band edge
  ability?: Ability
  recommendedPct: number
  upliftArr: number
  recommendation: string
  mfnExposure: string[]
}

export function analyzePricing(a: Account, c: Contract | undefined, allCustomers: Account[], contracts: Record<string, Contract>, today = new Date()): PricingAnalysis {
  const lm = listMonthly(a)
  const cm = mrr(a)
  const disc = lm ? 1 - cm / lm : 0
  const center = expectedDiscount(lm)
  const bandLow = Math.max(0, center - BAND_HALF_WIDTH)
  const bandHigh = center + BAND_HALF_WIDTH
  let status: PriceStatus = 'In band'
  let targetDisc = disc
  if (disc > bandHigh) {
    status = 'Under-priced'
    targetDisc = bandHigh
  } else if (disc < bandLow) {
    status = 'Over-priced'
    targetDisc = bandLow
  }
  const normalizedMrr = lm * (1 - targetDisc)
  const neededPct = cm ? (normalizedMrr / cm - 1) * 100 : 0
  const ability = c ? contractAbility(c, today) : undefined

  let recommendedPct = 0
  let recommendation = 'Pricing is within the normal band for an account this size. No action needed.'
  const mfnExposure: string[] = []
  if (status === 'Under-priced') {
    const cap = ability?.maxIncreasePct
    recommendedPct = cap == null ? neededPct : Math.min(neededPct, cap)
    const gap = neededPct - recommendedPct
    recommendation = !ability
      ? `Pricing is ${neededPct.toFixed(1)}% below the band. No contract is on file.`
      : ability.window === 'Locked'
        ? `Pricing is ${neededPct.toFixed(1)}% below the band, but the price is locked. Plan a +${recommendedPct.toFixed(1)}% increase effective ${new Date(ability.effectiveDate).toLocaleDateString()}.`
        : `Raise ${recommendedPct.toFixed(1)}% at ${ability.window.toLowerCase()} (${new Date(ability.effectiveDate).toLocaleDateString()}), with notice by ${new Date(ability.noticeBy).toLocaleDateString()}.${gap > 0.5 ? ` That still leaves ${gap.toFixed(1)}% to close at the next window; consider bundling an add-on to close it sooner.` : ''}`
  } else if (status === 'Over-priced') {
    recommendedPct = 0
    recommendation = `Paying ${Math.abs(neededPct).toFixed(1)}% above peers of this size, which is a churn risk. Don't cut list price. Offer a value bundle (add a module at the price difference) or reset to the band at renewal${ability ? ` (${new Date(ability.effectiveDate).toLocaleDateString()})` : ''}.`
    for (const other of allCustomers) {
      if (other.id === a.id || other.segment !== a.segment || !other.contractId) continue
      if (contracts[other.contractId]?.mfn) mfnExposure.push(other.name)
    }
    if (mfnExposure.length) recommendation += ` Warning: ${mfnExposure.length} ${a.segment} customer(s) have MFN clauses, so cutting unit prices here may cascade.`
  }
  const upliftArr = status === 'Under-priced' ? cm * (recommendedPct / 100) * 12 : 0
  return { status, listMrr: lm, currentMrr: cm, actualDiscount: disc, bandLow, bandHigh, normalizedMrr, neededPct, ability, recommendedPct, upliftArr, recommendation, mfnExposure }
}
