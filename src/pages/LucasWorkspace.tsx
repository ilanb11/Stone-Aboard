import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, Loader2, Mail, SendHorizonal, Sparkles } from 'lucide-react'
import { useBook } from '../lib/useData'
import { useCrm, type Decision } from '../store'
import { CLAUSES, CLAUSE, renderClause } from '../data/contracts'
import { chatWithLucas, dealContext, lucasStatus, reviewContract, type LucasItem } from '../lib/lucas'
import { Button, Card, Chip, Empty, LucasMark, Notice, PageHeader, Pill, StatusBadge, TextLink, type Tone } from '../components/ui'
import { isFramed, money, saveText, shortDate } from '../lib/format'
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
  // Merge runs of the same kind so each change reads as one continuous mark.
  const runs: { t: string; k: 'same' | 'del' | 'ins' }[] = []
  for (const p of diffWords(a, b)) {
    const last = runs[runs.length - 1]
    if (last && last.k === p.k) last.t += p.t
    else runs.push({ ...p })
  }
  return (
    <p className="text-[15px] leading-[1.7] text-ink">
      {runs.map((p, i) =>
        p.k === 'same' ? (
          <span key={i}>{p.t}</span>
        ) : p.k === 'del' ? (
          <del key={i} className="rounded-[3px] bg-critical/10 px-[2px] text-critical line-through [box-decoration-break:clone]">
            {p.t}
          </del>
        ) : (
          <ins key={i} className="rounded-[3px] bg-lime px-[2px] text-on-lime no-underline [box-decoration-break:clone]">
            {p.t}
          </ins>
        ),
      )}
    </p>
  )
}

const recTone = (r: LucasItem['recommendation']): Tone => (r === 'Accept' ? 'good' : r === 'Counter' ? 'warning' : 'critical')
const riskTone = (r: string): Tone => (r === 'High' ? 'critical' : r === 'Medium' ? 'warning' : 'good')

/** Small sentence-case label above a block of content. */
function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-[12px] text-muted ${className}`}>{children}</div>
}

function Markdownish({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-ink">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {para.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((s, j) =>
            s.startsWith('**') ? (
              <b key={j} className="font-medium">
                {s.slice(2, -2)}
              </b>
            ) : s.startsWith('`') ? (
              <code key={j} className="rounded-[6px] bg-accent-soft px-1.5 py-0.5 font-mono text-[12px]">
                {s.slice(1, -1)}
              </code>
            ) : (
              s
            ),
          )}
        </p>
      ))}
    </div>
  )
}

