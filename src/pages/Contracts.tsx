import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSignature } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { Card, Chip, PageHeader, StatusBadge, Tabs } from '../components/ui'
import { money, shortDate } from '../lib/format'
import { mrr } from '../lib/pricing'

export default function Contracts() {
  const book = useBook()
  const reviews = useCrm((s) => s.reviews)
  const [tab, setTab] = useState<'neg' | 'renewing' | 'all'>('neg')
  const rows = useMemo(() => {
    const soon = Date.now() + 120 * 86400000
    return book.contracts
      .filter((c) => (tab === 'neg' ? c.status === 'In Negotiation' : tab === 'renewing' ? c.status === 'Active' && new Date(c.end).getTime() < soon && new Date(c.end).getTime() > Date.now() : true))
      .sort((a, b) => (tab === 'renewing' ? a.end.localeCompare(b.end) : b.redlines.length - a.redlines.length))
  }, [book, tab])
  const neg = book.contracts.filter((c) => c.status === 'In Negotiation').length

  return (
    <div>
      <PageHeader
        title="Contracts · Lucas the Hog"
        subtitle="T&Cs, redlines and renewals. Lucas the Hog reviews each customer redline against our negotiation playbook, recommends accept, counter or reject with ready-to-paste language, and drafts the reply that moves the deal to signature."
      />
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-xl" aria-hidden>🐷</span>
        <div className="text-sm">
          <div className="font-semibold text-ink">Lucas the Hog</div>
          <div className="text-ink-2">{neg} contracts are waiting on redline review. Open one and click <b>Ask Lucas to review</b>.</div>
        </div>
      </div>
      <Card pad={false}>
        <div className="px-4 pt-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'neg', label: `In negotiation (${neg})` }, { value: 'renewing', label: 'Renewing in 120 days' }, { value: 'all', label: 'All contracts' }]} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-y border-line text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Contract</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Term</th>
                <th className="px-3 py-2 text-left font-medium">Price clause</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-left font-medium">Redlines</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 200).map((c) => {
                const a = book.byId[c.accountId]
                const opp = book.opportunities.find((o) => o.contractId === c.id)
                const r = reviews[c.id]
                return (
                  <tr key={c.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2"><Link to={`/accounts/${a.id}`} className="font-medium text-ink hover:text-accent">{a.name}</Link><div className="text-xs text-muted">{a.segment} · {a.state}</div></td>
                    <td className="px-3 py-2 text-xs"><div className="text-ink">{c.id}</div><div className="text-muted">{c.template}</div></td>
                    <td className="px-3 py-2"><Chip tone={c.status === 'In Negotiation' ? 'accent' : 'neutral'}>{c.status}</Chip></td>
                    <td className="px-3 py-2 text-xs text-ink-2">{c.termMonths} mo · ends {shortDate(c.end)}</td>
                    <td className="px-3 py-2 text-xs text-ink-2">{c.price.mechanism}{c.price.capPct ? ` (${c.price.capPct}%)` : ''}{c.mfn ? ' · MFN' : ''}</td>
                    <td className="tabular px-3 py-2 text-right">{money(opp?.arr ?? mrr(a) * 12)}</td>
                    <td className="px-3 py-2">{c.redlines.length ? (r ? <StatusBadge tone={r.overallRisk === 'High' ? 'critical' : r.overallRisk === 'Medium' ? 'warning' : 'good'}>{c.redlines.length} · {r.overallRisk} risk</StatusBadge> : <span className="text-xs text-ink-2">{c.redlines.length} to review</span>) : <span className="text-xs text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-right"><Link to={`/contracts/${c.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent"><FileSignature size={13} /> Open</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <div className="p-8 text-center text-sm text-muted">No contracts here.</div>}
        </div>
      </Card>
    </div>
  )
}
