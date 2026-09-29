import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Account, Activity, Contract, GrantApplication, GrantSectionId, Invoice, Opportunity, OppStage, OrderLine, Outreach } from './types'
import { isClosedStage, isOpenStage } from './types'
import { generateDataset, SEED_VERSION } from './data/generate'
import { PRODUCT, applyPriceList, unitsFor } from './data/products'
import { expectedDiscount } from './lib/pricing'
import type { LucasReview } from './lib/lucas'
import { draftNegotiationPackage } from './lib/lucasDrafts'
import { TEMPLATE_VERSION } from './data/contracts'
import { currentDeal, newOpportunityFor } from './lib/pipeline'
import { COVERAGE_THRESHOLD, affectedAccounts, fundingFor, grantSource, lawChangesFrom, purchaseFor, purchaseFromDeal, regulatoryChange, type RegulatoryChange } from './lib/grants'
import { draftGrantApplication, grantApplicationId, sectionsFor } from './lib/grantDrafts'
import { DEFAULT_MODEL, calibrateFactors, rankAccount, type PricingModel } from './lib/unitPricing'
import { draftPriceChange, type PriceChangeDraft } from './lib/priceChangeDrafts'
import type { Trip } from './lib/tripPlanner'
import { createMailSlice, initialMail, type MailSlice } from './lib/mail/slice'

// Deterministic seed data. Signals are reference data; everything else is
// user-editable CRM state persisted in localStorage.
export const dataset = generateDataset()
export const CURRENT_USER = 'Avery Collins'
/** Segment price factors for the unit-economics model, calibrated once from the seeded book. */
export const SEGMENT_FACTORS = calibrateFactors(dataset.accounts.filter((a) => a.status === 'Customer'))
/** Regional rule changes in the seeded signals (reference data), for grant drafting. */
const LAW_CHANGES = lawChangesFrom(dataset.signals)

// ---------- persisted-state migration ----------
// Stage names before the six-stage pipeline (seed version 13 and earlier).
const LEGACY_STAGES: Record<string, OppStage> = { Identified: 'Prospect', Qualified: 'Demo', Proposal: 'Demo' }
export const migrateStage = (s: string): OppStage => LEGACY_STAGES[s] ?? (s as OppStage)

type Persisted = Pick<CrmState, 'accounts' | 'contracts' | 'opportunities' | 'outreach' | 'activities'> & Record<string, unknown>

/** Rule changes dated within this many days count as new when the app opens. */
export const GRANT_TRIGGER_DAYS = 7

/** Append seed records the saved state doesn't have yet (matched by id). */
function mergeById<T extends { id: string }>(saved: T[], seed: T[]): T[] {
  const have = new Set(saved.map((x) => x.id))
  return [...saved, ...seed.filter((x) => !have.has(x.id))]
}

/**
 * Keeps the user's saved work across seed versions (anything before v13 is reseeded):
 * - v13 -> v14: rename old stages; add the new seed records (field-crop accounts,
 *   closed and on-ice deals).
 * - v14 -> v15: deals already in Negotiation count as started, so Lucas the Hog
 *   doesn't draft for deals that were negotiating before the trigger existed.
 * - v15 -> v16: pipeline history from the seed (stage-change dates, recent contact,
 *   slipped close dates) for deals the user hasn't moved and accounts they haven't worked.
 * - v16 -> v17: rep notes on lost and on-ice deals (merged by id like any seed record);
 *   grant drafts are rebuilt under the purchase-coverage rule (reviewed or edited ones
 *   are redrafted against the account's purchase, keeping status and edits); the stock
 *   pricing targets move to the mix-adjusted defaults (the user's own targets and settings
 *   stay) and open price-change drafts are redrafted under them; customers won without a
 *   negotiated contract get the standard agreement every won deal now has.
 * - v17 -> v18: email tracking starts empty (no mailbox connected); contact addresses
 *   with spaces in them (an old generator bug) are repaired so tracked email can match them.
 */
function migrateState(persisted: unknown, version: number) {
  const p = persisted as Partial<Persisted> | undefined
  if (!p?.accounts || !p.opportunities || version < 13) return initial()
  const seedAccount = Object.fromEntries(dataset.accounts.map((a) => [a.id, a]))
  // Accounts the user has worked keep their own contact dates.
  const workedByUser = new Set((p.activities ?? []).filter((v) => v.author === CURRENT_USER).map((v) => v.accountId))
  const accounts = mergeById(
    p.accounts.map((a) => {
      if (version < 18) a = { ...a, contacts: a.contacts.map((c) => (/\s/.test(c.email) ? { ...c, email: c.email.trim().replace(/\s+/g, '.') } : c)) }
      // The v14 seed turned a few prospects with a won deal into customers; take that fix
      // unless the user already has a contract on the account.
      const s = seedAccount[a.id]
      if (version < 16 && s && !workedByUser.has(a.id)) a = { ...a, lastContact: s.lastContact }
      return s && a.status === 'Prospect' && s.status === 'Customer' && !a.contractId ? { ...a, status: s.status, subscriptions: s.subscriptions, contractId: s.contractId, health: s.health, competitor: undefined, competitorRenewal: undefined } : a
    }),
    dataset.accounts,
  )
  const seedOpp = Object.fromEntries(dataset.opportunities.map((o) => [o.id, o]))
  const opportunities = mergeById(
    p.opportunities.map((o) => {
      const x = { ...o, stage: migrateStage(o.stage) }
      const s = seedOpp[x.id]
      return version < 16 && s && !x.stageChangedAt && s.stage === x.stage ? { ...x, createdAt: s.createdAt, stageChangedAt: s.stageChangedAt, closeDate: s.closeDate } : x
    }),
    dataset.opportunities,
  ).map((o) => (o.stage === 'Negotiation' && !o.negotiationStartedAt ? { ...o, negotiationStartedAt: o.stageChangedAt ?? o.createdAt } : o))
  const seedNote = Object.fromEntries(dataset.activities.map((v) => [v.id, v]))
  const merged = { accounts, contracts: mergeById(p.contracts ?? [], dataset.contracts), opportunities }
  const book = version < 17 ? backfillAgreements(merged) : merged
  const grants = version < 17 ? upgradeGrantApplications((p.grantApplications as unknown[] | undefined) ?? [], book) : undefined
  if (version < 17 && ((p.invoices as Invoice[] | undefined) ?? []).some((i) => i.status === 'Draft')) redraftAfterLoad = true
  return {
    ...initial(),
    ...p,
    ...book,
    outreach: mergeById(p.outreach ?? [], dataset.outreach),
    activities: [
      ...(grants?.notes ?? []),
      ...mergeById(
        (p.activities ?? []).map((v) => (version < 16 && v.id.startsWith('V-') && seedNote[v.id] && !workedByUser.has(v.accountId) ? { ...v, date: seedNote[v.id].date } : v)),
        dataset.activities,
      ),
    ],
    ...(grants ? { grantApplications: grants.apps, grantTriggered: Object.fromEntries(grants.apps.map((g) => [g.id, g.createdAt])), pricingModel: upgradePricingModel(p.pricingModel as Partial<PricingModel> | undefined) } : {}),
  }
}

