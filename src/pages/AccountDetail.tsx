import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, FileSignature, Mail, UserPlus } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { CURRENT_USER, useCrm } from '../store'
import { PRODUCT, unitLabel } from '../data/products'
import { Button, Card, Chip, Empty, Notice, PageHeader, StatusBadge, TextLink, inputClass } from '../components/ui'
import { initials, money, num, relDays, shortDate } from '../lib/format'
import { mrr } from '../lib/pricing'
import { draftForSignal, whitespace } from '../lib/outreach'
import { OPERATION_LABEL, OPP_STAGES, isOpenStage, type AccountStatus, type OppStage } from '../types'
import { currentDeal } from '../lib/pipeline'
import { SignedContractButton } from '../components/SignedContractButton'
import { Pager } from '../components/Pager'
import type { PriceChangeDraft } from '../lib/priceChangeDrafts'
import { NoticeAction, NoticeModal, PriceAnalysisPanel, lastNotices } from './Pricing'

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
  const invoices = useCrm((s) => s.invoices)
  const setAccountStage = useCrm((s) => s.setAccountStage)
  const setAccountStatus = useCrm((s) => s.setAccountStatus)
  const moveOpp = useCrm((s) => s.moveOpp)
  const [actPage, setActPage] = useState(0)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const [notice, setNotice] = useState<PriceChangeDraft | null>(null)
  // The route reuses this component when only the id changes (header search), so start the next account fresh.
  useEffect(() => {
    setActPage(0)
    setNote('')
  }, [id])
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
  const negotiation = book.contracts.find((c) => c.accountId === a.id && c.status === 'In Negotiation') ?? book.contracts.find((c) => c.accountId === a.id && c.status === 'Draft')
  const opps = book.opportunities.filter((o) => o.accountId === a.id)
  const acts = activities.filter((x) => x.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date))
  const actPages = Math.max(1, Math.ceil(acts.length / 8))
  const actCur = Math.min(actPage, actPages - 1)
  const mails = outreach.filter((o) => o.accountId === a.id)
  const pa = book.pricing[a.id]
  const ws = whitespace(a)
  const recentCutoff = Date.now() - 60 * 86400000
  const toast = (m: string) => {
    setFlash(m)
    setTimeout(() => setFlash(null), 2500)
  }

  const grain = a.species === 'Grain'
  const facts: [string, ReactNode][] = [
    grain ? ['Acres', num(a.acres)] : ['Head', num(a.headCount)],
    ['Sites', a.sites],
    [grain ? 'Grain bins' : 'Barns', a.barns],
    grain ? ['Main crop', a.crops?.[0] ?? 'None'] : ['Acres', num(a.acres)],
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
              {OPERATION_LABEL[a.species]}, {a.segment}
            </span>
            {grain && a.crops?.length ? <span>{a.crops.join(', ')}</span> : null}
            <span>
              {a.county} Co., {a.state}
            </span>
            <span className="text-muted">Rep {a.rep}</span>
          </span>
        }
        actions={
          <>
            <SignedContractButton account={a} />
            {negotiation && (
              // A link styled as the primary pill: a <button> inside an <a> is invalid and adds a second tab stop.
              <Link
                to={`/contracts/${negotiation.id}`}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-[14px] font-medium text-on-accent transition hover:opacity-85"
              >
                <FileSignature size={14} aria-hidden /> Open in Lucas the Hog
              </Link>
            )}
          </>
        }
      />
      {/* Status controls on the account itself (the same actions as the Accounts table). */}
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-3">
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
          <span>Deal stage{currentDeal(opps) ? ` (${currentDeal(opps)!.type})` : ''}</span>
          <select
            id={`account-stage-${a.id}`}
            value={currentDeal(opps)?.stage ?? ''}
            onChange={(e) => setAccountStage(a.id, e.target.value as OppStage)}
            className={`${inputClass} pr-8`}
          >
            {!currentDeal(opps) && <option value="">No deal yet</option>}
            {OPP_STAGES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
          <span>Customer status</span>
          <select id={`account-status-${a.id}`} value={a.status} onChange={(e) => setAccountStatus(a.id, e.target.value as AccountStatus)} className={`${inputClass} pr-8`}>
            {(['Prospect', 'Customer', 'Churned'] as AccountStatus[]).map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </label>
        <p className="min-w-0 max-w-[60ch] pb-1.5 text-[12px] text-muted">Moving the deal to Negotiation has Lucas the Hog draft the contract and intro email once; Closed Won signs it. Changes are logged in Activity.</p>
      </div>
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
              {a.integrator && <Fact label={a.species === 'Hog' ? 'Integrator' : grain ? 'Grain marketing' : 'Packer or co-op'}>{a.integrator}</Fact>}
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
              {/* The same notice flow as the band check (email plus revised invoice), so both show the same state. */}
              {pa.status === 'Under-priced' && pa.ability?.canActNow && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <NoticeAction a={a} pa={pa} contract={contract} last={lastNotices(invoices).get(a.id)} onPreview={setNotice} primary />
                </div>
              )}
              {notice && <NoticeModal draft={notice} onClose={() => setNotice(null)} />}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
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
                        <TextLink>Review {c!.redlines.length} redlines with Lucas the Hog</TextLink>
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
                        <select aria-label={`Stage for the ${o.type} deal`} value={o.stage} onChange={(e) => moveOpp(o.id, e.target.value as OppStage)} className="h-7 rounded-full border border-transparent bg-accent-soft pl-2.5 pr-6 text-[12px] text-ink outline-none hover:bg-accent-soft-2 focus:border-line-strong">
                          {OPP_STAGES.map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-muted">{o.products.map((p) => PRODUCT[p].name).join(', ')}</div>
                      {o.reason && !isOpenStage(o.stage) && <div className="mt-0.5 text-[12px] text-ink-2">{o.reason}</div>}
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
              {acts.slice(actCur * 8, actCur * 8 + 8).map((x) => (
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
            <Pager page={actCur} pages={actPages} onPage={setActPage} total={acts.length} size={8} noun="activities" className="-mx-5 mt-3 -mb-5" />
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
