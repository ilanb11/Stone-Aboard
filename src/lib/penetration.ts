import type { Account, Species } from '../types'
import { OPERATION_TYPES } from '../types'
import { STATES, STATE_LIST } from '../data/geo'

/** Size in market units: hogs and cattle in head (a sow farm's pigs = sows x 11), field crops in acres. */
export const marketUnits = (a: Account) => (a.species === 'Grain' ? a.acres : a.segment === 'Sow Farm' ? a.headCount * 11 : a.headCount)

/** State market in the same units, from the indicative USDA-scale figures in geo.ts. */
export const stateMarket = (code: string, sp: Species) => (sp === 'Hog' ? STATES[code].hogs : sp === 'Cattle' ? STATES[code].cattle : STATES[code].crops) * 1e6

export interface Split {
  market: number
  vended: number // customers
  prospects: number // prospects and churned accounts we track
  vendedPct: number
  prospectPct: number
  whitespacePct: number // market no account in the CRM covers
}

function split(market: number, vended: number, prospects: number): Split {
  const vendedPct = market ? Math.min(1, vended / market) : 0
  const prospectPct = market ? Math.min(1 - vendedPct, prospects / market) : 0
  return { market, vended, prospects, vendedPct, prospectPct, whitespacePct: market ? Math.max(0, 1 - vendedPct - prospectPct) : 0 }
}

export interface Penetration {
  /** state -> operation -> split */
  state: Record<string, Record<Species, Split>>
  /** `${state}|${county}` -> tracked vended / unvended size and counts */
  county: Record<string, { state: string; county: string; vended: number; unvended: number; vendedCount: number; unvendedCount: number }>
  national: Record<Species, Split>
}

export function computePenetration(accounts: Account[]): Penetration {
  const acc: Record<string, Record<Species, { v: number; p: number }>> = {}
  for (const s of STATE_LIST) acc[s.code] = { Hog: { v: 0, p: 0 }, Cattle: { v: 0, p: 0 }, Grain: { v: 0, p: 0 } }
  const county: Penetration['county'] = {}
  for (const a of accounts) {
    const u = marketUnits(a)
    const vended = a.status === 'Customer'
    const cell = acc[a.state]?.[a.species]
    if (!cell) continue
    if (vended) cell.v += u
    else cell.p += u
    const key = `${a.state}|${a.county}`
    const c = (county[key] ??= { state: a.state, county: a.county, vended: 0, unvended: 0, vendedCount: 0, unvendedCount: 0 })
    if (vended) {
      c.vended += u
      c.vendedCount++
    } else {
      c.unvended += u
      c.unvendedCount++
    }
  }
  const state: Penetration['state'] = {}
  const nat: Record<Species, { m: number; v: number; p: number }> = { Hog: { m: 0, v: 0, p: 0 }, Cattle: { m: 0, v: 0, p: 0 }, Grain: { m: 0, v: 0, p: 0 } }
  for (const s of STATE_LIST) {
    state[s.code] = {} as Record<Species, Split>
    for (const sp of OPERATION_TYPES) {
      const m = stateMarket(s.code, sp)
      const { v, p } = acc[s.code][sp]
      state[s.code][sp] = split(m, v, p)
      nat[sp].m += m
      nat[sp].v += v
      nat[sp].p += p
    }
  }
  const national = Object.fromEntries(OPERATION_TYPES.map((sp) => [sp, split(nat[sp].m, nat[sp].v, nat[sp].p)])) as Record<Species, Split>
  return { state, county, national }
}

/**
 * One operation type, or the average across types with a market in the state
 * (head and acres can't be added, so "All" averages the shares).
 */
export function combined(rows: Record<Species, Split>, filter: 'All' | Species): Split {
  if (filter !== 'All') return rows[filter]
  const present = OPERATION_TYPES.map((sp) => rows[sp]).filter((r) => r.market > 0)
  if (!present.length) return split(0, 0, 0)
  const avg = (k: 'vendedPct' | 'prospectPct' | 'whitespacePct') => present.reduce((s, r) => s + r[k], 0) / present.length
  return { market: 0, vended: 0, prospects: 0, vendedPct: avg('vendedPct'), prospectPct: avg('prospectPct'), whitespacePct: avg('whitespacePct') }
}
