import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, ArrowDown, ArrowUp, ArrowUpDown, Copy, Download } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { STATE_LIST } from '../data/geo'
import { TEAM } from '../data/generate'
import type { Account, Segment } from '../types'
import { Button, Chip, HealthBadge, Notice, PageHeader, Select, StatusBadge, TextInput, WeatherBadge } from '../components/ui'
import { downloadCsv, isFramed, money, num, relDays } from '../lib/format'
import { mrr } from '../lib/pricing'

const SEGMENTS: Segment[] = ['Sow Farm', 'Wean-to-Finish', 'Farrow-to-Finish', 'Contract Finisher', 'Integrated System', 'Cow-Calf', 'Stocker / Backgrounder', 'Feedlot', 'Dairy']
type SortKey = 'name' | 'head' | 'arr' | 'health' | 'weather' | 'signal'

const td = 'px-4 py-3 align-top first:pl-5 last:pr-5'
const none = <span className="text-muted">—</span>

export default function Accounts() {
  const book = useBook()
  const [params] = useSearchParams()
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState('All')
  const [segment, setSegment] = useState('All')
  const [status, setStatus] = useState(params.get('status') ?? 'All')
  const [state, setState] = useState(params.get('state') ?? 'All')
  const [rep, setRep] = useState('All')
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'arr', d: -1 })
  const [page, setPage] = useState(0)
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null)
  const framed = isFramed()

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = book.accounts.filter((a) => {
      if (s && !`${a.name} ${a.county} ${a.state} ${a.integrator ?? ''} ${a.parentCompany ?? ''} ${a.contacts.map((c) => c.name).join(' ')}`.toLowerCase().includes(s)) return false
      if (species !== 'All' && a.species !== species) return false
      if (segment !== 'All' && a.segment !== segment) return false
      if (status !== 'All' && a.status !== status) return false
      if (state !== 'All' && a.state !== state) return false
      if (rep !== 'All' && a.rep !== rep) return false
      return true
    })
    const v = (a: Account): number | string => {
      switch (sort.k) {
        case 'name': return a.name
        case 'head': return a.headCount
        case 'arr': return mrr(a)
        case 'health': return book.health[a.id]?.score ?? -1
        case 'weather': return book.weatherRisk[a.id]?.risk ?? 0
        case 'signal': return signalsByAccount[a.id]?.[0]?.date ?? ''
      }
    }
    return out.sort((a, b) => {
      const x = v(a), y = v(b)
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.d
    })
  }, [book, q, species, segment, status, state, rep, sort])

  const PAGE = 50
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const reset = () => setPage(0)
  const toast = (text: string, error = false) => {
    setFlash({ text, error })
    setTimeout(() => setFlash(null), error ? 4000 : 2500)
  }

  const exportCsv = async () => {
    const result = await downloadCsv('accounts.csv', [['ID', 'Name', 'Species', 'Segment', 'County', 'State', 'Head', 'Sites', 'Barns', 'Status', 'ARR', 'Rep', 'Integrator/Packer', 'Parent'], ...rows.map((a) => [a.id, a.name, a.species, a.segment, a.county, a.state, a.headCount, a.sites, a.barns, a.status, Math.round(mrr(a) * 12), a.rep, a.integrator ?? '', a.parentCompany ?? ''])])
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
          <button type="button" className={`inline-flex items-center gap-1.5 transition-colors hover:text-ink ${active ? 'text-ink' : ''}`} onClick={() => setSort((s) => ({ k, d: s.k === k ? (-s.d as 1 | -1) : k === 'name' ? 1 : -1 }))}>
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
        subtitle="Every hog and cattle operation we sell to or want to sell to."
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <TextInput className="col-span-2 md:col-span-1 xl:col-span-2" label="Search" value={q} onChange={(v) => { setQ(v); reset() }} placeholder="Name, contact or integrator" />
        <Select label="Species" value={species} onChange={(v) => { setSpecies(v); reset() }} options={['All', 'Hog', 'Cattle']} />
        <Select label="Segment" value={segment} onChange={(v) => { setSegment(v); reset() }} options={['All', ...SEGMENTS]} />
        <Select label="Status" value={status} onChange={(v) => { setStatus(v); reset() }} options={['All', 'Customer', 'Prospect', 'Churned']} />
        <Select label="State" value={state} onChange={(v) => { setState(v); reset() }} options={[{ value: 'All', label: 'All' }, ...STATE_LIST.map((s) => ({ value: s.code, label: s.name }))]} />
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
        <table className="w-full min-w-[1150px] text-[14px]">
          <thead>
            <tr>
              {th('Account', 'name')}
              {th('Segment')}
              {th('Head', 'head', true)}
              {th('Sites / barns', undefined, true)}
              {th('Status')}
              {th('ARR', 'arr', true)}
              {th('Health', 'health')}
              {th('Weather (7d)', 'weather')}
              {th('Pricing')}
              {th('Latest signal', 'signal')}
              {th('Rep')}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((a) => {
              const sig = signalsByAccount[a.id]?.[0]
              const p = book.pricing[a.id]
              return (
                <tr key={a.id} className="border-t border-line hover:bg-accent-soft/60">
                  <td className={`${td} min-w-[240px]`}>
                    <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{a.name}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                      <span>{a.county} Co., {a.state}</span>
                      {a.integrator && <span>{a.integrator}</span>}
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="text-ink">{a.segment}</span>
                    <div className="mt-0.5 text-[12px] text-muted">{a.species}</div>
                  </td>
                  <td className={`${td} tabular text-right text-ink`}>{num(a.headCount)}</td>
                  <td className={`${td} tabular text-right text-ink`}>{a.sites} / {a.barns}</td>
                  <td className={td}><Chip tone={a.status === 'Customer' ? 'accent' : a.status === 'Churned' ? 'dim' : 'neutral'}>{a.status}</Chip></td>
                  <td className={`${td} tabular text-right text-ink`}>{a.status === 'Customer' ? money(mrr(a) * 12) : none}</td>
                  <td className={td}><HealthBadge h={book.health[a.id]} /></td>
                  <td className={td}>{a.status === 'Customer' ? <WeatherBadge w={book.weatherRisk[a.id]} compact /> : none}</td>
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
