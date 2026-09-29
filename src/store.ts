import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Account, Activity, Contract, GrantApplication, GrantSectionId, Invoice, Opportunity, OppStage, OrderLine, Outreach } from './types'
import { generateDataset, SEED_VERSION } from './data/generate'
import { PRODUCT, applyPriceList, unitsFor } from './data/products'
import { expectedDiscount } from './lib/pricing'
import type { LucasReview } from './lib/lucas'
import { draftNegotiationPackage } from './lib/lucasDrafts'
import { currentDeal, newOpportunityFor } from './lib/pipeline'
import { affectedAccounts, grantSource, grantsForChange, rankGrants, regulatoryChange } from './lib/grants'
import { draftGrantApplication, grantApplicationId } from './lib/grantDrafts'
import { DEFAULT_MODEL, calibrateFactors, rankAccount, type PricingModel } from './lib/unitPricing'
import { draftPriceChange } from './lib/priceChangeDrafts'

// Deterministic seed data. Signals are reference data; everything else is
// user-editable CRM state persisted in localStorage.
export const dataset = generateDataset()
export const CURRENT_USER = 'Avery Collins'
/** Segment price factors for the unit-economics model, calibrated once from the seeded book. */
export const SEGMENT_FACTORS = calibrateFactors(dataset.accounts.filter((a) => a.status === 'Customer'))

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
 */
