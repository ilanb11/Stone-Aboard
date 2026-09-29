import type { Account, Contract, Opportunity, Signal, Species } from '../../types'
import { STATES } from '../../data/geo'
import { num } from '../format'
import { bandPrice } from '../pipeline'
import { listMonthly } from '../pricing'
import { seededGrants } from './seeded'
import type { DeadlineRule, Grant, GrantSource, GrantTopic } from './types'

export * from './types'

/** The grant catalog in use. Swap for a live GrantSource here; nothing else changes. */
export const grantSource: GrantSource = seededGrants

// ---------- regulatory changes ----------

export interface RegulatoryChange {
  signal: Signal
  /** Short name for what changed. */
  label: string
  /** What the rule asks of an operation, most important first. */
  topics: GrantTopic[]
  operations: Species[]
  /** Who the rule covers, in plain language. */
  scope: string
  /** Size floor for rules that only cover large operations. */
  minHead?: { Hog?: number; Cattle?: number; Dairy?: number }
  /** Why the rule matters to one account, for the application narrative. */
  why: (a: Account) => string
}

type Rule = Omit<RegulatoryChange, 'signal'> & { test: RegExp }

const sites = (a: Account) => `${a.sites} ${a.sites === 1 ? 'site' : 'sites'}`
const RULES: Rule[] = [
  {
    test: /setback/i,
    label: 'Setbacks for new livestock barns',
    topics: ['siting-odor', 'manure'],
    operations: ['Hog', 'Cattle'],
    scope: 'Livestock operations in the state. New and expanding barns must meet the setback distances.',
    why: (a) => `Setback distances make odor control and screening part of any expansion at ${a.name}'s ${sites(a)}. Windbreaks and covered manure storage cut odor at property lines, which helps existing sites and future permits meet the new distances.`,
  },
  {
    test: /CAFO|manure/i,
    label: 'CAFO nutrient management rules',
    topics: ['nutrients', 'manure', 'water-quality'],
    operations: ['Hog', 'Cattle'],
    scope: 'Large CAFOs under EPA size thresholds: 2,500 or more hogs, 1,000 or more cattle, or 700 or more dairy cows.',
    minHead: { Hog: 2500, Cattle: 1000, Dairy: 700 },
    why: (a) => `The updated rules add manure storage and application record requirements for large livestock operations. At ${num(a.headCount)} head, ${a.name} is above the large-CAFO threshold, so its storage capacity and nutrient management plan need to meet the new standard.`,
  },
  {
    test: /nitrogen/i,
    label: 'Fall nitrogen application rules',
    topics: ['nutrients', 'water-quality'],
    operations: ['Grain'],
    scope: 'Crop operations applying nitrogen in the fall, especially near wells.',
    why: (a) => `New application windows limit fall nitrogen near wells. Cover crops, a nitrification inhibitor and an updated nutrient plan keep yields on ${num(a.acres)} acres while meeting the timing rules.`,
  },
  {
    test: /electronic ID|\bEID\b/i,
    label: 'Electronic ID for cattle movement',
    topics: ['traceability'],
    operations: ['Cattle'],
    scope: 'Cattle operations that move breeding cattle across state lines.',
    why: (a) => `Breeding cattle moving across state lines now need official electronic ID. Tagging the herd (${num(a.headCount)} head) keeps sales and shipments moving without delays at the sale barn.`,
  },
  {
    test: /Prop 12|sow-housing/i,
    label: 'Sow housing standards',
    topics: ['animal-housing'],
    operations: ['Hog'],
    scope: 'Hog operations selling pork into the state.',
    why: (a) => `Sow housing audits decide whether ${a.name}'s pork can be sold into the state.`,
  },
  {
    test: /conservation program/i,
    label: 'Conservation program enrollment',
    topics: ['conservation', 'water-quality', 'nutrients'],
    operations: ['Hog', 'Cattle', 'Grain'],
    scope: 'All farms in the state.',
    why: (a) => `Enrollment is open now. The practices below address ${a.name}'s main resource concerns and rank well in this sign-up.`,
  },
]

