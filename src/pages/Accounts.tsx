import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Download } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { STATE_LIST } from '../data/geo'
import { TEAM } from '../data/generate'
import type { Account, Segment } from '../types'
import { Button, Chip, HealthBadge, PageHeader, Select, StatusBadge, TextInput, WeatherBadge } from '../components/ui'
import { downloadCsv, money, num, relDays } from '../lib/format'
import { mrr } from '../lib/pricing'

const SEGMENTS: Segment[] = ['Sow Farm', 'Wean-to-Finish', 'Farrow-to-Finish', 'Contract Finisher', 'Integrated System', 'Cow-Calf', 'Stocker / Backgrounder', 'Feedlot', 'Dairy']
type SortKey = 'name' | 'head' | 'arr' | 'health' | 'weather' | 'signal'

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
  const reset = () => setPage(0)

  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`whitespace-nowrap px-3 py-2 text-xs font-medium text-ink-2 ${right ? 'text-right' : 'text-left'}`}>
      {k ? (
        <button className={`inline-flex items-center gap-1 hover:text-ink ${sort.k === k ? 'text-ink' : ''}`} onClick={() => setSort((s) => ({ k, d: s.k === k ? (-s.d as 1 | -1) : k === 'name' ? 1 : -1 }))}>
          {children} <ArrowUpDown size={12} className={sort.k === k ? 'text-accent' : 'text-muted'} />
        </button>
      ) : children}
    </th>
  )

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Every hog and cattle operation we sell to or want to sell to."
        actions={
          <Button onClick={() => downloadCsv('accounts.csv', [['ID', 'Name', 'Species', 'Segment', 'County', 'State', 'Head', 'Sites', 'Barns', 'Status', 'ARR', 'Rep', 'Integrator/Packer', 'Parent'], ...rows.map((a) => [a.id, a.name, a.species, a.segment, a.county, a.state, a.headCount, a.sites, a.barns, a.status, Math.round(mrr(a) * 12), a.rep, a.integrator ?? '', a.parentCompany ?? ''])])}>
            <Download size={14} /> Export CSV
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-4 xl:grid-cols-7">
        <TextInput className="col-span-2 md:col-span-1 xl:col-span-2" label="Search" value={q} onChange={(v) => { setQ(v); reset() }} placeholder="Name, contact, integrator…" />
        <Select label="Species" value={species} onChange={(v) => { setSpecies(v); reset() }} options={['All', 'Hog', 'Cattle']} />
        <Select label="Segment" value={segment} onChange={(v) => { setSegment(v); reset() }} options={['All', ...SEGMENTS]} />
        <Select label="Status" value={status} onChange={(v) => { setStatus(v); reset() }} options={['All', 'Customer', 'Prospect', 'Churned']} />
        <Select label="State" value={state} onChange={(v) => { setState(v); reset() }} options={[{ value: 'All', label: 'All' }, ...STATE_LIST.map((s) => ({ value: s.code, label: s.name }))]} />
        <Select label="Rep" value={rep} onChange={(v) => { setRep(v); reset() }} options={['All', ...TEAM]} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
        <span><b className="font-semibold text-ink">{num(rows.length)}</b> accounts · {money(rows.reduce((s, a) => s + mrr(a) * 12, 0))} ARR</span>
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="tabular">Page {page + 1} / {Math.max(1, Math.ceil(rows.length / PAGE))}</span>
          <Button size="sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="border-b border-line">
            <tr>
              <Th k="name">Account</Th>
              <Th>Segment</Th>
              <Th k="head" right>Head</Th>
              <Th right>Sites / barns</Th>
              <Th>Status</Th>
              <Th k="arr" right>ARR</Th>
              <Th k="health">Health</Th>
              <Th k="weather">Weather (7d)</Th>
              <Th>Pricing</Th>
              <Th k="signal">Latest signal</Th>
              <Th>Rep</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pageRows.map((a) => {
              const sig = signalsByAccount[a.id]?.[0]
              const p = book.pricing[a.id]
              return (
                <tr key={a.id} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2">
                    <Link to={`/accounts/${a.id}`} className="font-medium text-ink hover:text-accent">{a.name}</Link>
                    <div className="text-xs text-muted">{a.county} Co., {a.state}{a.integrator ? ` · ${a.integrator}` : ''}</div>
                  </td>
                  <td className="px-3 py-2"><span className="text-ink">{a.segment}</span><div className="text-xs text-muted">{a.species}</div></td>
                  <td className="tabular px-3 py-2 text-right">{num(a.headCount)}</td>
                  <td className="tabular px-3 py-2 text-right">{a.sites} / {a.barns}</td>
                  <td className="px-3 py-2"><Chip tone={a.status === 'Customer' ? 'accent' : a.status === 'Churned' ? 'dim' : 'neutral'}>{a.status}</Chip></td>
                  <td className="tabular px-3 py-2 text-right">{a.status === 'Customer' ? money(mrr(a) * 12) : '—'}</td>
                  <td className="px-3 py-2"><HealthBadge h={book.health[a.id]} /></td>
                  <td className="px-3 py-2">{a.status === 'Customer' ? <WeatherBadge w={book.weatherRisk[a.id]} compact /> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="px-3 py-2">
                    {p ? <StatusBadge tone={p.status === 'Under-priced' ? 'warning' : p.status === 'Over-priced' ? 'serious' : 'good'}>{p.status}</StatusBadge> : <span className="text-xs text-muted">—</span>}
                  </td>
                  <td className="max-w-64 px-3 py-2">
                    {sig ? <><div className="truncate text-xs text-ink">{sig.headline}</div><div className="text-[11px] text-muted">{sig.type} · {relDays(sig.date)}</div></> : <span className="text-xs text-muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">{a.rep}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!pageRows.length && <div className="p-8 text-center text-sm text-muted">No accounts match.</div>}
      </div>
    </div>
  )
}
