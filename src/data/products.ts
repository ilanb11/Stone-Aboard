import type { Segment, Species } from '../types'

export type Unit = 'site' | 'barn' | 'bin' | '1k head' | '1k acres' | 'flat'

export interface Product {
  id: string
  name: string
  unit: Unit
  listPrice: number // per unit per month
  species: Species[]
  pitch: string
}

// Illustrative ThiboLiSoft catalog for the demo.
export const PRODUCTS: Product[] = [
  { id: 'herdtrack', name: 'HerdTrack Core', unit: 'site', listPrice: 420, species: ['Hog', 'Cattle'], pitch: 'Herd inventory, production records and closeouts in one place.' },
  { id: 'feedopt', name: 'FeedOptimizer', unit: '1k head', listPrice: 34, species: ['Hog', 'Cattle'], pitch: 'Ration formulation, feed budgets and bin forecasting.' },
  { id: 'barnsense', name: 'BarnSense IoT', unit: 'barn', listPrice: 95, species: ['Hog', 'Cattle'], pitch: 'Ventilation, temperature and water sensors with alarm routing.' },
  { id: 'healthwatch', name: 'HealthWatch', unit: 'site', listPrice: 180, species: ['Hog', 'Cattle'], pitch: 'Vet records, treatment logs and disease/biosecurity surveillance.' },
  { id: 'tracelink', name: 'TraceLink Compliance', unit: 'site', listPrice: 140, species: ['Hog', 'Cattle', 'Grain'], pitch: 'Traceability and audit records (PQA Plus, BQA, Prop 12, FARM, sustainability programs).' },
  { id: 'pastureview', name: 'PastureView', unit: '1k acres', listPrice: 65, species: ['Cattle'], pitch: 'Satellite grazing, forage and stock-water monitoring.' },
  { id: 'advisory', name: 'Advisory Services', unit: 'flat', listPrice: 1800, species: ['Hog', 'Cattle', 'Grain'], pitch: 'Nutrition, agronomy and operations consulting retainer.' },
  { id: 'fieldtrack', name: 'FieldTrack', unit: '1k acres', listPrice: 55, species: ['Grain'], pitch: 'Field records, planting and harvest logs, and yield maps.' },
  { id: 'agronomyview', name: 'AgronomyView', unit: '1k acres', listPrice: 42, species: ['Grain'], pitch: 'Satellite crop health, scouting and nitrogen recommendations.' },
  { id: 'binsense', name: 'BinSense', unit: 'bin', listPrice: 38, species: ['Grain'], pitch: 'Grain bin temperature, moisture and aeration fan control.' },
]

export const PRODUCT: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]))

export const SEGMENT_FIT: Record<Segment, string[]> = {
  'Sow Farm': ['herdtrack', 'healthwatch', 'barnsense', 'tracelink', 'feedopt'],
  'Wean-to-Finish': ['herdtrack', 'barnsense', 'feedopt', 'healthwatch'],
  'Farrow-to-Finish': ['herdtrack', 'barnsense', 'feedopt', 'healthwatch', 'tracelink'],
  'Contract Finisher': ['herdtrack', 'barnsense', 'feedopt'],
  'Integrated System': ['herdtrack', 'barnsense', 'feedopt', 'healthwatch', 'tracelink', 'advisory'],
  'Cow-Calf': ['herdtrack', 'pastureview', 'healthwatch'],
  'Stocker / Backgrounder': ['herdtrack', 'pastureview', 'feedopt'],
  Feedlot: ['herdtrack', 'feedopt', 'healthwatch', 'tracelink'],
  Dairy: ['herdtrack', 'feedopt', 'barnsense', 'healthwatch', 'tracelink'],
  'Corn & Soybean': ['fieldtrack', 'agronomyview', 'binsense', 'tracelink'],
  'Wheat & Small Grains': ['fieldtrack', 'agronomyview', 'binsense'],
  'Irrigated Row Crop': ['fieldtrack', 'agronomyview', 'binsense', 'tracelink', 'advisory'],
  'Diversified Grain': ['fieldtrack', 'agronomyview', 'binsense', 'tracelink'],
}

export function unitsFor(productId: string, a: { sites: number; barns: number; headCount: number; acres: number; segment: Segment }): number {
  const p = PRODUCT[productId]
  switch (p.unit) {
    case 'site': return Math.max(1, a.sites)
    case 'barn':
    case 'bin': return Math.max(1, a.barns)
    case '1k head': return Math.max(1, Math.ceil((a.segment === 'Sow Farm' ? a.headCount * 11 : a.headCount) / 1000))
    case '1k acres': return Math.max(1, Math.ceil(a.acres / 1000))
    case 'flat': return 1
  }
}

export const unitLabel = (u: Unit) => (u === 'flat' ? 'month' : `${u} / mo`)