/** Set when saved price-change drafts predate the current pricing model: they're redrafted once the saved price list is applied. */
let redraftAfterLoad = false

type Book = { accounts: Account[]; contracts: Contract[]; opportunities: Opportunity[] }

/** v16 deals won without going through Negotiation left no agreement on file: add the standard one. */
function backfillAgreements({ accounts, contracts, opportunities }: Book): Book {
  const active = new Set(contracts.filter((c) => c.status === 'Active').map((c) => c.id))
  const have = new Set(contracts.map((c) => c.id))
  const added: Contract[] = []
  const next = accounts.map((a) => {
    if (a.status !== 'Customer' || (a.contractId && active.has(a.contractId))) return a
    const won = opportunities.filter((o) => o.accountId === a.id && o.stage === 'Closed Won').sort((x, y) => (y.stageChangedAt ?? y.closeDate).localeCompare(x.stageChangedAt ?? x.closeDate))[0]
    if (!won || have.has(`C-${won.id}`)) return a
    const c = standardAgreement(a, won, won.stageChangedAt ?? won.closeDate)
    added.push(c)
    return { ...a, contractId: c.id }
  })
  const byDeal = new Map(added.map((c) => [c.opportunityId, c.id]))
  return { accounts: next, contracts: [...added, ...contracts], opportunities: opportunities.map((o) => (byDeal.has(o.id) && !o.contractId ? { ...o, contractId: byDeal.get(o.id) } : o)) }
}

/**
 * v16 applications funded conservation practices. Reviewed or edited ones are redrafted
 * against what the account is buying from us, keeping their status and hand edits; one
 * with no purchase to fund is dropped, with a note on the account saying so.
 */
function upgradeGrantApplications(saved: unknown[], { accounts, contracts, opportunities }: Book) {
  const apps: GrantApplication[] = []
  const notes: Activity[] = []
  for (const g of saved as GrantApplication[]) {
    if (g.status !== 'Reviewed' && !(g.edits && Object.keys(g.edits).length)) continue
    if (Array.isArray(g.lines)) {
      apps.push(g)
      continue
    }
    const grant = grantSource.get(g.grantId)
    const a = accounts.find((x) => x.id === g.accountId)
    const p = a && purchaseFor(a, opportunities, a.contractId ? contracts.find((c) => c.id === a.contractId) : undefined)
    if (!grant || !a || !p) {
      const why = grant ? `applications now fund what the customer buys from us, and ${a?.name} has no open deal or renewal coming up for it to fund` : 'the program is no longer in the grant catalog'
      if (a) notes.push({ id: uid('V'), accountId: a.id, date: now(), author: 'Herdbook', kind: 'System', text: `Grant application ${grant?.shortName ?? g.grantId} (${g.status === 'Reviewed' ? 'reviewed' : 'edited'}) was removed in an update: ${why}.` })
      continue
    }
    const app = draftGrantApplication(grant, a, p, LAW_CHANGES.filter((c) => g.signalIds?.includes(c.signal.id)))
    const sections = new Set<string>(sectionsFor(app))
    const edits = Object.fromEntries(Object.entries(g.edits ?? {}).filter(([k]) => sections.has(k)))
    apps.push({ ...app, status: g.status, createdAt: g.createdAt, updatedAt: g.updatedAt, reviewedAt: g.reviewedAt, edits })
  }
  return { apps, notes }
}

// v16 operation targets: a saved model still on these moves to the new defaults; anything the user set stays.
const V16_TARGETS = { hog: 2.25, cattle: 12, grainAcre: 2.75, grainBushel: 0.03 } as const

function upgradePricingModel(saved: Partial<PricingModel> | undefined): PricingModel {
  const m: PricingModel = { ...DEFAULT_MODEL, grainBasis: saved?.grainBasis ?? DEFAULT_MODEL.grainBasis, segmentTargets: saved?.segmentTargets ?? {}, capAtList: saved?.capAtList ?? DEFAULT_MODEL.capAtList }
  for (const k of Object.keys(V16_TARGETS) as (keyof typeof V16_TARGETS)[]) {
    const v = saved?.[k]
    if (typeof v === 'number' && v !== V16_TARGETS[k]) m[k] = v
  }
  return m
}

/** The agreement on file for a deal won on standard terms (no contract was negotiated). */
function standardAgreement(a: Account, o: Opportunity, at: string): Contract {
  const end = new Date(at)
  end.setMonth(end.getMonth() + 24)
  return {
    id: `C-${o.id}`,
    accountId: a.id,
    template: TEMPLATE_VERSION,
    status: 'Active',
    start: at,
    end: end.toISOString(),
    termMonths: 24,
    autoRenew: true,
    renewalNoticeDays: 60,
    paymentTerms: 'Net 30',
    price: { mechanism: 'Annual increase with notice', capPct: 5, noticeDays: 60 },
    mfn: false,
    assignmentOnChangeOfControl: 'Consent required',
    redlines: [],
    opportunityId: o.id,
    orderForm: a.subscriptions.map((x) => ({ productId: x.productId, units: x.units, unitPrice: x.unitPrice, listPrice: PRODUCT[x.productId]?.listPrice ?? x.unitPrice })),
  }
}

/** Apply an order form (or band pricing for plain products) to an account's subscriptions. */
function withOrder(a: Account, products: string[], order?: OrderLine[]) {
  const subs = new Map(a.subscriptions.map((x) => [x.productId, x]))
  if (order?.length) for (const l of order) subs.set(l.productId, { productId: l.productId, units: l.units, unitPrice: l.unitPrice })
  else {
    const add = products.filter((pid) => !subs.has(pid))
    const d = expectedDiscount(add.reduce((sum, pid) => sum + unitsFor(pid, a) * PRODUCT[pid].listPrice, 0))
    for (const pid of add) subs.set(pid, { productId: pid, units: unitsFor(pid, a), unitPrice: Math.round(PRODUCT[pid].listPrice * (1 - d) * 100) / 100 })
  }
  return [...subs.values()]
}

export interface Toast {
  id: string
  text: string
  link?: { to: string; label: string }
  /** Which assistant is speaking: Lucas the Hog (contracts) or the grants drafter. */
  mark?: 'lucas' | 'grants'
}

