import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, Download, SendHorizonal } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import { deliverOutreach } from '../lib/liveMail'
import type { Contract, OrderLine } from '../types'
import { OPERATION_LABEL } from '../types'
import { PRODUCT, unitLabel } from '../data/products'
import { Button, Card, Chip, LucasMark, Notice, PageHeader, StatusBadge, inputClass } from '../components/ui'
import { isFramed, money, saveText, shortDate, sizeLabel } from '../lib/format'
import { annualValue, contractClauses, draftContractEmail, pricingBasis, renderContractDocument, type DraftContext } from '../lib/lucasDrafts'

const field = `${inputClass} w-full`
const dateInput = (iso: string) => iso.slice(0, 10)
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + n)
  return d.toISOString()
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[13px] text-ink-2">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Review screen for a contract Lucas the Hog drafted. Nothing leaves until the user approves it. */
export default function LucasDraft({ contract: c }: { contract: Contract }) {
  const book = useBook()
  const email = useCrm((s) => s.outreach.find((m) => m.id === c.draft?.emailId))
  const updateContract = useCrm((s) => s.updateContract)
  const updateOutreach = useCrm((s) => s.updateOutreach)
  const approveDraft = useCrm((s) => s.approveDraft)
  const [copied, setCopied] = useState<string | null>(null)
  const a = book.byId[c.accountId]
  const opp = book.opportunities.find((o) => o.id === c.draft?.opportunityId)
  const lines = c.orderForm ?? []
  const annual = annualValue(lines)
  const locked = c.status !== 'Draft'
  const ctx: DraftContext | undefined = opp
    ? { account: a, opportunity: opp, activeContract: a.contractId ? book.contractById[a.contractId] : undefined, customers: book.customers, contractsById: book.contractById }
    : undefined
  const basis = ctx ? pricingBasis(ctx) : undefined

  // The email summarizes the contract, so it follows contract edits until someone
  // edits the email by hand (then their wording wins).
  const apply = (patch: Partial<Contract>) => {
    const next = { ...c, ...patch }
    updateContract(c.id, patch)
    if (!ctx || !email) return
    const before = draftContractEmail(ctx, c)
    if (email.body !== before.body || email.subject !== before.subject) return
    const after = draftContractEmail(ctx, next)
    updateOutreach(email.id, { subject: after.subject, body: after.body })
  }
  const generated = ctx ? draftContractEmail(ctx, c) : undefined
  const stale = !!(email && generated && !locked && (email.body !== generated.body || email.subject !== generated.subject))
  const refreshEmail = () => email && generated && updateOutreach(email.id, { subject: generated.subject, body: generated.body })
  const setTerms = (patch: Partial<Contract>) => {
    const next = { ...c, ...patch }
    apply({ ...patch, end: addMonths(next.start, next.termMonths) })
  }
  const setLine = (i: number, patch: Partial<OrderLine>) => apply({ orderForm: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })

  const exportDoc = async () => {
    const r = await saveText(`${c.id}.txt`, renderContractDocument(c, a, a.rep, basis))
    setCopied(r === 'copied' ? 'Contract text copied to the clipboard' : r === 'downloaded' ? 'Contract downloaded' : "Couldn't copy the contract. Allow clipboard access and try again.")
    setTimeout(() => setCopied(null), 3000)
  }

  return (
    <div>
      <Link to="/contracts" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Lucas the Hog
      </Link>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Chip tone={locked ? 'accent' : 'lime'}>{locked ? 'Sent' : 'Draft for review'}</Chip>
            <span className="meta">{c.id}</span>
            <span>{c.template}</span>
          </span>
        }
        actions={
          <>
            <Button onClick={exportDoc}>
              {isFramed() ? <Copy size={14} /> : <Download size={14} />} {isFramed() ? 'Copy contract text' : 'Download contract'}
            </Button>
            {!locked && (
              <Button variant="primary" onClick={() => { const emailId = c.draft?.emailId; approveDraft(c.id); if (emailId) void deliverOutreach(emailId) }}>
                <SendHorizonal size={14} /> Approve and send
              </Button>
            )}
          </>
        }
      />
      {copied && <Notice>{copied}</Notice>}

      <div className="mb-5 flex items-start gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
        <LucasMark size={40} />
        <p className="min-w-0 max-w-[72ch] text-[14px] leading-relaxed text-ink-2">
          {locked ? (
            <>Approved and sent on {shortDate(c.draft?.approvedAt ?? c.start)}. The customer has the contract and the intro email.</>
          ) : (
            <>
              Lucas the Hog drafted this contract and intro email on {shortDate(c.draft?.at ?? c.start)}, when the deal moved to Negotiation. It uses the account, deal and Pricing module data, with playbook-standard terms. <span className="text-ink">Nothing has been sent.</span> Review, edit if needed, then approve and send.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Terms">
            <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
              <Row label="Start date">
                <input id="draft-start" type="date" className={field} value={dateInput(c.start)} onChange={(e) => e.target.value && setTerms({ start: new Date(e.target.value + 'T12:00:00').toISOString() })} />
              </Row>
              <Row label="Initial term">
                <select id="draft-term" className={field} value={c.termMonths} onChange={(e) => setTerms({ termMonths: Number(e.target.value) })}>
                  {[12, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}
                </select>
              </Row>
              <Row label="Payment terms">
                <select id="draft-payment" className={field} value={c.paymentTerms} onChange={(e) => setTerms({ paymentTerms: e.target.value })}>
                  {['Net 30', 'Net 45', 'Net 60'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Row>
              <Row label="Annual price increase cap">
                <select id="draft-cap" className={field} value={c.price.capPct ?? 5} onChange={(e) => setTerms({ price: { ...c.price, capPct: Number(e.target.value) } })}>
                  {[3, 4, 5].map((p) => <option key={p} value={p}>Up to {p}% on {c.price.noticeDays} days' notice</option>)}
                </select>
              </Row>
              <label className="flex items-center gap-2 text-[14px] text-ink sm:col-span-2">
                <input id="draft-renew" type="checkbox" checked={c.autoRenew} onChange={(e) => setTerms({ autoRenew: e.target.checked })} className="h-4 w-4" />
                Renews for 12-month terms unless either side gives {c.renewalNoticeDays} days' notice
              </label>
            </fieldset>
            <p className="mt-4 text-[13px] text-muted">Ends {shortDate(c.end)}. Payment, term and cap options stay inside the negotiation playbook.</p>
          </Card>

          <Card title="Order form" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead>
                  <tr className="text-left text-[13px] text-muted">
                    <th className="px-5 py-3 font-normal">Product</th>
                    <th className="px-3 py-3 text-right font-normal">Units</th>
                    <th className="px-3 py-3 text-right font-normal">Price / unit / mo</th>
                    <th className="px-3 py-3 text-right font-normal">Off list</th>
                    <th className="px-5 py-3 text-right font-normal">Monthly</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const p = PRODUCT[l.productId]
                    return (
                      <tr key={l.productId} className="border-t border-line">
                        <td className="px-5 py-3 text-ink">
                          {p.name}
                          <div className="text-[12px] text-muted">per {unitLabel(p.unit)}, list ${l.listPrice}</div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input aria-label={`${p.name} units`} type="number" min={1} disabled={locked} className={`${inputClass} tabular w-20 text-right`} value={l.units} onChange={(e) => setLine(i, { units: Math.max(1, Number(e.target.value) || 1) })} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input aria-label={`${p.name} price per unit`} type="number" min={0} step="0.01" disabled={locked} className={`${inputClass} tabular w-24 text-right`} value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} />
                        </td>
                        <td className="tabular px-3 py-3 text-right text-ink-2">{Math.round((1 - l.unitPrice / l.listPrice) * 100)}%</td>
                        <td className="tabular px-5 py-3 text-right text-ink">{money(l.units * l.unitPrice)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <td className="px-5 py-3 text-ink" colSpan={4}>Annual subscription fees</td>
                    <td className="figure px-5 py-3 text-right text-[24px] text-ink">{money(annual)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {basis && <p className="px-5 pb-4 pt-1 text-[13px] text-ink-2">{basis}</p>}
          </Card>

          <Card title="Full agreement">
            <div className="mb-4 text-[14px] text-ink-2">
              Between ThiboLiSoft and {a.name}, {a.county} County, {a.state}. {OPERATION_LABEL[a.species]} operation ({a.segment}), {sizeLabel(a)}. Starts {shortDate(c.start)} for {c.termMonths} months.
            </div>
            <ol className="flex flex-col gap-3 text-[14px]">
              {contractClauses(c).map((cl) => (
                <li key={cl.number}>
                  <div className="font-medium text-ink">
                    {cl.number}. {cl.title}
                  </div>
                  <p className="mt-0.5 leading-relaxed text-ink-2">{cl.text}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Intro email" action={email && <StatusBadge tone={email.status === 'Sent' ? 'good' : 'warning'}>{email.status === 'Sent' ? `Sent ${shortDate(email.sentAt ?? '')}` : 'Draft, not sent'}</StatusBadge>}>
            {email ? (
              <div className="flex flex-col gap-3">
                <div className="text-[13px] text-ink-2">
                  To <span className="text-ink">{email.contactName}</span> <span className="meta text-muted">{email.contactEmail}</span>
                </div>
                <input id="draft-subject" aria-label="Email subject" disabled={locked} className={`${field} font-medium`} value={email.subject} onChange={(e) => updateOutreach(email.id, { subject: e.target.value })} />
                <textarea id="draft-body" aria-label="Email body" disabled={locked} rows={16} className={`${inputClass.replace('h-9', 'py-2.5')} w-full resize-y leading-relaxed`} value={email.body} onChange={(e) => updateOutreach(email.id, { body: e.target.value })} />
                {stale && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-[13px] text-ink-2">
                    <span>You've edited this email, so contract changes no longer update it. Check that the summary still matches the contract.</span>
                    <Button size="sm" onClick={refreshEmail}>Update from contract</Button>
                  </div>
                )}
                <p className="text-[12px] text-muted">The email updates with the contract terms until you edit it. The contract goes as an attachment. Sending is simulated in this demo, and it only happens when you approve.</p>
                {!locked && (
                  <div>
                    <Button variant="primary" onClick={() => { const emailId = c.draft?.emailId; approveDraft(c.id); if (emailId) void deliverOutreach(emailId) }}>
                      <SendHorizonal size={14} /> Approve and send
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[14px] text-muted">No intro email is linked to this draft.</p>
            )}
          </Card>

          <Card title="Deal">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-[14px]">
              <div>
                <dt className="text-[12px] text-muted">Account</dt>
                <dd className="mt-0.5">
                  <Link to={`/accounts/${a.id}`} className="text-ink underline-offset-4 hover:underline">{a.name}</Link>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Sales rep</dt>
                <dd className="mt-0.5 text-ink">{a.rep}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Deal</dt>
                <dd className="mt-0.5 text-ink">{opp ? `${opp.type}, ${opp.stage}` : 'Not found'}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Negotiation started</dt>
                <dd className="mt-0.5 text-ink">{opp?.negotiationStartedAt ? shortDate(opp.negotiationStartedAt) : 'Not yet'}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Operation</dt>
                <dd className="mt-0.5 text-ink">{OPERATION_LABEL[a.species]}, {sizeLabel(a)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Location</dt>
                <dd className="mt-0.5 text-ink">{a.county}, {a.state}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
