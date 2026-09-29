import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudRain, Snowflake, Sun, ThermometerSnowflake, ThermometerSun } from 'lucide-react'
import type { Account } from '../../types'
import { OPERATION_LABEL } from '../../types'
import { STATES } from '../../data/geo'
import { Card, Chip, Pill, StatusBadge } from '../../components/ui'
import { type Geo, accountInGeo } from '../../components/GeoFilter'
import { num } from '../../lib/format'
import { EVENT_KINDS, EVENT_RULES, type ImpactGroup, type WeatherEventKind, type WeatherImpact } from '../../lib/weatherImpact'
import { Pager, pageCount, pageOf } from '../../components/Pager'

export const EVENT_ICON: Record<WeatherEventKind, typeof Sun> = {
  'Heat wave': ThermometerSun,
  Drought: Sun,
  Flood: CloudRain,
  Blizzard: Snowflake,
  'Early frost': ThermometerSnowflake,
}

const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
export const eventWhen = (g: Pick<ImpactGroup, 'kind' | 'start' | 'end'>) => (g.kind === 'Drought' ? 'Last 30 days' : g.start === g.end ? day(g.start) : `${day(g.start)} to ${day(g.end)}`)
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')

/** Groups inside the geography filter, keeping only accounts inside it (a county filter narrows a state group). */
export function impactInGeo(groups: ImpactGroup[], geo: Geo): ImpactGroup[] {
  return groups
    .map((g) => ({ ...g, accounts: g.accounts.filter((a) => accountInGeo(a, geo)) }))
    .filter((g) => g.accounts.length)
    .map((g) => ({ ...g, counties: g.counties.filter((c) => geo.county === 'All' || c === geo.county) }))
}

export function SourceLine({ impact }: { impact: WeatherImpact }) {
  if (impact.status === 'loading') return <span>Checking the Open-Meteo forecast for {num(impact.points)} counties…</span>
  return (
    <span>
      {impact.source === 'Open-Meteo live forecast' ? 'Open-Meteo live forecast' : 'Modeled forecast: live Open-Meteo data was not reachable, so these events are simulated'}, checked {time(impact.fetchedAt)} for {num(impact.points)} counties with customers or prospects.
    </span>
  )
}

function AccountLine({ a }: { a: Account }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <span className="min-w-0">
        <Link to={`/accounts/${a.id}`} className="text-[14px] text-ink underline-offset-4 hover:underline">
          {a.name}
        </Link>
        <span className="ml-2 text-[12px] text-muted">
          {OPERATION_LABEL[a.species]}, {a.county} County
        </span>
      </span>
      <span className="flex items-center gap-3 text-[12px] text-muted">
        <Chip tone={a.status === 'Customer' ? 'lime' : 'neutral'}>{a.status}</Chip>
        <span>{a.rep}</span>
      </span>
    </li>
  )
}

function ImpactCard({ g }: { g: ImpactGroup }) {
  const [all, setAll] = useState(false)
  const Icon = EVENT_ICON[g.kind]
  const custs = g.accounts.filter((a) => a.status === 'Customer').length
  const shown = all ? g.accounts : g.accounts.slice(0, 6)
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-ink" aria-hidden>
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[17px] font-medium leading-snug text-ink">
              {g.kind} in {STATES[g.state]?.name ?? g.state}
            </h3>
            <div className="mt-0.5 text-[13px] text-muted">
              {g.region} · {g.counties.map((c) => `${c}`).join(', ')} {g.counties.length === 1 ? 'County' : 'counties'} · {eventWhen(g)}
            </div>
          </div>
        </div>
        <span className="shrink-0">
          <StatusBadge tone={g.severity === 'Severe' ? 'critical' : 'serious'}>{g.severity}</StatusBadge>
        </span>
      </div>
      <p className="mt-3 text-[14px] text-ink-2">{g.summary}.</p>
      <div className="mt-4 border-t border-line pt-3">
        <div className="text-[13px] text-ink-2">
          {num(g.accounts.length)} affected {g.accounts.length === 1 ? 'account' : 'accounts'}: {num(custs)} {custs === 1 ? 'customer' : 'customers'}, {num(g.accounts.length - custs)} {g.accounts.length - custs === 1 ? 'prospect' : 'prospects'}
        </div>
        <ul className="divide-y divide-line">{shown.map((a) => <AccountLine key={a.id} a={a} />)}</ul>
        {g.accounts.length > shown.length && (
          <button type="button" className="mt-1 text-[13px] text-ink underline underline-offset-4" onClick={() => setAll(true)}>
            Show all {num(g.accounts.length)}
          </button>
        )}
      </div>
    </article>
  )
}

export function WeatherImpactView({ impact, geo }: { impact: WeatherImpact; geo: Geo }) {
  const [kind, setKind] = useState<'All' | WeatherEventKind>('All')
  const groups = impactInGeo(impact.groups, geo).filter((g) => kind === 'All' || g.kind === kind)
  const [page, setPage] = useState(0)
  // The area filter lives above this view, so a change there arrives only as a new geo.
  useEffect(() => setPage(0), [geo.region, geo.state, geo.county])
  const pages = pageCount(groups.length, 6)
  const cur = Math.min(page, pages - 1)
  const accounts = new Set(groups.flatMap((g) => g.accounts.map((a) => a.id)))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['All', ...EVENT_KINDS] as const).map((k) => (
          <Pill key={k} active={kind === k} onClick={() => { setKind(k); setPage(0) }}>
            {k === 'All' ? 'All events' : k}
          </Pill>
        ))}
      </div>
      <Card
        title={impact.status === 'loading' ? 'Weather impact' : `${num(groups.length)} significant ${groups.length === 1 ? 'event' : 'events'} · ${num(accounts.size)} affected ${accounts.size === 1 ? 'account' : 'accounts'}`}
      >
        <p className="text-[13px] text-ink-2">
          <SourceLine impact={impact} />
        </p>
        <details className="mt-2 text-[13px] text-ink-2">
          <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">What counts as significant</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {EVENT_KINDS.map((k) => (
              <li key={k}>
                <span className="text-ink">{k}:</span> {EVENT_RULES[k]}
              </li>
            ))}
          </ul>
        </details>
      </Card>
      {impact.status === 'ready' && !groups.length && <p className="px-1 text-[14px] text-muted">No significant weather events at customer or prospect locations{geo.state !== 'All' || geo.region !== 'All' ? ' in this area' : ''} for the next 7 days.</p>}
      <div className="grid gap-4 xl:grid-cols-2">{pageOf(groups, cur, 6).map((g) => <ImpactCard key={g.id} g={g} />)}</div>
      <Pager page={cur} pages={pages} onPage={setPage} total={groups.length} size={6} noun="events" className="rounded-[var(--radius-card)] border border-line bg-surface" />
    </div>
  )
}
