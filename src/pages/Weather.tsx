import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudSun, Send } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { STATES, STATE_LIST } from '../data/geo'
import { USMap } from '../components/USMap'
import { Button, Card, HealthBadge, PageHeader, Pill, Stat, WeatherBadge, weatherTone } from '../components/ui'
import { PLAYBOOK, draftForWeather } from '../lib/outreach'
import { runWeatherAutomation } from './Outreach'
import { relDays } from '../lib/format'

const WARM = [1, 2, 3, 4, 5].map((i) => `var(--color-warm-${i})`)

export default function Weather() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const [kind, setKind] = useState<'all' | 'heat' | 'cold' | 'rain' | 'dry' | 'health'>('all')
  const [msg, setMsg] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      book.customers
        .map((a) => ({ a, w: book.weatherRisk[a.id], h: book.health[a.id] }))
        .filter((r) => (kind === 'all' ? r.w.risk >= 22 || r.h?.level === 'At risk' : kind === 'health' ? r.h?.level !== 'Healthy' : r.w.kind === kind && r.w.risk >= 22))
        .sort((x, y) => y.w.risk - x.w.risk || (x.h?.score ?? 0) - (y.h?.score ?? 0)),
    [book, kind],
  )
  const count = (k: string) => book.customers.filter((a) => book.weatherRisk[a.id]?.kind === k && book.weatherRisk[a.id].risk >= 45).length
  const stateRisk = useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of STATE_LIST) {
      const cs = book.customers.filter((a) => a.state === s.code)
      out[s.code] = cs.length ? Math.max(...cs.map((a) => book.weatherRisk[a.id]?.risk ?? 0)) : -1
    }
    return out
  }, [book])
  const recentMail = new Map(outreach.filter((o) => o.trigger.startsWith('Weather')).map((o) => [o.accountId, o]))

  return (
    <div>
      <PageHeader
        title="Weather & Account Health"
        subtitle="The 7-day forecast for every customer's area, converted into livestock stress risk (THI heat stress, cold and blizzard, heavy rain on lagoons, dry pasture) and combined with usage, tickets, payments and NPS."
        actions={<Button variant="primary" onClick={() => { const n = runWeatherAutomation(book, outreach, queueOutreach); setMsg(n ? `${n} support messages queued (auto-send playbooks were sent).` : 'No new risks above threshold.') }}><CloudSun size={14} /> Run weather automation</Button>}
      />
      {msg && <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{msg} <Link to="/outreach" className="font-medium underline">Open queue</Link></div>}
      <div className="mb-3 text-xs text-muted">{book.weather.status === 'loading' ? 'Loading forecast…' : `${book.weather.source}${book.weather.fetchedAt ? ` · fetched ${relDays(book.weather.fetchedAt)}` : ''}`}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Heat stress" value={count('heat')} sub="customers ≥ serious" tone={count('heat') ? 'serious' : undefined} />
        <Stat label="Cold / blizzard" value={count('cold')} sub="customers ≥ serious" tone={count('cold') ? 'serious' : undefined} />
        <Stat label="Heavy rain" value={count('rain')} sub="lagoon / access risk" tone={count('rain') ? 'serious' : undefined} />
        <Stat label="Dry pasture" value={count('dry')} sub="cow-calf & stocker" tone={count('dry') ? 'serious' : undefined} />
        <Stat label="Health at risk" value={book.customers.filter((a) => book.health[a.id]?.level === 'At risk').length} sub="all factors" tone="critical" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card title="Peak weather risk by state (customers)">
          <USMap
            fill={(code) => {
              const v = stateRisk[code]
              if (v < 0) return 'var(--color-surface-2)'
              return WARM[v >= 70 ? 4 : v >= 45 ? 3 : v >= 22 ? 2 : v >= 10 ? 1 : 0]
            }}
            stateTooltip={(code) => {
              const worst = book.customers.filter((a) => a.state === code).map((a) => book.weatherRisk[a.id]).sort((x, y) => y.risk - x.risk)[0]
              return <div><div className="font-semibold">{STATES[code].name}</div>{worst ? <div className="text-ink-2">{worst.label}{worst.detail ? `: ${worst.detail}` : ''}</div> : <div className="text-muted">No customers</div>}</div>
            }}
          />
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-2">
            <span>Low</span><span className="flex">{WARM.map((c) => <span key={c} className="h-3 w-7" style={{ background: c }} />)}</span><span>Emergency</span>
          </div>
        </Card>

        <Card pad={false} title={<div className="flex flex-wrap items-center gap-1.5">{(['all', 'heat', 'cold', 'rain', 'dry', 'health'] as const).map((k) => <Pill key={k} active={kind === k} onClick={() => setKind(k)}>{{ all: 'Needs attention', heat: 'Heat', cold: 'Cold', rain: 'Rain', dry: 'Dry', health: 'Health watch' }[k]}</Pill>)}</div>}>
          <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
            {rows.map(({ a, w, h }) => {
              const pb = w.kind ? PLAYBOOK[`weather-${w.kind}`] : undefined
              const mail = recentMail.get(a.id)
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/accounts/${a.id}`} className="text-sm font-medium text-ink hover:text-accent">{a.name}</Link>
                    <div className="text-xs text-muted">{a.segment} · {a.county} Co., {a.state} · {a.rep}</div>
                    {w.kind && <div className="mt-0.5 text-xs text-ink-2">Forecast: {w.detail}</div>}
                    {pb && <div className="text-[11px] text-muted">Playbook: {pb.name}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <WeatherBadge w={w} compact />
                    <HealthBadge h={h} />
                    {w.kind && weatherTone(w.risk) !== 'good' && (mail ? <span className="text-[11px] text-ink-2">Outreach {mail.status.toLowerCase()}</span> : (
                      <Button size="sm" onClick={() => {
                        const d = draftForWeather(a, w.kind!, w.day ? new Date(w.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }) : 'this week', w.detail, a.rep)
                        queueOutreach({ accountId: a.id, trigger: `Weather: ${w.kind}`, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false })
                      }}><Send size={12} /> Send support</Button>
                    ))}
                  </div>
                </li>
              )
            })}
            {!rows.length && <li className="p-8 text-center text-sm text-muted">No customers in this category right now.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4" title="How weather risk is scored">
        <ul className="grid gap-2 text-sm text-ink-2 md:grid-cols-4">
          <li><b className="text-ink">Heat (THI).</b> The temperature-humidity index from the daily high and afternoon humidity: 72+ alert (dairy), 75+ alert, 79+ danger, 84+ emergency. Automation triggers at danger. Hogs and dairy are weighted up.</li>
          <li><b className="text-ink">Cold.</b> Lows at or below 0°F, windy lows below 14°F, or 6"+ of snow. Weighted up for outdoor cattle (calving), down for enclosed barns.</li>
          <li><b className="text-ink">Heavy rain.</b> 1.2"+ in a day, weighted up for hog operations because of lagoon freeboard and manure-application limits.</li>
          <li><b className="text-ink">Dry pasture.</b> Less than 0.1" of rain over 7 days with average highs above 86°F, for cow-calf and stocker operations.</li>
        </ul>
      </Card>
    </div>
  )
}
