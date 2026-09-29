import { feature } from 'topojson-client'
import { geoBounds, geoContains } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'
import usTopo from 'us-atlas/states-10m.json'
import type { Account, Activity, CattleSegment, Contact, Contract, GrainSegment, HogSegment, Opportunity, OppStage, Outreach, Ownership, PriceMechanism, Redline, Segment, Signal, SignalType, Species, Subscription } from '../types'
import { GRAIN_SEGMENTS, isClosedStage } from '../types'
import { STATE_LIST, STATES, type StateInfo } from './geo'
import { PRODUCT, SEGMENT_FIT, unitsFor } from './products'
import { CLAUSE, REDLINE_LIBRARY, REDLINE_BY_KEY, TEMPLATE_VERSION, renderClause } from './contracts'
import { expectedDiscount } from '../lib/pricing'
import { draftForSignal } from '../lib/outreach'

// ---------- deterministic randomness ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// Each seeding pass gets its own stream so adding a pass never reshuffles earlier ones.
const BASE_SEED = 4172026
const SPREAD_SEED = 20260930
const GRAIN_SEED = 7310511
const PIPELINE_SEED = 1162027
const NOTES_SEED = 5240613
let rng = mulberry32(BASE_SEED)
const rand = (lo = 0, hi = 1) => lo + rng() * (hi - lo)
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1))
const chance = (p: number) => rng() < p
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
function pickW<T>(items: readonly T[], weights: readonly number[]): T {
  let r = rng() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i]
  return items[items.length - 1]
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
const logN = (median: number, spread: number) => median * Math.exp(gauss() * spread)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)
const DAY = 86400000
const iso = (d: number) => new Date(TODAY.getTime() + d * DAY).toISOString() // d<0 = past

// ---------- vocab (all fictional) ----------
const SURNAMES = ['Anderson', 'Bauer', 'Carlson', 'Dietrich', 'Eriksen', 'Fischer', 'Gallagher', 'Hansen', 'Iverson', 'Jansen', 'Kowalski', 'Lindqvist', 'Mueller', 'Nielsen', 'Olsen', 'Petersen', 'Rasmussen', 'Schmidt', 'Thorsen', 'Vandenberg', 'Weber', 'Yoder', 'Zimmerman', 'Alvarez', 'Brennan', 'Castillo', 'Delgado', 'Garza', 'Hernandez', 'Kessler', 'Lange', 'Morales', 'Novak', 'Ortega', 'Pruitt', 'Ramirez', 'Sandoval', 'Whitaker', 'Becker', 'Hoffman', 'Koch', 'Krueger', 'Meyer', 'Schultz', 'Wagner', 'Walsh', 'Doyle', 'McAllister', 'Brandt', 'Harmon', 'Sinclair', 'Holloway', 'Voss', 'Engel', 'Larsen', 'Strand', 'De Vries', 'Hofstra', 'Van Zee', 'Boer']
const FIRST = ['James', 'Robert', 'Mary', 'Linda', 'Michael', 'David', 'Susan', 'Karen', 'Thomas', 'Daniel', 'Nancy', 'Carol', 'Richard', 'Joseph', 'Sarah', 'Janet', 'Gary', 'Dale', 'Ruth', 'Wayne', 'Roger', 'Diane', 'Carlos', 'Maria', 'Luis', 'Ana', 'Emily', 'Grace', 'Hank', 'Curtis', 'Lynn', 'Mark', 'Beth', 'Kyle', 'Amber', 'Travis', 'Brooke', 'Cody', 'Megan', 'Tyler']
const PLACES = ['Cedar Creek', 'Willow Bend', 'Prairie View', 'Red Oak', 'Stony Point', 'Blue River', 'Pine Ridge', 'Clear Springs', 'Twin Buttes', 'Sandhill', 'Meadowlark', 'Elk Horn', 'Big Sky', 'Hidden Valley', 'Rolling Hills', 'Golden Valley', 'Oak Grove', 'Silver Creek', 'Iron Horse', 'Cottonwood', 'Bluestem', 'Three Forks', 'North Fork', 'Deer Run', 'High Plains', 'Lone Tree', 'Riverbend', 'Heritage', 'Crescent', 'Spring Valley', 'Blackhawk', 'Timber Lake', 'Sweetwater', 'Badger Creek', 'Hawk Ridge', 'Buffalo Gap', 'Arrowhead', 'Juniper', 'Quail Hollow', 'Ridgeline', 'Long Meadow', 'Windmill', 'Clover Hill', 'Mill Creek', 'Sycamore', 'Bent Tree', 'Coyote Flats', 'Sagebrush']

export const TEAM = ['Avery Collins', 'Jordan Reyes', 'Morgan Patel', 'Riley Chen', 'Casey Brooks', 'Taylor Nguyen']
const TERRITORY: Record<string, string> = {
  'Corn Belt': 'Avery Collins', 'Southern Plains': 'Jordan Reyes', Mountain: 'Jordan Reyes', 'Lake States': 'Morgan Patel', Northeast: 'Morgan Patel',
  'Northern Plains': 'Riley Chen', Appalachian: 'Casey Brooks', Southeast: 'Casey Brooks', 'Delta States': 'Casey Brooks', Pacific: 'Taylor Nguyen',
}

const HOG_INTEGRATORS = ['Prairie Pork Integrated', 'Heartland Protein Co.', 'Riverbend Swine Systems', 'Cornerstone Pork Partners', 'Coastal Plain Pork']
const PACKERS = ['Sandhill Beef Processors', 'Red River Packing', 'High Plains Beef Co-op', 'Valley Crest Dairy Cooperative', 'Northern Prime Beef']
const HOG_ACQUIRERS = ['Heartland Protein Co.', 'Prairie Pork Integrated', 'Tri-State Pork Alliance', 'Summit Agri Partners', 'Crossroads Ag Capital']
const CATTLE_ACQUIRERS = ['Northstar Cattle Holdings', 'Blue Plains Beef', 'Summit Agri Partners', 'Crossroads Ag Capital']
const DAIRY_ACQUIRERS = ['Great Lakes Dairy Group', 'Valley Crest Dairy Cooperative', 'Crossroads Ag Capital']
const LENDERS = ['Plains State Ag Lending', 'Heartland Rural Bank', 'Prairie Mutual Credit', 'Tri-County Farm Bank']
const COMPETITORS = ['Barnwise', 'HerdHQ', 'PenLedger', 'Spreadsheets / paper']

// ---------- geography ----------
const topo = usTopo as unknown as Topology
const statesFC = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry>
const stateFeatures: Record<string, Feature<Geometry>> = {}
for (const f of statesFC.features) stateFeatures[String(f.id).padStart(2, '0')] = f
const boundsCache: Record<string, [[number, number], [number, number]]> = {}
function pointInState(st: StateInfo): [number, number] {
  const f = stateFeatures[st.fips]
  const b = (boundsCache[st.fips] ??= geoBounds(f) as [[number, number], [number, number]])
  for (let i = 0; i < 60; i++) {
    const p: [number, number] = [rand(b[0][0], b[1][0]), rand(b[0][1], b[1][1])]
    if (geoContains(f, p)) return p
  }
  return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
}

// ---------- accounts ----------
const DAIRY_STATES = ['WI', 'CA', 'ID', 'NY', 'PA', 'MI', 'MN', 'TX', 'NM', 'VT', 'WA', 'AZ', 'CO']
const FEEDLOT_STATES = ['TX', 'KS', 'NE', 'CO', 'IA', 'OK', 'SD']
const RANGE_STATES = ['MT', 'WY', 'SD', 'ND', 'NE', 'OK', 'MO', 'KY', 'TN', 'FL', 'NV', 'OR', 'NM', 'TX']

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18)
}

