import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileSignature, Newspaper } from 'lucide-react'
import { useBook, signals } from '../lib/useData'
import { useCrm } from '../store'
import { OPP_STAGES, isOpenStage } from '../types'
import { BarList, Card, Chip, LucasMark, PageHeader, Stat, TextLink } from '../components/ui'
import { money, num, relDays, shortDate, sizeLabel } from '../lib/format'
import { SignalRow } from './Signals'

const nameLink = 'text-ink underline-offset-4 hover:underline'

/** Secondary figure inside the hero: serif numerals, quiet label. */
function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="figure mt-2 text-[36px] text-ink">{value}</dd>
      {sub && <dd className="mt-1.5 text-[13px] text-muted">{sub}</dd>}
    </div>
  )
}

export default function Dashboard() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const m = useMemo(() => {
    const arr = book.customers.reduce((s, a) => s + a.subscriptions.reduce((x, l) => x + l.units * l.unitPrice, 0) * 12, 0)
    const open = book.opportunities.filter((o) => isOpenStage(o.stage))
    const uplift = Object.values(book.pricing).reduce((s, p) => s + p.upliftArr, 0)
    const underpriced = Object.values(book.pricing).filter((p) => p.status === 'Under-priced').length
    const since90 = Date.now() - 90 * 86400000
    const wonRecent = book.opportunities.filter((o) => o.stage === 'Closed Won' && new Date(o.closeDate).getTime() > since90)
    const week = signals.filter((s) => Date.now() - new Date(s.date).getTime() < 7 * 86400000)
    const byStage = OPP_STAGES.map((st) => {
      const os = book.opportunities.filter((o) => o.stage === st)
      return { st, n: os.length, v: os.reduce((s, o) => s + o.arr, 0) }
    })
    const negotiating = book.contracts.filter((c) => c.status === 'In Negotiation')
    return { arr, open, uplift, underpriced, wonRecent, week, byStage, negotiating }
  }, [book])
  const drafts = outreach.filter((o) => o.status === 'Draft').length
  const pricingMoves = Object.entries(book.pricing)
    .filter(([, p]) => p.upliftArr > 0)
    .sort((a, b) => b[1].upliftArr - a[1].upliftArr)
    .slice(0, 5)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${num(book.customers.length)} customers and ${num(book.accounts.filter((a) => a.status === 'Prospect').length)} prospects across hog, cattle and field-crop operations.`}
        actions={
          <Link
            to="/signals?tab=newsletter"
            className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-4 text-[14px] font-medium text-ink transition-colors hover:bg-accent-soft-2"
          >
            <Newspaper size={14} /> Read this week's newsletter
          </Link>
        }
      />

      {/* Hero: the book's size on the left, the one number to act on in lime. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8">
          <div className="text-[13px] text-ink-2">Customer ARR</div>
          <div className="figure mt-3 text-[64px] text-ink sm:text-[96px]">{money(m.arr)}</div>
          <div className="mt-3 text-[14px] text-muted">Annualized from active subscriptions</div>
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line pt-6 sm:grid-cols-3">
            <Figure label="Open pipeline" value={money(m.open.reduce((s, o) => s + o.arr, 0))} sub={`${num(m.open.length)} ${m.open.length === 1 ? 'opportunity' : 'opportunities'}`} />
            <Figure label="Won in the last 90 days" value={money(m.wonRecent.reduce((s, o) => s + o.arr, 0))} sub={`${num(m.wonRecent.length)} ${m.wonRecent.length === 1 ? 'deal' : 'deals'}`} />
            <Figure label="Signals this week" value={m.week.length} sub="Org and market changes" />
          </dl>
        </section>
        <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
          <Stat
            highlight
            label="Price normalization upside"
            value={money(m.uplift)}
            sub={
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span>
                  {num(m.underpriced)} under-priced {m.underpriced === 1 ? 'account' : 'accounts'}
                </span>
                <Link to="/pricing" className="font-medium text-on-lime underline underline-offset-4">
                  Review pricing
                </Link>
              </span>
            }
          />
          <Stat
            label="Outreach awaiting approval"
            value={drafts}
            sub={
              <Link to="/outreach">
                <TextLink>Review queue</TextLink>
              </Link>
            }
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="Top-ranked opportunities"
          pad={false}
          action={
            <Link to="/pipeline?view=table&sort=prob">
              <TextLink>Pipeline Review</TextLink>
            </Link>
          }
        >
          <ol className="divide-y divide-line">
            {book.ranked.slice(0, 8).map((r, i) => (
              <li key={r.key} className="flex items-start gap-4 px-5 py-3.5">
                <span className="tabular w-5 shrink-0 pt-0.5 text-right text-[13px] text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Link to={`/accounts/${r.account.id}`} className={`text-[15px] ${nameLink}`}>
                      {r.account.name}
                    </Link>
                    <Chip tone={r.type === 'Price Normalization' ? 'accent' : 'neutral'}>{r.type}</Chip>
                    <span className="text-[12px] text-muted">{r.stage}</span>
                  </div>
                  <div className="mt-1 truncate text-[13px] text-ink-2">{r.reasons[0] ?? `${r.account.segment}, ${sizeLabel(r.account)}`}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular text-[15px] text-ink">{money(r.arr)}</div>
                  <div className="meta mt-0.5 text-muted">{r.opp ? `${r.priority}% win probability` : `Score ${r.priority}`}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card
          title="Pipeline by stage"
          action={
            <Link to="/pipeline?view=board">
              <TextLink>Open board</TextLink>
            </Link>
          }
        >
          <BarList
            data={m.byStage.map((s) => ({
              key: s.st,
              label: (
                <Link to={`/pipeline?view=table&stage=${encodeURIComponent(s.st)}`} className={nameLink} aria-label={`${s.st}: ${s.n} deals, open in Pipeline Review`}>
                  {s.st} <span className="tabular text-muted">{s.n}</span>
                </Link>
              ),
              value: s.v,
              display: money(s.v),
              // Open stages in ink; won, lost and on-ice deals recede.
              color: isOpenStage(s.st) ? undefined : 'var(--color-seq-3)',
            }))}
          />
          <p className="mt-4 text-[13px] text-muted">Prospect, Demo and Negotiation make up the open pipeline. Closed and on-ice deals are shown for context.</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card
          title="Biggest pricing moves"
          pad={false}
          action={
            <Link to="/pricing">
              <TextLink>All pricing</TextLink>
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {pricingMoves.map(([id, p]) => (
              <li key={id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/accounts/${id}`} className={`block truncate text-[15px] ${nameLink}`}>
                    {book.byId[id].name}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
                    <span>
                      +{p.recommendedPct.toFixed(1)}% at {p.ability?.window.toLowerCase()}
                    </span>
                    {p.ability && <span className="meta">{shortDate(p.ability.effectiveDate)}</span>}
                  </div>
                </div>
                <span className="tabular shrink-0 text-[15px] text-good-text">+{money(p.upliftArr)}</span>
              </li>
            ))}
            {!pricingMoves.length && <li className="px-5 py-8 text-center text-[14px] text-muted">No price increases recommended right now.</li>}
          </ul>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2.5">
              <LucasMark size={28} />
              Contracts in negotiation
            </span>
          }
          pad={false}
          action={
            <Link to="/contracts">
              <TextLink>Open Lucas the Hog</TextLink>
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {m.negotiating.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] text-ink">{book.byId[c.accountId].name}</div>
                  <div className="text-[13px] text-muted">
                    {c.redlines.length} {c.redlines.length === 1 ? 'redline' : 'redlines'}
                  </div>
                </div>
                <Link
                  to={`/contracts/${c.id}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[12px] font-medium text-ink transition-colors hover:bg-accent-soft-2"
                  title="Review this contract with Lucas the Hog"
                >
                  <FileSignature size={13} /> Review
                </Link>
              </li>
            ))}
            {!m.negotiating.length && <li className="px-5 py-8 text-center text-[14px] text-muted">No contracts in negotiation.</li>}
          </ul>
        </Card>
      </div>

      <Card
        className="mt-5"
        title="Latest changes across hog, cattle and field-crop operations"
        pad={false}
        action={
          <Link to="/signals">
            <TextLink>All signals</TextLink>
          </Link>
        }
      >
        <ul className="divide-y divide-line">
          {signals.slice(0, 6).map((s) => (
            <SignalRow key={s.id} s={s} compact />
          ))}
        </ul>
        <div className="meta px-5 pb-2 pt-3 text-muted">Updated {relDays(signals[0]?.date ?? new Date().toISOString())}</div>
      </Card>
    </div>
  )
}
