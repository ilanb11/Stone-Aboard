import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileSignature } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { TEAM } from '../data/generate'
import { PRODUCT } from '../data/products'
import { OPP_STAGES, type OppStage } from '../types'
import { Card, Chip, PageHeader, Select, Tabs, TextInput } from '../components/ui'
import { initials, money, shortDate } from '../lib/format'

const FACTORS = [
  ['fit', 'Fit'],
  ['intent', 'Intent'],
  ['timing', 'Timing'],
  ['relationship', 'Relationship'],
] as const

export default function Opportunities() {
  const book = useBook()
  const moveOpp = useCrm((s) => s.moveOpp)
  const [params] = useSearchParams()
  const [view, setView] = useState<'ranked' | 'board'>(params.get('view') === 'board' ? 'board' : 'ranked')
  const [type, setType] = useState('All')
  const [species, setSpecies] = useState('All')
  const [rep, setRep] = useState('All')
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState<string | null>(null)

  const match = (a: { name: string; species: string; rep: string }, t: string) =>
    (type === 'All' || t === type) && (species === 'All' || a.species === species) && (rep === 'All' || a.rep === rep) && (!q || a.name.toLowerCase().includes(q.toLowerCase()))
  const ranked = useMemo(() => book.ranked.filter((r) => match(r.account, r.type)), [book, type, species, rep, q])
  const board = useMemo(() => book.opportunities.filter((o) => match(book.byId[o.accountId], o.type)), [book, type, species, rep, q])

  return (
    <div>
      <PageHeader title="Opportunities" subtitle="Ranked by fit, intent (recent org changes), timing (competitor and contract renewals) and relationship, weighted by deal size. Price-normalization moves from the pricing engine are included." />
      <Tabs value={view} onChange={setView} tabs={[{ value: 'ranked', label: `Ranked (${ranked.length})` }, { value: 'board', label: 'Pipeline board' }]} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <TextInput label="Search" value={q} onChange={setQ} placeholder="Account name…" />
        <Select label="Type" value={type} onChange={setType} options={['All', 'New Logo', 'Expansion', 'Renewal', 'Price Normalization']} />
        <Select label="Species" value={species} onChange={setSpecies} options={['All', 'Hog', 'Cattle']} />
        <Select label="Rep" value={rep} onChange={setRep} options={['All', ...TEAM]} />
      </div>

      {view === 'ranked' ? (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-line text-xs text-ink-2">
                <tr>
                  <th className="w-10 px-3 py-2 text-right font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium">Type / stage</th>
                  <th className="px-3 py-2 text-right font-medium">ARR</th>
                  <th className="w-48 px-3 py-2 text-left font-medium">Score</th>
                  <th className="px-3 py-2 text-left font-medium">Why now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ranked.slice(0, 200).map((r, i) => (
                  <tr key={r.key} className="align-top hover:bg-surface-2/50">
                    <td className="tabular px-3 py-2.5 text-right text-xs font-semibold text-muted">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <Link to={`/accounts/${r.account.id}`} className="font-medium text-ink hover:text-accent">{r.account.name}</Link>
                      <div className="text-xs text-muted">{r.account.segment} · {r.account.state} · {r.account.rep}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Chip tone={r.type === 'Price Normalization' ? 'accent' : 'neutral'}>{r.type}</Chip>
                      <div className="mt-1 text-xs text-ink-2">{r.stage}</div>
                      {r.opp?.contractId && <Link to={`/contracts/${r.opp.contractId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent"><FileSignature size={12} /> Lucas</Link>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right font-medium">{money(r.arr)}</td>
                    <td className="px-3 py-2.5">
                      <div className="tabular text-sm font-semibold text-ink">{r.priority}</div>
                      <div className="mt-1 grid grid-cols-4 gap-1" title={FACTORS.map(([k, l]) => `${l}: ${r.factors[k]}`).join('\n')}>
                        {FACTORS.map(([k, l]) => (
                          <div key={k}>
                            <div className="h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${r.factors[k]}%` }} /></div>
                            <div className="mt-0.5 text-[9px] text-muted">{l}</div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-md px-3 py-2.5">
                      <ul className="flex flex-col gap-0.5 text-xs text-ink-2">
                        {r.reasons.slice(0, 3).map((x) => <li key={x} className="truncate">• {x}</li>)}
                        {!r.reasons.length && <li className="text-muted">Strong segment fit</li>}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {OPP_STAGES.map((stage) => {
            const col = board.filter((o) => o.stage === stage)
            return (
              <div key={stage} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) moveOpp(drag, stage as OppStage); setDrag(null) }} className="flex w-68 shrink-0 flex-col rounded-xl border border-line bg-surface-2/60">
                <div className="flex items-baseline justify-between px-3 pb-2 pt-3">
                  <span className="text-sm font-semibold text-ink">{stage} <span className="tabular font-normal text-muted">{col.length}</span></span>
                  <span className="tabular text-xs text-ink-2">{money(col.reduce((s, o) => s + o.arr, 0))}</span>
                </div>
                <div className="flex max-h-[calc(100vh-300px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {col.map((o) => {
                    const a = book.byId[o.accountId]
                    return (
                      <div key={o.id} draggable onDragStart={() => setDrag(o.id)} className={`cursor-grab rounded-lg border border-line bg-surface p-3 shadow-sm ${drag === o.id ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/accounts/${a.id}`} className="text-sm font-medium leading-snug text-ink hover:text-accent">{a.name}</Link>
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent" title={o.owner}>{initials(o.owner)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{a.segment} · {a.state}</div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <Chip>{o.type}</Chip>
                          <span className="tabular font-semibold text-ink">{money(o.arr)}</span>
                        </div>
                        <div className="mt-1.5 truncate text-[11px] text-ink-2">{o.products.map((p) => PRODUCT[p].name).join(', ')}</div>
                        <div className="mt-1 text-[11px] text-muted">Close {shortDate(o.closeDate)}</div>
                        {o.contractId && <Link to={`/contracts/${o.contractId}`} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent"><FileSignature size={12} /> Redlines: open Lucas</Link>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
