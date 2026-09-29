import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, Copy, Mail } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { useCrm } from '../store'
import type { OutreachStatus, Signal, SignalType } from '../types'
import { STATES } from '../data/geo'
import { Button, Card, Chip, Notice, PageHeader, Pill, Select, StatusBadge, Tabs, TextInput, TextLink } from '../components/ui'
import { num, shortDate } from '../lib/format'
import { draftForSignal } from '../lib/outreach'

const TYPES: SignalType[] = ['Ownership Change', 'Leadership Change', 'Expansion', 'Contraction', 'Integrator / Packer Change', 'Biosecurity', 'Regulatory', 'Financial']

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

// Past-tense wording for the outreach link on a signal ("Outreach drafted", "Outreach sent").
const MAIL_STATE: Record<OutreachStatus, string> = { Draft: 'drafted', Approved: 'approved', Sent: 'sent', Skipped: 'skipped' }

export function SignalRow({ s, compact }: { s: Signal; compact?: boolean }) {
  const book = useBook()
  const outreach = useCrm((st) => st.outreach)
  const queueOutreach = useCrm((st) => st.queueOutreach)
  const a = s.accountId ? book.byId[s.accountId] : undefined
  const mail = outreach.find((o) => o.signalId === s.id)
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Chip>{s.type}</Chip>
          {s.severity === 'High' && <StatusBadge tone="serious">High</StatusBadge>}
          <span className="meta text-muted">{shortDate(s.date)}</span>
          <span className="text-[13px] text-muted">{s.source}</span>
          {s.state && STATES[s.state] && <span className="text-[13px] text-muted">{STATES[s.state].name}</span>}
        </div>
        <div className="mt-2 text-[15px] font-medium leading-snug text-ink">{s.headline}</div>
        {!compact && <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{s.detail}</p>}
        {a && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
            <Link to={`/accounts/${a.id}`} className="text-ink underline-offset-4 hover:underline">{a.name}</Link>
            <span>{a.status}</span>
            <span>{a.segment}</span>
          </div>
        )}
      </div>
      {a && (
        <div className="shrink-0 sm:pt-0.5 sm:text-right">
          {mail ? (
            <Link to={`/outreach?account=${a.id}`}>
              <TextLink>Outreach {MAIL_STATE[mail.status] ?? mail.status.toLowerCase()}</TextLink>
            </Link>
          ) : (
            <Button size="sm" onClick={() => { const d = draftForSignal(a, s, a.rep); queueOutreach({ accountId: a.id, signalId: s.id, trigger: s.type, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' }) }}>
              <Mail size={12} /> Draft outreach
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function weekStart(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

function SectionHeading({ children }: { children: string }) {
  return <h3 className="text-[22px] font-normal leading-tight tracking-[-0.02em] text-ink">{children}</h3>
}

function Newsletter() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const s = weekStart(new Date())
    s.setDate(s.getDate() - 7 * i)
    return s
  })
  const [wk, setWk] = useState(weeks[0].toISOString())
  const [species, setSpecies] = useState<'All' | 'Hog' | 'Cattle'>('All')
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 3000)
    return () => clearTimeout(t)
  }, [copied])
  const start = new Date(wk)
  const end = new Date(start.getTime() + 7 * 86400000)
  const items = signals.filter((s) => {
    const t = new Date(s.date)
    if (t < start || t >= end) return false
    if (species !== 'All' && s.accountId && book.byId[s.accountId].species !== species) return false
    return true
  })
  const by = (t: SignalType) => items.filter((s) => s.type === t)
  const custHit = [...new Set(items.filter((s) => s.accountId && book.byId[s.accountId].status === 'Customer').map((s) => s.accountId!))]
  const sent = outreach.filter((o) => o.sentAt && new Date(o.sentAt) >= start && new Date(o.sentAt) < end)
  const headAdded = by('Expansion').reduce((s, x) => s + (Number(x.headline.match(/\+([\d,]+) head/)?.[1]?.replace(/,/g, '')) || 0), 0)
  const hotStates = Object.entries(book.weather.byState)
    .map(([code]) => {
      const accts = book.customers.filter((a) => a.state === code)
      const avg = accts.length ? accts.reduce((s, a) => s + (book.weatherRisk[a.id]?.risk ?? 0), 0) / accts.length : 0
      const worst = accts.map((a) => book.weatherRisk[a.id]).sort((x, y) => (y?.risk ?? 0) - (x?.risk ?? 0))[0]
      return { code, avg, worst, n: accts.length }
    })
    .filter((x) => x.n && x.avg >= 22)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  const sections: [string, Signal[]][] = [
    ['Ownership and M&A', by('Ownership Change')],
    ['Leadership moves', by('Leadership Change')],
    ['Expansions', by('Expansion')],
    ['Contractions and closures', by('Contraction')],
    ['Integrator and packer moves', by('Integrator / Packer Change')],
    ['Biosecurity watch', by('Biosecurity')],
    ['Regulatory', by('Regulatory')],
    ['Financial', by('Financial')],
  ]
  const masthead = 'The Hog & Herd Brief'
  const weekLabel = `Week of ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`

  const asText = () =>
    [
      masthead,
      weekLabel,
      '',
      `${plural(items.length, 'change')} tracked, ${plural(by('Ownership Change').length, 'ownership change')}, ${plural(by('Leadership Change').length, 'leadership move')}, ${num(headAdded)} hog head of new barn capacity permitted.`,
      '',
      ...sections.flatMap(([h, list]) => (list.length ? [`## ${h}`, ...list.map((s) => `- ${s.headline} (${shortDate(s.date)})${s.accountId ? ` [${book.byId[s.accountId].status}]` : ''}`), ''] : [])),
      hotStates.length ? '## Weather outlook' : '',
      ...hotStates.map((h) => `- ${STATES[h.code].name}: ${h.worst?.label} affecting ${plural(h.n, 'customer operation')}`),
      '',
      `## Your book: ${plural(custHit.length, 'customer')} affected, ${plural(sent.length, 'outreach message')} sent`,
    ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText())
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  const figures: [string, string, string?][] = [
    ['Changes tracked', num(items.length)],
    ['Ownership changes', num(by('Ownership Change').length)],
    ['Leadership moves', num(by('Leadership Change').length)],
    ['New hog capacity', num(headAdded), 'head'],
  ]

  return (
    <div className="max-w-3xl">
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Select label="Week" value={wk} onChange={setWk} options={weeks.map((w) => ({ value: w.toISOString(), label: `Week of ${w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` }))} />
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {(['All', 'Hog', 'Cattle'] as const).map((s) => (
            <Pill key={s} active={species === s} onClick={() => setSpecies(s)}>
              {s === 'All' ? 'Hog and cattle' : s}
            </Pill>
          ))}
        </div>
        <div className="sm:ml-auto">
          <Button onClick={copy}>
            <Copy size={14} /> Copy as text
          </Button>
        </div>
      </div>
      {copied === 'copied' && <Notice>Copied to clipboard</Notice>}
      {copied === 'failed' && (
        <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
          <AlertOctagon size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-critical" aria-hidden />
          <span className="min-w-0">Couldn't copy. Allow clipboard access in your browser and try again.</span>
        </div>
      )}

      <article className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-8 sm:px-12 sm:py-12">
        <header>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="meta text-muted">ThiboLiSoft Market Intelligence</span>
            <span className="meta text-muted">{weekLabel}</span>
          </div>
          <h2 className="display mt-5 text-[40px] text-ink sm:text-[56px]">{masthead}</h2>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-[1.6] text-ink-2">
            Changes to hog and cattle operations this week: ownership, leadership, capacity, integrators, biosecurity and regulation, and what they mean for our accounts.
          </p>
        </header>

        {/* Four columns only when the article itself is wide enough; the rail makes viewport breakpoints unreliable here. */}
        <div className="@container mt-10 border-t border-line pt-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
            {figures.map(([label, value, unit]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[13px] text-ink-2">{label}</dt>
                <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="figure text-[44px] text-ink">{value}</span>
                  {unit && <span className="text-[13px] text-muted">{unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {!items.length && <p className="mt-10 text-[15px] text-muted">No changes recorded for this week. Pick an earlier week to read past issues.</p>}

        {sections.map(([h, list]) =>
          list.length ? (
            <section key={h} className="mt-12">
              <SectionHeading>{h}</SectionHeading>
              <ul className="mt-5 flex flex-col gap-6">
                {list.map((s) => {
                  const a = s.accountId ? book.byId[s.accountId] : undefined
                  return (
                    <li key={s.id} className="max-w-[68ch]">
                      <div className="text-[16px] font-medium leading-snug text-ink">{s.headline}</div>
                      <p className="mt-1.5 text-[15px] leading-[1.7] text-ink-2">{s.detail}</p>
                      {a && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
                          <Link to={`/accounts/${a.id}`} className="text-ink underline-offset-4 hover:underline">{a.name}</Link>
                          <span>{a.status === 'Customer' ? 'Our customer' : a.status}</span>
                          <span>Rep {a.rep}</span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null,
        )}

        {hotStates.length > 0 && (
          <section className="mt-12">
            <SectionHeading>Weather outlook for the next 7 days</SectionHeading>
            <ul className="mt-5 flex max-w-[68ch] flex-col gap-5">
              {hotStates.map((h) => (
                <li key={h.code}>
                  <div className="text-[16px] font-medium leading-snug text-ink">{STATES[h.code].name}</div>
                  <p className="mt-1 text-[15px] leading-[1.7] text-ink-2">
                    {h.worst?.label}: {h.worst?.detail}.
                  </p>
                  <div className="mt-1 text-[13px] text-muted">{plural(h.n, 'customer operation')} in the area</div>
                </li>
              ))}
            </ul>
            <div className="meta mt-4 text-muted">Source: {book.weather.source}</div>
          </section>
        )}

        <section className="mt-12 rounded-[14px] bg-accent-soft px-5 py-4 text-[15px] leading-relaxed text-ink">
          <span className="font-medium">Your book.</span>{' '}
          <span className="text-ink-2">
            {plural(custHit.length, 'customer account')} had changes this week and {plural(sent.length, 'outreach message')} went out.
          </span>
        </section>
      </article>
    </div>
  )
}

export default function Signals() {
  const book = useBook()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'feed' | 'newsletter'>(params.get('tab') === 'newsletter' ? 'newsletter' : 'feed')
  const [type, setType] = useState('All')
  const [scope, setScope] = useState<'all' | 'customers' | 'prospects' | 'market'>('all')
  const [days, setDays] = useState('30')
  const [species, setSpecies] = useState('All')
  const [q, setQ] = useState('')
  const feed = useMemo(() => {
    const cut = Date.now() - Number(days) * 86400000
    return signals.filter((s) => {
      if (new Date(s.date).getTime() < cut) return false
      if (type !== 'All' && s.type !== type) return false
      const a = s.accountId ? book.byId[s.accountId] : undefined
      if (scope === 'customers' && a?.status !== 'Customer') return false
      if (scope === 'prospects' && a?.status !== 'Prospect') return false
      if (scope === 'market' && a) return false
      if (species !== 'All' && a && a.species !== species) return false
      if (q && !`${s.headline} ${s.detail}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [book, type, scope, days, species, q])

  return (
    <div>
      <PageHeader title="Signals and newsletter" subtitle="Every change to a hog or cattle operation: ownership, leadership, capacity, integrator, biosecurity and regulation. Any change can start an outreach message." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'feed', label: 'Change feed' }, { value: 'newsletter', label: 'Weekly newsletter' }]} />
      {tab === 'newsletter' ? (
        <Newsletter />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-3">
            <TextInput label="Search" value={q} onChange={setQ} placeholder="Headline or detail" className="w-full sm:w-64" />
            <Select label="Type" value={type} onChange={setType} options={['All', ...TYPES]} />
            <Select label="Species" value={species} onChange={setSpecies} options={['All', 'Hog', 'Cattle']} />
            <Select label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '120', label: 'Last 120 days' }]} />
            <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
              {(['all', 'customers', 'prospects', 'market'] as const).map((s) => (
                <Pill key={s} active={scope === s} onClick={() => setScope(s)}>
                  {{ all: 'Everything', customers: 'Customers', prospects: 'Prospects', market: 'Market-wide' }[s]}
                </Pill>
              ))}
            </div>
          </div>
          <Card pad={false} title={plural(feed.length, 'signal')}>
            <ul className="divide-y divide-line">{feed.map((s) => <SignalRow key={s.id} s={s} />)}</ul>
            {!feed.length && <div className="px-5 py-10 text-center text-[14px] text-muted">No signals match these filters. Widen the period or clear the search.</div>}
          </Card>
        </div>
      )}
    </div>
  )
}