function migrateState(persisted: unknown, version: number) {
  const p = persisted as Partial<Persisted> | undefined
  if (!p?.accounts || !p.opportunities || version < 13) return initial()
  const seedAccount = Object.fromEntries(dataset.accounts.map((a) => [a.id, a]))
  // Accounts the user has worked keep their own contact dates.
  const workedByUser = new Set((p.activities ?? []).filter((v) => v.author === CURRENT_USER).map((v) => v.accountId))
  const accounts = mergeById(
    p.accounts.map((a) => {
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
  return {
    ...initial(),
    ...p,
    accounts,
    contracts: mergeById(p.contracts ?? [], dataset.contracts),
    opportunities,
    outreach: mergeById(p.outreach ?? [], dataset.outreach),
    activities: mergeById(
      (p.activities ?? []).map((v) => (version < 16 && v.id.startsWith('V-') && seedNote[v.id] && !workedByUser.has(v.accountId) ? { ...v, date: seedNote[v.id].date } : v)),
      dataset.activities,
    ),
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

interface CrmState {
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
  updateGrantApplication: (id: string, patch: Partial<Pick<GrantApplication, 'practices'>>) => void
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
  /** Skip an outreach draft; a price-change invoice attached to it is voided. */
  skipOutreach: (id: string) => void
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
  grantApplications: [] as GrantApplication[],
  grantTriggered: {} as Record<string, string>,
  pricingModel: DEFAULT_MODEL,
  priceList: {} as Record<string, number>,
  invoices: [] as Invoice[],
})

/** One account's unit-economics rank from the live state (used by the price-change drafts). */
function rankFromState(st: Pick<CrmState, 'contracts' | 'pricingModel'>, a: Account) {
  const c = a.contractId ? st.contracts.find((x) => x.id === a.contractId) : undefined
  const r = rankAccount(a, c, st.pricingModel, SEGMENT_FACTORS)
  return r && { ...r, rank: 0 }
}

export const useCrm = create<CrmState>()(
  persist(
    (set, get) => ({
      ...initial(),
      moveOpp: (id, stage) => {
        const o = get().opportunities.find((x) => x.id === id)
        if (!o || o.stage === stage) return
        set((s) => ({ opportunities: s.opportunities.map((x) => (x.id === id ? { ...x, stage, stageChangedAt: now() } : x)) }))
        get().log(o.accountId, 'System', `Opportunity ${o.type} moved ${o.stage} → ${stage}.`)
        // Every path into Negotiation (Accounts, the board, anywhere else) goes through here.
        if (stage === 'Negotiation') get().startNegotiation(id)
        if (stage === 'Closed Won') {
          const c = o.contractId ? get().contracts.find((x) => x.id === o.contractId) : undefined
          if (c && c.status !== 'Active') get().signContract(c.id)
          else
            set((s) => ({
              accounts: s.accounts.map((a) =>
                a.id === o.accountId && a.status !== 'Customer'
                  ? { ...a, status: 'Customer', subscriptions: withOrder(a, o.products), competitor: undefined, competitorRenewal: undefined, health: a.health.usage ? a.health : { usage: 60, openTickets: 0, daysLate: 0, nps: 40 } }
                  : a,
              ),
            }))
        }
      },
      setAccountStage: (accountId, stage) => {
        const s = get()
        const deal = currentDeal(s.opportunities.filter((o) => o.accountId === accountId))
        if (deal) return s.moveOpp(deal.id, stage)
        const a = s.accounts.find((x) => x.id === accountId)
        if (!a) return
        const o = newOpportunityFor(a, 'Prospect')
        set((st) => ({ opportunities: [o, ...st.opportunities] }))
        get().log(accountId, 'System', `Opportunity ${o.type} created from the Accounts page.`)
        if (stage !== 'Prospect') get().moveOpp(o.id, stage)
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
        const st = get()
        if (!ch) return 0
        const grants = grantsForChange(ch)
        const have = new Map(st.grantApplications.map((g) => [g.id, g]))
        const fresh: GrantApplication[] = []
        const linked = new Set<string>()
        for (const a of affectedAccounts(ch, st.accounts)) {
          const g = rankGrants(grants, a, ch.topics)[0]
          if (!g) continue
          const id = grantApplicationId(g.id, a.id)
          if (have.has(id)) linked.add(id)
          else fresh.push(draftGrantApplication(g, a, [ch]))
        }
        set((s) => ({
          grantApplications: [...fresh, ...s.grantApplications.map((g) => (linked.has(g.id) && !g.signalIds.includes(signalId) ? { ...g, signalIds: [...g.signalIds, signalId] } : g))],
          grantTriggered: { ...s.grantTriggered, [signalId]: now() },
        }))
        return fresh.length
      },
      runGrantTrigger: () => {
        const cut = Date.now() - GRANT_TRIGGER_DAYS * 86400000
        const due = dataset.signals.filter((x) => new Date(x.date).getTime() >= cut && !get().grantTriggered[x.id] && regulatoryChange(x))
        if (!due.length) return
        const counts = due.map((x) => [x, get().draftGrantsForSignal(x.id)] as const).filter(([, n]) => n > 0)
        const made = counts.reduce((n, [, c]) => n + c, 0)
        if (!made) return
        const states = [...new Set(counts.map(([x]) => x.state!))]
        get().notify({
          text: `Pre-drafted ${made} grant ${made === 1 ? 'application' : 'applications'} for ${counts.length} new rule ${counts.length === 1 ? 'change' : 'changes'} (${states.join(', ')}). Nothing has been submitted.`,
          link: { to: '/signals?tab=grants', label: 'Review applications' },
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
        const changes = dataset.signals.filter((x) => signalIds.includes(x.id)).map(regulatoryChange).filter((c) => !!c)
        set((s) => ({ grantApplications: [draftGrantApplication(g, a, changes), ...s.grantApplications] }))
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
          // One open price change per account: redrafting updates it instead of adding another.
          const open = st.invoices.find((i) => i.accountId === id && i.status === 'Draft')
          if (open) {
            const email = st.outreach.find((o) => o.id === open.outreachId)
            if (email && (email.subject !== open.emailGenerated.subject || email.body !== open.emailGenerated.body)) {
              counts.kept++ // the email was edited by hand, so it isn't overwritten
              continue
            }
            invoicePatch.set(open.id, { ...open, ...d.invoice, id: open.id, updatedAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body }, stale: false })
            if (email) outreachPatch.set(email.id, { subject: d.email.subject, body: d.email.body, trigger: d.email.trigger, contactName: d.email.contactName, contactEmail: d.email.contactEmail, auto: d.email.auto })
            counts.updated++
            continue
          }
          let invId = d.invoice.id
          for (let n = 2; taken.has(invId); n++) invId = `${d.invoice.id}-${n}`
          taken.add(invId)
          const oid = uid('M')
          addOutreach.push({ ...d.email, id: oid, createdAt: now(), status: 'Draft', invoiceId: invId })
          addInvoices.push({ ...d.invoice, id: invId, outreachId: oid, createdAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body } })
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
        const open = st.invoices.filter((i) => i.status === 'Draft')
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
            invoicePatch.set(inv.id, { ...inv, stale: true })
            continue
          }
          invoicePatch.set(inv.id, { ...inv, ...d.invoice, id: inv.id, updatedAt: now(), emailGenerated: { subject: d.email.subject, body: d.email.body }, stale: false })
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
      skipOutreach: (id) => {
        const o = get().outreach.find((x) => x.id === id)
        if (!o) return
        set((s) => ({
          outreach: s.outreach.map((x) => (x.id === id ? { ...x, status: 'Skipped' } : x)),
          invoices: o.invoiceId ? s.invoices.map((i) => (i.id === o.invoiceId && i.status === 'Draft' ? { ...i, status: 'Void' } : i)) : s.invoices,
        }))
      },
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
        if (!c) return
        const opp = get().opportunities.find((o) => o.contractId === contractId)
        set((s) => ({
          contracts: s.contracts.map((x) => (x.id === contractId ? { ...x, status: 'Active', start: now() } : x)),
          opportunities: s.opportunities.map((o) => (o.contractId === contractId ? { ...o, stage: 'Closed Won' } : o)),
          accounts: s.accounts.map((a) => {
            if (a.id !== c.accountId) return a
            // Signed prices come from the contract's order form when it has one.
            const subs = withOrder(a, opp?.products ?? [], c.orderForm)
            return { ...a, status: 'Customer', contractId: a.status === 'Customer' && a.contractId ? a.contractId : contractId, subscriptions: subs, competitor: undefined, competitorRenewal: undefined, health: a.health.usage ? a.health : { usage: 60, openTickets: 0, daysLate: 0, nps: 40 } }
          }),
        }))
        get().log(c.accountId, 'Contract', `Contract ${c.id} signed. Opportunity closed won.`)
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
      partialize: (s) => ({ accounts: s.accounts, contracts: s.contracts, opportunities: s.opportunities, outreach: s.outreach, activities: s.activities, reviews: s.reviews, decisions: s.decisions, chats: s.chats, autoSend: s.autoSend, priceProposals: s.priceProposals, grantApplications: s.grantApplications, grantTriggered: s.grantTriggered, pricingModel: s.pricingModel, priceList: s.priceList, invoices: s.invoices }),
      // The saved price list replaces the base list prices everywhere they're read.
      onRehydrateStorage: () => (state) => {
        if (state?.priceList) applyPriceList(state.priceList)
      },
    },
  ),
)
