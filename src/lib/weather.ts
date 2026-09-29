import { useEffect, useState } from 'react'
import type { Account, Segment, Species } from '../types'
import { STATES } from '../data/geo'
import type { WeatherKind } from './outreach'

export interface DayForecast {
  date: string
  tmax: number // °C
  tmin: number
  rh: number // minimum (afternoon) relative humidity %
  precip: number // mm
  snow: number // cm
  wind: number // km/h max
}

export interface WeatherState {
  status: 'loading' | 'ready'
  source: 'Open-Meteo live forecast' | 'Modeled forecast (offline)'
  fetchedAt?: string
  byState: Record<string, DayForecast[]>
}

/** Temperature-humidity index (NRC 1971) using the daily high and afternoon (minimum) humidity. */
export const thi = (tC: number, rh: number) => 1.8 * tC + 32 - (0.55 - 0.0055 * rh) * (1.8 * tC - 26)
export const toF = (c: number) => Math.round(c * 1.8 + 32)

export interface WeatherRisk {
  risk: number
  kind?: WeatherKind
  day?: string
  label: string
  detail: string
}

const dow = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export function assessWeather(days: DayForecast[] | undefined, segment: Segment, species: Species): WeatherRisk {
  if (!days?.length) return { risk: 0, label: 'No forecast', detail: '' }
  const outdoor = ['Cow-Calf', 'Stocker / Backgrounder', 'Feedlot'].includes(segment)
  let best: WeatherRisk = { risk: 5, label: 'Normal', detail: 'No weather stress expected in the next 7 days.' }
  const consider = (r: WeatherRisk) => {
    if (r.risk > best.risk) best = r
  }
  for (const d of days) {
    const t = thi(d.tmax, d.rh)
    // LCI bands: <75 normal (dairy starts at 72), 75-78 alert, 79-83 danger, 84+ emergency.
    let heat = t < 72 ? 0 : t < 75 ? (segment === 'Dairy' ? 12 : 0) : t < 79 ? 25 : t < 84 ? 55 : 80
    if (heat > 0) {
      heat += species === 'Hog' ? 6 : segment === 'Dairy' ? 10 : segment === 'Cow-Calf' ? -8 : 0
      const band = t < 75 ? 'dairy alert' : t < 79 ? 'alert' : t < 84 ? 'danger' : 'emergency'
      consider({ risk: Math.min(100, heat), kind: 'heat', day: d.date, label: `Heat stress (THI ${Math.round(t)})`, detail: `a THI of ${Math.round(t)} (${band}) with highs near ${toF(d.tmax)}°F on ${dow(d.date)}` })
    }
    let cold = d.tmin <= -25 ? 85 : d.tmin <= -18 ? 65 : d.tmin <= -10 && d.wind >= 40 ? 60 : d.tmin <= -10 ? 30 : 0
    if (d.snow >= 15) cold = Math.max(cold, 75)
    if (cold > 0) {
      cold += outdoor ? 10 : -12
      consider({ risk: Math.max(0, Math.min(100, cold)), kind: 'cold', day: d.date, label: d.snow >= 15 ? 'Blizzard / heavy snow' : 'Cold stress', detail: `lows near ${toF(d.tmin)}°F${d.snow >= 5 ? ` with ${Math.round(d.snow / 2.54)}" of snow` : ''}${d.wind >= 40 ? ' and strong wind' : ''} on ${dow(d.date)}` })
    }
    let rain = d.precip >= 75 ? 80 : d.precip >= 50 ? 60 : d.precip >= 30 ? 30 : 0
    if (rain > 0) {
      rain += species === 'Hog' ? 10 : 0
      consider({ risk: Math.min(100, rain), kind: 'rain', day: d.date, label: 'Heavy rain', detail: `${(d.precip / 25.4).toFixed(1)}" of rain on ${dow(d.date)}` })
    }
  }
  if (segment === 'Cow-Calf' || segment === 'Stocker / Backgrounder') {
    const rain7 = days.reduce((s, d) => s + d.precip, 0)
    const avgMax = days.reduce((s, d) => s + d.tmax, 0) / days.length
    if (rain7 < 3 && avgMax > 30) consider({ risk: avgMax > 34 ? 70 : 55, kind: 'dry', day: days[0].date, label: 'Hot & dry: pasture stress', detail: `a dry week (${(rain7 / 25.4).toFixed(2)}" rain) with average highs of ${toF(avgMax)}°F` })
  }
  return best
}

// ---------- fetching ----------
let cache: WeatherState | null = null
let inflight: Promise<WeatherState> | null = null

function modeled(codes: string[], pts: Record<string, [number, number]>): Record<string, DayForecast[]> {
  const out: Record<string, DayForecast[]> = {}
  const month = new Date().getMonth()
  const season = Math.cos(((month - 6.5) / 12) * 2 * Math.PI) // 1 in July, -1 in January
  codes.forEach((code, ci) => {
    const [lat] = pts[code]
    out[code] = Array.from({ length: 7 }, (_, i) => {
      const seed = Math.sin((ci + 1) * 97.3 + i * 13.1) * 43758.5453
      const r = seed - Math.floor(seed)
      const base = 27 - (lat - 32) * 0.9 + season * 9
      const tmax = base + (r - 0.5) * 10 + (ci % 7 === i ? 6 : 0)
      const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10)
      return { date: d, tmax, tmin: tmax - 11 - r * 5, rh: 30 + r * 35, precip: r > 0.82 ? r * 60 : r * 4, snow: tmax < 0 && r > 0.7 ? r * 20 : 0, wind: 10 + r * 35 }
    })
  })
  return out
}

export function loadWeather(accounts: Account[]): Promise<WeatherState> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  // One forecast point per state: the centroid of that state's accounts.
  const sums: Record<string, [number, number, number]> = {}
  for (const a of accounts) {
    const s = (sums[a.state] ??= [0, 0, 0])
    s[0] += a.lat
    s[1] += a.lon
    s[2]++
  }
  const codes = Object.keys(sums).filter((c) => STATES[c])
  const pts: Record<string, [number, number]> = Object.fromEntries(codes.map((c) => [c, [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]]]))
  const url =
    'https://api.open-meteo.com/v1/forecast?' +
    new URLSearchParams({
      latitude: codes.map((c) => pts[c][0].toFixed(3)).join(','),
      longitude: codes.map((c) => pts[c][1].toFixed(3)).join(','),
      daily: 'temperature_2m_max,temperature_2m_min,relative_humidity_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max',
      timezone: 'auto',
      forecast_days: '7',
    })
  // The published demo link can't reach outside APIs, so it uses the modeled forecast.
  inflight = (import.meta.env.VITE_ARTIFACT ? Promise.reject(new Error('offline demo')) : fetch(url))
    .then((r) => {
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
      return r.json()
    })
    .then((json) => {
      const arr = Array.isArray(json) ? json : [json]
      const byState: Record<string, DayForecast[]> = {}
      arr.forEach((loc: { daily: Record<string, (number | null)[]> & { time: string[] } }, i: number) => {
        const d = loc.daily
        byState[codes[i]] = d.time.map((t, j) => ({
          date: t,
          tmax: d.temperature_2m_max[j] ?? 20,
          tmin: d.temperature_2m_min[j] ?? 10,
          rh: d.relative_humidity_2m_min[j] ?? 45,
          precip: d.precipitation_sum[j] ?? 0,
          snow: d.snowfall_sum[j] ?? 0,
          wind: d.wind_speed_10m_max[j] ?? 10,
        }))
      })
      cache = { status: 'ready', source: 'Open-Meteo live forecast', fetchedAt: new Date().toISOString(), byState }
      return cache
    })
    .catch(() => {
      cache = { status: 'ready', source: 'Modeled forecast (offline)', fetchedAt: new Date().toISOString(), byState: modeled(codes, pts) }
      return cache
    })
  return inflight
}

export function useWeather(accounts: Account[]): WeatherState {
  const [w, setW] = useState<WeatherState>(cache ?? { status: 'loading', source: 'Open-Meteo live forecast', byState: {} })
  useEffect(() => {
    let live = true
    loadWeather(accounts).then((s) => live && setW(s))
    return () => {
      live = false
    }
  }, [accounts])
  return w
}