export type Decision = 'Pending' | 'Accept' | 'Counter' | 'Reject'
export interface RedlineDecision {
  decision: Decision
  language: string
}
export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}
/** The account and contracts as they were before a deal was won. */
export interface WinUndo {
  account: Pick<Account, 'status' | 'contractId' | 'subscriptions' | 'competitor' | 'competitorRenewal' | 'health'>
  /** The deal's own contract before it was signed (a Lucas draft or one in negotiation). */
  contract?: Pick<Contract, 'id' | 'status' | 'start' | 'end'>
  /** The agreement a signed renewal replaced. */
  replaced?: string
}

export interface CrmState extends MailSlice {
  accounts: Account[]
  contracts: Contract[]
  opportunities: Opportunity[]
  outreach: Outreach[]
  activities: Activity[]
  reviews: Record<string, LucasReview>
  decisions: Record<string, Record<string, RedlineDecision>>
  chats: Record<string, ChatMsg[]>
  autoSend: Record<string, boolean>
  priceProposals: Record<string, { pct: number; effectiveDate: string; createdAt: string }>
  /** What each win changed (deal id -> before), so moving the deal back out of Closed Won undoes it. */
  wonUndo: Record<string, WinUndo>
  moveOpp: (id: string, stage: OppStage) => void
  log: (accountId: string, kind: Activity['kind'], text: string) => void
  queueOutreach: (o: Omit<Outreach, 'id' | 'createdAt' | 'status'> & { status?: Outreach['status'] }) => string
  updateOutreach: (id: string, patch: Partial<Outreach>) => void
  sendOutreach: (id: string) => void
  setAutoSend: (playbook: string, on: boolean) => void
  setReview: (contractId: string, r: LucasReview) => void
  setDecision: (contractId: string, redlineId: string, d: RedlineDecision) => void
  appendChat: (contractId: string, m: ChatMsg) => void
  setChat: (contractId: string, msgs: ChatMsg[]) => void
  proposePrice: (accountId: string, pct: number, effectiveDate: string) => void
  signContract: (contractId: string) => void
  /** Account page: change the customer status directly (Prospect, Customer, Churned). */
  setAccountStatus: (accountId: string, status: Account['status']) => void
  /** Accounts page: set the stage of the account's current deal (creating one if needed). */
  setAccountStage: (accountId: string, stage: OppStage) => void
  /** Lucas the Hog: draft a contract and intro email the first time a deal reaches Negotiation. Returns the draft contract id, or null if it had already fired. */
  startNegotiation: (opportunityId: string) => string | null
  updateContract: (id: string, patch: Partial<Contract>) => void
  /** Approve a Lucas draft: sends its intro email (simulated) and marks the contract as with the customer. */
  approveDraft: (contractId: string) => void
  grantApplications: GrantApplication[]
  /** Regulatory signals already processed (signal id -> when), so each rule change drafts once. */
  grantTriggered: Record<string, string>
  /** Draft grant applications for every account a regulatory change affects. Returns how many are new. */
  draftGrantsForSignal: (signalId: string) => number
  /** App start: draft for rule changes from the last GRANT_TRIGGER_DAYS that haven't been processed. */
  runGrantTrigger: () => void
  /** Draft one more program for an account (from the review screen or Pipeline Review). */
  addGrantApplication: (grantId: string, accountId: string, signalIds: string[]) => string | null
  updateGrantApplication: (id: string, patch: Partial<Pick<GrantApplication, 'lines'>>) => void
  setGrantSection: (id: string, section: GrantSectionId, text: string | null) => void
  setGrantStatus: (id: string, status: GrantApplication['status']) => void
  discardGrantApplication: (id: string) => void
  /** Unit-economics targets (Pricing rank). */
  pricingModel: PricingModel
  setPricingModel: (patch: Partial<PricingModel>) => void
  setSegmentTarget: (key: string, value: number | null) => void
  resetPricingModel: () => void
  /** The user's list prices (product id -> $ per unit per month); products not listed keep the base price. */
  priceList: Record<string, number>
  setListPrice: (productId: string, price: number | null) => void
  resetPriceList: () => void
  invoices: Invoice[]
  /** Pricing rank automation: a price-change email and a pre-drafted invoice per account, both waiting for approval. */
  draftPriceChanges: (accountIds: string[]) => { created: number; updated: number; kept: number; skipped: number }
  /** Re-run open price-change drafts after the model or price list changes (hand-edited emails are left alone and flagged). */
  refreshPriceDrafts: () => void
  /** Approve a price change: sends the email with its invoice (simulated). */
  approvePriceChange: (outreachId: string) => void
  /** Add a prepared price change (email + invoice). With send, it goes out now: the click is the approval. */
  pushPriceChange: (d: PriceChangeDraft, send: boolean) => string
  /** Sent price changes whose effective date has come: apply the new unit prices to the subscription. */
  applyDuePriceChanges: () => void
  /** Skip an outreach draft; a price-change invoice attached to it is voided. */
  skipOutreach: (id: string) => void
  /** Where the user is travelling next (heat map trip planner). */
  trips: Trip[]
  addTrip: (t: Omit<Trip, 'id' | 'createdAt'>) => string
  removeTrip: (id: string) => void
  /** Monthly sales targets (YYYY-MM -> ARR booked), for the dashboard's sales bar. */
  salesTargets: Record<string, number>
  setSalesTarget: (month: string, value: number) => void
  toast: Toast | null
  notify: (t: Omit<Toast, 'id'>) => void
  dismissToast: () => void
  resetAll: () => void
}

const now = () => new Date().toISOString()
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const initial = () => ({
  accounts: dataset.accounts,
  contracts: dataset.contracts,
  opportunities: dataset.opportunities,
  outreach: dataset.outreach,
  activities: dataset.activities,
  reviews: {},
  decisions: {},
  chats: {},
  autoSend: { leadership: true, expansion: false, ownership: false, 'weather-heat': true, 'weather-cold': true },
  priceProposals: {},
  wonUndo: {} as Record<string, WinUndo>,
  grantApplications: [] as GrantApplication[],
  grantTriggered: {} as Record<string, string>,
  pricingModel: DEFAULT_MODEL,
  priceList: {} as Record<string, number>,
  invoices: [] as Invoice[],
  trips: [] as Trip[],
  salesTargets: {} as Record<string, number>,
  ...initialMail(),
})

// Grant drafting rules: only for real purchases worth the paperwork.
const GRANT_MIN_PURCHASE = 5000 // first-year cost, USD
const GRANT_MIN_FUNDED = 2500
const TAX_NOTE_MIN_PURCHASE = 15000
const TAX_NOTE_WON_DAYS = 60