function makeContacts(name: string, seg: Segment, big: boolean, founded: number): Contact[] {
  const domain = `${slug(name)}.example`
  const person = (role: Contact['role'], title: string, sinceDays: number): Contact => {
    const fn = pick(FIRST)
    const ln = pick(SURNAMES)
    return { id: `C${Math.floor(rng() * 1e9).toString(36)}`, name: `${fn} ${ln}`, title, role, email: `${fn}.${ln}`.toLowerCase().replace(/[^a-z.]/g, '') + `@${domain}`, since: iso(-sinceDays) }
  }
  const out: Contact[] = [person('Owner', big ? 'President & CEO' : 'Owner', randInt(365 * 3, 365 * Math.max(4, TODAY.getFullYear() - founded)))]
  if (big || chance(0.5)) out.push(person('GM', 'General Manager', randInt(200, 3000)))
  if (big) out.push(person('CFO', 'Chief Financial Officer', randInt(200, 3000)))
  if (GRAIN_SEGMENTS.includes(seg as GrainSegment)) {
    out.push(person('Operations', 'Farm Manager', randInt(100, 2500)))
    if (chance(0.6)) out.push(person('Agronomist', 'Crop Consultant', randInt(100, 3000)))
    return out
  }
  const hog = ['Sow Farm', 'Wean-to-Finish', 'Farrow-to-Finish', 'Contract Finisher', 'Integrated System'].includes(seg)
  out.push(person(hog || seg === 'Dairy' ? 'Barn Manager' : 'Operations', hog ? 'Production Manager' : seg === 'Dairy' ? 'Herd Manager' : 'Operations Manager', randInt(100, 2500)))
  if (seg === 'Sow Farm' || seg === 'Integrated System' || seg === 'Dairy' || seg === 'Feedlot' || chance(0.3)) out.push(person('Veterinarian', 'Consulting Veterinarian', randInt(100, 3000)))
  if (big && chance(0.6)) out.push(person('Nutritionist', 'Nutritionist', randInt(100, 2000)))
  return out
}

function accountName(seg: Segment, species: Species, used: Set<string>): string {
  const make = () => {
    const sn = pick(SURNAMES)
    const pl = pick(PLACES)
    const opts =
      species === 'Hog'
        ? seg === 'Integrated System'
          ? [`${pl} Pork Systems`, `${sn} Pork Group`, `${pl} Swine Enterprises`]
          : seg === 'Sow Farm'
            ? [`${pl} Sow Unit`, `${sn} Genetics & Sows`, `${pl} Pork Producers`]
            : [`${sn} Pork`, `${pl} Swine`, `${sn} Family Farms`, `${pl} Pork Producers LLC`, `${sn} Hog Farms`, `${sn} ${pl} Farms`]
        : species === 'Grain'
          ? [`${sn} Farms`, `${pl} Grain`, `${sn} Family Farms`, `${pl} Acres`, `${sn} Brothers Farms`, `${pl} Farms`, `${sn} Ag`]
          : seg === 'Dairy'
          ? [`${pl} Dairy`, `${sn} Dairy Farms`, `${sn} Family Dairy`, `${sn} ${pl} Dairy`]
          : seg === 'Feedlot'
            ? [`${pl} Feeders`, `${sn} Feedyard`, `${pl} Cattle Feeders`, `${sn} ${pl} Feedyard`]
            : [`${pl} Ranch`, `${sn} Land & Cattle Co.`, `${pl} Cattle Company`, `${sn} Angus`, `${sn} ${pl} Ranch`]
    return pick(opts)
  }
  let n = make()
  for (let i = 0; used.has(n) && i < 40; i++) n = make()
  for (let i = 2; used.has(n); i++) n = `${n.replace(/ \d+$/, '')} ${i}`
  used.add(n)
  return n
}

function subsFor(a: Omit<Account, 'subscriptions'>, fraction: number): Subscription[] {
  const fit = SEGMENT_FIT[a.segment]
  const chosen = fit.filter((_, i) => i === 0 || chance(fraction))
  const lines = chosen.map((productId) => ({ productId, units: unitsFor(productId, a), unitPrice: PRODUCT[productId].listPrice }))
  const listM = lines.reduce((s, l) => s + l.units * l.unitPrice, 0)
  const center = expectedDiscount(listM)
  // Some accounts were sold far below or above the normal band.
  const skew = chance(0.28) ? rand(0.08, 0.16) : chance(0.18) ? -rand(0.07, 0.14) : gauss() * 0.025
  return lines.map((l) => {
    const d = clamp(center + skew + gauss() * 0.02, 0, 0.5)
    return { ...l, unitPrice: Math.round(l.unitPrice * (1 - d) * 100) / 100 }
  })
}

