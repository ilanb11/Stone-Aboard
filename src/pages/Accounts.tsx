import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, FileSignature } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { STATES, STATE_LIST } from '../data/geo'
import { TEAM } from '../data/generate'
import { useCrm } from '../store'
import { GRAIN_SEGMENTS, OPERATION_LABEL, OPERATION_OPTIONS, OPP_STAGES, type Account, type Opportunity, type OppStage, type Segment, type Species } from '../types'
import { Button, Chip, Notice, PageHeader, Select, StatusBadge, TextInput } from '../components/ui'
import { downloadCsv, isFramed, money, num, relDays, sizeLabel } from '../lib/format'
import { mrr } from '../lib/pricing'
import { currentDeal } from '../lib/pipeline'

const SEGMENTS: Record<Species, readonly Segment[]> = {
  Hog: ['Sow Farm', 'Wean-to-Finish', 'Farrow-to-Finish', 'Contract Finisher', 'Integrated System'],
  Cattle: ['Cow-Calf', 'Stocker / Backgrounder', 'Feedlot', 'Dairy'],
  Grain: GRAIN_SEGMENTS,
}
type SortKey = 'name' | 'location' | 'size' | 'stage' | 'arr' | 'signal'
/** Size in the operation's own unit: head for livestock, acres for field crops. */
const sizeOf = (a: Account) => (a.species === 'Grain' ? a.acres : a.headCount)
const STAGE_RANK = Object.fromEntries(OPP_STAGES.map((s, i) => [s, i])) as Record<OppStage, number>
const NO_DEAL = 'No deal'

const td = 'px-4 py-3 align-top first:pl-5 last:pr-5'
const none = <span className="text-muted">—</span>
const stageSelect =
  'h-8 max-w-[150px] rounded-full border border-transparent bg-accent-soft pl-3 pr-7 text-[13px] text-ink outline-none transition-colors hover:bg-accent-soft-2 focus:border-line-strong focus:bg-surface'

