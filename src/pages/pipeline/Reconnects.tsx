import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, RotateCcw } from 'lucide-react'
import type { Species } from '../../types'
import { OPERATION_LABEL, OPERATION_OPTIONS } from '../../types'
import { TEAM } from '../../data/generate'
import { useBook, signals } from '../../lib/useData'
import { useCrm } from '../../store'
import { Button, Chip, Pill, Select, StatusBadge } from '../../components/ui'
import { Pager, pageOf } from '../../components/Pager'
import { money, num, shortDate } from '../../lib/format'
import { draftReconnect, findReconnects, type ReconnectTiming } from '../../lib/reconnects'

const PAGE = 8

/** Lost and on-ice deals worth reopening, ranked from the notes on each account. */
export function Reconnects() {
  const book = useBook()
  const activities = useCrm((s) => s.activities)
  const outreach = useCrm((s) => s.outreach)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const moveOpp = useCrm((s) => s.moveOpp)
  const [timing, setTiming] = useState<'All' | ReconnectTiming>('Now')
  const [rep, setRep] = useState('All')
  const [op, setOp] = useState<'All' | Species>('All')
  const [page, setPage] = useState(0)
  const all = useMemo(() => findReconnects(book.opportunities, book.byId, activities, signals), [book, activities])
  // The pill counts follow the rep and operation filters; the timing pill then picks from these.
  const scoped = all.filter((r) => (rep === 'All' || r.account.rep === rep) && (op === 'All' || r.account.species === op))
  const shown = scoped.filter((r) => timing === 'All' || r.timing === timing)
  const drafted = new Map(outreach.filter((o) => o.playbook === 'reconnect').map((o) => [o.accountId, o]))
  const count = (t: ReconnectTiming) => scoped.filter((r) => r.timing === t).length
  const pages = Math.ceil(shown.length / PAGE)
  // Reopening a row drops it from the list, which can leave the page past the end.
  const cur = Math.min(page, Math.max(0, pages - 1))
  const rows = pageOf(shown, cur, PAGE)

  return (
    <section className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface" aria-label="Reconnects">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium text-ink">Reconnects</h2>
          <p className="mt-0.5 max-w-[80ch] text-[13px] text-ink-2">
            Lost and on-ice deals worth another try, ranked from the notes on each account (when the customer said to come back, or what would change their mind) and what has happened since.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Sales rep" value={rep} onChange={(v) => { setRep(v); setPage(0) }} options={['All', ...TEAM]} />
          <Select label="Operation" value={op} onChange={(v) => { setOp(v); setPage(0) }} options={OPERATION_OPTIONS} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-5 pb-3" role="group" aria-label="When to reach out">
        {(['Now', 'Soon', 'Later', 'All'] as const).map((t) => (
          <Pill key={t} active={timing === t} onClick={() => { setTiming(t); setPage(0) }}>
            {t === 'All' ? `All ${num(scoped.length)}` : t === 'Now' ? `Reach out now ${num(count(t))}` : t === 'Soon' ? `Within 45 days ${num(count(t))}` : `Later ${num(count(t))}`}
          </Pill>
        ))}
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {rows.map((r) => {
          const mail = drafted.get(r.account.id)
          return (
            <li key={r.opp.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="tabular inline-flex h-6 min-w-9 items-center justify-center rounded-full bg-accent px-2 text-[12px] font-medium text-on-accent" title="Reconnect score (0 to 100)">
                    {r.score}
                  </span>
                  <Link to={`/accounts/${r.account.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{r.account.name}</Link>
                </div>
                <div className="mt-1 text-[12px] text-muted">
                  {OPERATION_LABEL[r.account.species]}, {r.account.segment}, {r.account.state} · {r.account.rep}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <Chip tone={r.opp.stage === 'On Ice' ? 'neutral' : 'dim'}>{r.opp.stage === 'On Ice' ? 'On ice' : 'Lost'}</Chip>
                  <span className="text-ink-2">
                    {r.opp.type} · {money(r.opp.arr)}
                  </span>
                </div>
                {r.opp.reason && <div className="mt-1 text-[13px] text-ink-2">{r.opp.reason}</div>}
              </div>
              <div className="min-w-0 text-[13px]">
                {r.note && (
                  <blockquote className="border-l-2 border-line-strong pl-3 text-ink-2">
                    “{r.note.text}”
                    <footer className="mt-0.5 text-[12px] text-muted">
                      {r.note.author}, {shortDate(r.note.date)}
                    </footer>
                  </blockquote>
                )}
                <ul className="mt-2 flex flex-col gap-1">
                  {r.reasons.slice(0, 3).map((x) => (
                    <li key={x} className="flex gap-2 text-ink">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink" aria-hidden />
                      <span className="min-w-0">{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex min-w-[180px] flex-col items-start gap-2 text-[13px] lg:items-end">
                <StatusBadge tone={r.timing === 'Now' ? 'good' : r.timing === 'Soon' ? 'warning' : 'neutral'}>{r.timing === 'Now' ? 'Reach out now' : `From ${shortDate(r.due.toISOString())}`}</StatusBadge>
                <span className="text-muted">
                  To {r.contact.name}, {r.contact.title}
                </span>
                {mail ? (
                  <Link to={`/outreach?account=${r.account.id}`} className="text-ink underline underline-offset-4">
                    Email {mail.status === 'Draft' ? 'drafted' : mail.status.toLowerCase()}
                  </Link>
                ) : (
                  <Button size="sm" onClick={() => queueOutreach({ ...draftReconnect(r), status: 'Draft' })}>
                    <Mail size={12} /> Draft reconnect email
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => moveOpp(r.opp.id, 'Prospect')} title="Move this deal back to Prospect">
                  <RotateCcw size={12} /> Reopen as prospect
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {!shown.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">No reconnects match these filters.</div>}
      <Pager page={cur} pages={pages} onPage={setPage} total={shown.length} size={PAGE} noun="reconnects" />
    </section>
  )
}