/** A regulatory or law change in a region: a market-wide Regulatory signal with a state. */
export function regulatoryChange(s: Signal): RegulatoryChange | null {
  if (s.type !== 'Regulatory' || s.accountId || !s.state) return null
  const rule = RULES.find((r) => r.test.test(`${s.headline} ${s.detail}`))
  if (!rule) return null
  const { test: _test, ...rest } = rule
  return { ...rest, signal: s }
}

export const lawChangesFrom = (signals: Signal[]) => signals.map(regulatoryChange).filter((c): c is RegulatoryChange => !!c)

/** Customers and prospects in the rule's state whose operation (and size) the rule covers. */
export function affects(ch: RegulatoryChange, a: Account): boolean {
  if (a.state !== ch.signal.state || a.status === 'Churned' || !ch.operations.includes(a.species)) return false
  const m = ch.minHead
  if (!m) return true
  const floor = a.species === 'Hog' ? m.Hog : a.segment === 'Dairy' ? m.Dairy : m.Cattle
  return floor === undefined || a.headCount >= floor
}
export const affectedAccounts = (ch: RegulatoryChange, accounts: Account[]) => accounts.filter((a) => affects(ch, a))

export const grantsForChange = (ch: RegulatoryChange) => grantSource.find({ state: ch.signal.state!, topics: ch.topics, operations: ch.operations })

/** Applications that answer a rule change: drafted for it, or for an account and program it covers. */
export function applicationsForChange<T extends { signalIds: string[]; accountId: string; grantId: string }>(ch: RegulatoryChange, apps: T[], accounts: Account[]): T[] {
  const grants = new Set(grantsForChange(ch).map((g) => g.id))
  const affected = new Set(affectedAccounts(ch, accounts).map((a) => a.id))
  return apps.filter((x) => x.signalIds.includes(ch.signal.id) || (grants.has(x.grantId) && affected.has(x.accountId)))
}

// ---------- eligibility ----------

export type CheckStatus = 'Met' | 'Not met' | 'To confirm'
export interface EligibilityCheck {
  label: string
  status: CheckStatus
  detail?: string
}

const OP_WORD: Record<Species, string> = { Hog: 'hog', Cattle: 'cattle', Grain: 'field crop' }
const opList = (ops: Species[]) => (ops.length === 3 ? 'Crop or livestock operation' : `${ops.map((o) => OP_WORD[o]).join(' or ').replace(/^./, (c) => c.toUpperCase())} operation`)

/** Checks what the CRM knows (state, operation type) and lists what the applicant has to confirm. */
export function checkEligibility(g: Grant, a: Account): EligibilityCheck[] {
  return g.eligibility.map((c) => {
    if (c.kind === 'state') {
      const names = c.states.map((s) => STATES[s]?.name ?? s).join(' or ')
      return { label: `Operates in ${names}`, status: c.states.includes(a.state) ? 'Met' : 'Not met', detail: `${a.county} County, ${STATES[a.state]?.name ?? a.state}` }
    }
    if (c.kind === 'operation') return { label: opList(c.operations), status: c.operations.includes(a.species) ? 'Met' : 'Not met', detail: `${OP_WORD[a.species]}, ${a.segment}` }
    return { label: c.label, status: 'To confirm' }
  })
}
export const isEligible = (g: Grant, a: Account) => checkEligibility(g, a).every((c) => c.status !== 'Not met')

/** Eligibility in plain words, without an account to check against. */
export const describeEligibility = (g: Grant): string[] =>
  g.eligibility.map((c) => (c.kind === 'state' ? `Operates in ${c.states.map((x) => STATES[x]?.name ?? x).join(' or ')}` : c.kind === 'operation' ? opList(c.operations) : c.label))

