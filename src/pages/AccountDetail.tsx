import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, FileSignature, Mail, Send, UserPlus } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { CURRENT_USER, useCrm } from '../store'
import { PRODUCT, unitLabel } from '../data/products'
import { Button, Card, Chip, Empty, HealthBadge, Notice, PageHeader, StatusBadge, TextLink, WeatherBadge, inputClass } from '../components/ui'
import { initials, money, num, relDays, shortDate } from '../lib/format'
import { mrr } from '../lib/pricing'
import { draftForSignal, draftForWeather, whitespace } from '../lib/outreach'
import { toF, thi } from '../lib/weather'
import { PriceAnalysisPanel, priceNoticeDraft } from './Pricing'

/** Label above value, like a spec sheet. */
function Fact({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 text-ink">{children}</div>
    </div>
  )
}

const th = 'px-4 py-3 text-[13px] font-normal text-muted'

export default function AccountDetail() {
  const { id } = useParams()
  const book = useBook()
  const activities = useCrm((s) => s.activities)
  const outreach = useCrm((s) => s.outreach)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const log = useCrm((s) => s.log)
  const proposePrice = useCrm((s) => s.proposePrice)
  const proposals = useCrm((s) => s.priceProposals)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const a = id ? book.byId[id] : undefined
  if (!a)
    return (
      <Empty>
        Account not found.{' '}
        <Link to="/accounts" className="text-ink underline underline-offset-4">
          Back to accounts
        </Link>
      </Empty>
    )

  const sigs = signalsByAccount[a.id] ?? []
  const contract = a.contractId ? book.contractById[a.contractId] : undefined
  const negotiation = book.contracts.find((c) => c.accountId === a.id && c.status === 'In Negotiation')
  const opps = book.opportunities.filter((o) => o.accountId === a.id)
  const acts = activities.filter((x) => x.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))
  const mails = outreach.filter((o) => o.accountId === a.id)
  const pa = book.pricing[a.id]
  const wr = book.weatherRisk[a.id]
  const forecast = book.weather.byState[a.state]
  const ws = whitespace(a)
  const recentCutoff = Date.now() - 60 * 86400000
  const toast = (m: string) => {
    setFlash(m)
    setTimeout(() => setFlash(null), 2500)
  }

  const facts: [string, ReactNode][] = [
    ['Head', num(a.headCount)],
    ['Sites', a.sites],
    ['Barns', a.barns],
    ['Acres', num(a.acres)],
    ['Employees', a.employees],
    ['Founded', a.yearFounded],
    ['ARR', a.status === 'Customer' ? money(mrr(a) * 12) : '—'],
  ]

  return (
    <div>
      <Link to="/accounts" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> All accounts
      </Link>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Chip tone={a.status === 'Customer' ? 'accent' : a.status === 'Churned' ? 'dim' : 'neutral'}>{a.status}</Chip>
            <span>
              {a.species}, {a.segment}
            </span>
            <span>
              {a.county} Co., {a.state}
            </span>
            <span className="text-muted">Rep {a.rep}</span>
          </span>
        }
        actions={
          negotiation && (
            // A link styled as the primary pill: a <button> inside an <a> is invalid and adds a second tab stop.
            <Link
              to={`/contracts/${negotiation.id}`}
              className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-[14px] font-medium text-on-accent transition hover:opacity-85"
            >
              <FileSignature size={14} aria-hidden /> Open in Lucas
            </Link>
          )
        }
      />
      {flash && <Notice>{flash}</Notice>}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:grid-cols-4 xl:grid-cols-7">
        {facts.map(([l, v]) => (
          <div key={l} className="min-w-0">
            <dt className="text-[12px] text-muted">{l}</dt>
            <dd className="figure mt-2 break-words text-[30px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Organization" action={<span className="tabular text-[13px] text-muted">{a.contacts.length} contacts</span>}>
            <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3 text-[14px]">
              <Fact label="Ownership">{a.ownership}</Fact>
              <Fact label="Parent company">{a.parentCompany ?? 'Independent'}</Fact>
              {a.integrator && <Fact label={a.species === 'Hog' ? 'Integrator' : 'Packer or co-op'}>{a.integrator}</Fact>}
              {a.competitor && (
                <Fact label="Incumbent">
                  {a.competitor}
                  {a.competitorRenewal && <span className="text-muted">, renews {shortDate(a.competitorRenewal)}</span>}
                </Fact>
              )}
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[...a.contacts]
                .sort((x, y) => y.since.localeCompare(x.since))
                .map((c) => {
                  const isNew = new Date(c.since).getTime() > recentCutoff
                  return (
                    <li key={c.id} className="flex min-w-0 items-start gap-3 rounded-[14px] bg-accent-soft px-3.5 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-medium text-on-accent" aria-hidden>
                        {initials(c.name)}
                      </span>
                      <div className="min-w-0 text-[14px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                          <span className="font-medium">{c.name}</span>
                          {isNew && (
                            <Chip tone="lime">
                              <UserPlus size={11} aria-hidden /> New
                            </Chip>
                          )}
                        </div>
                        <div className="text-[13px] text-ink-2">{c.title}</div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 text-[12px] text-muted">
                          <span className="max-w-full truncate">{c.email}</span>
                          <span className="whitespace-nowrap">Since {shortDate(c.since)}</span>
                        </div>
                      </div>
                    </li>
                  )
                })}
            </ul>
          </Card>

          <Card title="Change history and signals" pad={false}>
            {sigs.length ? (
              <ul className="mt-2 divide-y divide-line">
                {sigs.map((s) => (
                  <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <Chip>{s.type}</Chip>
                        {s.severity === 'High' && <StatusBadge tone="serious">High</StatusBadge>}
                        <span className="meta text-muted">{shortDate(s.date)}</span>
                        <span className="text-[13px] text-muted">{s.source}</span>
                      </div>
                      <div className="mt-2 text-[15px] font-medium leading-snug text-ink">{s.headline}</div>
                      <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{s.detail}</p>
                    </div>
                    <div className="shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          const d = draftForSignal(a, s, a.rep)
                          queueOutreach({ accountId: a.id, signalId: s.id, trigger: s.type, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' })
                          toast('Draft added to the outreach queue')
                        }}
                      >
                        <Mail size={12} /> Draft outreach
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-3 pt-2 text-[14px] text-muted">No changes recorded yet.</div>
            )}
          </Card>

          {a.status !== 'Prospect' && (
            <Card title="Subscriptions" pad={false}>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[560px] text-[14px]">
                  <thead>
                    <tr>
                      <th className={`${th} pl-5 text-left`}>Product</th>
                      <th className={`${th} text-right`}>Units</th>
                      <th className={`${th} text-right`}>Unit price</th>
                      <th className={`${th} text-right`}>List</th>
                      <th className={`${th} text-right`}>Discount</th>
                      <th className={`${th} pr-5 text-right`}>Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.subscriptions.map((s) => {
                      const p = PRODUCT[s.productId]
                      return (
                        <tr key={s.productId} className="border-t border-line transition-colors hover:bg-accent-soft/60">
                          <td className="py-3 pl-5 pr-4 text-ink">
                            {p.name}
                            <div className="text-[12px] text-muted">Per {unitLabel(p.unit)}</div>
                          </td>
                          <td className="tabular px-4 py-3 text-right text-ink">{s.units}</td>
                          <td className="tabular px-4 py-3 text-right text-ink">${s.unitPrice.toFixed(2)}</td>
                          <td className="tabular px-4 py-3 text-right text-muted">${p.listPrice}</td>
                          <td className="tabular px-4 py-3 text-right text-ink">{((1 - s.unitPrice / p.listPrice) * 100).toFixed(0)}%</td>
                          <td className="tabular py-3 pl-4 pr-5 text-right text-ink">{money(s.units * s.unitPrice)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {ws.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 pb-2 pt-4">
                  <span className="mr-1 text-[12px] text-muted">White space</span>
                  {ws.map((p) => (
                    <Chip key={p}>{PRODUCT[p].name}</Chip>
                  ))}
                </div>
              )}
            </Card>
          )}

          {pa && (
            <Card title="Pricing normalization">
              <PriceAnalysisPanel a={a} pa={pa} contract={contract} />
              {pa.status === 'Under-priced' && pa.ability && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {proposals[a.id] ? (
                    <StatusBadge tone="good">
                      Proposed +{proposals[a.id].pct.toFixed(1)}% on {shortDate(proposals[a.id].createdAt)}
                    </StatusBadge>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => {
                        proposePrice(a.id, pa.recommendedPct, pa.ability!.effectiveDate)
                        const d = priceNoticeDraft(a, pa)
                        queueOutreach({ ...d, auto: false, status: 'Draft' })
                        toast('Price notice drafted and added to the outreach queue for approval')
                      }}
                    >
                      Propose +{pa.recommendedPct.toFixed(1)}% and draft notice
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {a.status === 'Customer' && (
            <Card title="Weather and account health">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <HealthBadge h={book.health[a.id]} />
                <WeatherBadge w={wr} />
              </div>
              {wr?.kind && <p className="mt-2 text-[13px] text-ink-2">Forecast: {wr.detail}.</p>}
              {forecast && (
                <>
                  <ol className="mt-4 grid grid-cols-7 gap-1.5 text-center" aria-label="7-day forecast">
                    {forecast.map((d) => {
                      const flagged = !!wr?.kind && wr.day === d.date
                      const weekday = new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })
                      return (
                        <li
                          key={d.date}
                          className={`min-w-0 rounded-[14px] bg-accent-soft px-0.5 py-2.5 ${flagged ? 'ring-1 ring-inset ring-ink' : ''}`}
                          title={`${weekday}: high ${toF(d.tmax)}°F, low ${toF(d.tmin)}°F, THI ${Math.round(thi(d.tmax, d.rh))}`}
                        >
                          <div className="text-[12px] text-muted">{weekday}</div>
                          <div className="tabular mt-1 text-[15px] text-ink">{toF(d.tmax)}°</div>
                          <div className="tabular text-[12px] text-muted">{toF(d.tmin)}°</div>
                          <div className="tabular mx-1.5 mt-1.5 border-t border-line pt-1.5 text-[12px] text-ink-2">{Math.round(thi(d.tmax, d.rh))}</div>
                        </li>
                      )
                    })}
                  </ol>
                  <p className="mt-2 text-[12px] text-muted">Daily high, low and THI.{wr?.kind ? ' The riskiest day is outlined.' : ''}</p>
                </>
              )}
              {book.health[a.id] && (
                <dl className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
                  {book.health[a.id].parts.map((p) => (
                    <div key={p.label} className="flex min-w-0 justify-between gap-2">
                      <dt className="truncate text-ink-2">{p.label}</dt>
                      <dd className="tabular text-ink">{p.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {wr?.kind && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      const d = draftForWeather(a, wr.kind!, wr.day ? new Date(wr.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }) : 'this week', wr.detail, a.rep)
                      queueOutreach({ accountId: a.id, trigger: `Weather: ${wr.kind}`, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' })
                      toast('Support message drafted and added to the outreach queue')
                    }}
                  >
                    <Send size={12} /> Draft support message
                  </Button>
                </div>
              )}
            </Card>
          )}

          <Card title="Contract">
            {contract || negotiation ? (
              <div className="flex flex-col gap-3 text-[14px]">
                {[contract, negotiation].filter(Boolean).map((c) => (
                  <div key={c!.id} className="rounded-[14px] bg-accent-soft p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="meta text-muted">{c!.id}</span>
                        <span className="text-ink">{c!.template}</span>
                      </span>
                      <Chip tone={c!.status === 'Expired' ? 'dim' : 'neutral'}>{c!.status}</Chip>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
                      <Fact label="Term">
                        {c!.termMonths} months, ends {shortDate(c!.end)}
                      </Fact>
                      <Fact label="Auto-renew">{c!.autoRenew ? `Yes, ${c!.renewalNoticeDays}-day notice` : 'No'}</Fact>
                      <Fact label="Pricing">
                        {c!.price.mechanism}
                        {c!.price.capPct ? `, cap ${c!.price.capPct}%` : ''}
                      </Fact>
                      <Fact label="Payment">
                        {c!.paymentTerms}
                        {c!.mfn ? ', MFN' : ''}
                      </Fact>
                      <Fact label="Change of control" className="col-span-2">
                        {c!.assignmentOnChangeOfControl}
                      </Fact>
                    </div>
                    {c!.status === 'In Negotiation' && (
                      <Link to={`/contracts/${c!.id}`} className="mt-4 inline-block">
                        <TextLink>Review {c!.redlines.length} redlines with Lucas</TextLink>
                      </Link>
                    )}
                  </div>
                ))}
                {a.parentCompany && contract?.assignmentOnChangeOfControl === 'Consent required' && sigs.some((s) => s.type === 'Ownership Change') && (
                  <div className="flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink" role="status">
                    <AlertTriangle size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-warning" aria-hidden />
                    <span className="min-w-0">Ownership changed and assignment needs our consent. Review with the new owner.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[14px] text-muted">No contract on file.</div>
            )}
          </Card>

          <Card title="Opportunities" pad={false}>
            {opps.length ? (
              <ul className="mt-2 divide-y divide-line">
                {opps.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Chip tone={o.type === 'Price Normalization' ? 'accent' : 'neutral'}>{o.type}</Chip>
                        <span className="text-[12px] text-muted">{o.stage}</span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-muted">{o.products.map((p) => PRODUCT[p].name).join(', ')}</div>
                    </div>
                    <span className="tabular shrink-0 text-[15px] text-ink">{money(o.arr)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-3 pt-2 text-[14px] text-muted">No opportunities yet.</div>
            )}
          </Card>

          <Card title="Activity">
            <form
              className="mb-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (note.trim()) {
                  log(a.id, 'Note', note.trim())
                  setNote('')
                }
              }}
            >
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Add a note as ${CURRENT_USER}`} aria-label="Note" className={`${inputClass} min-w-0 flex-1`} />
              <Button type="submit" size="md">
                Add note
              </Button>
            </form>
            <ul className="flex flex-col gap-3">
              {acts.slice(0, 12).map((x) => (
                <li key={x.id} className="text-[14px]">
                  <div className="text-ink">{x.text}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                    <span>{x.kind}</span>
                    <span>{x.author}</span>
                    <span className="meta">{relDays(x.date)}</span>
                  </div>
                </li>
              ))}
              {!acts.length && <li className="text-[14px] text-muted">No activity yet. Add a note to start the record.</li>}
            </ul>
            {mails.length > 0 && (
              <Link to={`/outreach?account=${a.id}`} className="mt-4 inline-block">
                <TextLink>See {mails.length} outreach messages</TextLink>
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
