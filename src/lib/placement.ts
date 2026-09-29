import { feature } from 'topojson-client'
import { geoBounds, geoCentroid, geoContains } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'
import type { Account } from '../types'
import { STATES } from '../data/geo'

// County geometry for the heat map. The atlas (~840 KB) is loaded on demand, so
// it only costs the Heat map page. Farms are then placed inside their real county
// (the seed only knows the county name), deterministically per account id.

export interface County {
  fips: string
  name: string
  stateFips: string
  feature: Feature<Geometry>
}

export interface CountyAtlas {
  byKey: Map<string, County> // `${stateFips}|${name}`
  byState: Map<string, County[]>
}

let atlasPromise: Promise<CountyAtlas> | null = null

export function loadCountyAtlas(): Promise<CountyAtlas> {
  atlasPromise ??= import('us-atlas/counties-10m.json').then((mod) => {
    const topo = (mod.default ?? mod) as unknown as Topology
    const fc = feature(topo, topo.objects.counties) as unknown as FeatureCollection<Geometry, { name: string }>
    const byKey = new Map<string, County>()
    const byState = new Map<string, County[]>()
    for (const f of fc.features) {
      const fips = String(f.id).padStart(5, '0')
      const c: County = { fips, name: f.properties.name, stateFips: fips.slice(0, 2), feature: f }
      byKey.set(`${c.stateFips}|${c.name}`, c)
      const list = byState.get(c.stateFips) ?? []
      list.push(c)
      byState.set(c.stateFips, list)
    }
    return { byKey, byState }
  })
  return atlasPromise
}

export const countyKey = (a: Pick<Account, 'state' | 'county'>) => `${STATES[a.state]?.fips}|${a.county}`

/** Small seeded generator so a farm's position depends only on its id. */
function rngFor(id: string) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  let seed = h >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cache = new Map<string, [number, number]>()
const boundsCache = new Map<string, [[number, number], [number, number]]>()

/** [lon, lat] inside the account's county (falls back to its stored point). */
export function placeFarm(a: Account, atlas: CountyAtlas): [number, number] {
  const hit = cache.get(a.id)
  if (hit) return hit
  const county = atlas.byKey.get(countyKey(a))
  let pt: [number, number] = [a.lon, a.lat]
  if (county) {
    const b = boundsCache.get(county.fips) ?? (geoBounds(county.feature) as [[number, number], [number, number]])
    boundsCache.set(county.fips, b)
    const rnd = rngFor(a.id)
    let placed = false
    for (let i = 0; i < 60 && !placed; i++) {
      const p: [number, number] = [b[0][0] + rnd() * (b[1][0] - b[0][0]), b[0][1] + rnd() * (b[1][1] - b[0][1])]
      if (geoContains(county.feature, p)) {
        pt = p
        placed = true
      }
    }
    if (!placed) pt = geoCentroid(county.feature) as [number, number]
  }
  cache.set(a.id, pt)
  return pt
}