const textareaCls =
  'w-full rounded-[var(--radius-field)] border border-transparent bg-accent-soft p-3 text-[14px] leading-relaxed text-ink outline-none transition-colors placeholder:text-muted hover:bg-accent-soft-2 focus:border-line-strong focus:bg-surface'

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
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { lucasStatus().then(setAi) }, [])
  // Clear the previous contract's review error when switching contracts.
  useEffect(() => { setErr(null); setFlash(null) }, [id])
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [chats, streaming])

  const c = id ? book.contractById[id] : undefined
  if (!c)
    return (
      <Empty>
        Contract not found.{' '}
        <Link to="/contracts" className="text-ink underline underline-offset-4">
          Back to contracts
        </Link>
      </Empty>
    )
  const a = book.byId[c.accountId]
  const opp = book.opportunities.find((o) => o.contractId === c.id)
  const review = reviews[c.id]
  const dec = decisions[c.id] ?? {}
  const chat = chats[c.id] ?? []
  const itemFor = (rid: string) => review?.items.find((i) => i.redlineId === rid)
  const decided = c.redlines.filter((r) => dec[r.id] && dec[r.id].decision !== 'Pending').length
  const vars = { termMonths: c.termMonths, renewalNoticeDays: c.renewalNoticeDays, capPct: c.price.capPct ?? 5, noticeDays: c.price.noticeDays }
  const toast = (text: string, error = false) => { setFlash({ text, error }); setTimeout(() => setFlash(null), error ? 4000 : 2500) }
  const framed = isFramed()
  // One solid primary action at a time: review first, then apply, then sign.
  const allDecided = decided >= c.redlines.length
  const reviewPrimary = !review && !allDecided
  const applyPrimary = !!review && !allDecided
  const sourceLabel = review ? (review.source === 'offline-playbook' ? 'Offline playbook' : review.source) : ''

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

  const exportText = async () => {
    const lines = [`COUNTER-PROPOSAL: ${a.name}, ${c.id} (${c.template})`, `Prepared by ${a.rep}, ThiboLiSoft, ${new Date().toLocaleDateString()}`, '']
    for (const r of c.redlines) {
      const cl = CLAUSE[r.clauseId]
      const d = dec[r.id]
      lines.push(`Section ${cl.number}. ${cl.title}`, `  Customer proposal: ${r.proposed}`, `  ThiboLiSoft response: ${d?.decision ?? 'Pending'}`, d && d.decision !== 'Accept' && d.decision !== 'Pending' ? `  Proposed language: ${d.language}` : '', '')
    }
    const result = await saveText(`${c.id}-counter-redline.txt`, lines.filter((l) => l !== '').join('\n'))
    if (result === 'copied') toast('Counter-redline copied to clipboard')
    else if (result === 'failed') toast("Couldn't copy the counter-redline. Allow clipboard access in your browser and try again.", true)
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
      <Link to="/contracts" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> All contracts
      </Link>
      <PageHeader
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Chip tone={c.status === 'Expired' ? 'dim' : 'neutral'}>{c.status}</Chip>
            <span className="meta text-ink">{c.id}</span>
            <span>{c.template}</span>
            <span>{c.termMonths}-month term</span>
            <span>{c.paymentTerms}</span>
            {opp && (
              <span>
                {opp.type} <span className="tabular">{money(opp.arr)}</span> ARR
              </span>
            )}
          </span>
        }
        actions={
          <>
            {c.redlines.length > 0 && (
              <Button variant={reviewPrimary ? 'primary' : 'secondary'} onClick={runReview} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {review ? 'Review again' : 'Ask Lucas to review'}
              </Button>
            )}
            {review && (
              <Button variant={applyPrimary ? 'primary' : 'secondary'} onClick={applyAll}>
                Apply Lucas's recommendations
              </Button>
            )}
            {decided > 0 && (
              <Button onClick={exportText}>
                {framed ? <Copy size={14} /> : <Download size={14} />} {framed ? 'Copy counter-redline' : 'Download counter-redline'}
              </Button>
            )}
            {c.status === 'In Negotiation' && (
              <Button
                variant={allDecided ? 'primary' : 'secondary'}
                disabled={decided < c.redlines.length}
                title={decided < c.redlines.length ? 'Decide every redline first' : ''}
                onClick={() => {
                  signContract(c.id)
                  toast('Contract signed. Opportunity marked closed won')
                }}
              >
                <CheckCircle2 size={14} /> Mark signed
              </Button>
            )}
          </>
        }
      />
      {flash &&
        (flash.error ? (
          <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
            <AlertOctagon size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-critical" aria-hidden />
            <span className="min-w-0">{flash.text}</span>
          </div>
        ) : (
          <Notice>{flash.text}</Notice>
        ))}

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
        <LucasMark size={24} />
        {ai === null ? (
          <span className="text-muted">Checking Lucas…</span>
        ) : ai.ai ? (
          <StatusBadge tone="good">
            Lucas online <span className="meta text-muted">{ai.model}</span>
          </StatusBadge>
        ) : (
          <>
            <StatusBadge tone="warning" title={ai.error}>
              Lucas offline
            </StatusBadge>
            <span className="min-w-0">
              {import.meta.env.VITE_ARTIFACT ? (
                'Lucas uses the playbook rules in this demo link.'
              ) : (
                <>
                  Using playbook rules. Add <code className="meta text-ink">ANTHROPIC_API_KEY</code> to <code className="meta text-ink">.env</code> and restart for AI review.
                </>
              )}
            </span>
          </>
        )}
        {c.redlines.length > 0 && (
          <span className="ml-auto">
            <span className="tabular text-ink">
              {decided} of {c.redlines.length}
            </span>{' '}
            redlines decided
          </span>
        )}
      </div>
      {err && (
        <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
          <AlertTriangle size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-warning" aria-hidden />
          <span className="min-w-0">{err}</span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          {c.redlines.length === 0 && (
            <Card title="Contract terms">
              <dl className="grid gap-x-6 gap-y-4 text-[14px] sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">Start</dt>
                  <dd className="text-ink">{shortDate(c.start)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">End</dt>
                  <dd className="text-ink">{shortDate(c.end)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">Auto-renew</dt>
                  <dd className="text-ink">{c.autoRenew ? `Yes, ${c.renewalNoticeDays} days notice` : 'No'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">Price</dt>
                  <dd className="text-ink">
                    {c.price.mechanism}
                    {c.price.capPct ? `, cap ${c.price.capPct}%` : ''}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">MFN</dt>
                  <dd className="text-ink">{c.mfn ? 'Yes' : 'No'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[12px] text-muted">Change of control</dt>
                  <dd className="text-ink">{c.assignmentOnChangeOfControl}</dd>
                </div>
              </dl>
              <p className="mt-5 text-[14px] text-ink-2">No open redlines. Ask Lucas about renewal strategy, repricing or assignment in the chat.</p>
            </Card>
          )}
          {c.redlines.map((r) => {
            const cl = CLAUSE[r.clauseId]
            const it = itemFor(r.id)
            const d = dec[r.id]
            const set = (decision: Decision) => setDecision(c.id, r.id, { decision, language: decision === 'Accept' ? r.proposed : d?.language || it?.counterLanguage || r.original })
            return (
              <Card
                key={r.id}
                title={
                  <span>
                    <span className="meta mr-2 text-muted">§{cl.number}</span>
                    {cl.title}
                  </span>
                }
                action={
                  it && (
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge tone={recTone(it.recommendation)}>Lucas: {it.recommendation}</StatusBadge>
                      <StatusBadge tone={riskTone(it.risk)}>{it.risk} risk</StatusBadge>
                    </div>
                  )
                }
              >
                <Label className="mb-1.5">Customer redline</Label>
                <Diff a={r.original} b={r.proposed} />
                <div className="mt-4 rounded-[14px] bg-accent-soft px-4 py-3">
                  <Label className="mb-1">Customer note</Label>
                  <p className="text-[14px] text-ink-2">“{r.customerNote}”</p>
                </div>
                {it && (
                  <div className="mt-4">
                    <Label className="mb-1">Lucas's reasoning</Label>
                    <p className="text-[14px] leading-relaxed text-ink-2">{it.rationale}</p>
                  </div>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-1.5">
                  {(['Accept', 'Counter', 'Reject'] as Decision[]).map((x) => (
                    <Pill key={x} active={d?.decision === x} onClick={() => set(x)}>
                      {x}
                    </Pill>
                  ))}
                  {d && d.decision !== 'Pending' && (
                    <span className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-muted">
                      <CheckCircle2 size={13} aria-hidden /> Decision recorded
                    </span>
                  )}
                </div>
                {d && (d.decision === 'Counter' || d.decision === 'Reject') && (
                  <label className="mt-4 flex flex-col gap-1.5">
                    <span className="text-[12px] text-muted">{d.decision === 'Reject' ? 'Alternative language we offer' : 'Our language'}</span>
                    <textarea value={d.language} onChange={(e) => setDecision(c.id, r.id, { ...d, language: e.target.value })} rows={4} className={textareaCls} />
                  </label>
                )}
                <dl className="mt-5 grid gap-4 border-t border-line pt-4 text-[13px] leading-relaxed sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Playbook standard</dt>
                    <dd className="text-ink-2">{cl.playbook.standard}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Fallback</dt>
                    <dd className="text-ink-2">{cl.playbook.fallback}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted">Walk-away</dt>
                    <dd className="text-ink-2">{cl.playbook.walkAway}</dd>
                  </div>
                </dl>
              </Card>
            )
          })}
          <Card
            title="Full agreement"
            action={
              <button type="button" aria-expanded={showFull} onClick={() => setShowFull(!showFull)}>
                <TextLink>{showFull ? 'Hide text' : 'Show text'}</TextLink>
              </button>
            }
          >
            {showFull ? (
              <ol className="flex flex-col gap-4 text-[14px]">
                {CLAUSES.map((cl) => {
                  const r = c.redlines.find((x) => x.clauseId === cl.id)
                  const d = r ? dec[r.id] : undefined
                  const text = d && d.decision !== 'Pending' ? d.language : renderClause(cl, vars)
                  return (
                    <li key={cl.id} className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                        <span className="meta text-muted">{cl.number}</span>
                        <span className="font-medium">{cl.title}</span>
                        {r && <Chip tone="accent">{d?.decision && d.decision !== 'Pending' ? d.decision : 'Redlined'}</Chip>}
                      </div>
                      <p className="leading-relaxed text-ink-2">{text}</p>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-[14px] text-muted">
                {CLAUSES.length} sections. Decided redlines are merged into the text.
              </p>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {review ? (
            <Card
              title={
                <span className="inline-flex items-center gap-2.5">
                  <LucasMark size={28} /> Lucas's read
                </span>
              }
              action={<StatusBadge tone={riskTone(review.overallRisk)}>{review.overallRisk} risk</StatusBadge>}
            >
              <p className="text-[15px] leading-relaxed text-ink">{review.summary}</p>
              <Label className="mb-1.5 mt-5">Concession plan</Label>
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] leading-relaxed text-ink-2 marker:text-muted">
                {review.concessionPlan.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
              <Label className="mb-1 mt-5">Closing strategy</Label>
              <p className="text-[14px] leading-relaxed text-ink-2">{review.closingStrategy}</p>
              <div className="mt-5 rounded-[14px] bg-accent-soft p-4">
                <Label>Draft reply</Label>
                <div className="mt-1 text-[14px] font-medium text-ink">{review.replyEmail.subject}</div>
                <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-ink-2">{review.replyEmail.body}</pre>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const ct = pickContact(a, ['Owner', 'GM', 'CFO'])
                      queueOutreach({ accountId: a.id, trigger: 'Contract negotiation', playbook: 'lucas', contactName: ct.name, contactEmail: ct.email, subject: review.replyEmail.subject, body: review.replyEmail.body, auto: false, status: 'Draft' })
                      toast('Reply added to the outreach queue for approval')
                    }}
                  >
                    <Mail size={12} /> Queue reply for approval
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                <span className="meta">{sourceLabel}</span>
                <span className="meta">{shortDate(review.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">Not legal advice. Liability, indemnity and data changes need counsel sign-off.</p>
            </Card>
          ) : c.redlines.length > 0 ? (
            <Card
              title={
                <span className="inline-flex items-center gap-2.5">
                  <LucasMark size={28} /> Lucas the Hog
                </span>
              }
            >
              <p className="text-[14px] leading-relaxed text-ink-2">
                Lucas checks each redline against the playbook's standard, fallback and walk-away positions, reads the customer's note to find the real concern, and proposes language that closes the deal without giving away walk-away terms.
              </p>
              <div className="mt-4">
                <Button variant="secondary" onClick={runReview} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Ask Lucas to review
                </Button>
              </div>
            </Card>
          ) : null}

          <Card title="Chat with Lucas" pad={false}>
            <div className="flex max-h-[480px] min-h-48 flex-col gap-4 overflow-y-auto px-5 py-4">
              {!chat.length && streaming === null && (
                <div className="flex flex-col items-start gap-2">
                  <p className="mb-1 text-[14px] text-muted">Ask Lucas about this deal, or start with one of these.</p>
                  {['What should I give up first to close this week?', 'Write a counter on termination that works for a hog-price downturn.', 'How do I explain the liability cap to a farmer?'].map((s) => (
                    <button key={s} type="button" onClick={() => sendChat(s)} className="rounded-[18px] bg-accent-soft px-4 py-2 text-left text-[14px] text-ink transition-colors hover:bg-accent-soft-2">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {chat.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-[18px] bg-accent px-4 py-2.5 text-[14px] leading-relaxed text-on-accent">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="min-w-0 self-start">
                    <Markdownish text={m.content} />
                  </div>
                ),
              )}
              {streaming !== null && (
                <div className="min-w-0 self-start">
                  {streaming ? (
                    <Markdownish text={streaming} />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-muted">
                      <Loader2 size={14} className="animate-spin" aria-hidden /> Lucas is thinking…
                    </span>
                  )}
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="flex gap-2 border-t border-line px-5 pb-3 pt-4"
              onSubmit={(e) => {
                e.preventDefault()
                sendChat(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Lucas about this deal"
                aria-label="Message Lucas"
                className="h-9 min-w-0 flex-1 rounded-full border border-transparent bg-accent-soft px-4 text-[14px] text-ink outline-none transition-colors placeholder:text-muted hover:bg-accent-soft-2 focus:border-line-strong focus:bg-surface"
              />
              <Button type="submit" variant="primary" disabled={streaming !== null} title="Send message">
                <SendHorizonal size={14} aria-hidden />
                <span className="sr-only">Send message</span>
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
