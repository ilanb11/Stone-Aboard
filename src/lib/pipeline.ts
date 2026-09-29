import type { Account, Opportunity, OppStage } from '../types'
import { OPP_STAGES, isOpenStage } from '../types'
import { PRODUCT, SEGMENT_FIT, unitsFor } from '../data/products'
import { expectedDiscount } from './pricing'

const STAGE_RANK = Object.fromEntries(OPP_STAGES.map((s, i) => [s, i])) as Record<OppStage, number>

/** The deal that best describes where an account stands: its furthest open deal, else its latest one. */
export function currentDeal(opps: Opportunity[]): Opportunity | undefined {
  const open = opps.filter((o) => isOpenStage(o.stage)).sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage])
  return open[0] ?? [...opps].sort((a, b) => b.closeDate.localeCompare(a.closeDate))[0]
}

/** Monthly list and band price for a set of products on this account. */
export function bandPrice(a: Account, products: string[], alreadyListMonthly = 0) {
  const lines = products.map((p) => ({ productId: p, units: unitsFor(p, a), listPrice: PRODUCT[p].listPrice }))
  const listM = lines.reduce((s, l) => s + l.units * l.listPrice, 0)
  const discount = expectedDiscount(listM + alreadyListMonthly)
  return { lines: lines.map((l) => ({ ...l, unitPrice: Math.round(l.listPrice * (1 - discount) * 100) / 100 })), discount }
}

/**
 * A new deal for an account that has none: a new logo for prospects, an expansion
 * into white space (or a renewal when there is none) for customers.
 */
export function newOpportunityFor(a: Account, stage: OppStage, now = new Date()): Opportunity {
  const fit = SEGMENT_FIT[a.segment]
  const have = new Set(a.subscriptions.map((s) => s.productId))
  const customer = a.status === 'Customer'
  const whitespace = fit.filter((p) => !have.has(p))
  const type: Opportunity['type'] = customer ? (whitespace.length ? 'Expansion' : 'Renewal') : 'New Logo'
  const products = type === 'New Logo' ? fit.slice(0, 2) : type === 'Expansion' ? whitespace.slice(0, 2) : a.subscriptions.map((s) => s.productId)
  const currentList = a.subscriptions.reduce((s, x) => s + x.units * PRODUCT[x.productId].listPrice, 0)
  const arr =
    type === 'Renewal'
      ? a.subscriptions.reduce((s, x) => s + x.units * x.unitPrice, 0) * 12
      : bandPrice(a, products, type === 'Expansion' ? currentList : 0).lines.reduce((s, l) => s + l.units * l.unitPrice, 0) * 12
  const close = new Date(now.getTime() + 60 * 86400000)
  return {
    id: `O${now.getTime().toString(36).toUpperCase()}${a.id}`,
    accountId: a.id,
    type,
    stage,
    arr: Math.round(arr),
    products,
    owner: a.rep,
    createdAt: now.toISOString(),
    closeDate: close.toISOString(),
    negotiationStartedAt: undefined,
    stageChangedAt: now.toISOString(),
  }
}
