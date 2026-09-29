import { useSearchParams } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import type { Account, Signal } from '../types'
import { REGIONS, STATE_LIST, STATES } from '../data/geo'
import { Select } from './ui'

// Region, state and county filter shared by every Signals tab. It lives in the URL,
// so switching tabs keeps it and links can land pre-filtered (?state=IL).

export interface Geo {
  region: string
  state: string
  county: string
}

export function useGeo() {
  const [params, setParams] = useSearchParams()
  const geo: Geo = { region: params.get('region') ?? 'All', state: params.get('state') ?? 'All', county: params.get('county') ?? 'All' }
  const set = (patch: Partial<Geo>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (!v || v === 'All') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )
  return { geo, set, active: geo.region !== 'All' || geo.state !== 'All' }
}

/** Statewide items (market-wide rules, outbreaks) count for every county in their state. */
export const signalInGeo = (s: Signal, g: Geo) =>
  (g.region === 'All' || s.region === g.region) && (g.state === 'All' || s.state === g.state) && (g.county === 'All' || !s.county || s.county === g.county)

export const accountInGeo = (a: Pick<Account, 'region' | 'state' | 'county'>, g: Geo) =>
  (g.region === 'All' || a.region === g.region) && (g.state === 'All' || a.state === g.state) && (g.county === 'All' || a.county === g.county)

export function geoLabel(g: Geo) {
  if (g.state !== 'All') return `${g.county !== 'All' ? `${g.county} County, ` : ''}${STATES[g.state]?.name ?? g.state}`
  return g.region !== 'All' ? g.region : 'All regions'
}

export function GeoFilter({ counties = true }: { counties?: boolean }) {
  const { geo, set } = useGeo()
  const states = STATE_LIST.filter((s) => geo.region === 'All' || s.region === geo.region).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <Select label="Region" value={geo.region} onChange={(v) => set({ region: v, ...(v !== 'All' && geo.state !== 'All' && STATES[geo.state]?.region !== v ? { state: 'All', county: 'All' } : {}) })} options={[{ value: 'All', label: 'All regions' }, ...REGIONS.map((r) => ({ value: r, label: r }))]} />
      <Select label="State" value={geo.state} onChange={(v) => set({ state: v, county: 'All' })} options={[{ value: 'All', label: 'All states' }, ...states.map((s) => ({ value: s.code, label: s.name }))]} />
      {counties && (
        <Select
          label="County"
          value={geo.county}
          onChange={(v) => set({ county: v })}
          options={[{ value: 'All', label: geo.state === 'All' ? 'Pick a state first' : 'All counties' }, ...(geo.state !== 'All' ? (STATES[geo.state]?.counties ?? []).map((c) => ({ value: c, label: c })) : [])]}
        />
      )}
    </>
  )
}

/** "Corn Belt · Illinois · Henry County" (or "Statewide" for market-wide items). */
export function GeoTag({ region, state, county, statewide }: { region?: string; state?: string; county?: string; statewide?: boolean }) {
  if (!state) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <MapPin size={12} aria-hidden />
      {[region, STATES[state]?.name ?? state, county ? `${county} County` : statewide ? 'Statewide' : undefined].filter(Boolean).join(' · ')}
    </span>
  )
}
