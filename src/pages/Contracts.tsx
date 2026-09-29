import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSignature } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { Card, Chip, LucasMark, PageHeader, StatusBadge, Tabs } from '../components/ui'
import { money, shortDate } from '../lib/format'
import { mrr } from '../lib/pricing'

const th = 'whitespace-nowrap px-4 py-3 text-[13px] font-normal text-muted'
const statusTone = (s: string): 'dim' | 'neutral' => (s === 'Expired' ? 'dim' : 'neutral')

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
      <PageHeader title="Contracts" subtitle="Terms, redlines and renewals for every account." />

      <div className="mb-5 flex items-start gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
        <LucasMark size={44} />
        <div className="min-w-0 max-w-[68ch]">
          <div className="text-[15px] font-medium text-ink">Lucas the Hog</div>
          <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">
            Checks each customer redline against our negotiation playbook, recommends accept, counter or reject with language you can paste, and drafts the reply that moves the deal to signature.
          </p>
          <p className="mt-2 text-[14px] text-ink">
            {neg === 1 ? '1 contract is' : `${neg} contracts are`} waiting on redline review. Open one and choose Ask Lucas to review.
          </p>
        </div>
      </div>

      <Card pad={false}>
        <div className="px-5 pt-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: 'neg',
                label: (
                  <>
                    In negotiation<span className="tabular ml-1.5 opacity-60">{neg}</span>
                  </>
                ),
              },
              { value: 'renewing', label: 'Renewing in 120 days' },
              { value: 'all', label: 'All contracts' },
            ]}
          />
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead>
              <tr>
                <th className={`${th} pl-5 text-left`}>Account</th>
                <th className={`${th} text-left`}>Contract</th>
                <th className={`${th} text-left`}>Status</th>
                <th className={`${th} text-left`}>Term</th>
                <th className={`${th} text-left`}>Price clause</th>
                <th className={`${th} text-right`}>Value</th>
                <th className={`${th} text-left`}>Redlines</th>
                <th className={`${th} pr-5`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((c) => {
                const a = book.byId[c.accountId]
                const opp = book.opportunities.find((o) => o.contractId === c.id)
                const r = reviews[c.id]
                const n = c.redlines.length
                return (
                  <tr key={c.id} className="border-t border-line hover:bg-accent-soft/60">
                    <td className="py-3 pl-5 pr-4 align-top">
                      <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">
                        {a.name}
                      </Link>
                      <div className="text-[12px] text-muted">
                        {a.segment}, {a.state}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="meta text-ink">{c.id}</div>
                      <div className="whitespace-nowrap text-[12px] text-muted">{c.template}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Chip tone={statusTone(c.status)}>{c.status}</Chip>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-ink-2">
                      <div className="tabular whitespace-nowrap">{c.termMonths} months</div>
                      <div className="whitespace-nowrap text-[12px] text-muted">Ends {shortDate(c.end)}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] text-ink-2">
                      {c.price.mechanism}
                      {c.price.capPct ? `, cap ${c.price.capPct}%` : ''}
                      {c.mfn ? <div className="text-[12px] text-muted">MFN</div> : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right align-top text-ink">{money(opp?.arr ?? mrr(a) * 12)}</td>
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      {n ? (
                        r ? (
                          <StatusBadge tone={r.overallRisk === 'High' ? 'critical' : r.overallRisk === 'Medium' ? 'warning' : 'good'}>
                            {r.overallRisk} risk
                            <span className="tabular text-muted">
                              {n} {n === 1 ? 'redline' : 'redlines'}
                            </span>
                          </StatusBadge>
                        ) : (
                          <span className="text-[13px] text-ink-2">
                            <span className="tabular">{n}</span> to review
                          </span>
                        )
                      ) : (
                        <span className="text-[13px] text-muted">None</span>
                      )}
                    </td>
                    <td className="py-3 pl-4 pr-5 text-right align-top">
                      <Link
                        to={`/contracts/${c.id}`}
                        aria-label={`Open contract ${c.id}`}
                        className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-3 text-[12px] font-medium text-ink transition-colors hover:bg-accent-soft-2"
                      >
                        <FileSignature size={13} aria-hidden /> Open
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No contracts in this view.</div>}
        </div>
      </Card>
    </div>
  )
}
