import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Download, Loader2, Mail, SendHorizonal, Sparkles } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm, type Decision } from '../store'
import { CLAUSES, CLAUSE, renderClause } from '../data/contracts'
import { chatWithLucas, dealContext, lucasStatus, reviewContract, type LucasItem } from '../lib/lucas'
import { Button, Card, Chip, Empty, PageHeader, StatusBadge, type Tone } from '../components/ui'
import { money, shortDate } from '../lib/format'
import { pickContact } from '../lib/outreach'

// Word-level diff (LCS) for showing redlines.
function diffWords(a: string, b: string): { t: string; k: 'same' | 'del' | 'ins' }[] {
  const x = a.split(/(\s+)/)
  const y = b.split(/(\s+)/)
  const n = x.length, m = y.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: string; k: 'same' | 'del' | 'ins' }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push({ t: x[i++], k: 'same' }), j++
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: x[i++], k: 'del' })
    else out.push({ t: y[j++], k: 'ins' })
  }
  while (i < n) out.push({ t: x[i++], k: 'del' })
  while (j < m) out.push({ t: y[j++], k: 'ins' })
  return out
}

function Diff({ a, b }: { a: string; b: string }) {
  return (
    <p className="text-sm leading-relaxed text-ink">
      {diffWords(a, b).map((p, i) =>
        p.k === 'same' ? <span key={i}>{p.t}</span> : p.k === 'del' ? <del key={i} className="bg-critical/10 text-critical">{p.t}</del> : <ins key={i} className="bg-good/15 text-good-text no-underline">{p.t}</ins>,
      )}
    </p>
  )
}

const recTone = (r: LucasItem['recommendation']): Tone => (r === 'Accept' ? 'good' : r === 'Counter' ? 'warning' : 'critical')
const riskTone = (r: string): Tone => (r === 'High' ? 'critical' : r === 'Medium' ? 'warning' : 'good')

function Markdownish({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {para.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((s, j) => (s.startsWith('**') ? <b key={j}>{s.slice(2, -2)}</b> : s.startsWith('`') ? <code key={j} className="rounded bg-surface-2 px-1 text-[13px]">{s.slice(1, -1)}</code> : s))}
        </p>
      ))}
    </div>
  )
}