/** The program to draft first: most topic overlap, then usable practices, then the larger award. */
export function rankGrants(grants: Grant[], a: Account, topics: GrantTopic[]): Grant[] {
  const score = (g: Grant) =>
    g.topics.filter((t) => topics.includes(t)).length * 10 + g.practices.filter((p) => p.operations.includes(a.species) && p.topics.some((t) => topics.includes(t))).length + Math.log10(g.award.max)
  return grants.filter((g) => isEligible(g, a) && g.practices.some((p) => p.operations.includes(a.species))).sort((x, y) => score(y) - score(x))
}

// ---------- deadlines ----------

export function nextDeadline(rule: DeadlineRule, today = new Date()): Date | null {
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dates = rule.kind === 'annual' ? [[rule.month, rule.day] as [number, number]] : rule.kind === 'quarterly' ? rule.dates : []
  let best: Date | null = null
  for (const [m, d] of dates)
    for (const y of [d0.getFullYear(), d0.getFullYear() + 1]) {
      const t = new Date(y, m - 1, d)
      if (t >= d0 && (!best || t < best)) best = t
    }
  return best
}

export function deadlineText(rule: DeadlineRule, today = new Date()): { date?: string; days?: number; label: string } {
  const d = nextDeadline(rule, today)
  if (!d) return { label: rule.label }
  const days = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000)
  return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), days, label: rule.label }
}

// A tax credit pays nothing toward the purchase, so it gets no cap or cost share (its basis says how it's figured).
export const awardText = (g: Grant) =>
  g.kind === 'Tax credit' ? 'Tax credit, not a grant' : g.award.costSharePct < 100 ? `Up to $${num(g.award.max)} · ${g.award.costSharePct}% cost share` : `Up to $${num(g.award.max)}`

// ---------- funding what the customer buys from us ----------

/** An application is prepared only when a program covers at least this share of what the customer pays us. */
export const COVERAGE_THRESHOLD = 0.5
/** A renewal this close counts as a purchase the customer is about to make. */
export const RENEWAL_HORIZON_DAYS = 150

export interface Purchase {
  kind: 'Renewal' | 'New deal' | 'Expansion'
  opportunityId?: string
  /** When the customer commits: the renewal date or the deal's expected close. */
  when: string
  lines: { productId: string; units: number; unitPrice: number }[]
  /** First-year cost of the purchase, USD. */
  annualCost: number
}

const OPEN = ['Negotiation', 'Demo', 'Prospect']

/** What the account is buying from us next: its furthest open deal, else a renewal coming up. */
export function purchaseFor(a: Account, opps: Opportunity[], contract: Contract | undefined, today = new Date()): Purchase | null {
  if (a.status === 'Churned') return null
  const open = opps.filter((o) => o.accountId === a.id && OPEN.includes(o.stage)).sort((x, y) => OPEN.indexOf(x.stage) - OPEN.indexOf(y.stage))[0]
  if (open) return purchaseFromDeal(a, open)
  if (a.status === 'Customer' && contract && a.subscriptions.length) {
    const days = (new Date(contract.end).getTime() - today.getTime()) / 86400000
    if (days > 0 && days <= RENEWAL_HORIZON_DAYS) {
      const lines = a.subscriptions.map((x) => ({ productId: x.productId, units: x.units, unitPrice: x.unitPrice }))
      return { kind: 'Renewal', when: contract.end, lines, annualCost: lines.reduce((s, l) => s + l.units * l.unitPrice, 0) * 12 }
    }
  }
  return null
}