export default function Accounts() {
  const book = useBook()
  const setAccountStage = useCrm((s) => s.setAccountStage)
  const [params] = useSearchParams()
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState<'All' | Species>('All')
  const [segment, setSegment] = useState('All')
  const [status, setStatus] = useState(params.get('status') ?? 'All')
  const [stage, setStage] = useState<'All' | OppStage | typeof NO_DEAL>('All')
  const [state, setState] = useState(params.get('state') ?? 'All')
  const [county, setCounty] = useState('All')
  const [rep, setRep] = useState('All')
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'arr', d: -1 })
  const [page, setPage] = useState(0)
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null)
  const framed = isFramed()

  // Each account's current deal: its furthest open deal, else its latest one.
  const deals = useMemo(() => {
    const by: Record<string, Opportunity[]> = {}
    for (const o of book.opportunities) (by[o.accountId] ??= []).push(o)
    const out: Record<string, Opportunity | undefined> = {}
    for (const a of book.accounts) out[a.id] = by[a.id] ? currentDeal(by[a.id]) : undefined
    return out
  }, [book])

  // County choices follow the state filter; with every state, list "County, ST".
  const countyOptions = useMemo(() => {
    const keys = new Set(book.accounts.filter((a) => state === 'All' || a.state === state).map((a) => `${a.county}|${a.state}`))
    return [...keys]
      .map((k) => k.split('|') as [string, string])
      .sort((x, y) => (STATES[x[1]].name + x[0]).localeCompare(STATES[y[1]].name + y[0]))
      .map(([c, s]) => ({ value: `${c}|${s}`, label: state === 'All' ? `${c}, ${s}` : c }))
  }, [book, state])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = book.accounts.filter((a) => {
      if (s && !`${a.name} ${a.county} ${a.state} ${STATES[a.state]?.name ?? ''} ${a.integrator ?? ''} ${a.parentCompany ?? ''} ${a.contacts.map((c) => c.name).join(' ')}`.toLowerCase().includes(s)) return false
      if (species !== 'All' && a.species !== species) return false
      if (segment !== 'All' && a.segment !== segment) return false
      if (status !== 'All' && a.status !== status) return false
      if (state !== 'All' && a.state !== state) return false
      if (county !== 'All' && `${a.county}|${a.state}` !== county) return false
      if (rep !== 'All' && a.rep !== rep) return false
      const d = deals[a.id]
      if (stage === NO_DEAL && d) return false
      if (stage !== 'All' && stage !== NO_DEAL && d?.stage !== stage) return false
      return true
    })
    const v = (a: Account): number | string => {
      switch (sort.k) {
        case 'name': return a.name
        case 'location': return `${STATES[a.state]?.name ?? a.state} ${a.county}`
        case 'size': return sizeOf(a)
        case 'stage': return deals[a.id] ? STAGE_RANK[deals[a.id]!.stage] : -1
        case 'arr': return mrr(a)
        case 'signal': return signalsByAccount[a.id]?.[0]?.date ?? ''
      }
    }
    return out.sort((a, b) => {
      const x = v(a), y = v(b)
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.d
    })
  }, [book, deals, q, species, segment, status, stage, state, county, rep, sort])

  const PAGE = 50
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const reset = () => setPage(0)
  const toast = (text: string, error = false) => {
    setFlash({ text, error })
    setTimeout(() => setFlash(null), error ? 4000 : 2500)
  }

  const exportCsv = async () => {
    const result = await downloadCsv('accounts.csv', [
      ['ID', 'Name', 'Operation', 'Segment', 'Crops', 'County', 'State', 'Head', 'Acres', 'Sites', 'Barns or bins', 'Customer status', 'Stage', 'Deal type', 'ARR', 'Rep', 'Integrator, packer or elevator', 'Parent'],
      ...rows.map((a) => [a.id, a.name, OPERATION_LABEL[a.species], a.segment, (a.crops ?? []).join('; '), a.county, a.state, a.headCount, a.acres, a.sites, a.barns, a.status, deals[a.id]?.stage ?? '', deals[a.id]?.type ?? '', Math.round(mrr(a) * 12), a.rep, a.integrator ?? '', a.parentCompany ?? '']),
    ])
    if (result === 'copied') toast('Copied to clipboard')
    else if (result === 'failed') toast("Couldn't copy. Allow clipboard access in your browser and try again.", true)
  }

  // Render helper, not a component: a component defined in render remounts every
  // header cell on each sort, which drops keyboard focus from the sort button.
  const th = (label: string, k?: SortKey, right?: boolean) => {
    const active = !!k && sort.k === k
    const Icon = active ? (sort.d === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th key={label} className={`whitespace-nowrap px-4 py-3 text-[13px] font-normal text-muted first:pl-5 last:pr-5 ${right ? 'text-right' : 'text-left'}`} aria-sort={active ? (sort.d === 1 ? 'ascending' : 'descending') : undefined}>
        {k ? (
          <button type="button" className={`inline-flex items-center gap-1.5 transition-colors hover:text-ink ${active ? 'text-ink' : ''}`} onClick={() => setSort((s) => ({ k, d: s.k === k ? (-s.d as 1 | -1) : k === 'name' || k === 'location' ? 1 : -1 }))}>
            {label} <Icon size={12} className={active ? 'text-ink' : 'text-muted'} aria-hidden />
          </button>
        ) : label}
      </th>
    )
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Every hog, cattle and field-crop operation we sell to or want to sell to. Change a deal's stage right in the table. Moving a deal to Negotiation for the first time has Lucas the Hog draft the contract and intro email for your review."
        actions={
          <Button onClick={exportCsv}>
            {framed ? <Copy size={14} /> : <Download size={14} />} {framed ? 'Copy as CSV' : 'Export CSV'}
          </Button>
        }
      />
      {flash &&
        (flash.error ? (
          <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
            <AlertOctagon size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-critical" aria-hidden />
            <span className="min-w-0">{flash.text}</span>
          </div>
        ) : (
          <Notice>{flash.text}</Notice>
        ))}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-9">
        <TextInput className="col-span-2 md:col-span-2 xl:col-span-2" label="Search" value={q} onChange={(v) => { setQ(v); reset() }} placeholder="Name, contact, place or integrator" />
        <Select label="Operation" value={species} onChange={(v) => { setSpecies(v); setSegment('All'); reset() }} options={OPERATION_OPTIONS} />
        <Select label="Segment" value={segment} onChange={(v) => { setSegment(v); reset() }} options={['All', ...(species === 'All' ? Object.values(SEGMENTS).flat() : SEGMENTS[species])]} />
        <Select label="Customer status" value={status} onChange={(v) => { setStatus(v); reset() }} options={['All', 'Customer', 'Prospect', 'Churned']} />
        <Select label="Stage" value={stage} onChange={(v) => { setStage(v); reset() }} options={['All', ...OPP_STAGES, NO_DEAL]} />
        <Select label="State" value={state} onChange={(v) => { setState(v); setCounty('All'); reset() }} options={[{ value: 'All', label: 'All' }, ...STATE_LIST.map((s) => ({ value: s.code, label: s.name }))]} />
        <Select label="County" value={county} onChange={(v) => { setCounty(v); reset() }} options={[{ value: 'All', label: 'All' }, ...countyOptions]} />
        <Select label="Rep" value={rep} onChange={(v) => { setRep(v); reset() }} options={['All', ...TEAM]} />
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="flex items-baseline gap-2">
            <span className="figure text-[32px] text-ink">{num(rows.length)}</span>
            <span className="text-[14px] text-ink-2">accounts</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="figure text-[32px] text-ink">{money(rows.reduce((s, a) => s + mrr(a) * 12, 0))}</span>
            <span className="text-[14px] text-ink-2">ARR</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="tabular px-1 text-[13px] text-ink-2">Page {page + 1} of {pages}</span>
          <Button size="sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
        <table className="w-full min-w-[1180px] text-[14px]">
          <thead>
            <tr>
              {th('Account', 'name')}
              {th('Location', 'location')}
              {th('Segment')}
              {th('Size', 'size', true)}
              {th('Sites / barns or bins', undefined, true)}
              {th('Stage', 'stage')}
              {th('ARR', 'arr', true)}
              {th('Pricing')}
              {th('Latest signal', 'signal')}
              {th('Rep')}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((a) => {
              const sig = signalsByAccount[a.id]?.[0]
              const p = book.pricing[a.id]
              const d = deals[a.id]
              return (
                <tr key={a.id} className="border-t border-line hover:bg-accent-soft/60">
                  <td className={`${td} min-w-[220px]`}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{a.name}</Link>
                      <Chip tone={a.status === 'Customer' ? 'accent' : a.status === 'Churned' ? 'dim' : 'neutral'}>{a.status}</Chip>
                    </div>
                    {a.integrator && <div className="mt-0.5 text-[12px] text-muted">{a.integrator}</div>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="text-ink">{a.county}, {a.state}</span>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="text-ink">{a.segment}</span>
                    <div className="mt-0.5 text-[12px] text-muted">{a.species === 'Grain' ? (a.crops ?? []).join(', ') : OPERATION_LABEL[a.species]}</div>
                  </td>
                  <td className={`${td} tabular whitespace-nowrap text-right text-ink`}>{sizeLabel(a)}</td>
                  <td className={`${td} tabular text-right text-ink`}>{a.sites} / {a.barns}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    <select
                      id={`stage-${a.id}`}
                      aria-label={`Stage for ${a.name}`}
                      className={stageSelect}
                      value={d?.stage ?? ''}
                      onChange={(e) => setAccountStage(a.id, e.target.value as OppStage)}
                    >
                      {!d && <option value="">No deal</option>}
                      {OPP_STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                      <span>{d ? d.type : 'Pick a stage to open a deal'}</span>
                      {d?.contractId && (
                        <Link to={`/contracts/${d.contractId}`} className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline">
                          <FileSignature size={11} aria-hidden /> {d.contractId.startsWith('KD-') ? 'Lucas draft' : 'Contract'}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className={`${td} tabular text-right text-ink`}>{a.status === 'Customer' ? money(mrr(a) * 12) : none}</td>
                  <td className={td}>
                    {p ? <StatusBadge tone={p.status === 'Under-priced' ? 'warning' : p.status === 'Over-priced' ? 'serious' : 'good'}>{p.status}</StatusBadge> : none}
                  </td>
                  <td className={`${td} max-w-64`}>
                    {sig ? (
                      <>
                        <div className="truncate text-[13px] text-ink">{sig.headline}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                          <span>{sig.type}</span>
                          <span className="meta">{relDays(sig.date)}</span>
                        </div>
                      </>
                    ) : none}
                  </td>
                  <td className={`${td} whitespace-nowrap text-[13px] text-ink-2`}>{a.rep}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!pageRows.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No accounts match these filters. Clear the search or set a filter back to All.</div>}
      </div>
    </div>
  )
}
