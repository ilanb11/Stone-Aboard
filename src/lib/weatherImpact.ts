import { useEffect, useMemo, useState } from 'react'
import type { Account, RegionName, Species } from '../types'
import { STATES } from '../data/geo'
import { loadDailySeries, thi, toF, type DailySeries, type DayForecast, type ForecastPoint } from './weather'

// Weather impact: only significant events at customer and prospect locations.
// One Open-Meteo point per county we have accounts in; 30 days of history (for
// drought) plus the 7-day forecast. Thresholds are listed in EVENT_RULES.

export type WeatherEventKind = 'Heat wave' | 'Drought' | 'Flood' | 'Blizzard' | 'Early frost'
export const EVENT_KINDS: WeatherEventKind[] = ['Heat wave', 'Drought', 'Flood', 'Blizzard', 'Early frost']

export const EVENT_RULES: Record<WeatherEventKind, string> = {
  'Heat wave': 'Highs of 95°F or more for 3 days in a row, or 3 days in a row at a livestock heat index (THI) of 79 or more (livestock only).',
  Drought: 'Half an inch of rain or less over the last 30 days while evaporation outpaced rain by 3.5 inches or more. East of the Rockies only, where a dry month is unusual.',
  Flood: '3 inches of rain in a day, or 4 inches over 3 days.',
  Blizzard: '6 inches of snow in a day with gusts of 35 mph or more, or 10 inches of snow.',
  'Early frost': 'A low of 32°F or colder at least a week before the usual first fall frost for that latitude.',
}

/** Which operations each event affects. */
export const EVENT_OPERATIONS: Record<WeatherEventKind, Species[]> = {
  'Heat wave': ['Hog', 'Cattle', 'Grain'],
  Drought: ['Grain', 'Cattle'],
  Flood: ['Hog', 'Cattle', 'Grain'],
  Blizzard: ['Hog', 'Cattle'],
  'Early frost': ['Grain', 'Cattle'],
}

export interface WeatherEvent {
  kind: WeatherEventKind
  start: string
  end: string
  severity: 'Severe' | 'Significant'
  summary: string
  /** For ranking the worst location of a group. */
  peak: number
  /** Narrower than EVENT_OPERATIONS when only some operations are at risk. */
  operations?: Species[]
}

const inches = (mm: number) => `${(mm / 25.4).toFixed(1)}"`
const doy = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000)
}
/** Usual first fall frost: about Oct 15 at 40°N, roughly 3.6 days earlier per degree north. */
export const usualFirstFrost = (lat: number) => 288 + (40 - lat) * 3.6

/** Consecutive runs of days that pass a test. */
function runs(days: DayForecast[], test: (d: DayForecast) => boolean): DayForecast[][] {
  const out: DayForecast[][] = []
  let cur: DayForecast[] = []
  for (const d of days) {
    if (test(d)) cur.push(d)
    else if (cur.length) (out.push(cur), (cur = []))
  }
  if (cur.length) out.push(cur)
  return out
}

export function detectEvents(series: DayForecast[], { lat, lon }: { lat: number; lon: number }, today: string): WeatherEvent[] {
  const past = series.filter((d) => d.date < today).slice(-30)
  const ahead = series.filter((d) => d.date >= today)
  const events: WeatherEvent[] = []

  // Heat wave
  const hot = runs(ahead, (d) => d.tmax >= 35).filter((r) => r.length >= 3)
  const thiRun = runs(ahead, (d) => thi(d.tmax, d.rh) >= 79).filter((r) => r.length >= 3)
  const heat = hot.sort((a, b) => b.length - a.length)[0] ?? thiRun.sort((a, b) => b.length - a.length)[0]
  if (heat) {
    const hi = Math.max(...heat.map((d) => d.tmax))
    const t = Math.max(...heat.map((d) => thi(d.tmax, d.rh)))
    // Highs of 95°F stress crops too; a humid heat index at lower highs is a livestock risk.
    events.push({ kind: 'Heat wave', start: heat[0].date, end: heat[heat.length - 1].date, severity: hi >= 37.8 || t >= 84 ? 'Severe' : 'Significant', summary: `${heat.length} days with highs up to ${toF(hi)}°F, livestock heat index up to ${Math.round(t)}`, peak: t, operations: hot.length ? undefined : ['Hog', 'Cattle'] })
  }

  // Drought (needs the history)
  if (past.length >= 25 && lon > -104) {
    const rain = past.reduce((s, d) => s + d.precip, 0)
    const et = past.reduce((s, d) => s + (d.et0 ?? 0), 0)
    if (rain <= 12.7 && et - rain >= 90)
      events.push({ kind: 'Drought', start: past[0].date, end: today, severity: rain <= 5 && et - rain >= 127 ? 'Severe' : 'Significant', summary: `${inches(rain)} of rain in 30 days against ${inches(et)} of evaporation`, peak: et - rain })
  }

  // Flood
  let flood: WeatherEvent | undefined
  ahead.forEach((d, i) => {
    const three = ahead.slice(i, i + 3)
    const sum3 = three.reduce((s, x) => s + x.precip, 0)
    if (d.precip < 76 && sum3 < 102) return
    const severe = d.precip >= 102 || sum3 >= 152
    const cand: WeatherEvent = { kind: 'Flood', start: d.date, end: d.precip >= 76 ? d.date : three[three.length - 1].date, severity: severe ? 'Severe' : 'Significant', summary: d.precip >= 76 ? `${inches(d.precip)} of rain in one day` : `${inches(sum3)} of rain over 3 days`, peak: Math.max(d.precip, sum3) }
    if (!flood || cand.peak > flood.peak) flood = cand
  })
  if (flood) events.push(flood)

  // Blizzard or heavy snow
  const snowDay = ahead.filter((d) => (d.snow >= 15 && (d.gust ?? d.wind) >= 56) || d.snow >= 25).sort((a, b) => b.snow - a.snow)[0]
  if (snowDay) {
    const gust = snowDay.gust ?? snowDay.wind
    events.push({ kind: 'Blizzard', start: snowDay.date, end: snowDay.date, severity: snowDay.snow >= 30 || gust >= 72 ? 'Severe' : 'Significant', summary: `${inches(snowDay.snow * 10)} of snow with gusts to ${Math.round(gust / 1.609)} mph`, peak: snowDay.snow })
  }

  // Early frost
  const frost = ahead.filter((d) => d.tmin <= 0 && doy(d.date) >= 213 && doy(d.date) <= usualFirstFrost(lat) - 7).sort((a, b) => a.tmin - b.tmin)[0]
  if (frost) {
    const early = Math.round(usualFirstFrost(lat) - doy(frost.date))
    events.push({ kind: 'Early frost', start: frost.date, end: frost.date, severity: frost.tmin <= -2.2 ? 'Severe' : 'Significant', summary: `Low of ${toF(frost.tmin)}°F, about ${early} days before the usual first frost`, peak: -frost.tmin })
  }
  return events
}

