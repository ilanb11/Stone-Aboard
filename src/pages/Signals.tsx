import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, Copy, Mail } from 'lucide-react'
import { useBook, signals, lawChangeBySignal } from '../lib/useData'
import { useCrm } from '../store'
import { OPERATION_OPTIONS, type OutreachStatus, type RegionName, type Signal, type SignalType, type Species } from '../types'
import { REGIONS, STATES } from '../data/geo'
import { Button, Card, Chip, Notice, PageHeader, Pill, Select, StatusBadge, Tabs, TextInput, TextLink } from '../components/ui'
import { GeoFilter, GeoTag, geoLabel, signalInGeo, useGeo, accountInGeo, type Geo } from '../components/GeoFilter'
import { LawChangeGrants } from '../components/GrantPrograms'
import { num, shortDate } from '../lib/format'
import { draftForSignal } from '../lib/outreach'
import { affectedAccounts, applicationsForChange, awardText, deadlineText, grantsForChange } from '../lib/grants'
import { useWeatherImpact, type ImpactGroup } from '../lib/weatherImpact'
import { WeatherImpactView, EVENT_ICON, SourceLine, eventWhen, impactInGeo } from './signals/WeatherImpact'
import { GrantApplicationsView } from './signals/GrantApplications'

const TYPES: SignalType[] = ['Ownership Change', 'Leadership Change', 'Expansion', 'Contraction', 'Integrator / Packer Change', 'Biosecurity', 'Regulatory', 'Financial']
const TOPIC: Record<SignalType, string> = {
  'Ownership Change': 'Ownership and M&A',
  'Leadership Change': 'Leadership',
  Expansion: 'Expansion',
  Contraction: 'Contraction',
  'Integrator / Packer Change': 'Integrator, packer or grain marketing',
  Biosecurity: 'Animal and crop health',
  Regulatory: 'Regulatory',
  Financial: 'Financial',
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

// Past-tense wording for the outreach link on a signal ("Outreach drafted", "Outreach sent").
const MAIL_STATE: Record<OutreachStatus, string> = { Draft: 'drafted', Approved: 'approved', Sent: 'sent', Skipped: 'skipped' }

export function SignalRow({ s, compact }: { s: Signal; compact?: boolean }) {
  const book = useBook()
  const outreach = useCrm((st) => st.outreach)
  const queueOutreach = useCrm((st) => st.queueOutreach)
  const a = s.accountId ? book.byId[s.accountId] : undefined
  const mail = outreach.find((o) => o.signalId === s.id)
  const change = lawChangeBySignal[s.id]
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Chip>{s.type}</Chip>
          {s.severity === 'High' && <StatusBadge tone="serious">High</StatusBadge>}
          <span className="meta text-muted">{shortDate(s.date)}</span>
          <span className="text-[13px] text-muted">{s.source}</span>
          <GeoTag region={s.region} state={s.state} county={s.county} statewide={!s.accountId} />
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
        {!compact && change && <LawChangeGrants change={change} />}
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

function SectionHeading({ children, sub }: { children: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
      <h3 className="text-[24px] font-normal leading-tight tracking-[-0.02em] text-ink">{children}</h3>
      {sub && <span className="text-[13px] text-muted">{sub}</span>}
    </div>
  )
}

const listNames = (names: string[], max = 4) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`)
const statePlace = (s: Signal) => `${STATES[s.state ?? '']?.name ?? s.state}${s.county ? `, ${s.county} County` : s.accountId ? '' : ' (statewide)'}`

function Newsletter({ geo, impact }: { geo: Geo; impact: ReturnType<typeof useWeatherImpact> }) {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const apps = useCrm((s) => s.grantApplications)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const s = weekStart(new Date())
    s.setDate(s.getDate() - 7 * i)
    return s
  })
  const [wk, setWk] = useState(weeks[0].toISOString())
  const [species, setSpecies] = useState<'All' | Species>('All')
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 3000)
    return () => clearTimeout(t)
  }, [copied])
  const start = new Date(wk)
  const end = new Date(start.getTime() + 7 * 86400000)
  const current = wk === weeks[0].toISOString()
  const items = signals.filter((s) => {
    const t = new Date(s.date)
    if (t < start || t >= end) return false
    if (!signalInGeo(s, geo)) return false
    if (species !== 'All' && s.accountId && book.byId[s.accountId].species !== species) return false
    return true
  })
  const by = (t: SignalType) => items.filter((s) => s.type === t)
  // Grouped by region, busiest first; inside a region, by topic then newest.
  const regions = REGIONS.map((r) => [r, items.filter((s) => s.region === r).sort((x, y) => TYPES.indexOf(x.type) - TYPES.indexOf(y.type) || y.date.localeCompare(x.date))] as [RegionName, Signal[]])
    .filter(([, l]) => l.length)
    .sort((x, y) => y[1].length - x[1].length)
  const weather: ImpactGroup[] = current
    ? impactInGeo(impact.groups, geo)
        .map((g) => ({ ...g, accounts: g.accounts.filter((a) => species === 'All' || a.species === species) }))
        .filter((g) => g.accounts.length)
    : []
  const custHit = [...new Set(items.filter((s) => s.accountId && book.byId[s.accountId].status === 'Customer').map((s) => s.accountId!))]
  const sent = outreach.filter((o) => o.sentAt && new Date(o.sentAt) >= start && new Date(o.sentAt) < end && accountInGeo(book.byId[o.accountId] ?? { region: '' as RegionName, state: '', county: '' }, geo))
  const headAdded = by('Expansion').reduce((s, x) => s + (Number(x.headline.match(/\+([\d,]+) head/)?.[1]?.replace(/,/g, '')) || 0), 0)
  const acresAdded = by('Expansion').reduce((s, x) => s + (Number(x.headline.match(/adds ([\d,]+) acres/)?.[1]?.replace(/,/g, '')) || 0), 0)

  const funding = (s: Signal) => {
    const ch = lawChangeBySignal[s.id]
    if (!ch) return null
    const grants = grantsForChange(ch)
    const affected = affectedAccounts(ch, book.accounts)
    const drafted = applicationsForChange(ch, apps, book.accounts).length
    return { ch, grants, affected, drafted }
  }
  const fundingText = (f: NonNullable<ReturnType<typeof funding>>) =>
    f.grants.length
      ? `Funding: ${f.grants.map((g) => { const d = deadlineText(g.deadline); return `${g.shortName} (${awardText(g).toLowerCase()}, ${d.date ? `deadline ${d.date}` : d.label.toLowerCase()})` }).join('; ')}. ${plural(f.affected.length, 'affected account')}, ${plural(f.drafted, 'application')} pre-drafted.`
      : `No matching grant programs. ${plural(f.affected.length, 'affected account')}.`

  const masthead = 'The Hog, Herd & Field Brief'
  const weekLabel = `Week of ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  const area = geoLabel(geo)

  const asText = () =>
    [
      masthead,
      `${weekLabel}${area !== 'All regions' ? ` · ${area}` : ''}`,
      '',
      `${plural(items.length, 'change')} tracked, ${plural(by('Ownership Change').length, 'ownership change')}, ${plural(by('Leadership Change').length, 'leadership move')}, ${num(headAdded)} hog head of new barn capacity permitted, ${num(acresAdded)} acres of new cropland.`,
      '',
      ...(weather.length
        ? ['## Weather impact', ...weather.map((g) => `- ${g.severity}: ${g.kind} in ${STATES[g.state]?.name} (${g.counties.join(', ')}), ${eventWhen(g)}. ${g.summary}. Affects ${listNames(g.accounts.map((a) => a.name))}.`), '']
        : []),
      ...regions.flatMap(([r, list]) => [
        `## ${r}`,
        ...list.flatMap((s) => {
          const f = funding(s)
          return [`- [${TOPIC[s.type]} · ${statePlace(s)}] ${s.headline} (${shortDate(s.date)})${s.accountId ? ` [${book.byId[s.accountId].status}]` : ''}`, ...(f ? [`  ${fundingText(f)}`] : [])]
        }),
        '',
      ]),
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
    ['New cropland', num(acresAdded), 'acres'],
  ]

  return (
    <div className="max-w-3xl">
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Select label="Week" value={wk} onChange={setWk} options={weeks.map((w) => ({ value: w.toISOString(), label: `Week of ${w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` }))} />
        <GeoFilter counties={false} />
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {OPERATION_OPTIONS.map((o) => (
            <Pill key={o.value} active={species === o.value} onClick={() => setSpecies(o.value)}>
              {o.label}
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
            {area !== 'All regions' && <span className="meta text-muted">{area}</span>}
          </div>
          <h2 className="display mt-5 text-[40px] text-ink sm:text-[56px]">{masthead}</h2>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-[1.6] text-ink-2">
            Changes to hog, cattle and field-crop operations this week, region by region: ownership, leadership, capacity, integrators and grain marketing, animal and crop health, regulation and the grant money behind it, and the weather our accounts are facing.
          </p>
        </header>

        {/* Four columns only when the article itself is wide enough; the rail makes viewport breakpoints unreliable here. */}
        <div className="@container mt-10 border-t border-line pt-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-3 @3xl:grid-cols-5">
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

        {current && (
          <section className="mt-12">
            <SectionHeading sub={impact.status === 'ready' ? `${plural(weather.length, 'significant event')}` : 'Checking the forecast'}>Weather impact</SectionHeading>
            <p className="mt-3 text-[13px] text-muted">
              <SourceLine impact={impact} /> Only heat waves, drought, floods, blizzards and early frost that reach our customers and prospects.
            </p>
            {impact.status === 'ready' && !weather.length && <p className="mt-4 text-[15px] text-ink-2">No significant weather at customer or prospect locations in the next 7 days.</p>}
            <ul className="mt-5 flex flex-col gap-6">
              {weather.slice(0, 8).map((g) => {
                const Icon = EVENT_ICON[g.kind]
                const custs = g.accounts.filter((a) => a.status === 'Customer')
                return (
                  <li key={g.id} className="max-w-[68ch]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                      <Icon size={13} aria-hidden />
                      <span>{g.region}</span>
                      <span>{eventWhen(g)}</span>
                      <StatusBadge tone={g.severity === 'Severe' ? 'critical' : 'serious'}>{g.severity}</StatusBadge>
                    </div>
                    <div className="mt-1.5 text-[16px] font-medium leading-snug text-ink">
                      {g.kind} in {STATES[g.state]?.name}: {g.counties.join(', ')} {g.counties.length === 1 ? 'County' : 'counties'}
                    </div>
                    <p className="mt-1 text-[15px] leading-[1.7] text-ink-2">
                      {g.summary}. Affects {plural(g.accounts.length, 'account')}
                      {custs.length ? `, including customers ${listNames(custs.map((a) => a.name), 3)}` : ''}.
                    </p>
                  </li>
                )
              })}
            </ul>
            {weather.length > 8 && (
              <Link to="/signals?tab=weather" className="mt-4 inline-block text-[14px] text-ink underline underline-offset-4">
                All {num(weather.length)} events
              </Link>
            )}
          </section>
        )}

        {!items.length && <p className="mt-10 text-[15px] text-muted">No changes recorded for this week{area !== 'All regions' ? ` in ${area}` : ''}. Pick an earlier week or a wider area.</p>}

        {regions.map(([r, list]) => (
          <section key={r} className="mt-12">
            <SectionHeading sub={plural(list.length, 'change')}>{r}</SectionHeading>
            <ul className="mt-5 flex flex-col gap-6">
              {list.map((s) => {
                const a = s.accountId ? book.byId[s.accountId] : undefined
                const f = funding(s)
                return (
                  <li key={s.id} className="max-w-[68ch]">
                    <div className="text-[13px] text-muted">
                      {TOPIC[s.type]} · {statePlace(s)}
                    </div>
                    <div className="mt-1 text-[16px] font-medium leading-snug text-ink">{s.headline}</div>
                    <p className="mt-1.5 text-[15px] leading-[1.7] text-ink-2">{s.detail}</p>
                    {f && (
                      <p className="mt-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-ink-2">
                        <span className="text-ink">Grant funding. </span>
                        {fundingText(f).replace(/^Funding: /, '')}{' '}
                        {f.drafted > 0 && (
                          <Link to={`/signals?tab=grants&signal=${s.id}`} className="text-ink underline underline-offset-4">
                            Review applications
                          </Link>
                        )}
                      </p>
                    )}
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
        ))}

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

type Tab = 'feed' | 'weather' | 'grants' | 'newsletter'
const TAB_VALUES: Tab[] = ['feed', 'weather', 'grants', 'newsletter']

export default function Signals() {
  const book = useBook()
  const [params, setParams] = useSearchParams()
  const { geo } = useGeo()
  const impact = useWeatherImpact(book.accounts)
  const apps = useCrm((s) => s.grantApplications)
  const tab: Tab = TAB_VALUES.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'feed'
  const setTab = (t: Tab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams()
        // Geography carries across tabs; tab-specific filters don't.
        for (const k of ['region', 'state', 'county']) if (prev.get(k)) next.set(k, prev.get(k)!)
        if (t !== 'feed') next.set('tab', t)
        return next
      },
      { replace: true },
    )
  const type = params.get('type') ?? 'All'
  const setType = (v: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === 'All') next.delete('type')
        else next.set('type', v)
        return next
      },
      { replace: true },
    )
  const [scope, setScope] = useState<'all' | 'customers' | 'prospects' | 'market'>('all')
  const [days, setDays] = useState('30')
  const [species, setSpecies] = useState<'All' | Species>('All')
  const [q, setQ] = useState('')
  const feed = useMemo(() => {
    const cut = Date.now() - Number(days) * 86400000
    return signals.filter((s) => {
      if (new Date(s.date).getTime() < cut) return false
      if (type !== 'All' && s.type !== type) return false
      if (!signalInGeo(s, geo)) return false
      const a = s.accountId ? book.byId[s.accountId] : undefined
      if (scope === 'customers' && a?.status !== 'Customer') return false
      if (scope === 'prospects' && a?.status !== 'Prospect') return false
      if (scope === 'market' && a) return false
      if (species !== 'All' && a && a.species !== species) return false
      if (q && !`${s.headline} ${s.detail}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [book, type, scope, days, species, q, geo])
  const weatherCount = impact.status === 'ready' ? impactInGeo(impact.groups, geo).length : undefined
  const draftCount = apps.filter((a) => a.status === 'Draft').length

  return (
    <div>
      <PageHeader
        title="Signals and newsletter"
        subtitle="Every change to a hog, cattle or field-crop operation, tagged by region, state and county: ownership, leadership, capacity, integrator or grain marketing, animal and crop health, and regulation, with the grant programs a rule change opens. Plus significant weather at customer and prospect locations."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'feed', label: 'Change feed' },
          { value: 'weather', label: <>Weather impact{weatherCount !== undefined && <span className="tabular ml-1.5 opacity-60">{weatherCount}</span>}</> },
          { value: 'grants', label: <>Grant applications{draftCount > 0 && <span className="tabular ml-1.5 opacity-60">{draftCount}</span>}</> },
          { value: 'newsletter', label: 'Weekly newsletter' },
        ]}
      />
      {tab === 'newsletter' ? (
        <Newsletter geo={geo} impact={impact} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <GeoFilter />
          </div>
          {tab === 'weather' && <WeatherImpactView impact={impact} geo={geo} />}
          {tab === 'grants' && <GrantApplicationsView geo={geo} />}
          {tab === 'feed' && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <TextInput label="Search" value={q} onChange={setQ} placeholder="Headline or detail" className="w-full sm:w-64" />
                <Select label="Type" value={type} onChange={setType} options={['All', ...TYPES]} />
                <Select label="Operation" value={species} onChange={setSpecies} options={OPERATION_OPTIONS} />
                <Select label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '120', label: 'Last 120 days' }]} />
                <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                  {(['all', 'customers', 'prospects', 'market'] as const).map((s) => (
                    <Pill key={s} active={scope === s} onClick={() => setScope(s)}>
                      {{ all: 'Everything', customers: 'Customers', prospects: 'Prospects', market: 'Market-wide' }[s]}
                    </Pill>
                  ))}
                </div>
              </div>
              <Card pad={false} title={`${plural(feed.length, 'signal')}${geo.region !== 'All' || geo.state !== 'All' ? ` in ${geoLabel(geo)}` : ''}`}>
                <ul className="divide-y divide-line">{feed.map((s) => <SignalRow key={s.id} s={s} />)}</ul>
                {!feed.length && <div className="px-5 py-10 text-center text-[14px] text-muted">No signals match these filters. Widen the period, the area or clear the search.</div>}
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
