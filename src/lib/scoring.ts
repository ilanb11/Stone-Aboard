import type { Account, Contract, Opportunity, Segment, Signal, SignalType } from '../types'
import { OPEN_OPP_STAGES } from '../types'
import type { PricingAnalysis } from './pricing'

const DAY = 86400000
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const daysFrom = (iso: string) => (new Date(iso).getTime() - Date.now()) / DAY

const SEGMENT_FIT: Record<Segment, number> = {
  'Integrated System': 100, 'Sow Farm': 85, 'Farrow-to-Finish': 80, 'Wean-to-Finish': 72, 'Contract Finisher': 55,
  Dairy: 80, Feedlot: 78, 'Stocker / Backgrounder': 50, 'Cow-Calf': 45,
}
const INTENT_W: Record<SignalType, number> = {
  Expansion: 40, 'Ownership Change': 35, 'Leadership Change': 30, 'Integrator / Packer Change': 22, Financial: 15, Biosecurity: 12, Regulatory: 12, Contraction: 10,
}
const STAGE_TIMING: Record<string, number> = { Identified: 10, Qualified: 25, Proposal: 40, Negotiation: 55 }

export interface RankedOpp {
  key: string
  opp?: Opportunity
  account: Account
  type: Opportunity['type']
  stage: Opportunity['stage'] | 'Recommended'
  arr: number
  score: number
  priority: number
  factors: { fit: number; intent: number; timing: number; relationship: number }
  reasons: string[]
}

export function rankOpportunities(
  opps: Opportunity[],
  accounts: Record<string, Account>,
  contracts: Record<string, Contract>,
  signalsByAccount: Record<string, Signal[]>,
  pricing: Record<string, PricingAnalysis>,
): RankedOpp[] {
  const rows: RankedOpp[] = []
  const build = (key: string, account: Account, type: RankedOpp['type'], stage: RankedOpp['stage'], arr: number, opp?: Opportunity) => {
    const reasons: string[] = []
    const sizeBoost = clamp(Math.log10(Math.max(10, account.headCount)) * 14 - 20, 0, 40)
    const fit = clamp(SEGMENT_FIT[account.segment] * 0.7 + sizeBoost)

    let intent = 0
    for (const s of signalsByAccount[account.id] ?? []) {
      const age = -daysFrom(s.date)
      if (age > 90) continue
      intent += INTENT_W[s.type] * (1 - age / 120)
      const why = `${s.type}: ${s.headline}`
      if (reasons.length < 2 && !reasons.includes(why)) reasons.push(why)
    }
    intent = clamp(intent)

    let timing = typeof stage === 'string' && stage in STAGE_TIMING ? STAGE_TIMING[stage] : 30
    if (account.competitorRenewal) {
      const d = daysFrom(account.competitorRenewal)
      if (d > 0 && d < 150) {
        timing += 45 * (1 - d / 150)
        reasons.push(`${account.competitor} renewal in ${Math.round(d)} days`)
      }
    }
    const c = account.contractId ? contracts[account.contractId] : undefined
    if (c && type !== 'New Logo') {
      const d = daysFrom(c.end)
      if (d > 0 && d < 150) {
        timing += 35 * (1 - d / 150)
        reasons.push(`Contract ends in ${Math.round(d)} days`)
      }
    }
    if (opp && !opp.stage.startsWith('Closed')) {
      const d = daysFrom(opp.closeDate)
      if (d > 0 && d < 45) timing += 15
    }
    timing = clamp(timing)

    const recent = -daysFrom(account.lastContact)
    let relationship = clamp(account.contacts.length * 10 + (recent < 30 ? 30 : recent < 90 ? 15 : 0) + (account.status === 'Customer' ? account.health.usage * 0.35 : 0))
    if (account.status === 'Customer' && account.health.nps < 0) relationship = clamp(relationship - 20)

    const pa = pricing[account.id]
    if (type === 'Price Normalization' && pa) reasons.unshift(`Under-priced by ${pa.neededPct.toFixed(1)}%: ${pa.ability?.window === 'Anniversary' ? `+${pa.recommendedPct.toFixed(1)}% allowed at anniversary` : `reprice at ${pa.ability?.window.toLowerCase() ?? 'renewal'}`}`)
    if (type === 'Expansion') reasons.push(`White space: ${opp?.products.length ?? 0} module(s) not yet deployed`)

    const score = Math.round(0.3 * fit + 0.3 * intent + 0.2 * timing + 0.2 * relationship)
    rows.push({ key, opp, account, type, stage, arr, score, priority: 0, factors: { fit: Math.round(fit), intent: Math.round(intent), timing: Math.round(timing), relationship: Math.round(relationship) }, reasons })
  }

  for (const o of opps) {
    if (!OPEN_OPP_STAGES.includes(o.stage)) continue
    build(o.id, accounts[o.accountId], o.type, o.stage, o.arr, o)
  }
  for (const [id, pa] of Object.entries(pricing)) {
    if (pa.status === 'Under-priced' && pa.upliftArr > 2000) build(`P-${id}`, accounts[id], 'Price Normalization', 'Recommended', pa.upliftArr)
  }
  const maxArr = Math.max(...rows.map((r) => r.arr), 1)
  for (const r of rows) r.priority = Math.round(r.score * (0.45 + 0.55 * (Math.log10(Math.max(1, r.arr)) / Math.log10(maxArr))))
  return rows.sort((a, b) => b.priority - a.priority)
}

export interface Health {
  score: number
  level: 'Healthy' | 'Watch' | 'At risk'
  parts: { label: string; value: number }[]
}

export function accountHealth(a: Account, weatherRisk: number): Health {
  const h = a.health
  const parts = [
    { label: 'Product usage', value: h.usage, w: 0.35 },
    { label: 'Support tickets', value: clamp(100 - h.openTickets * 12), w: 0.15 },
    { label: 'Payment', value: clamp(100 - h.daysLate * 1.2), w: 0.15 },
    { label: 'NPS', value: clamp((h.nps + 100) / 2), w: 0.15 },
    { label: 'Weather outlook', value: clamp(100 - weatherRisk), w: 0.2 },
  ]
  const score = Math.round(parts.reduce((s, p) => s + p.value * p.w, 0))
  return { score, level: score < 55 ? 'At risk' : score < 70 ? 'Watch' : 'Healthy', parts: parts.map(({ label, value }) => ({ label, value: Math.round(value) })) }
}