function generateAccount(i: number, used: Set<string>): Account {
  const pairs: [StateInfo, Species][] = []
  const weights: number[] = []
  for (const s of STATE_LIST) {
    pairs.push([s, 'Hog'], [s, 'Cattle'])
    weights.push(s.hogs * 1.0 + 0.02, s.cattle * 0.6 + 0.02)
  }
  const [st, species] = pickW(pairs, weights)
  let segment: Segment
  if (species === 'Hog') {
    segment = pickW<HogSegment>(['Sow Farm', 'Wean-to-Finish', 'Farrow-to-Finish', 'Contract Finisher', 'Integrated System'], [20, 25, 12, st.code === 'NC' ? 45 : 33, 8])
  } else {
    segment = pickW<CattleSegment>(['Cow-Calf', 'Stocker / Backgrounder', 'Feedlot', 'Dairy'], [RANGE_STATES.includes(st.code) ? 50 : 25, 12, FEEDLOT_STATES.includes(st.code) ? 35 : 8, DAIRY_STATES.includes(st.code) ? 40 : 8])
  }
  let head = 0, sites = 1, barns = 0, acres = 0, employees = 1
  switch (segment) {
    case 'Sow Farm': head = Math.round(clamp(logN(2800, 0.5), 600, 12000)); sites = randInt(1, 3); barns = Math.ceil(head / 1200) + 1; employees = Math.round(head / 250 + 2); acres = randInt(40, 400); break
    case 'Wean-to-Finish': head = Math.round(clamp(logN(9000, 0.7), 2400, 80000)); barns = Math.ceil(head / 2400); sites = Math.max(1, Math.ceil(barns / 4)); employees = Math.round(head / 5000 + 1); acres = randInt(80, 2500); break
    case 'Farrow-to-Finish': { const sows = clamp(logN(1200, 0.6), 300, 4000); head = Math.round(sows * 10); barns = Math.ceil(head / 2000); sites = randInt(1, 4); employees = Math.round(sows / 120 + 3); acres = randInt(200, 3000); break }
    case 'Contract Finisher': head = Math.round(clamp(logN(5000, 0.6), 2400, 30000)); barns = Math.ceil(head / 2400); sites = randInt(1, 3); employees = Math.max(1, Math.round(head / 6000)); acres = randInt(160, 2000); break
    case 'Integrated System': head = Math.round(clamp(logN(150000, 0.7), 40000, 1200000)); sites = Math.round(clamp(head / 6000, 12, 150)); barns = sites * randInt(3, 6); employees = Math.round(head / 2500); acres = randInt(2000, 30000); break
    case 'Cow-Calf': head = Math.round(clamp(logN(450, 0.8), 60, 8000)); acres = Math.round(head * (['MT', 'WY', 'NV', 'NM', 'OR'].includes(st.code) ? rand(25, 45) : RANGE_STATES.includes(st.code) ? rand(8, 20) : rand(3, 8))); sites = randInt(1, 3); employees = Math.max(1, Math.round(head / 300 + 1)); break
    case 'Stocker / Backgrounder': head = Math.round(clamp(logN(2200, 0.7), 300, 15000)); acres = Math.round(head * rand(2, 6)); sites = randInt(1, 3); employees = Math.round(head / 800 + 1); break
    case 'Feedlot': head = Math.round(clamp(logN(12000, 0.9), 1000, 100000)); sites = randInt(1, 3); employees = Math.round(head / 700 + 3); acres = Math.round(head / 60 + rand(200, 2000)); break
    case 'Dairy': head = Math.round(clamp(logN(['CA', 'ID', 'TX', 'NM', 'AZ', 'CO', 'WA'].includes(st.code) ? 2400 : 450, 0.6), 80, 15000)); barns = Math.ceil(head / 400) + 1; sites = randInt(1, 3); employees = Math.round(head / 45 + 2); acres = Math.round(head * rand(0.8, 2)); break
  }
  const big = head > (species === 'Hog' ? 30000 : 5000) || segment === 'Integrated System'
  const yearFounded = Math.round(clamp(1990 - Math.abs(gauss()) * 35 + rand(0, 30), 1905, 2022))
  let ownership: Ownership = pickW<Ownership>(['Family', 'Multi-generational Family', 'Corporate', 'Cooperative', 'PE-backed'], [40, 28, 14, 5, 5])
  if (segment === 'Integrated System') ownership = pick(['Corporate', 'PE-backed', 'Multi-generational Family'] as Ownership[])
  if (segment === 'Contract Finisher' && ownership === 'Corporate') ownership = 'Family'
  const name = accountName(segment, species, used)
  const [lon, lat] = pointInState(st)
  const statusRoll = rng() + (big ? 0.12 : 0)
  const status = statusRoll > 0.66 ? 'Customer' : statusRoll > 0.61 ? 'Churned' : 'Prospect'
  const base: Omit<Account, 'subscriptions'> = {
    id: `A${String(i + 1).padStart(4, '0')}`,
    name,
    species,
    segment,
    state: st.code,
    county: pick(st.counties),
    region: st.region,
    lat,
    lon,
    headCount: head,
    sites,
    barns,
    acres,
    employees,
    yearFounded,
    ownership,
    parentCompany: ownership === 'PE-backed' ? pick(['Summit Agri Partners', 'Crossroads Ag Capital']) : ownership === 'Integrator-owned' ? pick(HOG_INTEGRATORS) : undefined,
    integrator: segment === 'Contract Finisher' || (segment === 'Wean-to-Finish' && chance(0.5)) ? (st.code === 'NC' ? 'Coastal Plain Pork' : pick(HOG_INTEGRATORS.slice(0, 4))) : species === 'Cattle' && chance(0.5) ? pick(PACKERS) : undefined,
    status,
    rep: TERRITORY[st.region],
    contacts: makeContacts(name, segment, big, yearFounded),
    competitor: status !== 'Customer' ? pick(COMPETITORS) : undefined,
    competitorRenewal: status !== 'Customer' && chance(0.7) ? iso(randInt(-30, 330)) : undefined,
    health: status === 'Customer'
      ? { usage: Math.round(clamp(72 + gauss() * 18, 8, 99)), openTickets: chance(0.6) ? 0 : randInt(1, 7), daysLate: chance(0.85) ? 0 : randInt(10, 75), nps: Math.round(clamp(38 + gauss() * 28, -60, 90)) }
      : { usage: 0, openTickets: 0, daysLate: 0, nps: 0 },
    lastContact: iso(-randInt(1, status === 'Customer' ? 90 : 240)),
  }
  const subscriptions = status === 'Prospect' ? [] : subsFor(base, status === 'Customer' ? 0.55 : 0.35)
  return { ...base, subscriptions }
}

// ---------- contracts ----------
function makeContract(a: Account, idx: number): Contract {
  const startDaysAgo = randInt(60, 1250)
  const termMonths = pickW([12, 24, 36], [30, 40, 30])
  let endOffset = -startDaysAgo + Math.round(termMonths * 30.4)
  while (endOffset < -20) endOffset += 365 // auto-renewed into a current term
  const mechanism = pickW<PriceMechanism>(['Annual increase with notice', 'Annual CPI escalator', 'Fixed for term', 'Renegotiate at renewal', 'Multi-year price lock'], [30, 25, 20, 15, 10])
  return {
    id: `K${String(idx + 1).padStart(4, '0')}`,
    accountId: a.id,
    template: pick([TEMPLATE_VERSION, 'ThiboLiSoft MSA v3.1', 'ThiboLiSoft MSA v2.8']),
    status: 'Active',
    start: iso(-startDaysAgo),
    end: iso(endOffset),
    termMonths,
    autoRenew: chance(0.75),
    renewalNoticeDays: pick([30, 60, 90]),
    paymentTerms: pickW(['Net 30', 'Net 45', 'Net 60'], [70, 20, 10]),
    price: {
      mechanism,
      capPct: mechanism === 'Annual increase with notice' ? pick([3, 4, 5]) : mechanism === 'Annual CPI escalator' ? pick([3, 4, 5]) : mechanism === 'Multi-year price lock' ? 3 : undefined,
      noticeDays: pick([30, 60, 90]),
      lockUntil: mechanism === 'Multi-year price lock' ? iso(randInt(-100, 500)) : undefined,
    },
    mfn: chance(0.1),
    assignmentOnChangeOfControl: chance(0.8) ? 'Consent required' : 'Permitted with notice',
    redlines: [],
  }
}

function redlinesFor(a: Account, hasOwnershipSignal: boolean): Redline[] {
  const keys = new Set<string>()
  if (hasOwnershipSignal) keys.add('assignment-coc')
  if (a.species === 'Hog' && ['Sow Farm', 'Integrated System', 'Farrow-to-Finish'].includes(a.segment) && chance(0.8)) keys.add('biosecurity-downtime')
  const n = randInt(3, 6)
  const pool = REDLINE_LIBRARY.map((r) => r.key).filter((k) => k !== 'assignment-coc' || hasOwnershipSignal)
  while (keys.size < n) {
    const k = pick(pool)
    // one fees redline at most
    if (REDLINE_BY_KEY[k].clauseId === 'fees' && [...keys].some((x) => REDLINE_BY_KEY[x].clauseId === 'fees')) continue
    keys.add(k)
  }
  return [...keys].map((k, i) => {
    const t = REDLINE_BY_KEY[k]
    return { id: `R${a.id}-${i}`, clauseId: t.clauseId, key: k, original: renderClause(CLAUSE[t.clauseId], { termMonths: 24, renewalNoticeDays: 60, capPct: 5, noticeDays: 60 }), proposed: t.proposed, customerNote: t.customerNote }
  })
}

// ---------- signals ----------
const SIGNAL_W: [SignalType, number][] = [
  ['Leadership Change', 20], ['Ownership Change', 12], ['Expansion', 18], ['Contraction', 8], ['Integrator / Packer Change', 10], ['Financial', 12], ['Biosecurity', 10], ['Regulatory', 8],
]
const SOURCES = ['State permit filings', 'Press release', 'Trade press', 'LinkedIn', 'County records', 'Rep field note', 'Lender announcement', 'State ag department']

