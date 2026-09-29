import { feature } from 'topojson-client'
import { geoBounds, geoContains } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'
import usTopo from 'us-atlas/states-10m.json'
import type { Account, Activity, CattleSegment, Contact, Contract, HogSegment, Opportunity, OppStage, Outreach, Ownership, PriceMechanism, Redline, Segment, Signal, SignalType, Species, Subscription } from '../types'
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
const rng = mulberry32(4172026)
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
  const hog = a.species === 'Hog'
  const where = `${a.county} Co., ${a.state}`
  const sig = (headline: string, detail: string, severity: Signal['severity']): Signal => ({ id: '', date, type, headline, detail, accountId: a.id, state: a.state, severity, source: pick(SOURCES) })
  switch (type) {
    case 'Leadership Change': {
      const role = pick(['GM', 'CFO', 'Operations'] as const)
      const title = role === 'GM' ? 'General Manager' : role === 'CFO' ? 'Chief Financial Officer' : hog ? 'Director of Production' : 'Operations Manager'
      const person = `${pick(FIRST)} ${pick(SURNAMES)}`
      a.contacts.push({ id: `C${Math.floor(rng() * 1e9).toString(36)}`, name: person, title, role, email: `${person.replace(' ', '.').toLowerCase()}@${slug(a.name)}.example`, since: date })
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

// ---------- assembly ----------
export interface Dataset {
  accounts: Account[]
  contracts: Contract[]
  opportunities: Opportunity[]
  signals: Signal[]
  outreach: Outreach[]
  activities: Activity[]
}

export const SEED_VERSION = 13

export function generateDataset(n = 900): Dataset {
  const used = new Set<string>()
  const accounts = Array.from({ length: n }, (_, i) => generateAccount(i, used))
  const contracts: Contract[] = []
  for (const a of accounts) {
    if (a.status !== 'Customer') continue
    const c = makeContract(a, contracts.length)
    a.contractId = c.id
    contracts.push(c)
  }

  // Signals over the last 120 days
  const signals: Signal[] = []
  for (let i = 0; i < 280; i++) {
    const date = iso(-Math.floor(Math.pow(rng(), 1.3) * 120))
    let s: Signal
    if (chance(0.78)) {
      const a = chance(0.45) ? pick(accounts.filter((x) => x.status === 'Customer')) : pick(accounts)
      const type = pickW(SIGNAL_W.map((x) => x[0]), SIGNAL_W.map((x) => x[1]))
      s = accountSignal(a, type, date)
    } else s = stateSignal(date)
    s.id = `S${String(i + 1).padStart(4, '0')}`
    signals.push(s)
  }
  signals.sort((a, b) => b.date.localeCompare(a.date))
  const ownershipAccounts = new Set(signals.filter((s) => s.type === 'Ownership Change').map((s) => s.accountId))

  // Opportunities
  const opportunities: Opportunity[] = []
  const addOpp = (a: Account, type: Opportunity['type'], stage: OppStage, products: string[], arr: number) => {
    const id = `O${String(opportunities.length + 1).padStart(4, '0')}`
    const o: Opportunity = { id, accountId: a.id, type, stage, arr: Math.round(arr), products, owner: a.rep, createdAt: iso(-randInt(5, 200)), closeDate: iso(stage.startsWith('Closed') ? -randInt(1, 120) : randInt(10, 160)) }
    if (stage === 'Negotiation') {
      const c: Contract = { ...makeContract(a, contracts.length), status: 'In Negotiation', start: iso(randInt(15, 45)), template: TEMPLATE_VERSION, redlines: redlinesFor(a, ownershipAccounts.has(a.id)), opportunityId: id }
      c.end = new Date(new Date(c.start).getTime() + c.termMonths * 30.4 * DAY).toISOString()
      contracts.push(c)
      o.contractId = c.id
    }
    opportunities.push(o)
  }
  for (const a of accounts) {
    const fit = SEGMENT_FIT[a.segment]
    if (a.status === 'Prospect' && chance(0.3)) {
      const products = fit.filter((_, i) => i < 2 || chance(0.5))
      const arr = products.reduce((s, p) => s + unitsFor(p, a) * PRODUCT[p].listPrice * (1 - expectedDiscount(2000)), 0) * 12
      addOpp(a, 'New Logo', pickW<OppStage>(['Identified', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'], [30, 25, 18, 10, 7, 10]), products, arr)
    }
    if (a.status === 'Customer') {
      const have = new Set(a.subscriptions.map((s) => s.productId))
      const ws = fit.filter((p) => !have.has(p))
      if (ws.length && chance(0.35)) {
        const products = ws.slice(0, randInt(1, ws.length))
        addOpp(a, 'Expansion', pickW<OppStage>(['Identified', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won'], [30, 25, 22, 10, 8]), products, products.reduce((s, p) => s + unitsFor(p, a) * PRODUCT[p].listPrice * 0.85, 0) * 12)
      }
      const c = contracts.find((x) => x.id === a.contractId)!
      const daysToEnd = (new Date(c.end).getTime() - TODAY.getTime()) / DAY
      if (daysToEnd < 150 && daysToEnd > 0) addOpp(a, 'Renewal', pickW<OppStage>(['Identified', 'Qualified', 'Proposal', 'Negotiation'], [30, 30, 25, 15]), a.subscriptions.map((s) => s.productId), a.subscriptions.reduce((s, x) => s + x.units * x.unitPrice, 0) * 12)
    }
  }

  // Outreach queue seeded from recent account signals
  const outreach: Outreach[] = []
  const activities: Activity[] = []
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]))
  for (const s of signals) {
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
  for (const a of accounts) {
    if (a.status !== 'Customer' || !chance(0.7)) continue
    activities.push({ id: `V-${a.id}`, accountId: a.id, date: a.lastContact, author: a.rep, kind: pick(['Call', 'Note'] as const), text: pick(['Quarterly check-in. Team happy with closeout reports.', 'Walked barn manager through the new alarm routing.', 'Discussed adding remaining sites next budget cycle.', 'Support ticket on sensor connectivity resolved.', 'Owner asked about benchmarking against similar operations.']) })
  }
  return { accounts, contracts, opportunities, signals, outreach, activities }
}

export { STATES }
