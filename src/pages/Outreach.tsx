import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CloudSun, Send, Sparkles, X } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm } from '../store'
import type { Outreach, OutreachStatus } from '../types'
import { PLAYBOOK, PLAYBOOKS, draftForWeather } from '../lib/outreach'
import { aiRewriteOutreach } from '../lib/lucas'
import { Button, Card, Chip, PageHeader, StatusBadge, Tabs } from '../components/ui'
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
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button className="min-w-0 text-left" onClick={() => setOpen(!open)}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone}>{o.status}</StatusBadge>
            <Chip>{PLAYBOOK[o.playbook]?.name ?? 'Price notice'}</Chip>
            {o.auto && <Chip tone="dim">auto</Chip>}
            <span className="text-[11px] text-muted">{o.trigger} · {relDays(o.sentAt ?? o.createdAt)}</span>
          </div>
          <div className="mt-1 text-sm font-medium text-ink">{o.subject}</div>
          <div className="text-xs text-ink-2">To {o.contactName} &lt;{o.contactEmail}&gt; · <Link to={`/accounts/${a.id}`} className="text-accent" onClick={(e) => e.stopPropagation()}>{a.name}</Link></div>
        </button>
        {o.status === 'Draft' && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => update(o.id, { status: 'Skipped' })}><X size={12} /> Skip</Button>
            <Button size="sm" variant="primary" onClick={() => send(o.id)}><Send size={12} /> Approve & send</Button>
          </div>
        )}
      </div>
      {open && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2/50 p-3">
          {o.status === 'Draft' ? (
            <>
              <input value={o.subject} onChange={(e) => update(o.id, { subject: e.target.value })} className="mb-2 h-8 w-full rounded-md border border-line bg-surface px-2 text-sm font-medium outline-none focus:border-accent" />
              <textarea value={o.body} onChange={(e) => update(o.id, { body: e.target.value })} rows={9} className="w-full rounded-md border border-line bg-surface p-2 font-sans text-sm leading-relaxed outline-none focus:border-accent" />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" disabled={busy} onClick={async () => {
                  setBusy(true)
                  setErr(null)
                  const r = await aiRewriteOutreach({ account: { name: a.name, segment: a.segment, species: a.species, state: a.state, status: a.status, headCount: a.headCount, integrator: a.integrator, parentCompany: a.parentCompany }, recipient: `${o.contactName}`, trigger: o.trigger, draft: { subject: o.subject, body: o.body } })
                  setBusy(false)
                  if ('error' in r) setErr(r.error)
                  else update(o.id, { subject: r.subject, body: r.body })
                }}><Sparkles size={12} /> {busy ? 'Rewriting…' : 'Rewrite with AI'}</Button>
                {err && <span className="text-xs text-critical">{err}</span>}
              </div>
            </>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{o.body}</pre>
          )}
        </div>
      )}
    </li>
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
        title="Automated Outreach"
        subtitle="Org changes and weather events trigger playbook messages automatically. Drafts wait for approval unless auto-send is on for that playbook. Sending is simulated in this demo."
        actions={
          <Button variant="primary" onClick={() => { const n = runWeatherAutomation(book, outreach, queueOutreach); setMsg(n ? `${n} weather support messages queued.` : 'No new weather risks above threshold.') }}>
            <CloudSun size={14} /> Run weather automation
          </Button>
        }
      />
      {msg && <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{msg}</div>}
      {accountFilter && <div className="mb-3 text-sm text-ink-2">Showing outreach for <b className="text-ink">{book.byId[accountFilter]?.name}</b>. <Link to="/outreach" className="text-accent">Clear</Link></div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card pad={false}>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'Draft', label: `Awaiting approval (${count('Draft')})` }, { value: 'Sent', label: `Sent (${count('Sent')})` }, { value: 'Skipped', label: `Skipped (${count('Skipped')})` }, { value: 'All', label: 'All' }]} />
          </div>
          <ul className="divide-y divide-line">{list.slice(0, 100).map((o) => <Item key={o.id} o={o} />)}</ul>
          {!list.length && <div className="p-8 text-center text-sm text-muted">Nothing here.</div>}
        </Card>
        <Card title="Playbooks & automation">
          <ul className="flex flex-col gap-3">
            {PLAYBOOKS.map((p) => {
              const sent = outreach.filter((o) => o.playbook === p.id && o.status === 'Sent').length
              return (
                <li key={p.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{p.name}</div>
                    <div className="text-xs text-ink-2">{p.description}</div>
                    <div className="mt-0.5 text-[11px] text-muted">Trigger: {p.trigger} · to {p.roles.slice(0, 2).join(' / ')} · {sent} sent</div>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-2">
                    <input type="checkbox" checked={!!autoSend[p.id]} onChange={(e) => setAutoSend(p.id, e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
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
