import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertOctagon, CloudSun, Send, Sparkles, X } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Outreach, OutreachStatus } from '../types'
import { PLAYBOOK, PLAYBOOKS, draftForWeather } from '../lib/outreach'
import { aiRewriteOutreach } from '../lib/lucas'
import { Button, Card, Chip, Notice, PageHeader, StatusBadge, Tabs, TextLink, inputClass } from '../components/ui'
import { relDays } from '../lib/format'

export function runWeatherAutomation(book: ReturnType<typeof useBook>, outreach: Outreach[], queue: ReturnType<typeof useCrm.getState>['queueOutreach']) {
  const recent = new Set(outreach.filter((o) => o.trigger.startsWith('Weather') && Date.now() - new Date(o.createdAt).getTime() < 3 * 86400000).map((o) => o.accountId))
  let n = 0
  for (const a of book.customers) {
    const w = book.weatherRisk[a.id]
    if (!w?.kind || w.risk < 45 || recent.has(a.id)) continue
    const when = w.day ? new Date(w.day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }) : 'this week'
    const d = draftForWeather(a, w.kind, when, w.detail, a.rep)
    queue({ accountId: a.id, trigger: `Weather: ${w.kind}`, playbook: d.playbook, contactName: d.contact.name, contactEmail: d.contact.email, subject: d.subject, body: d.body, auto: true })
    n++
  }
  return n
}

// Editor fields share the design-system field style; the textarea sizes by rows instead of a fixed height.
const subjectClass = `${inputClass} w-full font-medium`
const bodyClass = `${inputClass.replace('h-9', 'py-2.5')} w-full resize-y leading-relaxed`

const EMPTY: Record<OutreachStatus | 'All', string> = {
  Draft: 'No drafts waiting for approval.',
  Approved: 'No approved messages.',
  Sent: 'No messages sent yet.',
  Skipped: 'No skipped messages.',
  All: 'No outreach yet. Run the weather automation or draft a message from a signal.',
}

function Item({ o }: { o: Outreach }) {
  const book = useBook()
  const update = useCrm((s) => s.updateOutreach)
  const send = useCrm((s) => s.sendOutreach)
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
              <Chip>{PLAYBOOK[o.playbook]?.name ?? 'Price notice'}</Chip>
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
            <Button size="sm" variant="ghost" onClick={() => update(o.id, { status: 'Skipped' })}><X size={12} /> Skip</Button>
            <Button size="sm" variant="primary" onClick={() => send(o.id)}><Send size={12} /> Approve and send</Button>
          </div>
        )}
      </div>
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
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const [params] = useSearchParams()
  const accountFilter = params.get('account')
  const [tab, setTab] = useState<OutreachStatus | 'All'>(accountFilter ? 'All' : 'Draft')
  const [msg, setMsg] = useState<string | null>(null)
  const list = useMemo(() => outreach.filter((o) => (tab === 'All' || o.status === tab) && (!accountFilter || o.accountId === accountFilter)).sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt)), [outreach, tab, accountFilter])
  const count = (s: OutreachStatus) => outreach.filter((o) => o.status === s && (!accountFilter || o.accountId === accountFilter)).length

  return (
    <div>
      <PageHeader
        title="Automated outreach"
        subtitle="Org changes and weather events start playbook messages. Drafts wait for your approval unless auto-send is on for that playbook. Sending is simulated in this demo."
        actions={
          <Button variant="primary" onClick={() => { const n = runWeatherAutomation(book, outreach, queueOutreach); setMsg(n ? `Queued ${n} weather support ${n === 1 ? 'message' : 'messages'}. Any on an auto-send playbook were sent right away` : 'No new weather risks above the threshold') }}>
            <CloudSun size={14} /> Run weather automation
          </Button>
        }
      />
      {msg && <Notice>{msg}</Notice>}
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
          </div>
          {list.length > 0 && <ul className="divide-y divide-line border-t border-line">{list.slice(0, 100).map((o) => <Item key={o.id} o={o} />)}</ul>}
          {!list.length && <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">{EMPTY[tab]}</div>}
        </Card>
        <Card title="Playbooks and automation">
          <ul className="flex flex-col divide-y divide-line">
            {PLAYBOOKS.map((p) => {
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
