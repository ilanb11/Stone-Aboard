import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Account, Activity, Contract, Opportunity, OppStage, Outreach } from './types'
import { generateDataset, SEED_VERSION } from './data/generate'
import { PRODUCT, unitsFor } from './data/products'
import { expectedDiscount } from './lib/pricing'
import type { LucasReview } from './lib/lucas'

// Deterministic seed data. Signals are reference data; everything else is
// user-editable CRM state persisted in localStorage.
export const dataset = generateDataset()
export const CURRENT_USER = 'Avery Collins'

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
})

export const useCrm = create<CrmState>()(
  persist(
    (set, get) => ({
      ...initial(),
      moveOpp: (id, stage) => {
        const o = get().opportunities.find((x) => x.id === id)
        if (!o || o.stage === stage) return
        set((s) => ({ opportunities: s.opportunities.map((x) => (x.id === id ? { ...x, stage } : x)) }))
        get().log(o.accountId, 'System', `Opportunity ${o.type} moved ${o.stage} → ${stage}.`)
      },
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
            const have = new Set(a.subscriptions.map((x) => x.productId))
            const add = (opp?.products ?? []).filter((p) => !have.has(p))
            const listM = add.reduce((sum, p) => sum + unitsFor(p, a) * PRODUCT[p].listPrice, 0)
            const d = expectedDiscount(listM)
            const subs = [...a.subscriptions, ...add.map((p) => ({ productId: p, units: unitsFor(p, a), unitPrice: Math.round(PRODUCT[p].listPrice * (1 - d) * 100) / 100 }))]
            return { ...a, status: 'Customer', contractId: a.status === 'Customer' && a.contractId ? a.contractId : contractId, subscriptions: subs, health: a.health.usage ? a.health : { usage: 60, openTickets: 0, daysLate: 0, nps: 40 } }
          }),
        }))
        get().log(c.accountId, 'Contract', `Contract ${c.id} signed. Opportunity closed won.`)
      },
      resetAll: () => set(initial()),
    }),
    {
      name: 'herdbook-crm',
      version: SEED_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: () => initial() as unknown as CrmState,
      partialize: (s) => ({ accounts: s.accounts, contracts: s.contracts, opportunities: s.opportunities, outreach: s.outreach, activities: s.activities, reviews: s.reviews, decisions: s.decisions, chats: s.chats, autoSend: s.autoSend, priceProposals: s.priceProposals }),
    },
  ),
)
