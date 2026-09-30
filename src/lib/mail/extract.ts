import type { Contract } from '../../types'
import { CLAUSE, REDLINE_BY_KEY } from '../../data/contracts'
import { lucasStatus } from '../lucas'
import type { RedlineDecision } from '../../store'
import type { MailCtx } from './pipeline'
import { INJECTION, unwrapForward } from './pipeline'
import { inlinePairs, normalize, ourAddress, signatureState, splitQuoted } from './text'
import type { AiMail } from './schema'
import type { ClauseChange, MailExtraction, MailFlag, MailKind, MailMessage } from './types'

// Claude reads an email the rules already read. The CRM decides the account link; Claude
// reports what the email says. Every item must quote the email (or its attachment) word for
// word, and items whose quote isn't there are dropped: that is what stops an invented or
// injected change from reaching a contract. Offline, or on any error, the rules result stands.

const esc = (t: string) => t.replace(/<\//g, '<\\/')
const flat = (t: string) => normalize(t).replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase()

function repliesTo(m: MailMessage, ctx: MailCtx) {
  const k = m.inReplyTo ? ctx.known[m.inReplyTo] : undefined
  if (!k) return 'unknown'
  return k.direction === 'outbound' ? 'our message' : k.direction === 'internal' ? 'internal message' : 'customer message'
}

function contractContext(c: Contract, decisions: Record<string, RedlineDecision> | undefined) {
  return {
    paper: c.template.startsWith('Customer paper') ? 'customer' : 'ours',
    status: c.status,
    terms: { termMonths: c.termMonths, start: c.start.slice(0, 10), end: c.end.slice(0, 10), paymentTerms: c.paymentTerms, autoRenew: c.autoRenew, renewalNoticeDays: c.renewalNoticeDays, price: c.price, mfn: c.mfn, assignmentOnChangeOfControl: c.assignmentOnChangeOfControl },
    orderForm: (c.orderForm ?? []).map((l) => ({ productId: l.productId, units: l.units, unitPrice: l.unitPrice })),
    open_asks: c.redlines.filter((r) => !r.agreed).map((r) => ({ redlineId: r.id, clauseId: r.clauseId, customerText: r.proposed, ourDecision: decisions?.[r.id]?.decision ?? 'Pending', ourSentLanguage: decisions?.[r.id]?.language ?? '' })),
    agreed: c.redlines.filter((r) => r.agreed).map((r) => ({ clauseId: r.clauseId, agreedText: r.agreed!.value ?? decisions?.[r.id]?.language ?? r.proposed })),
  }
}

/** The user turn: the mailbox, what the CRM knows, then the email split into new text, inline answers, quotes and attachments. */
export function buildMailUserTurn(m: MailMessage, x: MailExtraction, ctx: MailCtx, decisions: Record<string, Record<string, RedlineDecision>>): string {
  const a = x.match.accountId ? ctx.accounts.find((y) => y.id === x.match.accountId) : undefined
  const deals = a ? ctx.opportunities.filter((o) => o.accountId === a.id && (['Prospect', 'Demo', 'Negotiation'].includes(o.stage) || o.contractId === a.contractId)) : []
  const contracts = a ? ctx.contracts.filter((c) => c.accountId === a.id && (c.status === 'In Negotiation' || c.status === 'Draft' || c.status === 'Active')) : []
  const crm = a
    ? {
        account: { name: a.name, species: a.species, segment: a.segment, location: `${a.county} County, ${a.state}`, status: a.status, parentCompany: a.parentCompany ?? '', integrator: a.integrator ?? '' },
        known_contacts: a.contacts.map((c) => ({ name: c.name, title: c.title, role: c.role, email: c.email, altEmails: c.altEmails ?? [] })),
        candidate_deals: deals.map((o) => ({ dealRef: `${o.id}${o.contractId ? `/${o.contractId}` : ''}`, type: o.type, stage: o.stage, closeDate: o.closeDate.slice(0, 10), contractStatus: contracts.find((c) => c.id === o.contractId)?.status ?? 'none' })),
        contracts: Object.fromEntries(contracts.map((c) => [c.id, contractContext(c, decisions[c.id])])),
      }
    : { account: null, note: 'Not linked to an account yet.' }
  const { fresh, quoted, inline } = splitQuoted(m.body)
  const fwd = unwrapForward(m)
  const who = (p: { name?: string; email: string }) => (p.name ? `${p.name} <${p.email}>` : p.email)
  const attrs = `direction="${x.direction}" replies_to="${repliesTo(m, ctx)}" date="${m.date}" from="${who(m.from)}" to="${m.to.map(who).join(', ')}" cc="${m.cc.map(who).join(', ')}" subject="${m.subject.replace(/"/g, "'")}"`
  return [
    `<mailbox owner="${m.mailbox}" />`,
    `<crm_context as_of="${m.date}">\n${JSON.stringify(crm)}\n</crm_context>`,
    `<email ${attrs}>`,
    `<new_text>\n${esc(fresh)}\n</new_text>`,
    inline ? `<inline_replies>\n${esc(inlinePairs(quoted).map((p) => `> ${p.q}\n${p.a}`).join('\n'))}\n</inline_replies>` : '',
    quoted && !fwd ? `<quoted_history>\n${esc(quoted.slice(0, 4000))}\n</quoted_history>` : '',
    fwd ? `<forwarded from="${who(fwd.from)}" subject="${fwd.subject.replace(/"/g, "'")}" unseen="false">\n${esc(fwd.body.slice(0, 6000))}\n</forwarded>` : '',
    '</email>',
    m.attachments.length ? `<attachments>\n${m.attachments.map((f) => `<attachment name="${f.name}" kind="${f.kind}" text_source="${f.text ? 'pdf-text' : 'none'}">\n${esc(f.text ?? '(no readable text)')}\n</attachment>`).join('\n')}\n</attachments>` : '<attachments />',
    'Report what this email means for the deal, as JSON.',
  ]
    .filter(Boolean)
    .join('\n')
}

const num = (s: string | undefined, lo: number, hi: number) => {
  const n = Number(s)
  return s && Number.isFinite(n) && n >= lo && n <= hi ? n : null
}

function valueOf(v: Record<string, string>): ClauseChange['value'] | undefined {
  const pay = num(v.paymentNetDays, 0, 180)
  if (pay !== null) return { field: 'paymentDays', to: pay }
  const mo = num(v.liabilityCapMonthsOfFees, 1, 120)
  if (mo !== null) return { field: 'liabilityMonths', to: mo }
  const mult = num(v.liabilityMultipleOfFees, 0.5, 10)
  if (mult !== null) return { field: 'liabilityMonths', to: Math.round(mult * 12) }
  const term = num(v.termMonths, 1, 120)
  if (term !== null) return { field: 'termMonths', to: term }
  const notice = num(v.renewalNoticeDays, 0, 365)
  if (notice !== null) return { field: 'renewalNoticeDays', to: notice }
  const cap = num(v.priceCapPct, 0, 25)
  if (cap !== null) return { field: 'capPct', to: cap }
  if (v.autoRenew === 'true' || v.autoRenew === 'false') return { field: 'autoRenew', to: v.autoRenew === 'true' }
  return undefined
}

/** Turn Claude's report into the same reading the rules produce, keeping only what the email itself says. */
export function fromAi(ai: AiMail, m: MailMessage, rules: MailExtraction, ctx: MailCtx, model: string): MailExtraction {
  const { fresh, quoted, inline } = splitQuoted(m.body)
  const fwd = unwrapForward(m)
  const sources = [fresh, inline ? inlinePairs(quoted).map((p) => p.a).join('\n') : '', fwd?.body ?? '', ...m.attachments.map((f) => f.text ?? '')].map(flat)
  const warnings = [...(ai.warnings ?? [])]
  const found = (quotes: string[] | undefined, what: string) => {
    const q = quotes?.find((x) => x && sources.some((s) => s.includes(flat(x))))
    if (!q && quotes?.length) warnings.push(`Dropped "${what}": its quote isn't in the email.`)
    return q
  }
  const contract = rules.match.contractId ? ctx.contracts.find((c) => c.id === rules.match.contractId) : undefined
  const toUs = repliesTo(m, ctx) === 'our message' || (repliesTo(m, ctx) === 'unknown' && m.to.some((p) => ourAddress(p.email)))

  const changes: ClauseChange[] = []
  for (const c of ai.changes ?? []) {
    if (!CLAUSE[c.clauseId] || c.action === 'withdraws_ask' || c.action === 'question_only') continue
    const quote = found(c.quotes, c.summary || CLAUSE[c.clauseId].title)
    if (!quote) continue
    const action: ClauseChange['action'] = c.action === 'accepts_counter' || c.action === 'our_accept' ? 'accept' : c.action === 'rejects_counter' || c.action === 'our_reject' ? 'reject' : 'ask'
    // Agreement to our position counts only when the email answers us, not a colleague.
    if (action === 'accept' && !toUs) continue
    changes.push({ clauseId: c.clauseId, action, libraryKey: REDLINE_BY_KEY[c.libraryKey]?.clauseId === c.clauseId ? c.libraryKey : undefined, proposed: c.proposedText || undefined, value: valueOf(c.values ?? {}), quote })
  }
  // "We're good with everything": every open point on the contract, less the exceptions.
  if (ai.acceptance?.scope === 'all_open' && toUs && contract) {
    const quote = found(ai.acceptance.quotes, 'acceptance')
    if (quote) for (const r of contract.redlines) if (!r.agreed && !ai.acceptance.exceptClauseIds.includes(r.clauseId) && !changes.some((c) => c.clauseId === r.clauseId)) changes.push({ clauseId: r.clauseId, action: 'accept', quote })
  }

  const sig = ai.signature?.status ?? 'none'
  const sigQuote = sig !== 'none' ? found(ai.signature.quotes, 'signature') : undefined
  // A signature needs something to hold: a file (or e-sign notice) the rules also saw, or an attachment whose quoted block reads as signed.
  const claimed = (sig === 'signed_by_customer' || sig === 'fully_executed' || sig === 'possibly_signed') && !!sigQuote
  const signed = claimed && (rules.kind === 'signed' || (m.attachments.length > 0 && signatureState(sigQuote!) === 'signed'))
  if (claimed && !signed) warnings.push("Claude read this as signed, but there's no signed file or e-sign notice to back it. Nothing is marked signed; ask for the signed copy.")
  const accepts = changes.filter((c) => c.action === 'accept')
  const asks = changes.filter((c) => c.action === 'ask')
  const byIntent: Partial<Record<AiMail['intent'], MailKind>> = { amendment: 'amendment', contract_sent: 'contract-sent', contract_request: 'contract-request', question: 'question', internal_approval: 'internal-approval', auto_reply: 'auto-reply', unrelated: 'unrelated' }
  let kind: MailKind =
    !ai.contractRelated ? (rules.kind === 'auto-reply' ? 'auto-reply' : 'unrelated')
    : signed ? 'signed'
    : rules.direction === 'outbound' ? (ai.intent === 'counter' ? 'counter' : ai.intent === 'contract_sent' ? 'contract-sent' : 'discussion')
    : ai.intent === 'notice' && ai.notices?.some((n) => n.kind === 'non_renewal' || n.kind === 'termination') ? 'renewal'
    : accepts.length && !asks.length ? 'acceptance'
    : asks.length ? 'redlines'
    : ai.intent === 'verbal_accept' || sig === 'intended' || sig === 'requested' ? (toUs ? 'verbal-yes' : 'discussion')
    : byIntent[ai.intent] ?? 'discussion'
  if (rules.direction === 'internal') kind = ai.internalApproval?.given && found(ai.internalApproval.quotes, 'approval') ? 'internal-approval' : rules.match.accountId ? 'discussion' : 'unrelated'

  // A new person Claude found, when the rules didn't: never one of our own addresses.
  const known = rules.match.accountId ? ctx.accounts.find((a) => a.id === rules.match.accountId)?.contacts ?? [] : []
  const person = ai.people?.find((p) => p.email && !ourAddress(p.email) && !known.some((k) => k.email.toLowerCase() === p.email.toLowerCase() || k.altEmails?.includes(p.email)) && found(p.quotes, p.name))
  const flags = new Set<MailFlag>(rules.flags ?? [])
  if (ai.containsInstructionsToAssistant || INJECTION.test(fresh)) flags.add('injection')
  if (ai.missingAttachment) flags.add('missing_attachment')
  return {
    ...rules,
    kind,
    by: 'ai',
    at: new Date().toISOString(),
    summary: ai.summary || rules.summary,
    changes: kind === 'redlines' ? asks : kind === 'acceptance' ? accepts : kind === 'counter' ? changes : [],
    signedAttachment: signed ? ai.signature.attachmentName || rules.signedAttachment || m.attachments[0]?.name : undefined,
    // A signature only Claude saw (no signed file name, no e-sign notice) is never High.
    match: { ...rules.match, confidence: signed && rules.kind !== 'signed' && rules.match.confidence === 'High' ? 'Medium' : rules.match.confidence, newContact: rules.match.newContact ?? (person ? { name: person.name || undefined, email: person.email } : undefined) },
    flags: flags.size ? [...flags] : undefined,
    warnings: warnings.length ? warnings : undefined,
    model,
  }
}

/** Ask Claude to read one email. Falls back to the rules result, with the reason. */
export async function aiReadMail(m: MailMessage, rules: MailExtraction, ctx: MailCtx, decisions: Record<string, Record<string, RedlineDecision>>): Promise<{ x: MailExtraction; error?: string }> {
  const st = await lucasStatus()
  if (!st.ai) return { x: rules, error: st.error ?? 'Claude is offline; read by playbook rules.' }
  try {
    const r = await fetch('/api/lucas/mail/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: buildMailUserTurn(m, rules, ctx, decisions) }) })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`)
    return { x: fromAi(json.data as AiMail, m, rules, ctx, String(json.model ?? 'claude')) }
  } catch (e) {
    return { x: rules, error: e instanceof Error ? e.message : String(e) }
  }
}
