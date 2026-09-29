import { useMemo } from 'react'
import type { Account, Contract, Opportunity, Signal } from '../types'
import { dataset, useCrm } from '../store'
import { analyzePricing, type PricingAnalysis } from './pricing'
import { assessWeather, useWeather, type WeatherRisk, type WeatherState } from './weather'
import { accountHealth, rankOpportunities, type Health, type RankedOpp } from './scoring'

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
  weatherRisk: Record<string, WeatherRisk>
  health: Record<string, Health>
  ranked: RankedOpp[]
  weather: WeatherState
}

let cache: { key: unknown[]; book: Book } | undefined

function build(accounts: Account[], contracts: Contract[], opportunities: Opportunity[], weather: WeatherState): Book {
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const contractById = Object.fromEntries(contracts.map((c) => [c.id, c]))
  const customers = accounts.filter((a) => a.status === 'Customer')
  const pricing: Record<string, PricingAnalysis> = {}
  for (const a of customers) pricing[a.id] = analyzePricing(a, a.contractId ? contractById[a.contractId] : undefined, customers, contractById)
  const weatherRisk: Record<string, WeatherRisk> = {}
  const health: Record<string, Health> = {}
  for (const a of accounts) {
    weatherRisk[a.id] = assessWeather(weather.byState[a.state], a.segment, a.species)
    if (a.status === 'Customer') health[a.id] = accountHealth(a, weatherRisk[a.id].risk)
  }
  const ranked = rankOpportunities(opportunities, byId, contractById, signalsByAccount, pricing)
  return { accounts, byId, contracts, contractById, opportunities, customers, pricing, weatherRisk, health, ranked, weather }
}

export function useBook(): Book {
  const accounts = useCrm((s) => s.accounts)
  const contracts = useCrm((s) => s.contracts)
  const opportunities = useCrm((s) => s.opportunities)
  const weather = useWeather(dataset.accounts)
  return useMemo(() => {
    const key = [accounts, contracts, opportunities, weather]
    if (cache && cache.key.every((k, i) => k === key[i])) return cache.book
    const book = build(accounts, contracts, opportunities, weather)
    cache = { key, book }
    return book
  }, [accounts, contracts, opportunities, weather])
}
