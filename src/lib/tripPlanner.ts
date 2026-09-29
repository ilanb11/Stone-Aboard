import type { Account, Opportunity, Outreach } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT } from '../data/products'
import { pickContact } from './outreach'
import type { Reconnect } from './reconnects'

// Trip planning: pick where you're going and when, and the CRM proposes customer
// meetings in the area, ranked by chance to close (open deals) or to reconnect
// (lost and on-ice deals due a follow-up), laid out as a day-by-day route.

export interface Trip {
  id: string
  state: string
  county?: string
  /** YYYY-MM-DD */
  start: string
  end: string
  radiusMiles: number
  createdAt: string
}

export type MeetingKind = 'Close' | 'Reconnect'

export interface MeetingOption {
  account: Account
  kind: MeetingKind
  /** 0 to 100: win probability for Close, reconnect score for Reconnect. */
  score: number
  why: string
  miles: number
  opp?: Opportunity
  reconnect?: Reconnect
}

export interface Stop {
  option: MeetingOption
  day: string
  time: string
  /** From the trip base (first stop) or the previous stop. */
  driveMiles: number
}

export interface LatLon {
  lat: number
  lon: number
}

/**
 * Where farms and counties sit. The seed's lat/lon is only a point somewhere in the
 * state, so trips measure from the county-placed points the heat map draws.
 */
export interface TripGeo {
  farm: (a: Account) => LatLon
  county: (state: string, county: string) => LatLon | undefined
}

const R = 3958.8
export function miles(a: LatLon, b: LatLon) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** YYYY-MM-DD in local time. toISOString gives the UTC date, a day ahead on US evenings. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const inTripCounty = (t: Pick<Trip, 'state' | 'county'>, a: Account) => !!t.county && a.state === t.state && a.county === t.county

/** Where the trip is based: the middle of the county, else the middle of the state's farms. */
export function tripBase(t: Pick<Trip, 'state' | 'county'>, accounts: Account[], geo: TripGeo): LatLon | null {
  const center = t.county ? geo.county(t.state, t.county) : undefined
  if (center) return center
  const inCounty = accounts.filter((a) => inTripCounty(t, a))
  const pool = (inCounty.length ? inCounty : accounts.filter((a) => a.state === t.state)).map(geo.farm)
  if (!pool.length) return null
  return { lat: pool.reduce((s, p) => s + p.lat, 0) / pool.length, lon: pool.reduce((s, p) => s + p.lon, 0) / pool.length }
}