/** The purchase an open deal represents, priced at our normal band. */
export function purchaseFromDeal(a: Account, o: Opportunity): Purchase {
  if (o.type === 'Renewal' && a.subscriptions.length) {
    const lines = a.subscriptions.map((x) => ({ productId: x.productId, units: x.units, unitPrice: x.unitPrice }))
    return { kind: 'Renewal', opportunityId: o.id, when: o.closeDate, lines, annualCost: lines.reduce((s, l) => s + l.units * l.unitPrice, 0) * 12 }
  }
  const { lines } = bandPrice(a, o.products, o.type === 'Expansion' ? listMonthly(a) : 0)
  const ls = lines.map((l) => ({ productId: l.productId, units: l.units, unitPrice: l.unitPrice }))
  return { kind: o.type === 'Expansion' ? 'Expansion' : 'New deal', opportunityId: o.id, when: o.closeDate, lines: ls, annualCost: ls.reduce((s, l) => s + l.units * l.unitPrice, 0) * 12 }
}

export interface Coverage {
  lines: { productId: string; units: number; annualCost: number; eligible: boolean }[]
  eligibleCost: number
  /** What the program would pay toward the purchase in the first year. */
  funded: number
  /** funded as a share of the purchase's first-year cost. */
  coverage: number
}

export function coverageFor(g: Grant, p: Purchase): Coverage {
  const lines = p.lines.map((l) => ({ productId: l.productId, units: l.units, annualCost: l.units * l.unitPrice * 12, eligible: g.funds.products.includes(l.productId) }))
  const eligibleCost = lines.filter((l) => l.eligible).reduce((s, l) => s + l.annualCost, 0)
  const funded = Math.min(g.award.max, (eligibleCost * g.funds.sharePct) / 100)
  return { lines, eligibleCost, funded, coverage: p.annualCost ? funded / p.annualCost : 0 }
}

// ---------- per account ----------

export interface AccountGrantMatch {
  grant: Grant
  changes: RegulatoryChange[]
  coverage: Coverage
}

/**
 * Programs that can pay for part of what the account is buying from us, best coverage
 * first, with any regional rule change that makes the program timely. Tax credits are
 * separate (see irs-rd).
 */
export function fundingFor(a: Account, p: Purchase, changes: RegulatoryChange[]): AccountGrantMatch[] {
  const bought = new Set(p.lines.map((l) => l.productId))
  const relevant = changes.filter((ch) => affects(ch, a))
  return grantSource
    .list()
    .filter((g) => g.kind === 'Grant' && (g.level === 'Federal' || g.state === a.state) && g.funds.products.some((x) => bought.has(x)) && isEligible(g, a))
    .map((g) => ({ grant: g, coverage: coverageFor(g, p), changes: relevant.filter((ch) => grantsForChange(ch).some((x) => x.id === g.id)) }))
    .filter((m) => m.coverage.funded > 0)
    .sort((x, y) => y.coverage.coverage - x.coverage.coverage)
}

/** Every program an account qualifies for through a regulatory change that covers it, best first. Changes are newest first. */
export function grantMatchesForRules(a: Account, changes: RegulatoryChange[]): { grant: Grant; changes: RegulatoryChange[] }[] {
  const byGrant = new Map<string, { grant: Grant; changes: RegulatoryChange[] }>()
  const topics = new Set<GrantTopic>()
  const seen = new Set<string>()
  for (const ch of changes) {
    if (!affects(ch, a)) continue
    // The same rule reported twice (a proposal, then an update) counts once: the newest report.
    const key = `${ch.label}|${ch.signal.state}`
    if (seen.has(key)) continue
    seen.add(key)
    ch.topics.forEach((t) => topics.add(t))
    for (const g of rankGrants(grantsForChange(ch), a, ch.topics)) {
      const m = byGrant.get(g.id) ?? { grant: g, changes: [] }
      m.changes.push(ch)
      byGrant.set(g.id, m)
    }
  }
  const order = rankGrants([...byGrant.values()].map((m) => m.grant), a, [...topics]).map((g) => g.id)
  return order.map((id) => byGrant.get(id)!)
}

/** Programs for an account's next purchase from us (none when it isn't buying). */
export function grantMatchesForAccount(a: Account, changes: RegulatoryChange[], purchase: Purchase | null): AccountGrantMatch[] {
  return purchase ? fundingFor(a, purchase, changes) : []
}
