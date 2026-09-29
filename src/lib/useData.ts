import { useMemo } from 'react'
import type { Account, Contract, Opportunity, Signal } from '../types'
import { dataset, useCrm } from '../store'
import { analyzePricing, type PricingAnalysis } from './pricing'
import { rankOpportunities, type RankedOpp } from './scoring'

// Weather (src/lib/weather.ts, Open-Meteo) is intentionally not loaded here any more:
// no page shows it right now. The integration is kept for the newsletter to reuse.

export const signals: Signal[] = dataset.signals
export const signalsByAccount: Record<string, Signal[]> = {}
for (const s of signals) if (s.accountId) (signalsByAccount[s.accountId] ??= []).push(s)

export interface Book {
  accounts: Account[]
  byId: Record<string, Account>
  contracts: Contract[]
  contractById: Record<string, Contract>
  opportunities: Opportunity[]
  customers: Account[]
  pricing: Record<string, PricingAnalysis>
  ranked: RankedOpp[]
}

let cache: { key: unknown[]; book: Book } | undefined

function build(accounts: Account[], contracts: Contract[], opportunities: Opportunity[]): Book {
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const contractById = Object.fromEntries(contracts.map((c) => [c.id, c]))
  const customers = accounts.filter((a) => a.status === 'Customer')
  const pricing: Record<string, PricingAnalysis> = {}
  for (const a of customers) pricing[a.id] = analyzePricing(a, a.contractId ? contractById[a.contractId] : undefined, customers, contractById)
  const ranked = rankOpportunities(opportunities, byId, contractById, signalsByAccount, pricing)
  return { accounts, byId, contracts, contractById, opportunities, customers, pricing, ranked }
}

export function useBook(): Book {
  const accounts = useCrm((s) => s.accounts)
  const contracts = useCrm((s) => s.contracts)
  const opportunities = useCrm((s) => s.opportunities)
  return useMemo(() => {
    const key = [accounts, contracts, opportunities]
    if (cache && cache.key.every((k, i) => k === key[i])) return cache.book
    const book = build(accounts, contracts, opportunities)
    cache = { key, book }
    return book
  }, [accounts, contracts, opportunities])
}
