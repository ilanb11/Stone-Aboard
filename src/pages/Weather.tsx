import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudRain, CloudSun, HeartPulse, Send, Snowflake, Sun, Wind, type LucideIcon } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { STATES, STATE_LIST } from '../data/geo'
import { USMap } from '../components/USMap'
import { Button, Card, HealthBadge, Notice, PageHeader, Pill, TextLink, TONE_COLOR, WeatherBadge, weatherTone, type Tone } from '../components/ui'
import { PLAYBOOK, draftForWeather } from '../lib/outreach'
import { runWeatherAutomation } from './Outreach'
import { relDays } from '../lib/format'
import type { OutreachStatus } from '../types'

// Written out in full: Tailwind only emits theme variables it finds literally in source.
const WARM = ['var(--color-warm-1)', 'var(--color-warm-2)', 'var(--color-warm-3)', 'var(--color-warm-4)', 'var(--color-warm-5)']

// Past-tense wording for outreach already queued for an account, matching the Signals feed.
const MAIL_STATE: Record<OutreachStatus, string> = { Draft: 'drafted', Approved: 'approved', Sent: 'sent', Skipped: 'skipped' }

const SCORING = [
  {
    icon: Sun,
    title: 'Heat (THI)',
    body: 'The temperature-humidity index from the daily high and afternoon humidity: 72+ alert (dairy), 75+ alert, 79+ danger, 84+ emergency. Automation triggers at danger. Hogs and dairy are weighted up.',
  },
  {
    icon: Snowflake,
    title: 'Cold',
    body: 'Lows at or below 0°F, windy lows below 14°F, or 6"+ of snow. Weighted up for outdoor cattle (calving), down for enclosed barns.',
  },
  {
    icon: CloudRain,
    title: 'Heavy rain',
    body: '1.2"+ in a day, weighted up for hog operations because of lagoon freeboard and manure-application limits.',
  },
  {
    icon: Wind,
    title: 'Dry pasture',
    body: 'Less than 0.1" of rain over 7 days with average highs above 86°F, for cow-calf and stocker operations.',
  },
]

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
  // One summary strip instead of five tiles: figures stay ink, the icon carries the status color.
  const summary: { icon: LucideIcon; label: string; value: number; sub: string; tone: Tone }[] = [
    { icon: Sun, label: 'Heat stress', value: count('heat'), sub: 'Serious or worse', tone: 'serious' },
    { icon: Snowflake, label: 'Cold or blizzard', value: count('cold'), sub: 'Serious or worse', tone: 'serious' },
    { icon: CloudRain, label: 'Heavy rain', value: count('rain'), sub: 'Lagoon and access risk', tone: 'serious' },
    { icon: Wind, label: 'Dry pasture', value: count('dry'), sub: 'Cow-calf and stocker', tone: 'serious' },
    { icon: HeartPulse, label: 'Health at risk', value: book.customers.filter((a) => book.health[a.id]?.level === 'At risk').length, sub: 'Across all factors', tone: 'critical' },
  ]

  return (
    <div>
      <PageHeader
        title="Weather and account health"
        subtitle="The 7-day forecast for each customer's area, turned into livestock stress risk (THI heat stress, cold and blizzards, heavy rain on lagoons, dry pasture) and combined with usage, tickets, payments and NPS."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              const n = runWeatherAutomation(book, outreach, queueOutreach)
              setMsg(n ? `Queued ${n} weather support ${n === 1 ? 'message' : 'messages'}. Any on an auto-send playbook were sent right away` : 'No new weather risks above the threshold')
            }}
          >
            <CloudSun size={14} /> Run weather automation
          </Button>
        }
      />
      {msg && (
        <Notice>
          <span className="min-w-0">{msg}</span>
          <Link to="/outreach" className="shrink-0 font-medium text-on-lime underline underline-offset-4">
            Open queue
          </Link>
        </Notice>
      )}
      <div className="meta mb-4 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
        {book.weather.status === 'loading' ? (
          <span>Loading forecast…</span>
        ) : (
          <>
            <span>{book.weather.source}</span>
            {book.weather.fetchedAt && <span>Fetched {relDays(book.weather.fetchedAt)}</span>}
          </>
        )}
      </div>
      <section className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-5 sm:px-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 xl:grid-cols-5">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <s.icon size={14} strokeWidth={2.25} style={{ color: s.value ? TONE_COLOR[s.tone] : 'var(--color-muted)' }} aria-hidden />
                {s.label}
              </dt>
              <dd className="figure tabular mt-2 text-[44px] text-ink">{s.value}</dd>
              <dd className="mt-1.5 text-[13px] text-muted">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="self-start" title="Peak customer weather risk by state">
          <USMap
            fill={(code) => {
              const v = stateRisk[code]
              if (v < 0) return 'var(--color-surface-2)'
              return WARM[v >= 70 ? 4 : v >= 45 ? 3 : v >= 22 ? 2 : v >= 10 ? 1 : 0]
            }}
            stateTooltip={(code) => {
              const worst = book.customers
                .filter((a) => a.state === code)
                .map((a) => book.weatherRisk[a.id])
                .sort((x, y) => y.risk - x.risk)[0]
              return (
                <div>
                  <div className="font-medium">{STATES[code].name}</div>
                  {worst ? (
                    <div className="text-ink-2">
                      {worst.label}
                      {worst.detail ? `: ${worst.detail}` : ''}
                    </div>
                  ) : (
                    <div className="text-muted">No customers</div>
                  )}
                </div>
              )
            }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-2">
            <span className="inline-flex items-center gap-2">
              <span>Low</span>
              <span className="flex overflow-hidden rounded-full" aria-hidden>
                {WARM.map((c) => (
                  <span key={c} className="h-2.5 w-7" style={{ background: c }} />
                ))}
              </span>
              <span>Emergency</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border border-line-strong bg-surface-2" aria-hidden />
              No customers
            </span>
          </div>
        </Card>

        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4 pt-5" role="group" aria-label="Filter customers">
            {(['all', 'heat', 'cold', 'rain', 'dry', 'health'] as const).map((k) => (
              <Pill key={k} active={kind === k} onClick={() => setKind(k)}>
                {{ all: 'Needs attention', heat: 'Heat', cold: 'Cold', rain: 'Rain', dry: 'Dry', health: 'Health watch' }[k]}
              </Pill>
            ))}
          </div>
          <ul className="max-h-[560px] divide-y divide-line overflow-y-auto border-t border-line">
            {rows.map(({ a, w, h }) => {
              const pb = w.kind ? PLAYBOOK[`weather-${w.kind}`] : undefined
              const mail = recentMail.get(a.id)
              return (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3.5">
                  <div className="min-w-0 flex-1 basis-56">
                    <Link to={`/accounts/${a.id}`} className="text-[15px] text-ink underline-offset-4 hover:underline">
                      {a.name}
                    </Link>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
                      <span>
                        {a.segment}, {a.county} Co., {a.state}
                      </span>
                      <span>Rep {a.rep}</span>
                    </div>
                    {w.kind && <div className="mt-1 text-[13px] text-ink-2">Forecast: {w.detail}</div>}
                    {pb && <div className="mt-0.5 text-[12px] text-muted">Playbook: {pb.name}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <WeatherBadge w={w} compact />
                    <HealthBadge h={h} />
                    {w.kind &&
                      weatherTone(w.risk) !== 'good' &&
                      (mail ? (
                        <Link to={`/outreach?account=${a.id}`}>
                          <TextLink>Outreach {MAIL_STATE[mail.status] ?? mail.status.toLowerCase()}</TextLink>
                        </Link>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            const d = draftForWeather(a, w.kind!, w.day ? new Date(w.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }) : 'this week', w.detail, a.rep)
                            queueOutreach({ accountId: a.id, trigger: `Weather: ${w.kind}`, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false })
                          }}
                        >
                          <Send size={12} /> Queue support message
                        </Button>
                      ))}
                  </div>
                </li>
              )
            })}
            {!rows.length && <li className="px-5 py-10 text-center text-[14px] text-muted">No customers in this category right now.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-5" title="How weather risk is scored">
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {SCORING.map((s) => (
            <li key={s.title} className="min-w-0 rounded-[14px] bg-accent-soft p-4">
              <h3 className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <s.icon size={15} strokeWidth={2} aria-hidden />
                {s.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