// ---------- grouping for the page ----------

export interface ImpactGroup {
  id: string
  kind: WeatherEventKind
  state: string
  region: RegionName
  counties: string[]
  start: string
  end: string
  severity: WeatherEvent['severity']
  summary: string
  accounts: Account[]
}

export interface WeatherImpact {
  status: 'loading' | 'ready'
  source?: DailySeries['source']
  fetchedAt?: string
  points: number
  groups: ImpactGroup[]
}

const countyKey = (a: Pick<Account, 'state' | 'county'>) => `${a.state}|${a.county}`

/** Forecast points: one per county with a customer or prospect, at the mean of its accounts. */
export function countyPoints(accounts: Account[]): ForecastPoint[] {
  const sums = new Map<string, [number, number, number]>()
  for (const a of accounts) {
    if (a.status === 'Churned') continue
    const s = sums.get(countyKey(a)) ?? [0, 0, 0]
    s[0] += a.lat
    s[1] += a.lon
    s[2]++
    sums.set(countyKey(a), s)
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, [la, lo, n]]) => ({ key, lat: la / n, lon: lo / n }))
}

export function groupImpacts(series: DailySeries, points: ForecastPoint[], accounts: Account[], today: string): ImpactGroup[] {
  const byCounty = new Map<string, Account[]>()
  for (const a of accounts) if (a.status !== 'Churned') byCounty.set(countyKey(a), [...(byCounty.get(countyKey(a)) ?? []), a])
  const groups = new Map<string, ImpactGroup & { best: number }>()
  for (const p of points) {
    const days = series.byKey[p.key]
    if (!days) continue
    const [state, county] = p.key.split('|')
    for (const e of detectEvents(days, p, today)) {
      const hit = (byCounty.get(p.key) ?? []).filter((a) => (e.operations ?? EVENT_OPERATIONS[e.kind]).includes(a.species))
      if (!hit.length) continue
      const id = `${e.kind}|${state}`
      const g = groups.get(id) ?? { id, kind: e.kind, state, region: STATES[state]?.region ?? 'Corn Belt', counties: [], start: e.start, end: e.end, severity: e.severity, summary: e.summary, accounts: [], best: -Infinity }
      g.counties.push(county)
      g.accounts.push(...hit)
      if (e.start < g.start) g.start = e.start
      if (e.end > g.end) g.end = e.end
      if (e.severity === 'Severe') g.severity = 'Severe'
      if (e.peak > g.best) (g.best = e.peak), (g.summary = e.summary)
      groups.set(id, g)
    }
  }
  const custs = (g: ImpactGroup) => g.accounts.filter((a) => a.status === 'Customer').length
  return [...groups.values()]
    .map(({ best: _best, ...g }) => ({ ...g, accounts: g.accounts.sort((x, y) => (x.status === y.status ? x.name.localeCompare(y.name) : x.status === 'Customer' ? -1 : 1)) }))
    .sort((a, b) => (a.severity === b.severity ? custs(b) - custs(a) || b.accounts.length - a.accounts.length : a.severity === 'Severe' ? -1 : 1))
}

export function useWeatherImpact(accounts: Account[]): WeatherImpact {
  const points = useMemo(() => countyPoints(accounts), [accounts])
  const [series, setSeries] = useState<DailySeries | null>(null)
  useEffect(() => {
    let live = true
    loadDailySeries(points).then((s) => live && setSeries(s))
    return () => {
      live = false
    }
  }, [points])
  return useMemo(() => {
    if (!series) return { status: 'loading', points: points.length, groups: [] }
    const today = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD, matching Open-Meteo's local dates
    return { status: 'ready', source: series.source, fetchedAt: series.fetchedAt, points: points.length, groups: groupImpacts(series, points, accounts, today) }
  }, [series, points, accounts])
}
