import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, FileSignature, Mail, Send, UserPlus } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { CURRENT_USER, useCrm } from '../store'
import { PRODUCT, unitLabel } from '../data/products'
import { Button, Card, Chip, Empty, HealthBadge, PageHeader, StatusBadge, WeatherBadge } from '../components/ui'
import { money, num, relDays, shortDate } from '../lib/format'
import { mrr } from '../lib/pricing'
import { draftForSignal, draftForWeather, whitespace } from '../lib/outreach'
import { toF, thi } from '../lib/weather'
import { PriceAnalysisPanel, priceNoticeDraft } from './Pricing'

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
  if (!a) return <Empty>Account not found. <Link to="/accounts" className="text-accent">Back to accounts</Link></Empty>

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

  return (
    <div>
      <Link to="/accounts" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} /> Accounts</Link>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={a.status === 'Customer' ? 'accent' : 'neutral'}>{a.status}</Chip>
            <span>{a.species} · {a.segment} · {a.county} Co., {a.state}</span>
            <span className="text-muted">· Rep {a.rep}</span>
          </span>
        }
        actions={negotiation && <Link to={`/contracts/${negotiation.id}`}><Button variant="primary"><FileSignature size={14} /> Open in Lucas</Button></Link>}
      />
      {flash && <div className="mb-3 rounded-lg border border-line bg-accent-soft px-3 py-2 text-sm text-accent">{flash}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {[
          ['Head', num(a.headCount)],
          ['Sites', a.sites],
          ['Barns', a.barns],
          ['Acres', num(a.acres)],
          ['Employees', a.employees],
          ['Founded', a.yearFounded],
          ['ARR', a.status === 'Customer' ? money(mrr(a) * 12) : '—'],
          ['Ownership', a.ownership],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="text-[11px] text-muted">{l}</div>
            <div className="truncate text-sm font-semibold text-ink">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card title="Organization" action={<span className="text-xs text-muted">{a.contacts.length} contacts</span>}>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 text-ink-2"><Building2 size={14} /> Parent: <b className="font-medium text-ink">{a.parentCompany ?? 'Independent'}</b></span>
              {a.integrator && <span className="text-ink-2">{a.species === 'Hog' ? 'Integrator' : 'Packer / co-op'}: <b className="font-medium text-ink">{a.integrator}</b></span>}
              {a.competitor && <span className="text-ink-2">Incumbent: <b className="font-medium text-ink">{a.competitor}</b>{a.competitorRenewal && <> (renews {shortDate(a.competitorRenewal)})</>}</span>}
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {[...a.contacts].sort((x, y) => y.since.localeCompare(x.since)).map((c) => {
                const isNew = new Date(c.since).getTime() > recentCutoff
                return (
                  <li key={c.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink-2">{c.name.split(' ').map((p) => p[0]).join('')}</span>
                    <div className="min-w-0 text-sm">
                      <div className="flex items-center gap-1.5 font-medium text-ink">{c.name}{isNew && <Chip tone="accent"><UserPlus size={11} /> New</Chip>}</div>
                      <div className="text-xs text-ink-2">{c.title}</div>
                      <div className="truncate text-xs text-muted">{c.email} · since {shortDate(c.since)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Change history & signals" pad={false}>
            {sigs.length ? (
              <ul className="divide-y divide-line">
                {sigs.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Chip>{s.type}</Chip><span className="text-[11px] text-muted">{shortDate(s.date)} · {s.source}</span></div>
                      <div className="mt-1 text-sm font-medium text-ink">{s.headline}</div>
                      <div className="text-xs text-ink-2">{s.detail}</div>
                    </div>
                    <Button size="sm" onClick={() => {
                      const d = draftForSignal(a, s, a.rep)
                      queueOutreach({ accountId: a.id, signalId: s.id, trigger: s.type, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' })
                      toast('Draft added to the outreach queue.')
                    }}><Mail size={12} /> Draft outreach</Button>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-muted">No recorded changes.</div>}
          </Card>

          {a.status !== 'Prospect' && (
            <Card title="Subscriptions" pad={false}>
              <table className="w-full text-sm">
                <thead className="border-b border-line text-xs text-ink-2">
                  <tr><th className="px-4 py-2 text-left font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Units</th><th className="px-3 py-2 text-right font-medium">Unit price</th><th className="px-3 py-2 text-right font-medium">List</th><th className="px-3 py-2 text-right font-medium">Discount</th><th className="px-4 py-2 text-right font-medium">Monthly</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.subscriptions.map((s) => {
                    const p = PRODUCT[s.productId]
                    return (
                      <tr key={s.productId}>
                        <td className="px-4 py-2 text-ink">{p.name}<div className="text-[11px] text-muted">per {unitLabel(p.unit)}</div></td>
                        <td className="tabular px-3 py-2 text-right">{s.units}</td>
                        <td className="tabular px-3 py-2 text-right">${s.unitPrice.toFixed(2)}</td>
                        <td className="tabular px-3 py-2 text-right text-muted">${p.listPrice}</td>
                        <td className="tabular px-3 py-2 text-right">{((1 - s.unitPrice / p.listPrice) * 100).toFixed(0)}%</td>
                        <td className="tabular px-4 py-2 text-right">{money(s.units * s.unitPrice)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {ws.length > 0 && <div className="border-t border-line px-4 py-2 text-xs text-ink-2">White space: {ws.map((p) => PRODUCT[p].name).join(', ')}</div>}
            </Card>
          )}

          {pa && (
            <Card title="Pricing normalization">
              <PriceAnalysisPanel a={a} pa={pa} contract={contract} />
              {pa.status === 'Under-priced' && pa.ability && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {proposals[a.id] ? (
                    <StatusBadge tone="good">Proposed +{proposals[a.id].pct.toFixed(1)}% on {shortDate(proposals[a.id].createdAt)}</StatusBadge>
                  ) : (
                    <Button variant="primary" onClick={() => {
                      proposePrice(a.id, pa.recommendedPct, pa.ability!.effectiveDate)
                      const d = priceNoticeDraft(a, pa)
                      queueOutreach({ ...d, auto: false, status: 'Draft' })
                      toast('Price notice drafted and added to the outreach queue for approval.')
                    }}>Propose +{pa.recommendedPct.toFixed(1)}% & draft notice</Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {a.status === 'Customer' && (
            <Card title="Weather & account health">
              <div className="flex flex-wrap items-center gap-4">
                <HealthBadge h={book.health[a.id]} />
                <WeatherBadge w={wr} />
              </div>
              {wr?.kind && <p className="mt-2 text-xs text-ink-2">Forecast: {wr.detail}.</p>}
              {forecast && (
                <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px]">
                  {forecast.map((d) => (
                    <div key={d.date} className="rounded-md bg-surface-2 py-1.5">
                      <div className="text-muted">{new Date(d.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div className="tabular font-semibold">{toF(d.tmax)}°</div>
                      <div className="tabular text-muted">{toF(d.tmin)}°</div>
                      <div className="tabular text-ink-2">{Math.round(thi(d.tmax, d.rh))}</div>
                    </div>
                  ))}
                </div>
              )}
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {book.health[a.id]?.parts.map((p) => <li key={p.label} className="flex justify-between"><span className="text-ink-2">{p.label}</span><span className="tabular text-ink">{p.value}</span></li>)}
              </ul>
              {wr?.kind && (
                <div className="mt-3">
                  <Button size="sm" onClick={() => {
                    const d = draftForWeather(a, wr.kind!, wr.day ? new Date(wr.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }) : 'this week', wr.detail, a.rep)
                    queueOutreach({ accountId: a.id, trigger: `Weather: ${wr.kind}`, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: false, status: 'Draft' })
                    toast('Support message drafted.')
                  }}><Send size={12} /> Draft support message</Button>
                </div>
              )}
            </Card>
          )}

          <Card title="Contract">
            {contract || negotiation ? (
              <div className="flex flex-col gap-3 text-sm">
                {[contract, negotiation].filter(Boolean).map((c) => (
                  <div key={c!.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{c!.id} · {c!.template}</span>
                      <Chip tone={c!.status === 'In Negotiation' ? 'accent' : 'neutral'}>{c!.status}</Chip>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-ink-2">
                      <span>Term: {c!.termMonths} mo, ends {shortDate(c!.end)}</span>
                      <span>Auto-renew: {c!.autoRenew ? `yes (${c!.renewalNoticeDays}d notice)` : 'no'}</span>
                      <span>Pricing: {c!.price.mechanism}{c!.price.capPct ? ` (cap ${c!.price.capPct}%)` : ''}</span>
                      <span>Payment: {c!.paymentTerms}{c!.mfn ? ' · MFN' : ''}</span>
                      <span className="col-span-2">Change of control: {c!.assignmentOnChangeOfControl}</span>
                    </div>
                    {c!.status === 'In Negotiation' && <Link to={`/contracts/${c!.id}`} className="mt-2 inline-block text-xs font-medium text-accent">{c!.redlines.length} redlines: review with Lucas →</Link>}
                  </div>
                ))}
                {a.parentCompany && contract?.assignmentOnChangeOfControl === 'Consent required' && sigs.some((s) => s.type === 'Ownership Change') && (
                  <StatusBadge tone="warning">Ownership changed and assignment needs our consent. Review with the new owner.</StatusBadge>
                )}
              </div>
            ) : <div className="text-sm text-muted">No contract on file.</div>}
          </Card>

          <Card title="Opportunities" pad={false}>
            {opps.length ? (
              <ul className="divide-y divide-line">
                {opps.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <div><span className="font-medium text-ink">{o.type}</span> <span className="text-xs text-muted">· {o.products.map((p) => PRODUCT[p].name).join(', ')}</span></div>
                    <div className="flex items-center gap-2"><Chip>{o.stage}</Chip><span className="tabular">{money(o.arr)}</span></div>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4 text-sm text-muted">None yet.</div>}
          </Card>

          <Card title="Activity">
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { log(a.id, 'Note', note.trim()); setNote('') } }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Add a note as ${CURRENT_USER}…`} className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent" />
              <Button type="submit" size="md">Add</Button>
            </form>
            <ul className="flex flex-col gap-2">
              {acts.slice(0, 12).map((x) => (
                <li key={x.id} className="text-sm">
                  <div className="text-ink">{x.text}</div>
                  <div className="text-[11px] text-muted">{x.kind} · {x.author} · {relDays(x.date)}</div>
                </li>
              ))}
              {!acts.length && <li className="text-sm text-muted">No activity yet.</li>}
            </ul>
            {mails.length > 0 && <Link to={`/outreach?account=${a.id}`} className="mt-3 block text-xs font-medium text-accent">{mails.length} outreach messages →</Link>}
          </Card>
        </div>
      </div>
    </div>
  )
}