/**
 * Pre-draft funding for these accounts: a grant application where one program covers at
 * least half of what the account is buying from us (a deal at Demo or Negotiation, or a
 * renewal within 90 days), and an R&D tax-credit note for larger new sign-ups. Each
 * program is drafted once per account (grantTriggered), so a discarded draft stays gone.
 */
type SetState = (p: Partial<CrmState> | ((s: CrmState) => Partial<CrmState>)) => void

function draftFundingFor(get: () => CrmState, set: SetState, accountIds: string[], changes: RegulatoryChange[]) {
  const st = get()
  const today = Date.now()
  const triggered = { ...st.grantTriggered }
  const have = new Set(st.grantApplications.map((g) => g.id))
  const fresh: GrantApplication[] = []
  let notes = 0
  const rd = grantSource.get('irs-rd')
  for (const id of new Set(accountIds)) {
    const a = st.accounts.find((x) => x.id === id)
    if (!a || a.status === 'Churned') continue
    const contract = a.contractId ? st.contracts.find((c) => c.id === a.contractId) : undefined
    const p = purchaseFor(a, st.opportunities, contract)
    const opp = p?.opportunityId ? st.opportunities.find((o) => o.id === p.opportunityId) : undefined
    if (p && p.annualCost >= GRANT_MIN_PURCHASE && (opp ? opp.stage !== 'Prospect' : (new Date(p.when).getTime() - today) / 86400000 <= 90)) {
      const best = fundingFor(a, p, changes).find((m) => m.coverage.coverage >= COVERAGE_THRESHOLD && m.coverage.funded >= GRANT_MIN_FUNDED)
      const gid = best && grantApplicationId(best.grant.id, a.id)
      if (best && gid && !have.has(gid) && !triggered[gid]) {
        fresh.push(draftGrantApplication(best.grant, a, p, best.changes))
        triggered[gid] = new Date().toISOString()
      }
    }
    // New sign-ups: a note to take to their accountant about the R&D credit.
    const signup = st.opportunities.find(
      (o) => o.accountId === a.id && (o.type === 'New Logo' || o.type === 'Expansion') && (o.stage === 'Negotiation' || (o.stage === 'Closed Won' && today - new Date(o.stageChangedAt ?? o.closeDate).getTime() < TAX_NOTE_WON_DAYS * 86400000)),
    )
    if (rd && signup) {
      const sp = purchaseFromDeal(a, signup)
      const tid = grantApplicationId(rd.id, a.id)
      if (sp.annualCost >= TAX_NOTE_MIN_PURCHASE && !have.has(tid) && !triggered[tid]) {
        fresh.push(draftGrantApplication(rd, a, sp, []))
        triggered[tid] = new Date().toISOString()
        notes++
      }
    }
  }
  if (fresh.length) set((s) => ({ grantApplications: [...fresh, ...s.grantApplications], grantTriggered: triggered }))
  return { grants: fresh.length - notes, notes }
}

/** One account's unit-economics rank from the live state (used by the price-change drafts). */
function rankFromState(st: Pick<CrmState, 'contracts' | 'pricingModel'>, a: Account) {
  const c = a.contractId ? st.contracts.find((x) => x.id === a.contractId) : undefined
  const r = rankAccount(a, c, st.pricingModel, SEGMENT_FACTORS)
  return r && { ...r, rank: 0 }
}

/** Which tool drafted a price change. Drafts saved before invoices recorded it are told apart by their email's trigger. */
const draftSource = (inv: Invoice, outreach: Outreach[]): 'rank' | 'band' =>
  inv.source ?? (outreach.find((o) => o.id === inv.outreachId)?.trigger.startsWith('Pricing normalization') ? 'band' : 'rank')

const fundingText = (m: { grants: number; notes: number }) =>
  [
    m.grants && `${m.grants === 1 ? 'a grant application that covers' : `${m.grants} grant applications that each cover`} at least half of what the customer is buying from us`,
    m.notes && `${m.notes === 1 ? 'an R&D tax credit note for a new sign-up or expansion' : `${m.notes} R&D tax credit notes for new sign-ups and expansions`}`,
  ]
    .filter(Boolean)
    .join(' and ')

/** After a deal or status change: draft funding for the account, with one grants toast unless the change already raised one (Lucas the Hog's). */
function fundAccount(get: () => CrmState, set: SetState, accountId: string, toastBefore: Toast | null) {
  const made = draftFundingFor(get, set, [accountId], LAW_CHANGES)
  if ((!made.grants && !made.notes) || get().toast !== toastBefore) return
  const name = get().accounts.find((a) => a.id === accountId)?.name ?? 'This account'
  get().notify({ text: `${name}: pre-drafted ${fundingText(made)}. Nothing has been submitted.`, link: { to: '/signals?tab=grants', label: 'Review' }, mark: 'grants' })
}

const accountBefore = (a: Account): WinUndo['account'] => ({ status: a.status, contractId: a.contractId, subscriptions: a.subscriptions, competitor: a.competitor, competitorRenewal: a.competitorRenewal, health: a.health })

/**
 * A deal moved out of Closed Won is no longer won: the standard agreement the win created
 * is void, a contract the win signed goes back to where it was, and the account is as it
 * was before. Wins from before undo records were kept only lose the standard agreement.
 */
function undoWin(get: () => CrmState, set: SetState, o: Opportunity) {
  const st = get()
  const undo = st.wonUndo[o.id]
  const autoId = `C-${o.id}`
  const auto = st.contracts.find((c) => c.id === autoId && c.status === 'Active')
  const a = st.accounts.find((x) => x.id === o.accountId)
  if ((!undo && !auto) || !a) return
  const prev = undo?.account
  const restore = undo?.contract
  const otherActive = st.contracts.filter((c) => c.accountId === a.id && c.id !== autoId && c.status === 'Active').sort((x, y) => y.start.localeCompare(x.start))[0]?.id
  set((s) => {
    const wonUndo = { ...s.wonUndo }
    delete wonUndo[o.id]
    return {
      wonUndo,
      contracts: s.contracts.map((c) => (auto && c.id === auto.id ? { ...c, status: 'Void' as const } : restore && c.id === restore.id ? { ...c, ...restore } : c.id === undo?.replaced ? { ...c, status: 'Active' as const } : c)),
      opportunities: s.opportunities.map((x) => (x.id === o.id && x.contractId === autoId ? { ...x, contractId: undefined } : x)),
      accounts: s.accounts.map((x) =>
        x.id !== a.id ? x : prev ? { ...x, status: prev.status, contractId: prev.contractId, subscriptions: prev.subscriptions, competitor: prev.competitor, competitorRenewal: prev.competitorRenewal, health: prev.health } : x.contractId === autoId ? { ...x, contractId: otherActive } : x,
      ),
    }
  })
  const done = [
    auto && `agreement ${autoId} voided`,
    restore && `contract ${restore.id} back ${restore.status === 'Draft' ? 'to draft' : 'in negotiation'}`,
    undo?.replaced && `agreement ${undo.replaced} active again`,
    prev && prev.status !== a.status && `customer status back to ${prev.status}`,
    prev && 'subscription as it was before the win',
  ].filter(Boolean)
  get().log(a.id, 'Contract', `Deal moved out of Closed Won, so the win is undone: ${done.join('; ')}.`)
}

