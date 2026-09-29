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

const th = 'whitespace-nowrap px-4 py-3 text-left text-[13px] font-normal text-muted first:pl-5 last:pr-5'
const thNum = 'whitespace-nowrap px-4 py-3 text-right text-[13px] font-normal text-muted first:pl-5 last:pr-5'
const td = 'px-4 py-4 first:pl-5 last:pr-5'

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
      <PageHeader
        title="Opportunities"
        subtitle="Ranked by fit, intent (recent org changes), timing (competitor and contract renewals) and relationship, weighted by deal size. Includes the price changes suggested on the Pricing page."
      />
      <Tabs value={view} onChange={setView} tabs={[
          {
            value: 'ranked',
            label: (
              <>
                Ranked<span className="tabular ml-1.5 opacity-60">{ranked.length}</span>
              </>
            ),
          },
          { value: 'board', label: 'Pipeline board' },
        ]} />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <TextInput label="Search" value={q} onChange={setQ} placeholder="Account name" className="w-full sm:w-64" />
        <Select label="Type" value={type} onChange={setType} options={['All', 'New Logo', 'Expansion', 'Renewal', 'Price Normalization']} />
        <Select label="Species" value={species} onChange={setSpecies} options={['All', 'Hog', 'Cattle']} />
        <Select label="Rep" value={rep} onChange={setRep} options={['All', ...TEAM]} />
      </div>

      {view === 'ranked' ? (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-[14px]">
              <thead>
                <tr>
                  <th className={`w-12 ${thNum}`}>Rank</th>
                  <th className={`min-w-[220px] ${th}`}>Account</th>
                  <th className={`min-w-[170px] ${th}`}>Type and stage</th>
                  <th className={thNum}>ARR</th>
                  <th className={`min-w-[196px] ${th}`}>Score</th>
                  <th className={`w-full min-w-[240px] ${th}`}>Why now</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 200).map((r, i) => (
                  <tr key={r.key} className="border-t border-line align-top hover:bg-accent-soft/60">
                    <td className={`${td} meta text-right text-muted`}>{i + 1}</td>
                    <td className={`${td} min-w-0`}>
                      <Link to={`/accounts/${r.account.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {r.account.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
                        <span>
                          {r.account.segment}, {r.account.state}
                        </span>
                        <span>Rep {r.account.rep}</span>
                      </div>
                    </td>
                    <td className={td}>
                      <Chip tone={r.type === 'Price Normalization' ? 'accent' : 'neutral'}>{r.type}</Chip>
                      <div className="mt-1.5 text-[13px] text-ink-2">{r.stage}</div>
                      {r.opp?.contractId && (
                        <Link to={`/contracts/${r.opp.contractId}`} className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-ink underline-offset-4 hover:underline">
                          <FileSignature size={13} aria-hidden /> Lucas redlines
                        </Link>
                      )}
                    </td>
                    <td className={`${td} tabular text-right text-ink`}>{money(r.arr)}</td>
                    <td className={td}>
                      <div className="tabular text-[15px] font-medium text-ink">{r.priority}</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2" title={FACTORS.map(([k, l]) => `${l}: ${r.factors[k]}`).join('\n')}>
                        {FACTORS.map(([k, l]) => (
                          <div key={k} className="min-w-0">
                            <div className="truncate text-[11px] leading-none text-muted">{l}</div>
                            <div className="mt-1 h-1 rounded-full bg-accent-soft">
                              <div className="h-1 rounded-full bg-ink" style={{ width: `${r.factors[k]}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className={`${td} max-w-0`}>
                      <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
                        {r.reasons.slice(0, 3).map((x, j) => (
                          <li key={`${j}-${x}`} className="line-clamp-2" title={x}>
                            {x}
                          </li>
                        ))}
                        {!r.reasons.length && <li className="text-muted">Strong segment fit</li>}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ranked.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No opportunities match these filters. Clear the search or set a filter back to All.</div>}
          </div>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {OPP_STAGES.map((stage) => {
            const col = board.filter((o) => o.stage === stage)
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag) moveOpp(drag, stage as OppStage)
                  setDrag(null)
                }}
                className="flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] bg-accent-soft"
              >
                <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-4">
                  <span className="text-[14px] font-medium text-ink">
                    {stage} <span className="meta ml-1 font-normal text-muted">{col.length}</span>
                  </span>
                  <span className="tabular text-[13px] text-ink-2">{money(col.reduce((s, o) => s + o.arr, 0))}</span>
                </div>
                <div className="flex max-h-[calc(100vh-300px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {!col.length && <div className="px-2 py-6 text-center text-[13px] text-muted">No deals in this stage</div>}
                  {col.map((o) => {
                    const a = book.byId[o.accountId]
                    return (
                      <div key={o.id} draggable onDragStart={() => setDrag(o.id)} className={`cursor-grab rounded-[14px] border border-line bg-surface p-4 ${drag === o.id ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/accounts/${a.id}`} className="min-w-0 text-[14px] font-medium leading-snug text-ink underline-offset-4 hover:underline">
                            {a.name}
                          </Link>
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-on-accent" title={o.owner}>
                            {initials(o.owner)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted">
                          {a.segment}, {a.state}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <Chip tone={o.type === 'Price Normalization' ? 'accent' : 'neutral'}>{o.type}</Chip>
                          <span className="tabular text-[14px] font-medium text-ink">{money(o.arr)}</span>
                        </div>
                        <div className="mt-2 truncate text-[12px] text-ink-2">{o.products.map((p) => PRODUCT[p].name).join(', ')}</div>
                        <div className="meta mt-1 text-muted">Closes {shortDate(o.closeDate)}</div>
                        {o.contractId && (
                          <Link to={`/contracts/${o.contractId}`} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink underline-offset-4 hover:underline">
                            <FileSignature size={12} aria-hidden /> Lucas redlines
                          </Link>
                        )}
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