export default function LucasWorkspace() {
  const { id } = useParams()
  const book = useBook()
  const reviews = useCrm((s) => s.reviews)
  const decisions = useCrm((s) => s.decisions)
  const chats = useCrm((s) => s.chats)
  const setReview = useCrm((s) => s.setReview)
  const setDecision = useCrm((s) => s.setDecision)
  const appendChat = useCrm((s) => s.appendChat)
  const setChat = useCrm((s) => s.setChat)
  const signContract = useCrm((s) => s.signContract)
  const queueOutreach = useCrm((s) => s.queueOutreach)
  const log = useCrm((s) => s.log)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ai, setAi] = useState<{ ai: boolean; model: string; error?: string } | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { lucasStatus().then(setAi) }, [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [chats, streaming])

  const c = id ? book.contractById[id] : undefined
  if (!c) return <Empty>Contract not found. <Link to="/contracts" className="text-accent">Back</Link></Empty>
  const a = book.byId[c.accountId]
  const opp = book.opportunities.find((o) => o.contractId === c.id)
  const review = reviews[c.id]
  const dec = decisions[c.id] ?? {}
  const chat = chats[c.id] ?? []
  const itemFor = (rid: string) => review?.items.find((i) => i.redlineId === rid)
  const decided = c.redlines.filter((r) => dec[r.id] && dec[r.id].decision !== 'Pending').length
  const vars = { termMonths: c.termMonths, renewalNoticeDays: c.renewalNoticeDays, capPct: c.price.capPct ?? 5, noticeDays: c.price.noticeDays }
  const toast = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 2500) }

  const runReview = async () => {
    setBusy(true)
    setErr(null)
    const { review: r, error } = await reviewContract(a, c, opp, a.rep)
    setReview(c.id, r)
    if (error) setErr(`Lucas used the offline playbook (${error}).`)
    log(a.id, 'Contract', `Lucas reviewed ${c.redlines.length} redlines on ${c.id} (${r.overallRisk} risk).`)
    setBusy(false)
  }

  const applyAll = () => {
    if (!review) return
    for (const r of c.redlines) {
      const it = itemFor(r.id)
      if (it) setDecision(c.id, r.id, { decision: it.recommendation, language: it.recommendation === 'Accept' ? r.proposed : it.counterLanguage })
    }
  }

  const exportText = () => {
    const lines = [`COUNTER-PROPOSAL: ${a.name}, ${c.id} (${c.template})`, `Prepared by ${a.rep}, ThiboLiSoft · ${new Date().toLocaleDateString()}`, '']
    for (const r of c.redlines) {
      const cl = CLAUSE[r.clauseId]
      const d = dec[r.id]
      lines.push(`Section ${cl.number}. ${cl.title}`, `  Customer proposal: ${r.proposed}`, `  ThiboLiSoft response: ${d?.decision ?? 'Pending'}`, d && d.decision !== 'Accept' && d.decision !== 'Pending' ? `  Proposed language: ${d.language}` : '', '')
    }
    const blob = new Blob([lines.filter((l) => l !== '').join('\n')], { type: 'text/plain' })
    const el = document.createElement('a')
    el.href = URL.createObjectURL(blob)
    el.download = `${c.id}-counter-redline.txt`
    el.click()
  }

  const sendChat = async (text: string) => {
    if (!text.trim() || streaming !== null) return
    const next = [...chat, { role: 'user' as const, content: text.trim() }]
    setChat(c.id, next)
    setInput('')
    setStreaming('')
    let acc = ''
    try {
      await chatWithLucas({ ...dealContext(a, c, opp, a.rep), lucasReview: review ? { summary: review.summary, items: review.items } : undefined, repDecisions: dec }, next, (t) => { acc += t; setStreaming(acc) })
    } catch (e) {
      acc += `\n\n[Error: ${e instanceof Error ? e.message : String(e)}]`
    }
    appendChat(c.id, { role: 'assistant', content: acc })
    setStreaming(null)
  }

  return (
    <div>
      <Link to="/contracts" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"><ArrowLeft size={14} /> Contracts</Link>
      <PageHeader
        title={`${a.name} · ${c.id}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Chip tone={c.status === 'In Negotiation' ? 'accent' : 'neutral'}>{c.status}</Chip><span>{c.template} · {c.termMonths}-month term · {c.paymentTerms}{opp ? ` · ${opp.type} ${money(opp.arr)} ARR` : ''}</span></span>}
        actions={
          <>
            {c.redlines.length > 0 && <Button variant="primary" onClick={runReview} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {review ? 'Re-run Lucas' : 'Ask Lucas to review'}</Button>}
            {review && <Button onClick={applyAll}>Apply Lucas recommendations</Button>}
            {decided > 0 && <Button onClick={exportText}><Download size={14} /> Export counter-redline</Button>}
            {c.status === 'In Negotiation' && <Button variant="secondary" disabled={decided < c.redlines.length} title={decided < c.redlines.length ? 'Decide every redline first' : ''} onClick={() => { signContract(c.id); toast('Contract signed. Opportunity closed won.') }}><CheckCircle2 size={14} /> Mark signed</Button>}
          </>
        }
      />
      {flash && <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{flash}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span aria-hidden>🐷</span>
        {ai === null ? 'Checking Lucas…' : ai.ai ? <StatusBadge tone="good">Lucas online · {ai.model}</StatusBadge> : <StatusBadge tone="warning" title={ai.error}>Lucas offline: using playbook rules. Add ANTHROPIC_API_KEY to .env and restart for AI review.</StatusBadge>}
        {err && <span className="text-critical">{err}</span>}
        {c.redlines.length > 0 && <span className="ml-auto">{decided}/{c.redlines.length} redlines decided</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-3">
          {c.redlines.length === 0 && (
            <Card title="Contract terms">
              <div className="grid grid-cols-2 gap-2 text-sm text-ink-2">
                <span>Start {shortDate(c.start)}</span><span>End {shortDate(c.end)}</span>
                <span>Auto-renew {c.autoRenew ? `yes (${c.renewalNoticeDays}d notice)` : 'no'}</span><span>{c.price.mechanism}{c.price.capPct ? `, cap ${c.price.capPct}%` : ''}</span>
                <span>MFN: {c.mfn ? 'yes' : 'no'}</span><span>Change of control: {c.assignmentOnChangeOfControl}</span>
              </div>
              <p className="mt-3 text-sm text-ink-2">No open redlines. Ask Lucas about renewal strategy, repricing or assignment in the chat.</p>
            </Card>
          )}
          {c.redlines.map((r) => {
            const cl = CLAUSE[r.clauseId]
            const it = itemFor(r.id)
            const d = dec[r.id]
            const set = (decision: Decision) => setDecision(c.id, r.id, { decision, language: decision === 'Accept' ? r.proposed : d?.language || it?.counterLanguage || r.original })
            return (
              <Card key={r.id} title={<span>§{cl.number} {cl.title}</span>} action={it && <div className="flex items-center gap-2"><StatusBadge tone={recTone(it.recommendation)}>Lucas: {it.recommendation}</StatusBadge><StatusBadge tone={riskTone(it.risk)}>{it.risk} risk</StatusBadge></div>}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Customer redline</div>
                <Diff a={r.original} b={r.proposed} />
                <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2"><b className="text-ink">Customer note:</b> “{r.customerNote}”</div>
                {it && (
                  <div className="mt-3 text-sm">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Why</div>
                    <p className="text-ink-2">{it.rationale}</p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(['Accept', 'Counter', 'Reject'] as Decision[]).map((x) => (
                    <button key={x} onClick={() => set(x)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${d?.decision === x ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-line-strong'}`}>{x}</button>
                  ))}
                  {d && d.decision !== 'Pending' && <span className="text-xs text-muted">Decision recorded</span>}
                </div>
                {d && (d.decision === 'Counter' || d.decision === 'Reject') && (
                  <div className="mt-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Our language{d.decision === 'Reject' ? ' (alternative offered)' : ''}</div>
                    <textarea value={d.language} onChange={(e) => setDecision(c.id, r.id, { ...d, language: e.target.value })} rows={4} className="w-full rounded-md border border-line bg-surface p-2 text-sm leading-relaxed outline-none focus:border-accent" />
                  </div>
                )}
                <div className="mt-2 text-[11px] text-muted">Playbook: {cl.playbook.standard} Fallback: {cl.playbook.fallback} Walk-away: {cl.playbook.walkAway}</div>
              </Card>
            )
          })}
          <Card title="Full agreement" action={<button className="text-xs font-medium text-accent" onClick={() => setShowFull(!showFull)}>{showFull ? 'Hide' : 'Show'}</button>}>
            {showFull ? (
              <ol className="flex flex-col gap-3 text-sm">
                {CLAUSES.map((cl) => {
                  const r = c.redlines.find((x) => x.clauseId === cl.id)
                  const d = r ? dec[r.id] : undefined
                  const text = d && d.decision !== 'Pending' ? d.language : renderClause(cl, vars)
                  return (
                    <li key={cl.id}>
                      <div className="font-medium text-ink">{cl.number}. {cl.title} {r && <Chip tone="accent">{d?.decision && d.decision !== 'Pending' ? d.decision : 'redlined'}</Chip>}</div>
                      <p className="text-ink-2">{text}</p>
                    </li>
                  )
                })}
              </ol>
            ) : <p className="text-sm text-muted">{CLAUSES.length} sections. Decided redlines are merged into the text.</p>}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {review ? (
            <Card title={<span className="inline-flex items-center gap-2">🐷 Lucas's read</span>} action={<StatusBadge tone={riskTone(review.overallRisk)}>{review.overallRisk} risk</StatusBadge>}>
              <p className="text-sm text-ink">{review.summary}</p>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Concession plan</div>
              <ol className="mt-1 list-decimal pl-5 text-sm text-ink-2">{review.concessionPlan.map((x, i) => <li key={i}>{x}</li>)}</ol>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">Closing strategy</div>
              <p className="text-sm text-ink-2">{review.closingStrategy}</p>
              <div className="mt-3 rounded-lg border border-line p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Draft reply</div>
                <div className="mt-1 text-sm font-medium text-ink">{review.replyEmail.subject}</div>
                <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-ink-2">{review.replyEmail.body}</pre>
                <div className="mt-2">
                  <Button size="sm" onClick={() => {
                    const ct = pickContact(a, ['Owner', 'GM', 'CFO'])
                    queueOutreach({ accountId: a.id, trigger: 'Contract negotiation', playbook: 'lucas', contactName: ct.name, contactEmail: ct.email, subject: review.replyEmail.subject, body: review.replyEmail.body, auto: false, status: 'Draft' })
                    toast('Reply queued in Automated Outreach for approval.')
                  }}><Mail size={12} /> Queue reply for approval</Button>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted">Source: {review.source} · {shortDate(review.createdAt)}. Not legal advice. Liability, indemnity and data changes need counsel sign-off.</div>
            </Card>
          ) : c.redlines.length > 0 ? (
            <Card title="🐷 Lucas the Hog">
              <p className="text-sm text-ink-2">Lucas checks each redline against the playbook's standard, fallback and walk-away positions, reads the customer's note to find the real concern, and proposes language that closes the deal without giving away walk-away terms.</p>
              <div className="mt-3"><Button variant="primary" onClick={runReview} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Ask Lucas to review</Button></div>
            </Card>
          ) : null}

          <Card title="Chat with Lucas" pad={false}>
            <div className="flex max-h-[480px] min-h-48 flex-col gap-3 overflow-y-auto px-4 py-3">
              {!chat.length && streaming === null && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">Ask about this deal. For example:</p>
                  {['What should I give up first to close this week?', 'Write a counter on termination that works for a hog-price downturn.', 'How do I explain the liability cap to a farmer?'].map((s) => (
                    <button key={s} onClick={() => sendChat(s)} className="rounded-lg border border-line px-3 py-2 text-left text-sm text-ink-2 hover:border-accent hover:text-ink">{s}</button>
                  ))}
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'self-end rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink' : 'self-start'}>
                  {m.role === 'user' ? m.content : <Markdownish text={m.content} />}
                </div>
              ))}
              {streaming !== null && <div className="self-start">{streaming ? <Markdownish text={streaming} /> : <span className="inline-flex items-center gap-1.5 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Lucas is thinking…</span>}</div>}
              <div ref={chatEnd} />
            </div>
            <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); sendChat(input) }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Lucas…" className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent" />
              <Button type="submit" variant="primary" disabled={streaming !== null}><SendHorizonal size={14} /></Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
