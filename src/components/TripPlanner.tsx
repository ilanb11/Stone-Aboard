import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Mail, MapPin, Plane, Trash2 } from 'lucide-react'
import { STATE_LIST, STATES } from '../data/geo'
import { useBook, signals } from '../lib/useData'
import { CURRENT_USER, useCrm } from '../store'
import { winProbability } from '../lib/scoring'
import { findReconnects } from '../lib/reconnects'
import { draftMeetingEmail, localDay, meetingOptions, planItinerary, tripDays, type Stop, type Trip, type TripGeo } from '../lib/tripPlanner'
import { countyCenter, placeFarm, type CountyAtlas } from '../lib/placement'
import { Button, Chip, Select, inputClass } from './ui'
import { Pager, pageOf } from './Pager'
import { num } from '../lib/format'

const nextMonday = (plus = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + plus)
  return localDay(d)
}
const dayLabel = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const range = (t: Pick<Trip, 'start' | 'end'>) => `${dayLabel(t.start)} to ${dayLabel(t.end)}`

/** "Where are we travelling next": pick a place and dates, get meetings worth setting up there. */
export function TripPlanner({ onFocusState, atlas, atlasLoading }: { onFocusState: (code: string) => void; atlas: CountyAtlas | null; atlasLoading: boolean }) {
  const book = useBook()
  const trips = useCrm((s) => s.trips)
  const addTrip = useCrm((s) => s.addTrip)
  const removeTrip = useCrm((s) => s.removeTrip)
  const outreach = useCrm((s) => s.outreach)
  const activities = useCrm((s) => s.activities)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const skipOutreach = useCrm((s) => s.skipOutreach)
  const today = localDay()
  const upcoming = trips.filter((t) => t.end >= today)
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = upcoming.find((t) => t.id === activeId) ?? upcoming[0]
  const [page, setPage] = useState(0)
  const pickTrip = (id: string | null) => {
    setActiveId(id)
    setPage(0)
  }

  // Form defaults: the state with the most open deals, next Monday to Wednesday.
  const busiest = useMemo(() => {
    const n: Record<string, number> = {}
    for (const o of book.opportunities) if (['Prospect', 'Demo', 'Negotiation'].includes(o.stage)) n[book.byId[o.accountId]?.state] = (n[book.byId[o.accountId]?.state] ?? 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'IA'
  }, [book])
  const [state, setState] = useState(busiest)
  const [county, setCounty] = useState('')
  const [start, setStart] = useState(() => nextMonday())
  const [end, setEnd] = useState(() => nextMonday(2))
  const [radius, setRadius] = useState('75')

  // Distances use the same county-placed farms as the map. If the atlas failed to load, the stored points.
  const geo = useMemo<TripGeo>(
    () => ({
      farm: (a) => {
        const [lon, lat] = atlas ? placeFarm(a, atlas) : [a.lon, a.lat]
        return { lat, lon }
      },
      county: (state, county) => {
        const c = atlas ? countyCenter({ state, county }, atlas) : undefined
        return c && { lat: c[1], lon: c[0] }
      },
    }),
    [atlas],
  )
  const winProb = useMemo(() => new Map(book.ranked.filter((r) => r.opp).map((r) => [r.opp!.id, winProbability(r)])), [book])
  const reconnects = useMemo(() => findReconnects(book.opportunities, book.byId, activities, signals), [book, activities])
  const options = useMemo(() => (active && !atlasLoading ? meetingOptions(active, book.accounts, book.opportunities, winProb, reconnects, geo) : []), [active, atlasLoading, book, winProb, reconnects, geo])
  // today: past days drop out of the plan once the date rolls over.
  const plan = useMemo(() => (active ? planItinerary(active, options, book.accounts, geo) : []), [active, options, book.accounts, geo, today])
  const days = active ? tripDays(active, today) : []
  const scheduled = new Set(plan.flat().map((s) => s.option.account.id))
  const extra = options.filter((o) => !scheduled.has(o.account.id))
  const pages = Math.ceil(extra.length / 5)
  const cur = Math.min(page, Math.max(0, pages - 1))
  // Requests drafted for this trip. A skipped one can be drafted again.
  const draftedFor = new Set(outreach.filter((o) => active && o.tripId === active.id && o.status !== 'Skipped').map((o) => o.accountId))
  const draftStop = (s: Stop) => active && queueOutreach({ ...draftMeetingEmail(s, active, CURRENT_USER), status: 'Draft' })
  const stops = plan.flat()
  const undrafted = stops.filter((s) => !draftedFor.has(s.option.account.id))
  const past = !!end && end < today
  const invalid = !start || !end || end < start || past

  const save = () => {
    const id = addTrip({ state, county: county || undefined, start, end, radiusMiles: Number(radius) })
    pickTrip(id)
    onFocusState(state)
  }
  const remove = (t: Trip) => {
    // Its unsent meeting requests go with it.
    for (const o of outreach) if (o.tripId === t.id && o.status === 'Draft') skipOutreach(o.id)
    removeTrip(t.id)
    pickTrip(null)
  }

  return (
    <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface" aria-labelledby="trip-title" id="trip">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id="trip-title" className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <Plane size={15} aria-hidden /> Where are we travelling next?
          </h2>
          <p className="mt-0.5 max-w-[80ch] text-[13px] text-ink-2">Add where you’re going and when. Herdbook proposes customer meetings nearby, ranked by chance to close or reconnect, and lays them out day by day. Every meeting request is a draft for you to send.</p>
        </div>
        {upcoming.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Upcoming trips">
            {upcoming.map((t) => (
              <button key={t.id} type="button" onClick={() => { pickTrip(t.id); onFocusState(t.state) }} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors ${active?.id === t.id ? 'bg-accent text-on-accent' : 'bg-accent-soft text-ink hover:bg-accent-soft-2'}`}>
                <MapPin size={12} aria-hidden /> {t.county ? `${t.county} Co., ` : ''}{t.state} · {dayLabel(t.start)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 items-end gap-3 border-t border-line px-5 py-4 md:grid-cols-6">
        <Select label="State" value={state} onChange={(v) => { setState(v); setCounty('') }} options={STATE_LIST.map((s) => ({ value: s.code, label: s.name })).sort((a, b) => a.label.localeCompare(b.label))} />
        <Select label="County (optional)" value={county} onChange={setCounty} options={[{ value: '', label: 'Anywhere in the state' }, ...(STATES[state]?.counties ?? []).map((c) => ({ value: c, label: c }))]} />
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] text-ink-2">
          <span>From</span>
          <input type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] text-ink-2">
          <span>To</span>
          <input type="date" value={end} min={start > today ? start : today} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
        <Select label="Within" value={radius} onChange={setRadius} options={[{ value: '50', label: '50 miles' }, { value: '75', label: '75 miles' }, { value: '150', label: '150 miles' }]} />
        <Button variant="primary" onClick={save} disabled={invalid}>
          <CalendarDays size={14} /> Add trip
        </Button>
        {past && <p className="col-span-2 text-[13px] text-muted md:col-span-6">These dates have already passed. Pick an end date from today on.</p>}
      </div>

      {active ? (
        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-[14px] text-ink">
              <span className="font-medium">
                {active.county ? `${active.county} County, ` : ''}
                {STATES[active.state]?.name}
              </span>
              <span className="text-ink-2"> · {range(active)} · within {active.radiusMiles} miles</span>
              <span className="text-muted"> · {num(options.length)} meeting {options.length === 1 ? 'option' : 'options'}, {num(stops.length)} scheduled</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {undrafted.length > 0 && (
                <Button size="sm" variant="primary" onClick={() => undrafted.forEach(draftStop)}>
                  <Mail size={12} /> Draft all {undrafted.length} meeting requests
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove(active)} title="Remove this trip and skip its unsent meeting requests">
                <Trash2 size={12} /> Remove trip
              </Button>
            </div>
          </div>
          {atlasLoading ? (
            <p className="mt-3 text-[13px] text-muted">Placing farms in their counties to plan the route…</p>
          ) : !days.length ? (
            <p className="mt-3 text-[13px] text-muted">{active.start < today ? 'The rest of this trip falls on a weekend.' : 'These dates are a weekend only.'} Pick weekdays to schedule meetings.</p>
          ) : (
            plan.length === 0 && <p className="mt-3 text-[13px] text-muted">No open deals or reconnects within {active.radiusMiles} miles. Widen the radius or pick another county.</p>
          )}
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {plan.map((day) => (
              <div key={day[0].day} className="min-w-0 rounded-[14px] bg-accent-soft p-3.5">
                <div className="mb-2 text-[13px] font-medium text-ink">{dayLabel(day[0].day)}</div>
                <ol className="flex flex-col gap-2.5">
                  {day.map((s) => (
                    <li key={s.option.account.id} className="min-w-0 rounded-[12px] bg-surface p-3 text-[13px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="tabular text-muted">{s.time}</span>
                        <span className="text-[12px] text-muted">{s.driveMiles} mi drive</span>
                      </div>
                      <Link to={`/accounts/${s.option.account.id}`} className="mt-0.5 block font-medium text-ink underline-offset-4 hover:underline">{s.option.account.name}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Chip tone={s.option.kind === 'Close' ? 'lime' : 'neutral'}>{s.option.kind === 'Close' ? `Close · ${s.option.score}` : `Reconnect · ${s.option.score}`}</Chip>
                        <span className="text-[12px] text-muted">{s.option.account.county} Co. · {s.option.account.rep}</span>
                      </div>
                      <p className="mt-1.5 text-ink-2">{s.option.why}</p>
                      {draftedFor.has(s.option.account.id) ? (
                        <Link to={`/outreach?account=${s.option.account.id}`} className="mt-2 inline-block text-ink underline underline-offset-4">Meeting request drafted</Link>
                      ) : (
                        <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-ink underline underline-offset-4" onClick={() => draftStop(s)}>
                          <Mail size={12} aria-hidden /> Draft meeting request
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          {extra.length > 0 && (
            <div className="mt-4 rounded-[14px] border border-line">
              <div className="px-4 pt-3 text-[13px] font-medium text-ink">More options nearby</div>
              <ul className="divide-y divide-line">
                {pageOf(extra, cur, 5).map((o) => (
                  <li key={o.account.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0">
                      <Link to={`/accounts/${o.account.id}`} className="text-ink underline-offset-4 hover:underline">{o.account.name}</Link>
                      <span className="ml-2 text-muted">{o.kind} · {o.score} · {Math.round(o.miles)} mi · {o.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Pager page={cur} pages={pages} onPage={setPage} total={extra.length} size={5} noun="options" />
            </div>
          )}
        </div>
      ) : (
        <p className="border-t border-line px-5 py-4 text-[13px] text-muted">No trips planned. Add one above to see meetings worth setting up.</p>
      )}
    </section>
  )
}