function accountSignal(a: Account, type: SignalType, date: string): Signal {
  if (a.species === 'Grain') return grainSignal(a, type, date)
  const hog = a.species === 'Hog'
  const where = `${a.county} Co., ${a.state}`
  const sig = (headline: string, detail: string, severity: Signal['severity']): Signal => ({ id: '', date, type, headline, detail, accountId: a.id, state: a.state, severity, source: pick(SOURCES) })
  switch (type) {
    case 'Leadership Change': {
      const role = pick(['GM', 'CFO', 'Operations'] as const)
      const title = role === 'GM' ? 'General Manager' : role === 'CFO' ? 'Chief Financial Officer' : hog ? 'Director of Production' : 'Operations Manager'
      const person = `${pick(FIRST)} ${pick(SURNAMES)}`
      a.contacts.push({ id: `C${Math.floor(rng() * 1e9).toString(36)}`, name: person, title, role, email: `${person.replace(/\s+/g, '.').toLowerCase()}@${slug(a.name)}.example`, since: date })
      return sig(`${person} named ${title} at ${a.name}`, `${person} joins ${a.name} (${where}) as ${title}, replacing a long-time leader. New leaders often re-evaluate vendors within 6 months.`, role === 'CFO' ? 'Medium' : 'High')
    }
    case 'Ownership Change': {
      const buyer = pick(hog ? HOG_ACQUIRERS : a.segment === 'Dairy' ? DAIRY_ACQUIRERS : CATTLE_ACQUIRERS)
      a.parentCompany = buyer
      a.ownership = buyer.includes('Capital') || buyer.includes('Partners') ? 'PE-backed' : 'Corporate'
      return sig(`${buyer} acquires ${a.name}`, `${buyer} has acquired ${a.name} (${a.headCount.toLocaleString()} ${hog ? 'head' : 'head of cattle'}, ${where}). Contract assignment and the buyer's standard vendor stack need review.`, 'High')
    }
    case 'Expansion': {
      if (hog) {
        const nb = randInt(2, 8)
        a.barns += nb
        a.headCount += nb * 2400
        a.sites += chance(0.4) ? 1 : 0
        return sig(`${a.name} files permit for ${nb} new finishing barns (+${(nb * 2400).toLocaleString()} head)`, `Permit filed in ${where}. Construction typically completes in 6–9 months, which is the window to win coverage.`, 'High')
      }
      const add = Math.round(a.headCount * rand(0.2, 0.6))
      a.headCount += add
      return sig(`${a.name} expands by ${add.toLocaleString()} head`, `${a.segment} expansion in ${where}${a.segment === 'Dairy' ? ', including a new rotary parlor' : a.segment === 'Feedlot' ? ', adding pen capacity' : ', adding leased pasture'}.`, 'Medium')
    }
    case 'Contraction': {
      a.headCount = Math.round(a.headCount * rand(0.55, 0.85))
      return sig(hog ? `${a.name} depopulates one site` : `${a.name} reduces herd amid tight margins`, `Reported reduction at ${where}. Churn risk if the subscription is not right-sized.`, a.status === 'Customer' ? 'High' : 'Low')
    }
    case 'Integrator / Packer Change': {
      const next = hog ? pick(HOG_INTEGRATORS.filter((x) => x !== a.integrator)) : pick(PACKERS.filter((x) => x !== a.integrator))
      const prev = a.integrator
      a.integrator = next
      return sig(`${a.name} moves ${hog ? 'contract production' : 'marketing'} to ${next}`, `${prev ? `Previously with ${prev}. ` : ''}New partner reporting requirements start next quarter.`, 'Medium')
    }
    case 'Financial': {
      if (chance(0.6)) {
        const m = Math.round(logN(8, 0.7))
        return sig(`${a.name} secures $${m}M credit facility from ${pick(LENDERS)}`, `Fresh capital for ${hog ? 'barn renovations and ventilation upgrades' : 'equipment and herd growth'}.`, 'Medium')
      }
      if (chance(0.5)) return sig(`${a.name} awarded USDA grant for ${hog || a.segment === 'Dairy' ? 'a manure digester' : 'grazing infrastructure'}`, 'Grant funds usually come with record-keeping requirements.', 'Low')
      return sig(`${a.name}: lender reports covenant waiver`, 'Financial pressure. Adjust payment terms proactively to protect the account.', 'Medium')
    }
    case 'Regulatory': {
      const opts = hog
        ? [`${a.name} completes Prop 12 sow-housing certification audit`, `${a.name} receives state notice on manure-application records`, `${a.name} applies for CAFO permit renewal`]
        : [`${a.name} receives notice on EID tagging for interstate movement`, `${a.name} applies for CAFO permit renewal`, `${a.name} completes ${a.segment === 'Dairy' ? 'FARM program' : 'BQA'} audit`]
      return sig(pick(opts), 'Compliance events come with record-keeping deadlines, which is a good time to offer TraceLink support.', 'Medium')
    }
    default: {
      return sig(hog ? `PRRS break reported in ${a.name}'s sow unit` : `${a.name} under quarantine after respiratory outbreak`, `Reported through ${pick(['regional monitoring', 'the herd vet', 'a rep field note'])}. Offer support; don't sell hard.`, 'High')
    }
  }
}

function stateSignal(date: string): Signal {
  const type = pickW<SignalType>(['Biosecurity', 'Regulatory'], [55, 45])
  const hogState = pickW(STATE_LIST, STATE_LIST.map((s) => s.hogs + 0.05))
  const cattleState = pickW(STATE_LIST, STATE_LIST.map((s) => s.cattle + 0.05))
  if (type === 'Biosecurity') {
    const opts: [string, string, string][] = [
      [hogState.code, `PRRS incidence rising across ${hogState.name}`, 'Regional swine health monitoring shows an early-season increase in PRRS cases. Sow farms should tighten biosecurity.'],
      [hogState.code, `PED detections reported in ${hogState.name} finishing sites`, 'State veterinarian urges trailer-wash and downtime compliance.'],
      [cattleState.code, `H5N1 detected in a ${cattleState.name} dairy herd`, 'State animal health officials expand bulk-milk testing. Dairy biosecurity and movement testing apply.'],
      [cattleState.code, `New World screwworm surveillance expanded in ${cattleState.name}`, 'Animal health officials ask producers to inspect wounds and report suspect cases.'],
    ]
    const [code, headline, detail] = pick(opts)
    return { id: '', date, type, headline, detail, state: code, severity: 'High', source: 'State ag department' }
  }
  const opts: [string, string, string][] = [
    [hogState.code, `${hogState.name} updates CAFO nutrient-management rules`, 'New manure-application record requirements take effect next season.'],
    ['CA', 'Prop 12 enforcement audits expand for pork sold in California', 'Suppliers must document sow-housing compliance; TraceLink records support audits.'],
    [cattleState.code, `${cattleState.name} adopts electronic ID for cattle movement`, 'EID tags required for interstate movement of breeding cattle; traceability records needed.'],
    [hogState.code, `${hogState.name} proposes setback rule for new livestock barns`, 'Comment period open; may slow new-barn permits.'],
  ]
  const [code, headline, detail] = pick(opts)
  return { id: '', date, type, headline, detail, state: code, severity: 'Medium', source: 'State ag department' }
}

// ---------- field crops ----------
const CORN_BELT = ['IA', 'IL', 'IN', 'OH', 'MN', 'MO', 'WI', 'MI', 'SD', 'NE']
const WHEAT_STATES = ['KS', 'ND', 'MT', 'WA', 'OK', 'ID', 'CO', 'OR', 'SD']
const IRRIGATED_STATES = ['NE', 'TX', 'CA', 'AR', 'MS', 'LA', 'CO', 'ID', 'KS']
const ELEVATORS = ['Prairie Grain Cooperative', 'Heartland Elevator Co.', 'Plains Grain Partners', 'River Terminal Grain', 'Northern Plains Ag Co-op']
const GRAIN_ACQUIRERS = ['Midwest Farmland Partners', 'Summit Agri Partners', 'Crossroads Ag Capital', 'Prairie Grain Cooperative']
const GRAIN_COMPETITORS = ['AcreDesk', 'Furrowline', 'Spreadsheets / paper']

