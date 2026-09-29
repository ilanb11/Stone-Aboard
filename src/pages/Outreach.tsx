import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, FileText, Send, Sparkles, X } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Outreach, OutreachStatus } from '../types'
import { PLAYBOOK, PLAYBOOKS } from '../lib/outreach'
import { aiRewriteOutreach } from '../lib/lucas'
import { Button, Card, Chip, PageHeader, Pill, StatusBadge, Tabs, TextLink, inputClass } from '../components/ui'
import { InvoicePreview } from '../components/InvoicePreview'
import { relDays } from '../lib/format'

// Editor fields share the design-system field style; the textarea sizes by rows instead of a fixed height.
const subjectClass = `${inputClass} w-full font-medium`
const bodyClass = `${inputClass.replace('h-9', 'py-2.5')} w-full resize-y leading-relaxed`

const EMPTY: Record<OutreachStatus | 'All', string> = {
  Draft: 'No drafts waiting for approval.',
  Approved: 'No approved messages.',
  Sent: 'No messages sent yet.',
  Skipped: 'No skipped messages.',
  All: 'No outreach yet. Draft a message from a signal on the Signals page.',
}

function Item({ o }: { o: Outreach }) {
  const book = useBook()
  const update = useCrm((s) => s.updateOutreach)
  const send = useCrm((s) => s.sendOutreach)
  const approveDraft = useCrm((s) => s.approveDraft)
  const approvePriceChange = useCrm((s) => s.approvePriceChange)
  const skipOutreach = useCrm((s) => s.skipOutreach)
  const invoice = useCrm((s) => (o.invoiceId ? s.invoices.find((i) => i.id === o.invoiceId) : undefined))
  const [open, setOpen] = useState(o.status === 'Draft')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const a = book.byId[o.accountId]
  const tone = o.status === 'Sent' ? 'good' : o.status === 'Draft' ? 'warning' : 'neutral'
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The account link sits outside the toggle button: a link nested in a button is invalid and unreachable by keyboard. */}
        <div className="min-w-0 flex-1 basis-[24rem]">
          <button className="block w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusBadge tone={tone}>{o.status}</StatusBadge>
              <Chip>{o.contractId ? 'Contract email (Lucas the Hog)' : o.invoiceId ? 'Price change and invoice' : PLAYBOOK[o.playbook]?.name ?? 'Price notice'}</Chip>
              {invoice && <span className="inline-flex items-center gap-1 text-[13px] text-ink-2"><FileText size={12} aria-hidden /> ${invoice.total.toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo invoice</span>}
              {o.auto && <Chip tone="dim">Auto</Chip>}
              <span className="text-[13px] text-muted">{o.trigger}</span>
              <span className="meta text-muted">{relDays(o.sentAt ?? o.createdAt)}</span>
            </span>
            <span className="mt-2 block text-[15px] font-medium leading-snug text-ink">{o.subject}</span>
          </button>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-ink-2">
            <span className="min-w-0 break-words">
              To {o.contactName} <span className="text-muted">&lt;{o.contactEmail}&gt;</span>
            </span>
            <Link to={`/accounts/${a.id}`} className="text-ink underline-offset-4 hover:underline">{a.name}</Link>
          </div>
        </div>
        {o.status === 'Draft' && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => skipOutreach(o.id)} title={invoice ? 'Skips the email and voids its invoice' : undefined}><X size={12} /> Skip</Button>
            <Button size="sm" variant="primary" onClick={() => (o.contractId ? approveDraft(o.contractId) : invoice ? approvePriceChange(o.id) : send(o.id))} title={o.contractId ? 'Approves the contract and sends this email' : invoice ? 'Sends this email with its invoice' : undefined}><Send size={12} /> {invoice ? 'Approve and send both' : 'Approve and send'}</Button>
          </div>
        )}
      </div>
      {open && invoice?.stale && o.status === 'Draft' && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
          <AlertOctagon size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-serious" aria-hidden />
          <span className="min-w-0">
            The pricing model changed after this draft {o.body !== invoice.emailGenerated.body || o.subject !== invoice.emailGenerated.subject ? 'and the email was edited by hand, so neither was updated' : 'and no longer calls for a price change for this account'}. Check the numbers, redraft it from <Link to="/pricing" className="underline underline-offset-4">Pricing rank</Link>, or skip it.
          </span>
        </div>
      )}
      {open && (
        <div className="mt-4">
          {o.status === 'Draft' ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
                <span>Subject</span>
                <input value={o.subject} onChange={(e) => update(o.id, { subject: e.target.value })} className={subjectClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
                <span>Message</span>
                <textarea value={o.body} onChange={(e) => update(o.id, { body: e.target.value })} rows={9} className={bodyClass} />
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={async () => {
                  setBusy(true)
                  setErr(null)
                  const r = await aiRewriteOutreach({ account: { name: a.name, segment: a.segment, species: a.species, state: a.state, status: a.status, headCount: a.headCount, integrator: a.integrator, parentCompany: a.parentCompany }, recipient: `${o.contactName}`, trigger: o.trigger, draft: { subject: o.subject, body: o.body } })
                  setBusy(false)
                  if ('error' in r) setErr(r.error)
                  else update(o.id, { subject: r.subject, body: r.body })
                }}><Sparkles size={12} /> {busy ? 'Rewriting…' : 'Rewrite with AI'}</Button>
              </div>
              {err && (
                <div role="alert" className="mt-1 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
                  <AlertOctagon size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-critical" aria-hidden />
                  <span className="min-w-0">{err}</span>
                </div>
              )}
            </div>
          ) : (
            <pre className="max-w-[72ch] whitespace-pre-wrap rounded-[14px] bg-accent-soft p-4 font-sans text-[14px] leading-relaxed text-ink">{o.body}</pre>
          )}
          {invoice && (
            <div className="mt-4 max-w-3xl">
              <div className="mb-2 text-[13px] text-ink-2">Attached invoice{o.status === 'Draft' ? ' (sent only with this email, on approval)' : ''}</div>
              <InvoicePreview inv={invoice} />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function TabLabel({ label, n }: { label: string; n?: number }) {
  return (
    <>
      {label}
      {n !== undefined && <span className="tabular ml-1.5 opacity-60">{n}</span>}
    </>
  )
}

export default function OutreachPage() {
  const book = useBook()
  const outreach = useCrm((s) => s.outreach)
  const autoSend = useCrm((s) => s.autoSend)
  const setAutoSend = useCrm((s) => s.setAutoSend)
  const [params] = useSearchParams()
  const accountFilter = params.get('account')
  const [kind, setKind] = useState<'all' | 'price'>(params.get('kind') === 'price' ? 'price' : 'all')
  const [tab, setTab] = useState<OutreachStatus | 'All'>(accountFilter ? 'All' : 'Draft')
  const inScope = (o: Outreach) => (!accountFilter || o.accountId === accountFilter) && (kind === 'all' || !!o.invoiceId)
  const list = outreach.filter((o) => (tab === 'All' || o.status === tab) && inScope(o)).sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
  const count = (s: OutreachStatus) => outreach.filter((o) => o.status === s && inScope(o)).length
  const priceDrafts = outreach.filter((o) => o.invoiceId && o.status === 'Draft').length

  return (
    <div>
      <PageHeader
        title="Automated outreach"
        subtitle="Org changes start playbook messages, and Pricing rank adds price-change emails with their invoices. Drafts wait for your approval unless auto-send is on for that playbook (price changes and contract emails never auto-send). Sending is simulated in this demo."
      />
      {accountFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-2">
          <span>
            Showing outreach for <span className="font-medium text-ink">{book.byId[accountFilter]?.name}</span>
          </span>
          <Link to="/outreach">
            <TextLink>Show all accounts</TextLink>
          </Link>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card pad={false}>
          <div className="px-5 pt-5">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'Draft', label: <TabLabel label="Awaiting approval" n={count('Draft')} /> },
                { value: 'Sent', label: <TabLabel label="Sent" n={count('Sent')} /> },
                { value: 'Skipped', label: <TabLabel label="Skipped" n={count('Skipped')} /> },
                { value: 'All', label: <TabLabel label="All" /> },
              ]}
            />
            <div className="-mt-2 mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Message type">
              <Pill active={kind === 'all'} onClick={() => setKind('all')}>Every message</Pill>
              <Pill active={kind === 'price'} onClick={() => setKind('price')}>Price changes with invoices{priceDrafts ? ` · ${priceDrafts} waiting` : ''}</Pill>
            </div>
          </div>
          {list.length > 0 && <ul className="divide-y divide-line border-t border-line">{list.slice(0, 100).map((o) => <Item key={o.id} o={o} />)}</ul>}
          {!list.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">{EMPTY[tab]}</div>}
        </Card>
        <Card title="Playbooks and automation">
          <ul className="flex flex-col divide-y divide-line">
            {PLAYBOOKS.filter((p) => !p.id.startsWith('weather-')).map((p) => {
              const sent = outreach.filter((o) => o.playbook === p.id && o.status === 'Sent').length
              return (
                <li key={p.id} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-ink">{p.name}</div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{p.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                      <span>Trigger: {p.trigger}</span>
                      <span>To {p.roles.slice(0, 2).join(' or ')}</span>
                      <span className="meta">{sent} sent</span>
                    </div>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 text-[13px] text-ink-2">
                    <input type="checkbox" checked={!!autoSend[p.id]} onChange={(e) => setAutoSend(p.id, e.target.checked)} className="h-4 w-4" />
                    Auto-send
                  </label>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
