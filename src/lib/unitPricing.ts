import type { Account, Contract, Segment, Species, Subscription } from '../types'
import { PRODUCT } from '../data/products'

// Unit-economics pricing: what each customer pays per hog, per head of cattle, or per
// acre or bushel of grain, against a target the user sets by operation type. Pure
// functions; the Pricing page and the price-change drafts both read from here.

export type GrainBasis = 'acre' | 'bushel'
export type VolumeUnit = 'hog' | 'head' | 'acre' | 'bushel'

export interface PricingModel {
  /** Target subscription price per unit per year, by operation type. */
  hog: number
  cattle: number
  grainAcre: number
  grainBushel: number
  grainBasis: GrainBasis
  /** Direct targets for a segment, replacing operation target × segment factor. Keyed by segmentKey(). */
  segmentTargets: Record<string, number>
  /** Renewal prices stop at the price list (on by default). Off prices renewals straight to target. */
  capAtList: boolean
}

export const DEFAULT_MODEL: PricingModel = { hog: 2.25, cattle: 12, grainAcre: 2.75, grainBushel: 0.03, grainBasis: 'acre', segmentTargets: {}, capAtList: true }

/** Grain targets depend on the basis (per acre and per bushel differ ~100x), so they're keyed separately. */
export const segmentKey = (segment: Segment, species: Species, basis: GrainBasis) => (species === 'Grain' ? `${segment}@${basis}` : segment)

export const operationTarget = (m: PricingModel, species: Species) => (species === 'Hog' ? m.hog : species === 'Cattle' ? m.cattle : m.grainBasis === 'acre' ? m.grainAcre : m.grainBushel)

/** Expected yield, bushels (or bushel-equivalents at standard test weights) per acre. Hay and cotton aren't sold by the bushel. */
export const YIELD_BU: Record<string, number> = { Corn: 177, Soybeans: 51, Wheat: 48, Sorghum: 70, Barley: 75, Oats: 65, Rice: 165, Sunflowers: 55, 'Dry Beans': 33 }

export const UNIT_WORD: Record<VolumeUnit, [string, string]> = { hog: ['hog', 'hogs'], head: ['head', 'head'], acre: ['acre', 'acres'], bushel: ['bushel', 'bushels'] }
export const unitFor = (species: Species, basis: GrainBasis): VolumeUnit => (species === 'Hog' ? 'hog' : species === 'Cattle' ? 'head' : basis)

export interface Volume {
  qty: number
  unit: VolumeUnit
  /** How the volume was derived, when it isn't read straight off the record. */
  note?: string
}

export function volumeOf(a: Account, basis: GrainBasis): Volume | null {
  if (a.species === 'Hog') return a.headCount > 0 ? { qty: a.headCount, unit: 'hog' } : null
  if (a.species === 'Cattle') return a.headCount > 0 ? { qty: a.headCount, unit: 'head' } : null
  if (!a.acres) return null
  if (basis === 'acre') return { qty: a.acres, unit: 'acre' }
  const crop = (a.crops ?? []).find((c) => YIELD_BU[c])
  if (!crop) return null
  return { qty: Math.round(a.acres * YIELD_BU[crop]), unit: 'bushel', note: `${a.acres.toLocaleString('en-US')} acres at ${YIELD_BU[crop]} bu/acre (${crop.toLowerCase()})` }
}

export const currentArr = (a: Pick<Account, 'subscriptions'>) => a.subscriptions.reduce((s, x) => s + x.units * x.unitPrice, 0) * 12
export const listArr = (a: Pick<Account, 'subscriptions'>) => a.subscriptions.reduce((s, x) => s + x.units * (PRODUCT[x.productId]?.listPrice ?? x.unitPrice), 0) * 12

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Each segment's price per unit relative to its operation type (median to median). */
export type SegmentFactors = Record<GrainBasis, Record<string, number>>

export function calibrateFactors(customers: Account[]): SegmentFactors {
  const out: SegmentFactors = { acre: {}, bushel: {} }
  for (const basis of ['acre', 'bushel'] as const) {
    const bySpecies = new Map<Species, number[]>()
    const bySegment = new Map<Segment, { species: Species; xs: number[] }>()
    for (const a of customers) {
      const v = volumeOf(a, basis)
      const arr = currentArr(a)
      if (!v || !arr) continue
      const p = arr / v.qty
      bySpecies.set(a.species, [...(bySpecies.get(a.species) ?? []), p])
      const seg = bySegment.get(a.segment) ?? { species: a.species, xs: [] }
      seg.xs.push(p)
      bySegment.set(a.segment, seg)
    }
    for (const [segment, { species, xs }] of bySegment) {
      const base = median(bySpecies.get(species) ?? [])
      out[basis][segment] = base ? Number((median(xs) / base).toPrecision(2)) : 1
    }
  }
  return out
}

export function targetFor(a: Pick<Account, 'species' | 'segment'>, m: PricingModel, f: SegmentFactors): { value: number; overridden: boolean } {
  const basis = m.grainBasis
  const own = m.segmentTargets[segmentKey(a.segment, a.species, basis)]
  if (own !== undefined) return { value: own, overridden: true }
  return { value: operationTarget(m, a.species) * (f[a.species === 'Grain' ? basis : 'acre'][a.segment] ?? 1), overridden: false }
}

// ---------- renewal ----------

