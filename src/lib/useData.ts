import { useMemo } from 'react'
import type { Account, Contract, Opportunity, Signal } from '../types'
import { dataset, useCrm } from '../store'
import { analyzePricing, type PricingAnalysis } from './pricing'
import { rankOpportunities, type RankedOpp } from './scoring'
import { lawChangesFrom, type RegulatoryChange } from './grants'

// Weather (src/lib/weather.ts, Open-Meteo) loads on demand in Signals and newsletter
// (src/lib/weatherImpact.ts), not here, so other pages never wait on it.

export const signals: Signal[] = dataset.signals
export const signalsByAccount: Record<string, Signal[]> = {}
for (const s of signals) if (s.accountId) (signalsByAccount[s.accountId] ??= []).push(s)

/** Regional regulatory and law changes (market-wide Regulatory signals) with their grant mapping. */
export const lawChanges: RegulatoryChange[] = lawChangesFrom(signals)
export const lawChangeBySignal: Record<string, RegulatoryChange> = Object.fromEntries(lawChanges.map((c) => [c.signal.id, c]))

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
  // List prices feed the pricing analysis, so an edited price list rebuilds the book.
  const priceList = useCrm((s) => s.priceList)
  return useMemo(() => {
    const key = [accounts, contracts, opportunities, priceList]
    if (cache && cache.key.every((k, i) => k === key[i])) return cache.book
    const book = build(accounts, contracts, opportunities)
    cache = { key, book }
    return book
  }, [accounts, contracts, opportunities, priceList])
}