function grainCrops(seg: GrainSegment, st: StateInfo): string[] {
  switch (seg) {
    case 'Corn & Soybean':
      return chance(0.3) ? ['Corn', 'Soybeans', 'Wheat'] : ['Corn', 'Soybeans']
    case 'Wheat & Small Grains': {
      const second =
        st.code === 'ND' ? pick(['Canola', 'Barley', 'Sunflowers', 'Soybeans'])
        : st.code === 'MT' ? pick(['Barley', 'Pulses'])
        : ['KS', 'OK'].includes(st.code) ? pick(['Sorghum', 'Soybeans'])
        : ['WA', 'OR', 'ID'].includes(st.code) ? pick(['Barley', 'Chickpeas'])
        : pick(['Barley', 'Sunflowers', 'Corn'])
      return ['Wheat', second]
    }
    case 'Irrigated Row Crop':
      if (st.code === 'TX') return ['Cotton', 'Sorghum']
      if (['AR', 'MS', 'LA'].includes(st.code)) return ['Rice', 'Soybeans']
      if (st.code === 'CA') return ['Rice', 'Wheat']
      if (st.code === 'ID') return ['Potatoes', 'Wheat']
      return chance(0.3) ? ['Corn', 'Soybeans', 'Dry Beans'] : ['Corn', 'Soybeans']
    case 'Diversified Grain': {
      const pool = ['Corn', 'Soybeans', 'Wheat', 'Sorghum', 'Oats', 'Hay']
      const out = [pick(pool)]
      while (out.length < 3) {
        const c = pick(pool)
        if (!out.includes(c)) out.push(c)
      }
      return out
    }
  }
}

function generateGrainAccount(i: number, used: Set<string>): Account {
  const st = pickW(STATE_LIST, STATE_LIST.map((s) => s.crops + 0.05))
  const segment = pickW<GrainSegment>([...GRAIN_SEGMENTS], [CORN_BELT.includes(st.code) ? 60 : 15, WHEAT_STATES.includes(st.code) ? 45 : 5, IRRIGATED_STATES.includes(st.code) ? 30 : 4, 20])
  const median = { 'Corn & Soybean': 1600, 'Wheat & Small Grains': 3800, 'Irrigated Row Crop': 2400, 'Diversified Grain': 1100 }[segment]
  const acres = Math.round(clamp(logN(median, 0.7), 150, 35000) / 10) * 10
  const crops = grainCrops(segment, st)
  const big = acres > 8000
  const yearFounded = Math.round(clamp(1975 - Math.abs(gauss()) * 40 + rand(0, 35), 1890, 2022))
  const ownership: Ownership = pickW<Ownership>(['Family', 'Multi-generational Family', 'Corporate', 'Cooperative', 'PE-backed'], [42, 36, 10, 4, 4])
  const name = accountName(segment, 'Grain', used)
  const [lon, lat] = pointInState(st)
  const statusRoll = rng() + (big ? 0.12 : 0)
  const status = statusRoll > 0.68 ? 'Customer' : statusRoll > 0.63 ? 'Churned' : 'Prospect'
  const base: Omit<Account, 'subscriptions'> = {
    id: `G${String(i + 1).padStart(4, '0')}`,
    name,
    species: 'Grain',
    segment,
    state: st.code,
    county: pick(st.counties),
    region: st.region,
    lat,
    lon,
    headCount: 0,
    sites: clamp(1 + Math.floor(acres / 4000), 1, 6),
    barns: Math.max(2, Math.round((acres / 350) * rand(0.6, 1.3))),
    acres,
    crops,
    employees: Math.max(1, Math.round(acres / 1100 + rand(0, 2))),
    yearFounded,
    ownership,
    parentCompany: ownership === 'PE-backed' ? pick(['Summit Agri Partners', 'Crossroads Ag Capital']) : undefined,
    integrator: chance(0.45) ? pick(ELEVATORS) : undefined,
    status,
    rep: TERRITORY[st.region],
    contacts: makeContacts(name, segment, big, yearFounded),
    competitor: status !== 'Customer' ? pick(GRAIN_COMPETITORS) : undefined,
    competitorRenewal: status !== 'Customer' && chance(0.7) ? iso(randInt(-30, 330)) : undefined,
    health:
      status === 'Customer'
        ? { usage: Math.round(clamp(70 + gauss() * 18, 8, 99)), openTickets: chance(0.65) ? 0 : randInt(1, 5), daysLate: chance(0.85) ? 0 : randInt(10, 60), nps: Math.round(clamp(40 + gauss() * 26, -60, 90)) }
        : { usage: 0, openTickets: 0, daysLate: 0, nps: 0 },
    lastContact: iso(-randInt(1, status === 'Customer' ? 90 : 240)),
  }
  const subscriptions = status === 'Prospect' ? [] : subsFor(base, status === 'Customer' ? 0.55 : 0.35)
  return { ...base, subscriptions }
}

function grainSignal(a: Account, type: SignalType, date: string): Signal {
  const where = `${a.county} Co., ${a.state}`
  const sig = (headline: string, detail: string, severity: Signal['severity']): Signal => ({ id: '', date, type, headline, detail, accountId: a.id, state: a.state, severity, source: pick(SOURCES) })
  const main = a.crops?.[0] ?? 'Corn'
  switch (type) {
    case 'Leadership Change': {
      const role = pick(['GM', 'CFO', 'Operations'] as const)
      const title = role === 'GM' ? 'General Manager' : role === 'CFO' ? 'Chief Financial Officer' : 'Farm Manager'
      const person = `${pick(FIRST)} ${pick(SURNAMES)}`
      a.contacts.push({ id: `C${Math.floor(rng() * 1e9).toString(36)}`, name: person, title, role, email: `${person.replace(/\s+/g, '.').toLowerCase()}@${slug(a.name)}.example`, since: date })
      return sig(`${person} named ${title} at ${a.name}`, `${person} takes over day-to-day decisions at ${a.name} (${where}). A good moment to revisit how field records and bin data are handled.`, role === 'CFO' ? 'Medium' : 'High')
    }
    case 'Ownership Change': {
      const buyer = pick(GRAIN_ACQUIRERS)
      a.parentCompany = buyer
      a.ownership = buyer.includes('Cooperative') ? 'Cooperative' : 'PE-backed'
      return sig(`${buyer} acquires ${a.name}`, `${buyer} has acquired ${a.name} (${a.acres.toLocaleString()} acres, ${where}). Contract assignment and the buyer's record-keeping standards need review.`, 'High')
    }
    case 'Expansion': {
      if (chance(0.55)) {
        const add = Math.round((a.acres * rand(0.1, 0.4)) / 10) * 10
        a.acres += add
        return sig(`${a.name} adds ${add.toLocaleString()} acres of leased ground`, `New ${main.toLowerCase()} acres in ${where} for next season. The time to add field coverage is before planting.`, 'High')
      }
      const bins = randInt(2, 6)
      a.barns += bins
      return sig(`${a.name} builds ${(bins * 60000).toLocaleString()}-bushel grain storage expansion`, `${bins} new bins going up in ${where}. New bins are the easiest time to add monitoring.`, 'Medium')
    }
    case 'Contraction': {
      const cut = Math.round((a.acres * rand(0.15, 0.4)) / 10) * 10
      a.acres = Math.max(150, a.acres - cut)
      return sig(`${a.name} sells ${cut.toLocaleString()} acres`, `Reported land sale in ${where}. Churn risk if the subscription is not right-sized.`, a.status === 'Customer' ? 'High' : 'Low')
    }
    case 'Integrator / Packer Change': {
      const next = pick(ELEVATORS.filter((x) => x !== a.integrator))
      const prev = a.integrator
      a.integrator = next
      return sig(`${a.name} moves grain marketing to ${next}`, `${prev ? `Previously sold through ${prev}. ` : ''}New delivery and settlement records start with this harvest.`, 'Medium')
    }
    case 'Financial': {
      if (chance(0.5)) return sig(`${a.name} secures $${Math.max(1, Math.round(logN(3, 0.6)))}M operating line from ${pick(LENDERS)}`, 'Fresh capital for inputs, storage and equipment.', 'Medium')
      if (chance(0.5)) return sig(`${a.name} enrolls ${Math.round(a.acres * rand(0.3, 0.9)).toLocaleString()} acres in a carbon program`, 'Carbon programs require field-level practice records, which FieldTrack keeps.', 'Low')
      return sig(`${a.name}: lender reports covenant waiver`, 'Financial pressure after a tight harvest. Adjust payment terms proactively to protect the account.', 'Medium')
    }
    case 'Biosecurity':
      return sig(main === 'Wheat' ? `Stripe rust found in ${a.name}'s wheat` : `Tar spot confirmed in ${a.name}'s corn`, `Reported through ${pick(['the crop consultant', 'extension scouting', 'a rep field note'])}. Offer AgronomyView scouting support.`, 'High')
    default:
      return sig(pick([`${a.name} files a nitrogen management plan under new state rules`, `${a.name} completes a sustainability audit for a grain buyer`, `${a.name} applies for a USDA conservation program`]), 'Compliance events come with record-keeping deadlines, which is a good time to offer TraceLink support.', 'Medium')
  }
}