export interface RenewalWindow {
  date: string
  noticeBy: string
  noticeDays: number
  /** The notice window for the current term end has passed, so this is the renewal after it. */
  rolled: boolean
  termEnd: string
  paymentTerms: string
}

const DAY = 86400000
const addMonths = (d: Date, n: number) => {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

export function renewalWindow(c: Contract, today = new Date()): RenewalWindow {
  let end = new Date(c.end)
  let rolled = false
  // Past the notice deadline, the agreement renews on current terms; the next chance is a year later.
  while (end.getTime() - c.renewalNoticeDays * DAY < today.getTime()) {
    end = addMonths(end, 12)
    rolled = true
  }
  return { date: end.toISOString(), noticeBy: new Date(end.getTime() - c.renewalNoticeDays * DAY).toISOString(), noticeDays: c.renewalNoticeDays, rolled, termEnd: c.end, paymentTerms: c.paymentTerms }
}

// ---------- repricing ----------

export interface RepricedLine {
  productId: string
  units: number
  currentPrice: number
  newPrice: number
  listPrice: number
}

/**
 * Raise unit prices toward a monthly goal, proportionally and never down. With the list
 * cap on, no line goes above list, and a few passes hand what capped lines couldn't take
 * to the lines still below list.
 */
export function repriceLines(subs: Subscription[], goalMonthly: number, capAtList = true): RepricedLine[] {
  const lines = subs.map((s) => ({ productId: s.productId, units: s.units, currentPrice: s.unitPrice, newPrice: s.unitPrice, listPrice: PRODUCT[s.productId]?.listPrice ?? s.unitPrice }))
  const ceiling = (l: (typeof lines)[number]) => (capAtList ? l.listPrice : Infinity)
  const total = () => lines.reduce((s, l) => s + l.units * l.newPrice, 0)
  for (let pass = 0; pass < 4; pass++) {
    const gap = goalMonthly - total()
    if (gap <= 0.5) break
    const open = lines.filter((l) => l.newPrice < ceiling(l) - 0.005)
    const openTotal = open.reduce((s, l) => s + l.units * l.newPrice, 0)
    if (!openTotal) break
    const f = 1 + gap / openTotal
    for (const l of open) l.newPrice = Math.min(ceiling(l), l.newPrice * f)
  }
  for (const l of lines) l.newPrice = Math.max(l.currentPrice, Math.round(l.newPrice * 100) / 100)
  return lines
}

// ---------- ranking ----------

export type RankStatus = 'Under target' | 'At target' | 'Over target'
/** Within this share of target counts as at target. */
export const AT_TARGET_BAND = 0.05

export interface UnitRank {
  rank: number
  account: Account
  volume: Volume
  currentArr: number
  currentPerUnit: number
  targetPerUnit: number
  targetOverridden: boolean
  /** Current price against target: -0.3 is 30% below target. */
  gap: number
  status: RankStatus
  targetArr: number
  listArr: number
  renewalArr: number
  /** The target is above list price, so renewal stops at list. */
  cappedAtList: boolean
  /** What renewal adds (within the list cap when it's on). */
  upliftArr: number
  /** What it would take to reach target, list or not. */
  toTargetArr: number
  lines: RepricedLine[]
  renewal?: RenewalWindow
}

export function rankAccount(a: Account, c: Contract | undefined, m: PricingModel, f: SegmentFactors, today = new Date()): Omit<UnitRank, 'rank'> | null {
  const volume = volumeOf(a, m.grainBasis)
  const cur = currentArr(a)
  if (!volume || !cur) return null
  const t = targetFor(a, m, f)
  const perUnit = cur / volume.qty
  const gap = t.value ? perUnit / t.value - 1 : 0
  const status: RankStatus = gap < -AT_TARGET_BAND ? 'Under target' : gap > AT_TARGET_BAND ? 'Over target' : 'At target'
  const targetArr = t.value * volume.qty
  const list = listArr(a)
  // Under target: move to target at renewal (not above list while the cap is on). Otherwise hold the price.
  const cap = m.capAtList !== false
  const goal = status === 'Under target' ? Math.max(cur, cap ? Math.min(targetArr, list) : targetArr) : cur
  const lines = repriceLines(a.subscriptions, goal / 12, cap)
  const renewalArr = lines.reduce((s, l) => s + l.units * l.newPrice, 0) * 12
  return {
    account: a,
    volume,
    currentArr: cur,
    currentPerUnit: perUnit,
    targetPerUnit: t.value,
    targetOverridden: t.overridden,
    gap,
    status,
    targetArr,
    listArr: list,
    renewalArr,
    cappedAtList: cap && status === 'Under target' && targetArr > list + 1,
    upliftArr: Math.max(0, renewalArr - cur),
    toTargetArr: status === 'Under target' ? Math.max(0, targetArr - cur) : 0,
    lines,
    renewal: c ? renewalWindow(c, today) : undefined,
  }
}

/** Every customer, furthest under target first (rank 1) to furthest over target. */
export function rankCustomers(customers: Account[], contracts: Record<string, Contract>, m: PricingModel, f: SegmentFactors, today = new Date()): UnitRank[] {
  return customers
    .map((a) => rankAccount(a, a.contractId ? contracts[a.contractId] : undefined, m, f, today))
    .filter((r) => !!r)
    .sort((x, y) => x.gap - y.gap)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** "$2.40", or "$0.028" for per-bushel prices. */
export const unitMoney = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US')}`