export const useCrm = create<CrmState>()(
  persist(
    (set, get) => ({
      ...initial(),
      // Email tracking: seeded demo mailboxes are built from the seed book, so they read the same on every load.
      ...createMailSlice(set, get, { accounts: dataset.accounts, contracts: dataset.contracts, opportunities: dataset.opportunities }, CURRENT_USER),
      moveOpp: (id, stage) => {
        const o = get().opportunities.find((x) => x.id === id)
        if (!o || o.stage === stage) return
        const toastBefore = get().toast
        // A deal that closes records when it closed; a closed deal that reopens gets a fresh close date.
        const closeDate = isClosedStage(stage) ? now() : isClosedStage(o.stage) || o.stage === 'On Ice' ? new Date(Date.now() + 60 * 86400000).toISOString() : o.closeDate
        // A reopened deal is no longer lost or parked, so its loss reason goes.
        set((s) => ({ opportunities: s.opportunities.map((x) => (x.id === id ? { ...x, stage, stageChangedAt: now(), closeDate, ...(isOpenStage(stage) ? { reason: undefined } : {}) } : x)) }))
        get().log(o.accountId, 'System', `Opportunity ${o.type} moved ${o.stage} → ${stage}.`)
        if (o.stage === 'Closed Won') undoWin(get, set, o)
        // A lost deal's unsigned contract is void (it no longer counts as in negotiation); reopening revives it.
        const cid = get().opportunities.find((x) => x.id === id)?.contractId
        const deal = cid ? get().contracts.find((x) => x.id === cid) : undefined
        if (deal && stage === 'Closed Lost' && (deal.status === 'Draft' || deal.status === 'In Negotiation')) set((s) => ({ contracts: s.contracts.map((x) => (x.id === deal.id ? { ...x, status: 'Void' } : x)) }))
        if (deal && deal.status === 'Void' && ['Prospect', 'Demo', 'Negotiation'].includes(stage)) set((s) => ({ contracts: s.contracts.map((x) => (x.id === deal.id ? { ...x, status: deal.draft && !deal.draft.approvedAt ? 'Draft' : 'In Negotiation' } : x)) }))
        // Every path into Negotiation (Accounts, the board, anywhere else) goes through here.
        if (stage === 'Negotiation') get().startNegotiation(id)
        if (stage === 'Closed Won') {
          const c = cid ? get().contracts.find((x) => x.id === cid) : undefined
          if (c && c.status !== 'Active') get().signContract(c.id)
          else {
            const before = get().accounts.find((a) => a.id === o.accountId)
            set((s) => ({
              wonUndo: before && !s.wonUndo[o.id] ? { ...s.wonUndo, [o.id]: { account: accountBefore(before) } } : s.wonUndo,
              accounts: s.accounts.map((a) => {
                if (a.id !== o.accountId) return a
                // The won deal's products join the subscription whatever the status was (it can be set to Customer by hand first).
                const subscriptions = withOrder(a, o.products)
                return a.status === 'Customer' ? { ...a, subscriptions } : { ...a, status: 'Customer' as const, subscriptions, competitor: undefined, competitorRenewal: undefined, health: a.health.usage ? a.health : { usage: 60, openTickets: 0, daysLate: 0, nps: 40 } }
              }),
            }))
            // Every won deal has a signed agreement on file: standard terms when none was negotiated.
            const a = get().accounts.find((x) => x.id === o.accountId)
            const active = a?.contractId ? get().contracts.find((x) => x.id === a.contractId && x.status === 'Active') : undefined
            if (a && !active) {
              const nc = standardAgreement(a, o, now())
              set((s) => ({
                contracts: [nc, ...s.contracts.filter((x) => x.id !== nc.id)],
                accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, contractId: nc.id } : x)),
                opportunities: s.opportunities.map((x) => (x.id === o.id ? { ...x, contractId: x.contractId ?? nc.id } : x)),
              }))
              get().log(a.id, 'Contract', `Signed agreement ${nc.id} on standard terms (${TEMPLATE_VERSION}).`)
            }
          }
        }
        fundAccount(get, set, o.accountId, toastBefore)
      },
      setAccountStatus: (accountId, status) => {
        const a = get().accounts.find((x) => x.id === accountId)
        if (!a || a.status === status) return
        const toastBefore = get().toast
        set((s) => ({ accounts: s.accounts.map((x) => (x.id === accountId ? { ...x, status } : x)) }))
        get().log(accountId, 'System', `Customer status changed ${a.status} → ${status}.`)
        fundAccount(get, set, accountId, toastBefore)
      },
      setAccountStage: (accountId, stage) => {
        const s = get()
        const deal = currentDeal(s.opportunities.filter((o) => o.accountId === accountId))
        if (deal) return s.moveOpp(deal.id, stage)
        const a = s.accounts.find((x) => x.id === accountId)
        if (!a) return
        const toastBefore = s.toast
        const o = newOpportunityFor(a, 'Prospect')
        set((st) => ({ opportunities: [o, ...st.opportunities] }))
        get().log(accountId, 'System', `Opportunity ${o.type} created from the Accounts page.`)
        if (stage !== 'Prospect') get().moveOpp(o.id, stage)
        fundAccount(get, set, accountId, toastBefore)
      },
      startNegotiation: (opportunityId) => {
        const s = get()
        const o = s.opportunities.find((x) => x.id === opportunityId)
        if (!o || o.negotiationStartedAt) return null // fires once per deal
        const at = now()
        set((st) => ({ opportunities: st.opportunities.map((x) => (x.id === o.id ? { ...x, negotiationStartedAt: at } : x)) }))
        // Deals that already carry a contract (for example seeded negotiations) keep it.
        if (o.contractId) return null
        const account = s.accounts.find((x) => x.id === o.accountId)
        if (!account) return null
        const contractsById = Object.fromEntries(s.contracts.map((c) => [c.id, c]))
        const { contract, email } = draftNegotiationPackage({
          account,
          opportunity: o,
          activeContract: account.contractId ? contractsById[account.contractId] : undefined,
          customers: s.accounts.filter((x) => x.status === 'Customer'),
          contractsById,
        })
        // Ids derive from the deal, so even a lost flag can't create a second draft.
        if (s.contracts.some((c) => c.id === contract.id)) return contract.id
        set((st) => ({
          contracts: [contract, ...st.contracts],
          opportunities: st.opportunities.map((x) => (x.id === o.id ? { ...x, contractId: contract.id } : x)),
          outreach: st.outreach.some((m) => m.id === email.id) ? st.outreach : [{ ...email, createdAt: at }, ...st.outreach],
        }))
        get().log(account.id, 'Contract', `Lucas the Hog drafted contract ${contract.id} and an intro email for review. Nothing has been sent.`)
        get().notify({ text: `Lucas the Hog drafted a contract and intro email for ${account.name}. Nothing has been sent.`, link: { to: `/contracts/${contract.id}`, label: 'Review drafts' } })
        return contract.id
      },
      updateContract: (id, patch) => set((s) => ({ contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      approveDraft: (contractId) => {
        const c = get().contracts.find((x) => x.id === contractId)
        if (!c?.draft || c.status !== 'Draft') return
        const emailId = c.draft.emailId
        const annual = (c.orderForm ?? []).reduce((sum, l) => sum + l.units * l.unitPrice, 0) * 12
        set((s) => ({
          contracts: s.contracts.map((x) => (x.id === contractId && x.draft ? { ...x, status: 'In Negotiation', draft: { ...x.draft, approvedAt: now() } } : x)),
          // The approved order form is the deal's value from here on.
          opportunities: annual ? s.opportunities.map((o) => (o.id === c.draft!.opportunityId ? { ...o, arr: Math.round(annual) } : o)) : s.opportunities,
        }))
        if (get().outreach.some((m) => m.id === emailId && m.status !== 'Sent')) get().sendOutreach(emailId)
        get().log(c.accountId, 'Contract', `Contract ${c.id} approved and sent to the customer.`)
        get().notify({ text: 'Contract approved and sent. It is now in negotiation with the customer.', link: { to: `/contracts/${c.id}`, label: 'Open contract' } })
      },
      grantApplications: [],
      grantTriggered: {},
      draftGrantsForSignal: (signalId) => {
        const sig = dataset.signals.find((x) => x.id === signalId)
        const ch = sig && regulatoryChange(sig)
        if (!ch) return 0
        const made = draftFundingFor(get, set, affectedAccounts(ch, get().accounts).map((a) => a.id), [ch])
        set((s) => ({ grantTriggered: { ...s.grantTriggered, [signalId]: now() } }))
        return made.grants
      },
      runGrantTrigger: () => {
        const st = get()
        // Grants are tied to what customers buy from us: every account with a qualifying purchase is checked
        // once per program. Rule changes add context but don't decide on their own.
        const made = draftFundingFor(get, set, st.accounts.map((a) => a.id), LAW_CHANGES)
        if (!made.grants && !made.notes) return
        get().notify({
          text: `Pre-drafted ${fundingText(made)}. Nothing has been submitted.`,
          link: { to: '/signals?tab=grants', label: 'Review' },
          mark: 'grants',
        })
      },
      addGrantApplication: (grantId, accountId, signalIds) => {
        const st = get()
        const g = grantSource.get(grantId)
        const a = st.accounts.find((x) => x.id === accountId)
        if (!g || !a) return null
        const id = grantApplicationId(grantId, accountId)
        if (st.grantApplications.some((x) => x.id === id)) return id
        const p = purchaseFor(a, st.opportunities, a.contractId ? st.contracts.find((c) => c.id === a.contractId) : undefined)
        if (!p) return null
        const changes = dataset.signals.filter((x) => signalIds.includes(x.id)).map(regulatoryChange).filter((c) => !!c)
        set((s) => ({ grantApplications: [draftGrantApplication(g, a, p, changes), ...s.grantApplications], grantTriggered: { ...s.grantTriggered, [id]: now() } }))
        return id
      },
      updateGrantApplication: (id, patch) => set((s) => ({ grantApplications: s.grantApplications.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: now() } : g)) })),
      setGrantSection: (id, section, text) =>
        set((s) => ({
          grantApplications: s.grantApplications.map((g) => {
            if (g.id !== id) return g
            const edits = { ...g.edits }
            if (text === null) delete edits[section]
            else edits[section] = text
            return { ...g, edits, updatedAt: now() }
          }),
        })),
      setGrantStatus: (id, status) => {
        const g = get().grantApplications.find((x) => x.id === id)
        if (!g) return
        set((s) => ({ grantApplications: s.grantApplications.map((x) => (x.id === id ? { ...x, status, reviewedAt: status === 'Reviewed' ? now() : undefined } : x)) }))
        if (status === 'Reviewed') get().log(g.accountId, 'Note', `Grant application ${grantSource.get(g.grantId)?.shortName ?? g.grantId} reviewed and ready to share with the customer. Not submitted.`)
      },
      discardGrantApplication: (id) => set((s) => ({ grantApplications: s.grantApplications.filter((g) => g.id !== id) })),
      pricingModel: DEFAULT_MODEL,
      setPricingModel: (patch) => {
        set((s) => ({ pricingModel: { ...s.pricingModel, ...patch } }))
        get().refreshPriceDrafts()
      },
      setSegmentTarget: (key, value) => {
        set((s) => {
          const segmentTargets = { ...s.pricingModel.segmentTargets }
          if (value === null) delete segmentTargets[key]
          else segmentTargets[key] = value
          return { pricingModel: { ...s.pricingModel, segmentTargets } }
        })
        get().refreshPriceDrafts()
      },
      resetPricingModel: () => {
        set({ pricingModel: DEFAULT_MODEL })
        get().refreshPriceDrafts()
      },
      priceList: {},
      setListPrice: (productId, price) => {
        const next = { ...get().priceList }
        if (price === null) delete next[productId]
        else next[productId] = price
        applyPriceList(next)
        set({ priceList: next })
        get().refreshPriceDrafts()
      },
      resetPriceList: () => {
        applyPriceList({})
        set({ priceList: {} })
        get().refreshPriceDrafts()
      },
      invoices: [],
      draftPriceChanges: (accountIds) => {
        const st = get()
        const counts = { created: 0, updated: 0, kept: 0, skipped: 0 }
        const addOutreach: Outreach[] = []
        const addInvoices: Invoice[] = []
        const outreachPatch = new Map<string, Partial<Outreach>>()
        const invoicePatch = new Map<string, Invoice>()
        const taken = new Set(st.invoices.map((i) => i.id))
        for (const id of accountIds) {
          const a = st.accounts.find((x) => x.id === id)
          const r = a && a.status === 'Customer' ? rankFromState(st, a) : null
          const d = r && draftPriceChange(r)
          if (!d) {
            counts.skipped++
            continue
          }
          // A change already sent and not yet in effect: nothing new to draft.
          if (st.invoices.some((i) => i.accountId === id && i.status === 'Sent' && !i.appliedAt)) {
            counts.skipped++
            continue
          }
          // One open price change per account: redrafting updates it instead of adding another.
          const open = st.invoices.find((i) => i.accountId === id && i.status === 'Draft')
          if (open) {
            const email = st.outreach.find((o) => o.id === open.outreachId)
            // A band-check notice, or an email edited by hand, isn't overwritten.
            if (draftSource(open, st.outreach) === 'band' || (email && (email.subject !== open.emailGenerated.subject || email.body !== open.emailGenerated.body))) {
              counts.kept++
              continue
            }
            invoicePatch.set(open.id, { ...open, ...d.invoice, id: open.id, source: 'rank', updatedAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body }, stale: false })
            if (email) outreachPatch.set(email.id, { subject: d.email.subject, body: d.email.body, trigger: d.email.trigger, contactName: d.email.contactName, contactEmail: d.email.contactEmail, auto: d.email.auto })
            counts.updated++
            continue
          }
          let invId = d.invoice.id
          for (let n = 2; taken.has(invId); n++) invId = `${d.invoice.id}-${n}`
          taken.add(invId)
          const oid = uid('M')
          addOutreach.push({ ...d.email, id: oid, createdAt: now(), status: 'Draft', invoiceId: invId })
          addInvoices.push({ ...d.invoice, id: invId, source: 'rank', outreachId: oid, createdAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body } })
          counts.created++
        }
        set((s) => ({
          outreach: [...addOutreach, ...s.outreach.map((o) => (outreachPatch.has(o.id) ? { ...o, ...outreachPatch.get(o.id) } : o))],
          invoices: [...addInvoices, ...s.invoices.map((i) => invoicePatch.get(i.id) ?? i)],
        }))
        return counts
      },
      refreshPriceDrafts: () => {
        const st = get()
        // Only Pricing rank drafts follow the model; band-check notices stay as the user saved them.
        const open = st.invoices.filter((i) => i.status === 'Draft' && draftSource(i, st.outreach) === 'rank')
        if (!open.length) return
        const outreachPatch = new Map<string, Partial<Outreach>>()
        const invoicePatch = new Map<string, Invoice>()
        for (const inv of open) {
          const a = st.accounts.find((x) => x.id === inv.accountId)
          const email = st.outreach.find((o) => o.id === inv.outreachId)
          const r = a ? rankFromState(st, a) : null
          const d = r && draftPriceChange(r)
          const edited = !!email && (email.subject !== inv.emailGenerated.subject || email.body !== inv.emailGenerated.body)
          if (!d || edited) {
            invoicePatch.set(inv.id, { ...inv, source: 'rank', stale: true })
            continue
          }
          invoicePatch.set(inv.id, { ...inv, ...d.invoice, id: inv.id, source: 'rank', updatedAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body }, stale: false })
          if (email) outreachPatch.set(email.id, { subject: d.email.subject, body: d.email.body, trigger: d.email.trigger, auto: d.email.auto })
        }
        set((s) => ({
          outreach: s.outreach.map((o) => (outreachPatch.has(o.id) ? { ...o, ...outreachPatch.get(o.id) } : o)),
          invoices: s.invoices.map((i) => invoicePatch.get(i.id) ?? i),
        }))
      },
      approvePriceChange: (outreachId) => {
        const st = get()
        const o = st.outreach.find((x) => x.id === outreachId)
        const inv = o?.invoiceId ? st.invoices.find((i) => i.id === o.invoiceId) : undefined
        if (!o || !inv || o.status !== 'Draft' || inv.status !== 'Draft') return
        st.sendOutreach(o.id)
        const pct = inv.previousTotal ? (inv.total / inv.previousTotal - 1) * 100 : 0
        set((s) => ({
          invoices: s.invoices.map((i) => (i.id === inv.id ? { ...i, status: 'Sent', sentAt: now() } : i)),
          priceProposals: { ...s.priceProposals, [inv.accountId]: { pct, effectiveDate: inv.issueDate, createdAt: now() } },
        }))
        get().log(inv.accountId, 'Pricing', `Price change approved: +${pct.toFixed(1)}% from ${new Date(inv.issueDate).toLocaleDateString()}. Invoice ${inv.id} ($${inv.total.toLocaleString('en-US')}/mo) sent with the notice email.`)
      },
      pushPriceChange: (d, send) => {
        const taken = new Set(get().invoices.map((i) => i.id))
        let invId = d.invoice.id
        for (let n = 2; taken.has(invId); n++) invId = `${d.invoice.id}-${n}`
        const oid = uid('M')
        // A new notice replaces any open price-change draft for the account.
        const stale = get().invoices.filter((i) => i.accountId === d.invoice.accountId && i.status === 'Draft')
        set((s) => ({
          outreach: [{ ...d.email, id: oid, createdAt: now(), status: 'Draft', invoiceId: invId }, ...s.outreach.map((o) => (stale.some((i) => i.outreachId === o.id) && o.status === 'Draft' ? { ...o, status: 'Skipped' as const } : o))],
          invoices: [{ ...d.invoice, id: invId, source: 'band', outreachId: oid, createdAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body } }, ...s.invoices.map((i) => (stale.includes(i) ? { ...i, status: 'Void' as const } : i))],
        }))
        if (send) get().approvePriceChange(oid)
        return oid
      },
      applyDuePriceChanges: () => {
        const due = get().invoices.filter((i) => i.status === 'Sent' && !i.appliedAt && new Date(i.issueDate).getTime() <= Date.now())
        if (!due.length) return
        const at = now()
        set((s) => ({
          accounts: s.accounts.map((a) => {
            const inv = due.find((i) => i.accountId === a.id)
            if (!inv) return a
            const price = new Map(inv.lines.map((l) => [l.productId, l.unitPrice]))
            return { ...a, subscriptions: a.subscriptions.map((x) => (price.has(x.productId) ? { ...x, unitPrice: price.get(x.productId)! } : x)) }
          }),
          invoices: s.invoices.map((i) => (due.includes(i) ? { ...i, appliedAt: at } : i)),
        }))
        for (const inv of due) get().log(inv.accountId, 'Pricing', `New pricing from invoice ${inv.id} took effect ($${inv.total.toLocaleString('en-US')}/mo).`)
      },
      skipOutreach: (id) => {
        const o = get().outreach.find((x) => x.id === id)
        if (!o) return
        set((s) => ({
          outreach: s.outreach.map((x) => (x.id === id ? { ...x, status: 'Skipped' } : x)),
          invoices: o.invoiceId ? s.invoices.map((i) => (i.id === o.invoiceId && i.status === 'Draft' ? { ...i, status: 'Void' } : i)) : s.invoices,
        }))
      },
      trips: [],
      addTrip: (t) => {
        const id = uid('TR')
        set((s) => ({ trips: [...s.trips, { ...t, id, createdAt: now() }].sort((a, b) => a.start.localeCompare(b.start)) }))
        return id
      },
      removeTrip: (id) => set((s) => ({ trips: s.trips.filter((t) => t.id !== id) })),
      salesTargets: {},
      setSalesTarget: (month, value) => set((s) => ({ salesTargets: { ...s.salesTargets, [month]: value } })),
      toast: null,
      notify: (t) => set({ toast: { ...t, id: uid('T') } }),
      dismissToast: () => set({ toast: null }),
      log: (accountId, kind, text) => set((s) => ({ activities: [{ id: uid('V'), accountId, date: now(), author: CURRENT_USER, kind, text }, ...s.activities] })),
      queueOutreach: (o) => {
        const id = uid('M')
        const status = o.status ?? (get().autoSend[o.playbook] ? 'Sent' : 'Draft')
        const item: Outreach = { ...o, id, createdAt: now(), status, sentAt: status === 'Sent' ? now() : undefined }
        set((s) => ({ outreach: [item, ...s.outreach] }))
        if (status === 'Sent') get().log(o.accountId, 'Email', `Auto-sent "${o.subject}" to ${o.contactName} (playbook: ${o.playbook}).`)
        return id
      },
      updateOutreach: (id, patch) => set((s) => ({ outreach: s.outreach.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),
      sendOutreach: (id) => {
        const o = get().outreach.find((x) => x.id === id)
        if (!o) return
        set((s) => ({ outreach: s.outreach.map((x) => (x.id === id ? { ...x, status: 'Sent', sentAt: now() } : x)) }))
        get().log(o.accountId, 'Email', `Sent "${o.subject}" to ${o.contactName}.`)
      },
      setAutoSend: (playbook, on) => set((s) => ({ autoSend: { ...s.autoSend, [playbook]: on } })),
      setReview: (contractId, r) => set((s) => ({ reviews: { ...s.reviews, [contractId]: r } })),
      setDecision: (contractId, redlineId, d) => set((s) => ({ decisions: { ...s.decisions, [contractId]: { ...(s.decisions[contractId] ?? {}), [redlineId]: d } } })),
      appendChat: (contractId, m) => set((s) => ({ chats: { ...s.chats, [contractId]: [...(s.chats[contractId] ?? []), m] } })),
      setChat: (contractId, msgs) => set((s) => ({ chats: { ...s.chats, [contractId]: msgs } })),
      proposePrice: (accountId, pct, effectiveDate) => {
        set((s) => ({ priceProposals: { ...s.priceProposals, [accountId]: { pct, effectiveDate, createdAt: now() } } }))
        get().log(accountId, 'Pricing', `Price adjustment of +${pct.toFixed(1)}% proposed, effective ${new Date(effectiveDate).toLocaleDateString()}.`)
      },
      signContract: (contractId) => {
        const c = get().contracts.find((x) => x.id === contractId)
        if (!c || c.status === 'Active') return // signing twice would reset the term
        const opp = (c.opportunityId && get().opportunities.find((o) => o.id === c.opportunityId)) || get().opportunities.find((o) => o.contractId === contractId)
        const at = now()
        const end = new Date(at)
        end.setMonth(end.getMonth() + c.termMonths)
        const account = get().accounts.find((a) => a.id === c.accountId)
        const toastBefore = get().toast
        // A signed renewal replaces the agreement it renews.
        const replaces = opp?.type === 'Renewal' && account?.contractId && account.contractId !== contractId ? account.contractId : undefined
        const undo: WinUndo | undefined = opp && account && !get().wonUndo[opp.id] ? { account: accountBefore(account), contract: { id: c.id, status: c.status, start: c.start, end: c.end }, replaced: replaces } : undefined
        set((s) => ({
          wonUndo: undo && opp ? { ...s.wonUndo, [opp.id]: undo } : s.wonUndo,
          contracts: s.contracts.map((x) => (x.id === contractId ? { ...x, status: 'Active', start: at, end: end.toISOString() } : x.id === replaces ? { ...x, status: 'Expired' } : x)),
          // Only the deal this contract belongs to closes, and it records when.
          opportunities: s.opportunities.map((o) => (o.id === opp?.id ? { ...o, stage: 'Closed Won', stageChangedAt: at, closeDate: at } : o)),
          accounts: s.accounts.map((a) => {
            if (a.id !== c.accountId) return a
            // Signed prices come from the contract's order form when it has one.
            const subs = withOrder(a, opp?.products ?? [], c.orderForm)
            const keep = a.status === 'Customer' && a.contractId && !replaces
            return { ...a, status: 'Customer', contractId: keep ? a.contractId : contractId, subscriptions: subs, competitor: undefined, competitorRenewal: undefined, health: a.health.usage ? a.health : { usage: 60, openTickets: 0, daysLate: 0, nps: 40 } }
          }),
        }))
        get().log(c.accountId, 'Contract', `Contract ${c.id} signed. Opportunity closed won.${replaces ? ` It replaces ${replaces}.` : ''}`)
        fundAccount(get, set, c.accountId, toastBefore)
      },
      resetAll: () => {
        applyPriceList({})
        set({ ...initial(), toast: null })
      },
    }),
    {
      name: 'herdbook-crm',
      version: SEED_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => migrateState(persisted, version) as unknown as CrmState,
      partialize: (s) => ({ accounts: s.accounts, contracts: s.contracts, opportunities: s.opportunities, outreach: s.outreach, activities: s.activities, reviews: s.reviews, decisions: s.decisions, chats: s.chats, autoSend: s.autoSend, priceProposals: s.priceProposals, wonUndo: s.wonUndo, grantApplications: s.grantApplications, grantTriggered: s.grantTriggered, pricingModel: s.pricingModel, priceList: s.priceList, invoices: s.invoices, trips: s.trips, salesTargets: s.salesTargets, mailboxes: s.mailboxes, mailRecords: s.mailRecords, mailProposals: s.mailProposals, signedCopies: s.signedCopies }),
      // The saved price list replaces the base list prices everywhere they're read.
      onRehydrateStorage: () => (state) => {
        if (state?.priceList) applyPriceList(state.priceList)
        // Drafts saved under an older pricing model are redrafted under the current one (hand-edited ones are flagged instead).
        if (state && redraftAfterLoad) {
          redraftAfterLoad = false
          state.refreshPriceDrafts()
        }
      },
    },
  ),
)