function grainStateSignal(date: string): Signal {
  const st = pickW(STATE_LIST, STATE_LIST.map((s) => s.crops + 0.05))
  const opts: [SignalType, string, string, Signal['severity']][] = [
    ['Biosecurity', `Tar spot confirmed across ${st.name} corn`, 'Extension specialists urge scouting before fungicide decisions.', 'High'],
    ['Biosecurity', `Wheat stripe rust reported in ${st.name}`, 'Early detections this season; growers are advised to scout fields weekly.', 'Medium'],
    ['Regulatory', `${st.name} tightens fall nitrogen application rules near wells`, 'New application windows and record requirements take effect next season.', 'Medium'],
    ['Regulatory', `USDA opens enrollment for a conservation program in ${st.name}`, 'Enrollment needs field-level practice records.', 'Low'],
  ]
  const [type, headline, detail, severity] = pick(opts)
  return { id: '', date, type, headline, detail, state: st.code, severity, source: 'State ag department' }
}

// ---------- assembly ----------
export interface Dataset {
  accounts: Account[]
  contracts: Contract[]
  opportunities: Opportunity[]
  signals: Signal[]
  outreach: Outreach[]
  activities: Activity[]
}

export const SEED_VERSION = 18

const LOST_REASONS = ['Lost to a competitor on price', 'Stayed with spreadsheets', 'No budget this year', "Chose their integrator's system", 'Decision maker left before signing']
const ON_ICE_REASONS = ['Budget frozen until after harvest', 'Waiting on integrator approval', 'Paused after a herd health break', 'Revisit after the lender review', 'Champion left the company', 'Revisit next budget cycle']
type StageWeights = [OppStage[], number[]]