/** Weekdays left on the trip: days before today can't take meetings any more. */
export const tripDays = (t: Pick<Trip, 'start' | 'end'>, today = localDay()) => {
  const out: string[] = []
  const d = new Date((t.start > today ? t.start : today) + 'T12:00:00')
  const end = new Date(t.end + 'T12:00:00')
  while (d <= end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(localDay(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export function meetingOptions(t: Trip, accounts: Account[], opps: Opportunity[], winProb: Map<string, number>, reconnects: Reconnect[], geo: TripGeo): MeetingOption[] {
  const base = tripBase(t, accounts, geo)
  if (!base) return []
  const near = new Map<string, number>()
  for (const a of accounts) {
    if (a.status === 'Churned') continue
    const m = miles(base, geo.farm(a))
    // A county trip always covers its own county, even where it reaches past the radius.
    if (m <= t.radiusMiles || inTripCounty(t, a)) near.set(a.id, m)
  }
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const out: MeetingOption[] = []
  const seen = new Set<string>()
  for (const o of opps) {
    if (!['Prospect', 'Demo', 'Negotiation'].includes(o.stage) || !near.has(o.accountId)) continue
    const p = Math.round((winProb.get(o.id) ?? 0) * 100)
    const cur = out.find((x) => x.account.id === o.accountId)
    if (cur && cur.score >= p) continue
    if (cur) out.splice(out.indexOf(cur), 1)
    out.push({ account: byId[o.accountId], kind: 'Close', score: p + (o.stage === 'Negotiation' ? 8 : 0), why: `${o.stage}, ${p}% win probability, ${o.type.toLowerCase()} worth $${Math.round(o.arr / 1000)}K`, miles: near.get(o.accountId)!, opp: o })
    seen.add(o.accountId)
  }
  for (const r of reconnects) {
    if (r.timing === 'Later' || !near.has(r.account.id) || seen.has(r.account.id)) continue
    out.push({ account: r.account, kind: 'Reconnect', score: r.score, why: r.reasons[0] ?? 'Due a follow-up', miles: near.get(r.account.id)!, reconnect: r, opp: r.opp })
  }
  return out.sort((x, y) => y.score - x.score || x.miles - y.miles)
}

const TIMES = ['9:00 AM', '11:30 AM', '2:30 PM']

/** Up to three meetings a day. Each day starts from the best option left and adds the best ones close to it. */
export function planItinerary(t: Trip, options: MeetingOption[], accounts: Account[], geo: TripGeo): Stop[][] {
  const base = tripBase(t, accounts, geo)
  const at = (o: MeetingOption) => geo.farm(o.account)
  const left = [...options]
  const plan: Stop[][] = []
  for (const day of tripDays(t)) {
    if (!left.length) break
    const anchor = left.shift()!
    const picks = [anchor]
    const nearby = left
      .map((o) => ({ o, d: miles(at(anchor), at(o)) }))
      .filter((x) => x.d <= 45)
      .sort((a, b) => b.o.score - b.d * 0.4 - (a.o.score - a.d * 0.4))
      .slice(0, 2)
    for (const { o } of nearby) {
      picks.push(o)
      left.splice(left.indexOf(o), 1)
    }
    // Drive order: nearest neighbour from the base.
    const route: MeetingOption[] = []
    let from = base ?? at(anchor)
    const pool = [...picks]
    while (pool.length) {
      pool.sort((a, b) => miles(from, at(a)) - miles(from, at(b)))
      const next = pool.shift()!
      route.push(next)
      from = at(next)
    }
    plan.push(route.map((o, i) => ({ option: o, day, time: TIMES[i], driveMiles: Math.round(miles(i ? at(route[i - 1]) : base ?? at(o), at(o))) })))
  }
  return plan
}

const longDay = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

/** Meeting request for one stop. Always a draft. */
export function draftMeetingEmail(s: Stop, t: Trip, traveler: string): Omit<Outreach, 'id' | 'createdAt' | 'status'> {
  const a = s.option.account
  const c = s.option.reconnect?.contact ?? pickContact(a, ['Owner', 'GM', 'CFO'])
  const first = c.name.split(' ')[0]
  const o = s.option.opp
  const products = (o?.products ?? []).map((p) => PRODUCT[p]?.name).filter(Boolean)
  const what = products.length ? products.slice(0, 2).join(' and ') : 'our platform'
  const purpose =
    s.option.kind === 'Reconnect'
      ? `${s.option.reconnect?.angle ?? ''} I'd like to catch up on where things stand with ${what}.`.trim()
      : o?.stage === 'Negotiation'
        ? 'I’d like to walk through the proposal together and answer anything that’s still open before you decide.'
        : o?.stage === 'Demo'
          ? `I can show you ${what} on your own records, which usually answers more than a slide deck.`
          : `I’d like to show you how operations near you are using ${what}.`
  // The stop's own county: a statewide or wide-radius trip reaches farms outside the trip's county.
  const place = `${a.county} County`
  const trip = `${t.county ? `${t.county} County, ` : ''}${STATES[t.state]?.name ?? t.state}`
  const co = a.rep !== traveler ? ` ${a.rep}, who looks after your account, may join us.` : ''
  return {
    accountId: a.id,
    tripId: t.id,
    trigger: `Trip to ${trip} (${s.option.kind === 'Close' ? 'close' : 'reconnect'})`,
    playbook: 'trip-meeting',
    contactName: c.name,
    contactEmail: c.email,
    subject: `Visiting ${place} on ${longDay(s.day)}`,
    body: [
      `Hi ${first},`,
      '',
      `I’ll be in ${place} on ${longDay(s.day)} and would love to stop by ${a.name} for 30 minutes around ${s.time}. ${purpose}${co}`,
      '',
      'Does that work? Happy to move the time if another slot is better.',
      '',
      'Best,',
      traveler,
      'ThiboLiSoft',
    ].join('\n'),
    auto: false,
  }
}
