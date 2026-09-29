import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Copy, Mail, Printer } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { useCrm } from '../store'
import type { Signal, SignalType } from '../types'
import { STATES } from '../data/geo'
import { Button, Card, Chip, PageHeader, Pill, Select, StatusBadge, Tabs, TextInput } from '../components/ui'
import { num, shortDate } from '../lib/format'
import { draftForSignal } from '../lib/outreach'

const TYPES: SignalType[] = ['Ownership Change', 'Leadership Change', 'Expansion', 'Contraction', 'Integrator / Packer Change', 'Biosecurity', 'Regulatory', 'Financial']

export function SignalRow({ s, compact }: { s: Signal; compact?: boolean }) {
  const book = useBook()
  const outreach = useCrm((st) => st.outreach)
  const queueOutreach = useCrm((st) => st.queueOutreach)
  const a = s.accountId ? book.byId[s.accountId] : undefined
  const mail = outreach.find((o) => o.signalId === s.id)
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{s.type}</Chip>
          {s.severity === 'High' && <StatusBadge tone="serious">High</StatusBadge>}
          <span className="text-[11px] text-muted">{shortDate(s.date)} · {s.source}{s.state ? ` · ${STATES[s.state]?.name}` : ''}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-ink">{s.headline}</div>
        {!compact && <div className="text-xs text-ink-2">{s.detail}</div>}
        {a && (
          <div className="mt-1 text-xs text-muted">
            <Link to={`/accounts/${a.id}`} className="font-medium text-accent">{a.name}</Link> · {a.status} · {a.segment}
          </div>
        )}
      </div>
      {a && (
        <div className="shrink-0 text-right">
          {mail ? (
            <Link to={`/outreach?account=${a.id}`} className="text-xs text-ink-2 hover:text-ink">Outreach: <b className="font-medium">{mail.status}</b></Link>
          ) : (
            <Button size="sm" onClick={() => { const d = draftForSignal(a, s, a.rep); queueOutreach({ accountId: a.id, signalId: s.id, trigger: s.type, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' }) }}>
              <Mail size={12} /> Draft
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
    ['Ownership & M&A', by('Ownership Change')],
    ['Leadership moves', by('Leadership Change')],
    ['Expansions', by('Expansion')],
    ['Contractions & closures', by('Contraction')],
    ['Integrator & packer moves', by('Integrator / Packer Change')],
    ['Biosecurity watch', by('Biosecurity')],
    ['Regulatory', by('Regulatory')],
    ['Financial', by('Financial')],
  ]
  const title = `The Hog & Herd Brief · week of ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`

  const asText = () =>
    [
      title,
      '',
      `${items.length} changes tracked · ${by('Ownership Change').length} ownership changes · ${by('Leadership Change').length} leadership moves · ${num(headAdded)} hog head of new barn capacity permitted`,
      '',
      ...sections.flatMap(([h, list]) => (list.length ? [`## ${h}`, ...list.map((s) => `- ${s.headline} (${shortDate(s.date)})${s.accountId ? ` [${book.byId[s.accountId].status}]` : ''}`), ''] : [])),
      hotStates.length ? '## Weather outlook' : '',
      ...hotStates.map((h) => `- ${STATES[h.code].name}: ${h.worst?.label} affecting ${h.n} customer operation(s)`),
      '',
      `## Your book: ${custHit.length} customers affected; ${sent.length} outreach messages sent`,
    ].join('\n')

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-end gap-3">
        <Select label="Week" value={wk} onChange={setWk} options={weeks.map((w) => ({ value: w.toISOString(), label: `Week of ${w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` }))} />
        <div className="flex items-center gap-1.5 pb-1">{(['All', 'Hog', 'Cattle'] as const).map((s) => <Pill key={s} active={species === s} onClick={() => setSpecies(s)}>{s === 'All' ? 'Hog + Cattle' : s}</Pill>)}</div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => navigator.clipboard?.writeText(asText())}><Copy size={14} /> Copy as text</Button>
          <Button onClick={() => window.print()}><Printer size={14} /> Print / PDF</Button>
        </div>
      </div>
      <article className="mx-auto max-w-3xl rounded-xl border border-line bg-surface px-6 py-6 sm:px-10">
        <div className="text-xs font-semibold uppercase tracking-wider text-accent">ThiboLiSoft Market Intelligence</div>
        <h2 className="mt-1 text-2xl font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-ink-2">Changes to hog and cattle operations: ownership, leadership, capacity, integrators, biosecurity and regulation, plus what it means for our accounts.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Changes tracked', items.length],
            ['Ownership changes', by('Ownership Change').length],
            ['Leadership moves', by('Leadership Change').length],
            ['New hog capacity', `${num(headAdded)} hd`],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-surface-2 px-3 py-2"><div className="text-[11px] text-muted">{l}</div><div className="text-lg font-semibold text-ink">{v}</div></div>
          ))}
        </div>
        {sections.map(([h, list]) =>
          list.length ? (
            <section key={h} className="mt-6">
              <h3 className="border-b border-line pb-1 text-sm font-semibold uppercase tracking-wide text-ink-2">{h}</h3>
              <ul className="mt-2 flex flex-col gap-2.5">
                {list.map((s) => {
                  const a = s.accountId ? book.byId[s.accountId] : undefined
                  return (
                    <li key={s.id}>
                      <div className="text-sm font-medium text-ink">{s.headline}</div>
                      <div className="text-xs text-ink-2">{s.detail}</div>
                      {a && <div className="mt-0.5 text-[11px] text-muted"><Link to={`/accounts/${a.id}`} className="text-accent">{a.name}</Link> · {a.status === 'Customer' ? 'our customer' : a.status.toLowerCase()} · rep {a.rep}</div>}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null,
        )}
        {hotStates.length > 0 && (
          <section className="mt-6">
            <h3 className="border-b border-line pb-1 text-sm font-semibold uppercase tracking-wide text-ink-2">Weather outlook (next 7 days)</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {hotStates.map((h) => <li key={h.code}><b className="font-medium text-ink">{STATES[h.code].name}</b> <span className="text-ink-2">{h.worst?.label}: {h.worst?.detail}. {h.n} customer operation(s) in the area.</span></li>)}
            </ul>
            <div className="mt-1 text-[11px] text-muted">{book.weather.source}</div>
          </section>
        )}
        <section className="mt-6 rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">
          <b>Your book:</b> {custHit.length} customer accounts had changes this week; {sent.length} outreach messages went out.
        </section>
        {!items.length && <p className="mt-6 text-sm text-muted">No changes recorded for this week.</p>}
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
      <PageHeader title="Signals & Newsletter" subtitle="Every change to a hog or cattle operation (ownership, leadership, capacity, integrator, biosecurity, regulation). Each change can trigger automated outreach." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'feed', label: 'Change feed' }, { value: 'newsletter', label: 'Weekly newsletter' }]} />
      {tab === 'newsletter' ? <Newsletter /> : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <TextInput label="Search" value={q} onChange={setQ} placeholder="Headline or detail…" />
            <Select label="Type" value={type} onChange={setType} options={['All', ...TYPES]} />
            <Select label="Species" value={species} onChange={setSpecies} options={['All', 'Hog', 'Cattle']} />
            <Select label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '120', label: 'Last 120 days' }]} />
            <div className="flex items-center gap-1.5 pb-1">
              {(['all', 'customers', 'prospects', 'market'] as const).map((s) => <Pill key={s} active={scope === s} onClick={() => setScope(s)}>{{ all: 'Everything', customers: 'Customers', prospects: 'Prospects', market: 'Market-wide' }[s]}</Pill>)}
            </div>
          </div>
          <Card pad={false} title={`${feed.length} signals`}>
            <ul className="divide-y divide-line">{feed.map((s) => <SignalRow key={s.id} s={s} />)}</ul>
          </Card>
        </>
      )}
    </div>
  )
}