export function generateDataset(n = 900, grainCount = 240): Dataset {
  rng = mulberry32(BASE_SEED)
  const used = new Set<string>()
  const accounts = Array.from({ length: n }, (_, i) => generateAccount(i, used))
  const contracts: Contract[] = []
  const signals: Signal[] = []
  const opportunities: Opportunity[] = []
  const outreach: Outreach[] = []
  const activities: Activity[] = []
  const ownershipAccounts = new Set<string | undefined>()

  const addContracts = (list: Account[]) => {
    for (const a of list) {
      if (a.status !== 'Customer') continue
      const c = makeContract(a, contracts.length)
      a.contractId = c.id
      contracts.push(c)
    }
  }
  const addSignals = (count: number, pool: Account[], market: (date: string) => Signal, weights: [SignalType, number][]) => {
    const fresh: Signal[] = []
    for (let i = 0; i < count; i++) {
      const date = iso(-Math.floor(Math.pow(rng(), 1.3) * 120))
      let s: Signal
      if (chance(0.78)) {
        const a = chance(0.45) ? pick(pool.filter((x) => x.status === 'Customer')) : pick(pool)
        s = accountSignal(a, pickW(weights.map((x) => x[0]), weights.map((x) => x[1])), date)
      } else s = market(date)
      s.id = `S${String(signals.length + fresh.length + 1).padStart(4, '0')}`
      fresh.push(s)
    }
    fresh.sort((a, b) => b.date.localeCompare(a.date))
    for (const s of fresh) if (s.type === 'Ownership Change') ownershipAccounts.add(s.accountId)
    signals.push(...fresh)
    return fresh
  }
  const addOpp = (a: Account, type: Opportunity['type'], stage: OppStage, products: string[], arr: number) => {
    const id = `O${String(opportunities.length + 1).padStart(4, '0')}`
    const o: Opportunity = { id, accountId: a.id, type, stage, arr: Math.round(arr), products, owner: a.rep, createdAt: iso(-randInt(5, 200)), closeDate: iso(isClosedStage(stage) ? -randInt(1, 120) : randInt(10, 160)) }
    if (stage === 'Negotiation') {
      o.negotiationStartedAt = o.createdAt
      const c: Contract = { ...makeContract(a, contracts.length), status: 'In Negotiation', start: iso(randInt(15, 45)), template: TEMPLATE_VERSION, redlines: redlinesFor(a, ownershipAccounts.has(a.id)), opportunityId: id }
      c.end = new Date(new Date(c.start).getTime() + c.termMonths * 30.4 * DAY).toISOString()
      contracts.push(c)
      o.contractId = c.id
    }
    opportunities.push(o)
    return o
  }
  const newLogoArr = (a: Account, products: string[]) => products.reduce((s, p) => s + unitsFor(p, a) * PRODUCT[p].listPrice * (1 - expectedDiscount(2000)), 0) * 12
  const expansionArr = (a: Account, products: string[]) => products.reduce((s, p) => s + unitsFor(p, a) * PRODUCT[p].listPrice * 0.85, 0) * 12
  const currentArr = (a: Account) => a.subscriptions.reduce((s, x) => s + x.units * x.unitPrice, 0) * 12
  const addOpps = (list: Account[], stages: { logo: StageWeights; expansion: StageWeights; renewal: StageWeights }) => {
    for (const a of list) {
      const fit = SEGMENT_FIT[a.segment]
      if (a.status === 'Prospect' && chance(0.3)) {
        const products = fit.filter((_, i) => i < 2 || chance(0.5))
        addOpp(a, 'New Logo', pickW<OppStage>(...stages.logo), products, newLogoArr(a, products))
      }
      if (a.status === 'Customer') {
        const have = new Set(a.subscriptions.map((s) => s.productId))
        const ws = fit.filter((p) => !have.has(p))
        if (ws.length && chance(0.35)) {
          const products = ws.slice(0, randInt(1, ws.length))
          addOpp(a, 'Expansion', pickW<OppStage>(...stages.expansion), products, expansionArr(a, products))
        }
        const c = contracts.find((x) => x.id === a.contractId)!
        const daysToEnd = (new Date(c.end).getTime() - TODAY.getTime()) / DAY
        if (daysToEnd < 150 && daysToEnd > 0) addOpp(a, 'Renewal', pickW<OppStage>(...stages.renewal), a.subscriptions.map((s) => s.productId), currentArr(a))
      }
    }
  }
  const addOutreach = (list: Signal[], byId: Record<string, Account>) => {
    for (const s of list) {
      if (!s.accountId) continue
      const age = (TODAY.getTime() - new Date(s.date).getTime()) / DAY
      if (age > 60) continue
      const a = byId[s.accountId]
      const d = draftForSignal(a, s, a.rep)
      const status = age <= 10 ? 'Draft' : chance(0.85) ? 'Sent' : 'Skipped'
      const o: Outreach = { id: `M${String(outreach.length + 1).padStart(4, '0')}`, accountId: a.id, signalId: s.id, trigger: s.type, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, status, createdAt: s.date, sentAt: status === 'Sent' ? iso(-Math.max(0, Math.floor(age) - randInt(0, 3))) : undefined, auto: true }
      outreach.push(o)
      if (status === 'Sent') activities.push({ id: `V${outreach.length}`, accountId: a.id, date: o.sentAt!, author: a.rep, kind: 'Email', text: `Sent "${o.subject}" to ${o.contactName} (playbook: ${o.playbook}).` })
    }
  }
  const addActivities = (list: Account[], notes: string[]) => {
    for (const a of list) {
      if (a.status !== 'Customer' || !chance(0.7)) continue
      activities.push({ id: `V-${a.id}`, accountId: a.id, date: a.lastContact, author: a.rep, kind: pick(['Call', 'Note'] as const), text: pick(notes) })
    }
  }
  const sample = <T,>(arr: T[], k: number) => {
    const copy = [...arr]
    const out: T[] = []
    while (out.length < k && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0])
    return out
  }
  // A customer's original win: a closed-won new-logo deal dated at contract start.
  const addWonHistory = (a: Account) => {
    const c = contracts.find((x) => x.id === a.contractId)!
    const o = addOpp(a, 'New Logo', 'Closed Won', a.subscriptions.map((s) => s.productId), currentArr(a))
    o.closeDate = c.start
    o.createdAt = new Date(new Date(c.start).getTime() - randInt(30, 120) * DAY).toISOString()
  }

  // Pass 1: hog and cattle. The stage lists keep their original weights and order
  // (Identified, Qualified, Proposal, Negotiation are now Prospect, Demo, Demo,
  // Negotiation), so the random stream and every record it produces are unchanged.
  addContracts(accounts)
  const baseSignals = addSignals(280, accounts, stateSignal, SIGNAL_W)
  addOpps(accounts, {
    logo: [['Prospect', 'Demo', 'Demo', 'Negotiation', 'Closed Won', 'Closed Lost'], [30, 25, 18, 10, 7, 10]],
    expansion: [['Prospect', 'Demo', 'Demo', 'Negotiation', 'Closed Won'], [30, 25, 22, 10, 8]],
    renewal: [['Prospect', 'Demo', 'Demo', 'Negotiation'], [30, 30, 25, 15]],
  })
  addOutreach(baseSignals, Object.fromEntries(accounts.map((a) => [a.id, a])))
  addActivities(accounts, ['Quarterly check-in. Team happy with closeout reports.', 'Walked barn manager through the new alarm routing.', 'Discussed adding remaining sites next budget cycle.', 'Support ticket on sensor connectivity resolved.', 'Owner asked about benchmarking against similar operations.'])

  // Pass 2: stage spread, on its own stream, so every stage has realistic data.
  rng = mulberry32(SPREAD_SEED)
  // A won new-logo deal means the account signed: turn those few seeded prospects
  // into customers with the subscription and contract they signed.
  for (const o of [...opportunities]) {
    const a = accounts.find((x) => x.id === o.accountId)!
    if (o.type !== 'New Logo' || o.stage !== 'Closed Won' || a.status !== 'Prospect') continue
    const listM = o.products.reduce((s, p) => s + unitsFor(p, a) * PRODUCT[p].listPrice, 0)
    a.status = 'Customer'
    a.subscriptions = o.products.map((p) => ({ productId: p, units: unitsFor(p, a), unitPrice: Math.round(PRODUCT[p].listPrice * (1 - expectedDiscount(listM)) * 100) / 100 }))
    a.competitor = undefined
    a.competitorRenewal = undefined
    a.health = { usage: randInt(45, 80), openTickets: randInt(0, 2), daysLate: 0, nps: randInt(20, 60) }
    const c = makeContract(a, contracts.length)
    c.start = o.closeDate
    c.end = new Date(new Date(c.start).getTime() + c.termMonths * 30.4 * DAY).toISOString()
    a.contractId = c.id
    contracts.push(c)
  }
  const custs = accounts.filter((a) => a.status === 'Customer')
  const prospects = accounts.filter((a) => a.status === 'Prospect')
  for (const a of sample(custs, 40)) addWonHistory(a)
  for (const a of sample(prospects, 32)) {
    const products = SEGMENT_FIT[a.segment].slice(0, 2)
    addOpp(a, 'New Logo', 'Closed Lost', products, newLogoArr(a, products)).reason = pick(LOST_REASONS)
  }
  for (const a of sample(custs, 10)) {
    const ws = SEGMENT_FIT[a.segment].filter((p) => !a.subscriptions.some((s) => s.productId === p)).slice(0, 1)
    if (ws.length) addOpp(a, 'Expansion', 'Closed Lost', ws, expansionArr(a, ws)).reason = pick(LOST_REASONS.slice(1))
  }
  for (const a of sample(prospects, 30)) {
    const products = SEGMENT_FIT[a.segment].slice(0, 2)
    addOpp(a, 'New Logo', 'On Ice', products, newLogoArr(a, products)).reason = pick(ON_ICE_REASONS)
  }
  for (const a of sample(custs, 12)) {
    const ws = SEGMENT_FIT[a.segment].filter((p) => !a.subscriptions.some((s) => s.productId === p)).slice(0, 2)
    if (ws.length) addOpp(a, 'Expansion', 'On Ice', ws, expansionArr(a, ws)).reason = pick(ON_ICE_REASONS.slice(3))
  }

  // Pass 3: field crops, on its own stream.
  rng = mulberry32(GRAIN_SEED)
  const grain = Array.from({ length: grainCount }, (_, i) => generateGrainAccount(i, used))
  accounts.push(...grain)
  addContracts(grain)
  const grainSignals = addSignals(80, grain, grainStateSignal, [['Leadership Change', 18], ['Ownership Change', 10], ['Expansion', 22], ['Contraction', 8], ['Integrator / Packer Change', 12], ['Financial', 14], ['Biosecurity', 8], ['Regulatory', 8]])
  const firstGrainOpp = opportunities.length
  addOpps(grain, {
    logo: [['Prospect', 'Demo', 'Negotiation', 'Closed Lost', 'On Ice'], [30, 40, 10, 10, 8]],
    expansion: [['Prospect', 'Demo', 'Negotiation', 'Closed Won', 'On Ice'], [30, 40, 10, 8, 6]],
    renewal: [['Prospect', 'Demo', 'Negotiation'], [30, 50, 20]],
  })
  for (const o of opportunities.slice(firstGrainOpp)) {
    if (o.stage === 'On Ice') o.reason = pick(['Budget frozen until after harvest', 'Revisit after the lender review', 'Waiting on the new farm manager', 'Revisit next budget cycle'])
    if (o.stage === 'Closed Lost') o.reason = pick(['Lost to a competitor on price', 'Stayed with spreadsheets', 'No budget this year', 'Went with the equipment dealer bundle'])
  }
  for (const a of sample(grain.filter((g) => g.status === 'Customer'), 18)) addWonHistory(a)
  addOutreach(grainSignals, Object.fromEntries(grain.map((a) => [a.id, a])))
  addActivities(grain, ['Pre-harvest check-in. Yield maps syncing from the combine.', 'Walked the farm manager through bin alerts.', 'Discussed adding the leased ground to FieldTrack.', 'Support ticket on a bin sensor resolved.', 'Owner asked for a nitrogen report by field.'])

  // Pass 4: pipeline history, on its own stream. Every deal gets the date it entered its
  // stage, reps have recent contact on most open deals, and a few deals slipped past
  // their expected close, so Pipeline Review's stale and past-due flags have real cases.
  rng = mulberry32(PIPELINE_SEED)
  const accountById = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const noteById = Object.fromEntries(activities.map((v) => [v.id, v]))
  const worked = new Set<string>()
  const today = iso(0)
  for (const o of opportunities) {
    if (isClosedStage(o.stage)) {
      o.stageChangedAt = o.closeDate < today ? o.closeDate : today
      // A deal is created before it closes.
      if (o.createdAt > o.stageChangedAt) o.createdAt = new Date(new Date(o.stageChangedAt).getTime() - randInt(20, 90) * DAY).toISOString()
      continue
    }
    // Prospects sit where they were created; later stages moved some time after.
    const created = new Date(o.createdAt).getTime()
    o.stageChangedAt = o.stage === 'Prospect' ? o.createdAt : new Date(created + (TODAY.getTime() - created) * rand(0.25, 0.95)).toISOString()
    if (o.stage === 'Negotiation') o.negotiationStartedAt = o.stageChangedAt
    if (o.stage === 'On Ice') continue
    if (chance(0.09)) o.closeDate = iso(-randInt(2, 40))
    const a = accountById[o.accountId]
    if (worked.has(a.id)) continue
    worked.add(a.id)
    a.lastContact = chance(0.8) ? iso(-randInt(1, 21)) : iso(-randInt(32, 80))
    if (noteById[`V-${a.id}`]) noteById[`V-${a.id}`].date = a.lastContact
  }

  // Pass 5: the rep's notes on lost and on-ice deals, on their own stream. Reconnects read
  // these: each note says why the deal stalled and when (or on what) to come back.
  rng = mulberry32(NOTES_SEED)
  const monthName = (iso: string, addMonths: number) => {
    const d = new Date(iso)
    d.setMonth(d.getMonth() + addMonths)
    return d.toLocaleDateString('en-US', { month: 'long' })
  }
  // Notes follow the operation: no PRRS on a cattle ranch, no barns or HerdTrack on a wheat farm.
  const NOTE: Record<string, (a: Account, at: string) => string> = {
    'Lost to a competitor on price': (a, at) => `Lost to ${a.competitor ?? 'a competitor'} on price. They signed a 12-month term; the owner said to call in ${monthName(at, 10)}, before it renews, and he'd look at us again.`,
    'Stayed with spreadsheets': (a) =>
      a.species === 'Grain'
        ? 'Went back to spreadsheets for now. The owner liked the yield maps; revisit when they expand acres or bring on a new farm manager.'
        : a.species === 'Cattle'
          ? 'Went back to spreadsheets for now. The GM liked the herd inventory reports; revisit when they expand the herd or hire a production manager.'
          : 'Went back to spreadsheets for now. The GM liked the closeout reports; revisit when they add the next barn or hire a production manager.',
    'No budget this year': () => 'No budget this year. The CFO said to come back with a proposal in January for next year’s budget.',
    "Chose their integrator's system": (a) =>
      a.species === 'Cattle' ? 'Chose the packer’s system. Their packer agreement comes up in the spring; ask again if they switch packers.' : 'Chose the integrator’s system. Their integrator contract comes up in the spring; ask again if they switch integrators.',
    'Decision maker left before signing': () => 'The owner’s son was driving the deal and left the operation before signing. Wait for the new manager, then reintroduce.',
    'Went with the equipment dealer bundle': () => 'Took the equipment dealer’s software bundle. It’s weak on agronomy; check in after harvest when they review yields.',
    'Budget frozen until after harvest': (a) => `Budget frozen until after harvest. Call back in early November; the owner was keen on ${a.species === 'Grain' ? 'grain bin' : 'feed bin'} monitoring.`,
    'Waiting on integrator approval': (a) =>
      a.species === 'Cattle' ? 'Waiting on the packer to approve sharing herd data with a third party. Follow up in 60 days.' : 'Waiting on the integrator to approve third-party sensors. Follow up in 60 days.',
    'Paused after a herd health break': (a) => `Paused after ${a.species === 'Cattle' ? 'a BRD outbreak' : 'a PRRS break'}. Give them 90 days to get the herd stable, then check in.`,
    'Revisit after the lender review': (a) =>
      a.species === 'Grain'
        ? 'Revisit after the lender review this fall. Their banker wants field-level yield and input records, which FieldTrack would give them.'
        : 'Revisit after the lender review this fall. Their banker wants production records, which HerdTrack would give them.',
    'Champion left the company': (a) => `Our champion, the ${a.species === 'Grain' ? 'farm manager' : 'production manager'}, left. Find the replacement and restart the conversation.`,
    'Revisit next budget cycle': () => 'Asked us to revisit in the next budget cycle, in January.',
    'Waiting on the new farm manager': () => 'A new farm manager starts next month; reintroduce FieldTrack once they’re settled.',
  }
  const LATER = (a: Account) => [
    'Ran into the owner at the county fair. Asked how pricing would look for next year.',
    a.species === 'Grain'
      ? 'Owner called about sensors for the new grain bins. Said to send something over.'
      : a.species === 'Hog' || a.segment === 'Dairy'
        ? 'Owner called about sensor options for the new barn. Said to send something over.'
        : 'Owner called about stock-water monitoring for the new pasture ground. Said to send something over.',
    `Saw them at the ${a.species === 'Hog' ? 'state pork expo' : a.species === 'Cattle' ? 'state cattlemen’s convention' : 'state farm show'}; they’re still frustrated with their current system.`,
    'CFO emailed asking for a reference customer in their area.',
  ]
  const DAY_MS = 86400000
  // Only a real vendor has a contract that renews.
  const vendor = (a: Account) => !!a.competitor && !/spreadsheet|paper|none/i.test(a.competitor)
  const termFrom = new Map<string, string>()
  for (const o of opportunities) {
    if (o.stage !== 'Closed Lost' && o.stage !== 'On Ice') continue
    const a = accountById[o.accountId]
    // Pass 1 seeds some lost new-logo deals without a reason; give them one so there's a note to go on.
    if (!o.reason) o.reason = pick(o.stage === 'On Ice' ? ON_ICE_REASONS : LOST_REASONS)
    if (o.reason === 'Lost to a competitor on price' && !vendor(a)) o.reason = 'Stayed with spreadsheets'
    const at = o.stageChangedAt ?? o.closeDate
    const text = NOTE[o.reason]?.(a, at)
    if (!text) continue
    // The competitor contract renews at the end of the 12-month term the note mentions (the latest loss wins).
    if (o.reason === 'Lost to a competitor on price' && at > (termFrom.get(a.id) ?? '')) {
      termFrom.set(a.id, at)
      const renews = new Date(at)
      renews.setMonth(renews.getMonth() + 12)
      a.competitorRenewal = renews.toISOString()
    }
    activities.push({ id: `V-R-${o.id}`, accountId: a.id, date: at, author: a.rep, kind: chance(0.6) ? 'Note' : 'Call', text })
    // Some accounts warmed up again since.
    const age = (TODAY.getTime() - new Date(at).getTime()) / DAY_MS
    if (age > 40 && chance(0.3)) {
      const later = new Date(new Date(at).getTime() + rand(20, Math.max(21, age - 5)) * DAY_MS).toISOString()
      activities.push({ id: `V-R2-${o.id}`, accountId: a.id, date: later, author: a.rep, kind: 'Note', text: pick(LATER(a)) })
    }
  }

  // Geography tags on every signal: region from the state; county for account signals
  // (market-wide rules and outbreaks are statewide).
  for (const s of signals) {
    if (s.state) s.region = STATES[s.state]?.region
    if (s.accountId) s.county = accountById[s.accountId]?.county
  }

  signals.sort((a, b) => b.date.localeCompare(a.date))
  return { accounts, contracts, opportunities, signals, outreach, activities }
}

export { STATES }
