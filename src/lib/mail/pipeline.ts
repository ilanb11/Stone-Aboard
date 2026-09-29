import type { Account, Contract, Opportunity } from '../../types'
import { CLAUSE } from '../../data/contracts'
import { acceptance, emailDomain, fingerprint, FREEMAIL, inlineAnswers, inlinePairs, isAutoReply, liabilityMonths, normEmail, normalize, ourAddress, paymentDays, signatureState, splitQuoted } from './text'
import type { ClauseChange, Confidence, MailExtraction, MailFlag, MailKind, MailMatch, MailMessage, MailProposal, Party } from './types'

// The email-tracking pipeline, run per message in date order:
// dedupe -> direction -> match -> classify and extract (rules) -> propose CRM changes.
// Pure functions over the CRM state; the store runs them and applies the results.

export interface MailCtx {
  accounts: Account[]
  contracts: Contract[]
  opportunities: Opportunity[]
  /** Messages already processed, by Message-ID, for thread continuity and "reply to ours" checks. */
  known: Record<string, { direction: MailExtraction['direction']; match: MailMatch; kind: MailKind }>
  /** Proposals still waiting for a click: later emails can build on them (agree to a redline not yet added). */
  pending?: MailProposal[]
}

const OPEN = ['Prospect', 'Demo', 'Negotiation']

// ---------- forwards ----------

/** The original message inside a forward ("---------- Forwarded message ---------"). */
export function unwrapForward(m: MailMessage): MailMessage | null {
  const t = normalize(m.body)
  const i = t.search(/-{2,}\s*Forwarded message\s*-{2,}/i)
  if (i < 0) return null
  const block = t.slice(i).split('\n').slice(1)
  const head: Record<string, string> = {}
  let k = 0
  for (; k < block.length; k++) {
    const l = block[k]
    const h = l.match(/^(From|Date|Subject|To|Cc):\s*(.*)$/i)
    if (h) head[h[1].toLowerCase()] = h[2]
    else if (!l.trim() && Object.keys(head).length) break
  }
  const from = head.from?.match(/^(.*?)\s*<([^>]+)>/) ?? []
  if (!head.from) return null
  return {
    ...m,
    id: `${m.id}-orig`,
    messageId: '',
    from: { name: from[1]?.trim() || undefined, email: (from[2] ?? head.from).trim() },
    subject: head.subject ?? m.subject.replace(/^fwd?:\s*/i, ''),
    body: block.slice(k + 1).join('\n').trim(),
    source: 'forward',
  }
}

// ---------- direction ----------

export function directionOf(m: MailMessage): MailExtraction['direction'] {
  const recipients = [...m.to, ...m.cc]
  if (ourAddress(m.from.email)) return recipients.every((p) => ourAddress(p.email)) ? 'internal' : 'outbound'
  return 'inbound'
}

// ---------- matching ----------

const TOKEN = /\b(K\d{4}|KD-O[A-Z0-9]+|C-O[A-Z0-9]+|IV-[AG]\d{4}-\d{6}(?:-\d+)?)\b/g

function contractFor(a: Account, ctx: MailCtx, prefer: 'negotiation' | 'active'): Contract | undefined {
  const mine = ctx.contracts.filter((c) => c.accountId === a.id)
  const openDeal = ctx.opportunities.find((o) => o.accountId === a.id && OPEN.includes(o.stage) && o.contractId)
  const neg = (openDeal && mine.find((c) => c.id === openDeal.contractId && (c.status === 'In Negotiation' || c.status === 'Draft'))) ?? mine.find((c) => c.status === 'In Negotiation') ?? mine.find((c) => c.status === 'Draft')
  const active = mine.find((c) => c.id === a.contractId && c.status === 'Active') ?? mine.find((c) => c.status === 'Active')
  return prefer === 'negotiation' ? neg ?? active : active ?? neg
}

/** Mail about an agreement already signed (a renewal, an added site) belongs to the active contract. */
const wantsActive = (m: MailMessage) => /\b(renew|renewal|amend|add(ing)? (a|our|one|another)? ?(site|unit|barn)|second (\w+ )?(site|unit))/i.test(`${m.subject}\n${m.body}\n${m.attachments.map((x) => x.name).join(' ')}`)

function pickFor(a: Account, m: MailMessage, ctx: MailCtx, confidence: Confidence, reason: string, contactId?: string, newContact?: Party): MailMatch {
  const c = contractFor(a, ctx, wantsActive(m) ? 'active' : 'negotiation')
  const opp = ctx.opportunities.find((o) => o.accountId === a.id && OPEN.includes(o.stage)) ?? (c ? ctx.opportunities.find((o) => o.contractId === c.id) : undefined)
  return { accountId: a.id, contactId, contractId: c?.id, opportunityId: opp?.id, confidence, reason, newContact }
}

/** The match a person chose for an email nothing else could link. */
export function linkMatch(accountId: string, m: MailMessage, ctx: MailCtx): MailMatch | null {
  const a = ctx.accounts.find((x) => x.id === accountId)
  if (!a) return null
  const direction = directionOf(m)
  const known = a.contacts.find((x) => normEmail(x.email) === normEmail(m.from.email) || x.altEmails?.some((e) => normEmail(e) === normEmail(m.from.email)))
  return pickFor(a, m, ctx, 'High', 'Linked by you', known?.id, direction === 'inbound' && !known ? m.from : undefined)
}

export function matchMessage(m: MailMessage, ctx: MailCtx, direction: MailExtraction['direction']): MailMatch {
  const byId = Object.fromEntries(ctx.accounts.map((a) => [a.id, a]))
  const customerParties: Party[] = direction === 'inbound' ? [m.from, ...m.cc.filter((p) => !ourAddress(p.email))] : [...m.to, ...m.cc].filter((p) => !ourAddress(p.email))
  const text = `${m.subject}\n${m.body}\n${m.attachments.map((x) => x.name).join(' ')}`
  const pick = (a: Account, confidence: Confidence, reason: string, contactId?: string, newContact?: Party) => pickFor(a, m, ctx, confidence, reason, contactId, newContact)
  // 1. A contract or invoice reference in the new text or the subject.
  const tokens = [...new Set([...text.matchAll(TOKEN)].map((x) => x[1]))]
  for (const tok of tokens) {
    const c = ctx.contracts.find((x) => x.id === tok)
    if (c && byId[c.accountId]) {
      const opp = ctx.opportunities.find((o) => o.contractId === c.id)
      return { accountId: c.accountId, contractId: c.id, opportunityId: opp?.id, confidence: 'High', reason: `Mentions ${tok}` }
    }
  }
  // 2. A known contact's address.
  const isContact = (a: Account, e: string) => a.contacts.find((x) => normEmail(x.email) === normEmail(e) || x.altEmails?.some((y) => normEmail(y) === normEmail(e)))
  for (const p of customerParties) {
    for (const a of ctx.accounts) {
      const ct = isContact(a, p.email)
      if (!ct) continue
      // A known contact on copy, but the sender is new at the farm: link, and propose the sender as a contact.
      const newSender = direction === 'inbound' && p !== m.from && !isContact(a, m.from.email) ? m.from : undefined
      return pick(a, 'High', newSender ? `${ct.name} (${ct.title}) is on copy; ${m.from.name ?? m.from.email} isn't a contact yet` : `From a known contact, ${ct.name} (${ct.title})`, newSender ? undefined : ct.id, newSender)
    }
  }
  // 3. The thread: a reply to (or reference to) a message we already matched.
  for (const ref of [m.inReplyTo, ...(m.references ?? [])].filter(Boolean) as string[]) {
    const k = ctx.known[ref]
    if (k?.match.accountId) {
      const a = byId[k.match.accountId]
      const personal = FREEMAIL.has(emailDomain(m.from.email))
      return { ...k.match, confidence: personal ? 'Medium' : 'High', reason: `Same thread as an earlier ${a?.name ?? ''} email${personal ? ', from a personal address' : ''}`, newContact: direction === 'inbound' && !a?.contacts.some((x) => normEmail(x.email) === normEmail(m.from.email)) ? m.from : undefined }
    }
  }
  // 4. A customer's own domain (unique, not a free-mail provider): probably a new contact there.
  for (const p of customerParties) {
    const dom = emailDomain(p.email)
    if (!dom || FREEMAIL.has(dom)) continue
    const hits = ctx.accounts.filter((a) => a.contacts.some((x) => emailDomain(x.email) === dom))
    if (hits.length === 1) return pick(hits[0], 'Medium', `Same domain as ${hits[0].name} (${dom}); ${p.name ?? p.email} isn't a contact yet`, undefined, p)
  }
  // 5. A personal address whose name matches someone on this rep's negotiations.
  const name = m.from.name?.toLowerCase()
  if (name && FREEMAIL.has(emailDomain(m.from.email))) {
    const negAccounts = ctx.contracts.filter((c) => c.status === 'In Negotiation' && byId[c.accountId]?.rep === m.mailbox).map((c) => byId[c.accountId])
    const hit = negAccounts.find((a) => a.contacts.some((x) => x.name.toLowerCase() === name))
    if (hit) return pick(hit, 'Medium', `Sender's name matches a contact at ${hit.name}; personal address`, undefined, m.from)
  }
  return { confidence: 'Low', reason: 'No contact, contract reference, thread or domain matches' }
}

// ---------- rules extraction ----------

const CLAUSE_WORDS: [string, RegExp][] = [
  ['payment', /\bpayment terms?\b|\bnet[ -]?\d{2}\b|\bdays (of|from|after) (the )?invoice|\bpayable within\b|\bpayment (within|due)\b/i],
  ['liability', /\bliabilit(y|ies)\b|\b(animal|livestock) loss/i],
  ['fees', /\b(price|pricing|fee increase|price adjustments?|escalator|cpi|price cap|most favou?red)\b/i],
  ['term', /\bauto[- ]?renew|\bnon-renewal\b|\binitial term\b|\bterm & renewal\b/i],
  ['termination', /\bterminat(e|ion)\b|\bfor convenience\b/i],
  ['sla', /\buptime\b|\bservice levels?\b|\bsla\b/i],
  ['data', /\b(data ownership|benchmark(ing)?|our data|production data)\b/i],
  ['indemnity', /\bindemni/i],
  ['hardware', /\bwarranty\b|\breplacement devices?\b|\bhardware\b/i],
  ['biosecurity', /\bbiosecurity\b|\bdowntime\b|\bshower|\bsite access\b/i],
  ['assignment', /\bassign(ment)?\b|\bchange of control\b/i],
  ['law', /\bgoverning law\b|\bhome[- ]state\b/i],
]

/** Accepts or refusals written inline, one per quoted point. The quoted line says which clause; the answer gives the value. */
function inlineChanges(pairs: { q: string; a: string }[]): ClauseChange[] {
  const out: ClauseChange[] = []
  for (const { q, a } of pairs) {
    const no = /^(no\b|not\b|we can'?t|can'?t|we need|we'd need|we still need)/i.test(a)
    const yes = !no && (/^(ok|okay|fine|agreed|agree|yes|works|that works|good|accepted|approved|sounds good)\b/i.test(a) || acceptance(a) === 'all')
    if (!yes && !no) continue
    const hit = CLAUSE_WORDS.find(([, re]) => re.test(q)) ?? CLAUSE_WORDS.find(([, re]) => re.test(a))
    if (!hit || out.some((c) => c.clauseId === hit[0])) continue
    const ch: ClauseChange = { clauseId: hit[0], action: no ? 'reject' : 'accept', quote: a }
    if (hit[0] === 'payment') {
      const d = paymentDays(a, 30)
      if (d) ch.value = { field: 'paymentDays', to: d }
    }
    if (hit[0] === 'liability') {
      const mo = liabilityMonths(`liability ${a}`)
      if (mo) ch.value = { field: 'liabilityMonths', to: mo }
    }
    out.push(ch)
  }
  return out
}

/** Sentences of a text, for quoting evidence. */
const sentences = (t: string) =>
  normalize(t)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)

function clauseChanges(text: string, action: ClauseChange['action']): ClauseChange[] {
  const out: ClauseChange[] = []
  for (const s of sentences(text)) {
    for (const [clauseId, re] of CLAUSE_WORDS) {
      if (!re.test(s) || out.some((c) => c.clauseId === clauseId)) continue
      const ch: ClauseChange = { clauseId, action, quote: s }
      if (clauseId === 'payment') {
        const d = paymentDays(s, 30)
        if (d) ch.value = { field: 'paymentDays', to: d }
        if (action === 'ask' && d && d >= 60) ch.libraryKey = 'net-60'
      }
      if (clauseId === 'liability') {
        const mo = liabilityMonths(s)
        if (mo) ch.value = { field: 'liabilityMonths', to: mo }
        if (action === 'ask' && (/\b(3|three)\s*(x|times)\b/i.test(s) || /animal|livestock/i.test(s))) ch.libraryKey = 'liability-3x'
      }
      if (clauseId === 'term' && /no auto|not (to )?auto|without auto/i.test(s)) ch.libraryKey = 'no-auto-renew'
      if (clauseId === 'termination' && /convenience/i.test(s)) ch.libraryKey = 'tfc-30'
      if (clauseId === 'data') ch.libraryKey = 'data-ownership'
      out.push(ch)
    }
  }
  return out
}

/** The one reading of an email the offline rules can make. */
export function extractRules(m: MailMessage, ctx: MailCtx, now = new Date(), hint?: MailMatch): MailExtraction {
  const direction = directionOf(m)
  const match = hint ?? (direction === 'internal' ? internalMatch(m, ctx) : matchMessage(m, ctx, direction))
  const { fresh, quoted, inline } = splitQuoted(m.body)
  const said = inline ? `${fresh}\n${inlineAnswers(quoted)}` : fresh
  const flags = flagsFor(m, said, direction)
  const base = { messageId: m.messageId || m.id, direction, match, by: 'rules' as const, at: now.toISOString(), changes: [] as ClauseChange[], flags: flags.length ? flags : undefined }
  const who = m.from.name ?? m.from.email
  // The first sentence that says something (not "Hi Avery," or "Thanks!").
  const first = sentences(said).find((x) => !/^(hi|hello|hey|dear|good (morning|afternoon)|thanks|thank you)\b[^.!?]{0,30}[,.!]?$/i.test(x)) ?? m.subject

  if (isAutoReply(m.subject, m.body)) return { ...base, kind: 'auto-reply', summary: `Auto-reply from ${who}` }
  if (direction === 'internal') {
    const ok = /\b(approved|ok to|okay to|fine to|go ahead)\b/i.test(said) && !/\bnot approved\b/i.test(said)
    return { ...base, kind: ok && match.accountId ? 'internal-approval' : match.accountId ? 'discussion' : 'unrelated', summary: ok ? `Internal approval from ${who}: ${first}` : `Internal email from ${who}` }
  }
  if (!match.accountId) return { ...base, kind: 'unrelated', summary: `Not matched to an account: ${m.subject}` }

  if (direction === 'outbound') {
    const sent = m.attachments.some((x) => /msa|agreement|contract/i.test(x.name)) || /proposed agreement/i.test(m.subject)
    const counter = /\b(our counter|we can offer|counter-?proposal|we can't|we cannot)\b/i.test(said)
    return { ...base, kind: counter ? 'counter' : sent ? 'contract-sent' : 'discussion', summary: counter ? `Our counter from ${who}` : sent ? `Contract sent by ${who}` : `Email from ${who}`, changes: counter ? clauseChanges(said, 'ask') : [] }
  }

  // Inbound from the customer.
  const toUs = m.to.some((p) => ourAddress(p.email))
  const repliesToUs = (() => {
    const k = m.inReplyTo ? ctx.known[m.inReplyTo] : undefined
    return k ? k.direction === 'outbound' : toUs
  })()
  const signedFile = m.attachments.find((x) => /signed|executed|countersigned/i.test(x.name) || /signatures?:\s*\/s\//i.test(x.text ?? ''))
  const esign = /^completed:/i.test(m.subject) && /docusign|adobesign|echosign|hellosign/i.test(m.from.email)
  // A spoofed notice or an email that tells an assistant to "mark it signed" never counts as a signature on its own.
  const sigBlocked = !!flags.length && (flags.includes('injection') || flags.includes('unverified_sender')) && !signedFile
  const sig = signatureState(`${m.subject}. ${said}`)
  if (((signedFile && sig !== 'intended') || esign) && !sigBlocked) {
    const conf: Confidence = esign || match.confidence !== 'High' ? 'Medium' : 'High'
    return { ...base, match: { ...match, confidence: conf === 'Medium' && match.confidence === 'High' ? 'Medium' : match.confidence }, kind: 'signed', signedAttachment: signedFile?.name ?? m.attachments[0]?.name, summary: `${esign ? 'E-signature completed' : 'Signed copy'} from ${who}${signedFile ? ` (${signedFile.name})` : ''}` }
  }
  const customerPaper = m.attachments.some((x) => x.kind === 'docx' || x.kind === 'pdf') && /\b(our (standard )?(vendor )?agreement|our paper|our contract)\b/i.test(said)
  if (customerPaper) return { ...base, kind: 'redlines', summary: `${who} sent their own paper (${m.attachments[0]?.name}) and wants to go ahead`, changes: clauseChanges(`${said}\n${m.attachments.map((x) => x.text ?? '').join('\n')}`, 'ask') }
  const contract = match.contractId ? ctx.contracts.find((c) => c.id === match.contractId) : undefined
  if (contract?.status === 'Active' && /\b(add(ing)?|another|second|more)\b[^.]{0,40}\b(site|unit|barns?|sensors?)\b/i.test(said)) return { ...base, kind: 'amendment', summary: `${who} wants to add to the agreement: ${first}` }
  if (contract?.status === 'Active' && /\b(renew(al)?|renegotiate)\b/i.test(said)) return { ...base, kind: 'renewal', summary: `${who} on the renewal: ${first}` }
  const acc = acceptance(said)
  if (acc !== 'none' && repliesToUs) {
    const pairs = inline ? inlineChanges(inlinePairs(quoted)).filter((c) => c.action === 'accept') : []
    const changes = [...pairs, ...clauseChanges(said, 'accept').filter((c) => !pairs.some((p) => p.clauseId === c.clauseId))]
    if (/send the final|we'?ll sign|ready to sign|move forward|go ahead/i.test(said) && !changes.length) return { ...base, kind: 'verbal-yes', summary: `Verbal yes from ${who}: ${first}` }
    return { ...base, kind: 'acceptance', summary: `${who} ${acc === 'partial' ? 'accepted part of' : 'accepted'} our position${changes.length ? ` on ${changes.map((c) => CLAUSE[c.clauseId]?.title).join(', ')}` : ''}`, changes }
  }
  if (acc !== 'none' && !repliesToUs) return { ...base, kind: 'discussion', summary: `${who} agreed with a colleague (not with our terms): ${first}` }
  const asks = clauseChanges(`${said}\n${m.attachments.map((x) => x.text ?? '').join('\n')}`, 'ask')
  if (asks.length && /\b(need|want|require|change|instead|must|ask|propose|markup|redline)/i.test(said)) return { ...base, kind: 'redlines', summary: `${who} asked for ${asks.length} ${asks.length === 1 ? 'change' : 'changes'}: ${asks.map((c) => CLAUSE[c.clauseId]?.title).join(', ')}`, changes: asks }
  if (/send (me|us) the (contract|agreement|paperwork|final)|where('s| is) the (contract|agreement)/i.test(said)) return { ...base, kind: 'contract-request', summary: `${who} asked for the contract` }
  if (/\?/.test(said)) return { ...base, kind: 'question', summary: `Question from ${who}: ${first}`, changes: clauseChanges(said, 'ask').map((c) => ({ ...c, action: 'ask' as const })).slice(0, 0) }
  return { ...base, kind: 'discussion', summary: `Email from ${who}: ${first}` }
}

/** Text aimed at an assistant ("AI: mark this signed") is data, never an instruction. */
export const INJECTION = /\b(assistant|ai|system|crm|lucas)\b[^.\n]{0,40}\b(mark|record|set|approve|ignore|disregard|update)\b/i

function flagsFor(m: MailMessage, said: string, direction: MailExtraction['direction']): MailFlag[] {
  const out: MailFlag[] = []
  const all = `${said}\n${m.attachments.map((x) => x.text ?? '').join('\n')}`
  if (direction !== 'internal' && INJECTION.test(all)) out.push('injection')
  if (/\b(attached|attachment|enclosed|see the file)\b/i.test(said) && !m.attachments.length) out.push('missing_attachment')
  // E-sign notices are easy to spoof: only the service's own domain counts, and even then a person confirms.
  if (/^completed:/i.test(m.subject) && !/@(docusign\.net|echosign\.com|adobesign\.com|hellosign\.com)$/i.test(m.from.email)) out.push('unverified_sender')
  if (direction === 'inbound' && /\b(uncapped|unlimited liability|without limitation|livestock (mortality|loss)|lose animals|animal loss(es)?|for convenience on thirty)\b/i.test(all)) out.push('walk_away')
  return out
}

/** A forward the rep sent to themselves "for the file" adds nothing beyond the message inside it. */
export function trivialForward(m: MailMessage): boolean {
  const own = splitQuoted(m.body).fresh.replace(/[\s.!-]+/g, ' ').trim()
  const toSelf = [...m.to, ...m.cc].every((p) => normEmail(p.email) === normEmail(m.from.email))
  return own.length < 40 && (toSelf || /^(fyi|for the file|see below|fwd?)?$/i.test(own))
}

/** Internal mail joins a deal only through a contract reference or a forwarded customer email. */
function internalMatch(m: MailMessage, ctx: MailCtx): MailMatch {
  const fwd = unwrapForward(m)
  if (fwd) return matchMessage(fwd, ctx, 'inbound')
  for (const ref of [m.inReplyTo, ...(m.references ?? [])].filter(Boolean) as string[]) {
    const k = ctx.known[ref]
    if (k?.match.accountId) return { ...k.match, reason: 'Internal reply on a deal thread' }
  }
  return { confidence: 'Low', reason: 'Internal email with no deal reference' }
}

// ---------- proposals ----------

const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Every CRM change one email calls for. Safe ones are marked auto. */
export function proposalsFor(m: MailMessage, x: MailExtraction, ctx: MailCtx, now = new Date()): MailProposal[] {
  const out: MailProposal[] = []
  const acct = x.match.accountId ? ctx.accounts.find((a) => a.id === x.match.accountId) : undefined
  if (!acct || x.kind === 'unrelated' || x.kind === 'auto-reply') return out
  const contract = x.match.contractId ? ctx.contracts.find((c) => c.id === x.match.contractId) : undefined
  const opp = x.match.opportunityId ? ctx.opportunities.find((o) => o.id === x.match.opportunityId) : undefined
  const mid = m.messageId || m.id
  const p = (kind: MailProposal['kind'], key: string, title: string, detail: string, payload: Record<string, unknown>, opts: Partial<MailProposal> = {}): MailProposal => {
    const prop: MailProposal = { id: `MP-${hash(key)}`, key, messageId: mid, kind, accountId: acct.id, contractId: contract?.id, opportunityId: opp?.id, title, detail, payload, confidence: x.match.confidence, auto: false, status: 'Proposed', createdAt: now.toISOString(), ...opts }
    out.push(prop)
    return prop
  }
  // Link and log: safe, and the only thing that happens without a click. The text is a template, not the model's summary.
  const verb = x.direction === 'inbound' ? `Email from ${m.from.name ?? m.from.email}` : x.direction === 'outbound' ? `Email to ${m.to.map((t) => t.name ?? t.email).join(', ')}` : 'Internal email'
  const link = p('log-activity', `log|${mid}`, `Log on ${acct.name}`, `${verb}: "${m.subject}"`, { accountId: acct.id, activityKind: x.kind === 'internal-approval' ? 'Contract' : 'Email', text: `${verb}: "${m.subject}"${x.kind === 'internal-approval' ? ` (${x.summary})` : ''}`, inbound: x.direction === 'inbound', date: m.date }, { auto: x.match.confidence === 'High', title: x.match.confidence === 'High' ? `Logged on ${acct.name}` : `Link to ${acct.name}?`, detail: x.match.confidence === 'High' ? `${verb}: "${m.subject}"` : `${x.match.reason}. Confirm the link first; nothing else on this email applies until then.` })
  const needsLink = link.auto ? undefined : [link.id]
  // People the customer copies in from their own domain ("looping in our new CFO") are new contacts too.
  const accountDomains = new Set(acct.contacts.map((c) => emailDomain(c.email)).filter((d) => d && !FREEMAIL.has(d)))
  const newcomers: Party[] = x.direction === 'inbound' ? [...m.to, ...m.cc].filter((q) => !ourAddress(q.email) && accountDomains.has(emailDomain(q.email)) && !acct.contacts.some((c) => normEmail(c.email) === normEmail(q.email) || c.altEmails?.some((e) => normEmail(e) === normEmail(q.email)))) : []
  for (const nc of [...(x.match.newContact ? [x.match.newContact] : []), ...newcomers].filter((q, i, all) => all.findIndex((z) => normEmail(z.email) === normEmail(q.email)) === i)) {
    if (x.direction !== 'inbound') break
    const personal = FREEMAIL.has(emailDomain(nc.email))
    const existing = acct.contacts.find((c) => c.name.toLowerCase() === (nc.name ?? '').toLowerCase())
    // The same person may already be waiting to be added from an earlier email.
    const pendingPerson = !existing ? ctx.pending?.find((q) => q.kind === 'add-contact' && q.status === 'Proposed' && q.accountId === acct.id && q.payload.email && String(q.payload.name ?? '').toLowerCase() === (nc.name ?? '').toLowerCase()) : undefined
    // The role named next to the person ("Dana Whitfield, our new CFO"), or in the sender's own signature.
    const near = (() => {
      const t = normalize(m.body)
      const i = nc.name ? t.indexOf(nc.name) : -1
      return i >= 0 ? t.slice(Math.max(0, i - 60), i + nc.name!.length + 60) : normEmail(nc.email) === normEmail(m.from.email) ? t.slice(-200) : ''
    })()
    const role = /\bcfo\b|chief financial/i.test(near) ? 'CFO' : /\bgm\b|general manager/i.test(near) ? 'GM' : /\bowner\b/i.test(near) ? 'Owner' : 'Operations'
    if (pendingPerson) {
      if (normEmail(String(pendingPerson.payload.email)) !== normEmail(nc.email)) p('add-contact', `altemail|${acct.id}|${normEmail(nc.email)}`, `Add ${nc.email} as ${nc.name}'s ${personal ? 'personal' : 'other'} address`, `So future emails from it match ${acct.name}. Applies after ${nc.name} is added as a contact.`, { accountId: acct.id, contactName: nc.name, altEmail: nc.email }, { dependsOn: [...(needsLink ?? []), pendingPerson.id] })
    } else if (existing && personal) p('add-contact', `altemail|${acct.id}|${normEmail(nc.email)}`, `Add ${nc.email} as ${existing.name}'s personal address`, `So future emails from it match ${acct.name}. It won't be used for marketing.`, { accountId: acct.id, contactId: existing.id, contactName: existing.name, altEmail: nc.email }, { dependsOn: needsLink })
    else if (!existing) p('add-contact', `contact|${acct.id}|${normEmail(nc.email)}`, `Add ${nc.name ?? nc.email} as a contact${role !== 'Operations' ? ` (${role})` : ''}`, `${nc.email} ${personal ? '(personal address)' : `at ${emailDomain(nc.email)}`}`, { accountId: acct.id, name: nc.name ?? nc.email, email: nc.email, role, title: role === 'CFO' ? 'Chief Financial Officer' : role === 'GM' ? 'General Manager' : role === 'Owner' ? 'Owner' : 'Contact' }, { dependsOn: needsLink })
  }
  if (x.kind === 'internal-approval' && contract) p('note', `note|${mid}`, `Record the approval on ${contract.id}`, x.summary, { accountId: acct.id, text: `Internal approval on ${contract.id}: ${x.summary.replace(/^Internal approval from [^:]+: /, '')}` }, { auto: x.match.confidence === 'High' })
  if (x.kind === 'redlines' && contract && (contract.status === 'In Negotiation' || contract.status === 'Draft')) {
    for (const ch of x.changes) {
      const open = contract.redlines.find((r) => r.clauseId === ch.clauseId && !r.agreed && (!ch.libraryKey || r.key === ch.libraryKey))
      const v = ch.value ? ` (${ch.value.field === 'paymentDays' ? `Net ${ch.value.to}` : ch.value.field === 'liabilityMonths' ? `${ch.value.to} months of fees` : String(ch.value.to)})` : ''
      if (open) p('note', `seen|${contract.id}|${ch.clauseId}|${mid}`, `Already tracked: ${CLAUSE[ch.clauseId]?.title}`, `The customer repeated an ask that is already an open redline on ${contract.id}.`, { accountId: acct.id, text: `${CLAUSE[ch.clauseId]?.title}: customer repeated the ask${v}.` }, { auto: true })
      else p('add-redline', `redline|${contract.id}|${ch.clauseId}|${ch.value ? `${ch.value.field}=${ch.value.to}` : hash(ch.quote)}`, `Add redline: ${CLAUSE[ch.clauseId]?.number}. ${CLAUSE[ch.clauseId]?.title}${v}`, `“${ch.quote}”`, { contractId: contract.id, clauseId: ch.clauseId, libraryKey: ch.libraryKey, quote: ch.quote, value: ch.value }, { dependsOn: needsLink })
    }
  }
  if (x.kind === 'redlines' && opp && opp.stage !== 'Negotiation' && OPEN.includes(opp.stage) && !contract) {
    p('move-stage', `paper|${opp.id}`, `Start negotiating on ${acct.name}'s paper`, `Moves the ${opp.type} deal to Negotiation and records their document (${m.attachments[0]?.name ?? 'attached'}) for legal review. Lucas won't draft our MSA.`, { opportunityId: opp.id, to: 'Negotiation', external: true, document: m.attachments[0]?.name, text: m.attachments[0]?.text, changes: x.changes }, { single: true, dependsOn: needsLink })
  }
  if (x.kind === 'acceptance' && contract) {
    for (const ch of x.changes) {
      const r = contract.redlines.find((y) => y.clauseId === ch.clauseId && !y.agreed)
      // The ask may still be waiting to be added from an earlier email: agree to it once it is.
      const pend = r ? undefined : ctx.pending?.find((q) => q.kind === 'add-redline' && q.status === 'Proposed' && q.payload.contractId === contract.id && q.payload.clauseId === ch.clauseId)
      if (!r && !pend) continue
      const v = ch.value?.field === 'paymentDays' ? `Net ${ch.value.to}` : ch.value?.field === 'liabilityMonths' ? `${ch.value.to} months of fees` : 'our counter'
      p('agree-redline', `agree|${contract.id}|${ch.clauseId}`, `Mark agreed: ${CLAUSE[ch.clauseId]?.title} at ${v}`, `“${ch.quote}”`, { contractId: contract.id, redlineId: r?.id, clauseId: ch.clauseId, value: ch.value, valueLabel: v, quote: ch.quote }, { dependsOn: [...(needsLink ?? []), ...(pend ? [pend.id] : [])] })
    }
  }
  if (x.kind === 'verbal-yes' && contract) p('draft-reply', `final|${contract.id}`, 'Draft the execution copy email', `${m.from.name ?? 'The customer'} said to send the final. Drafts the email with the agreed terms for you to approve.`, { accountId: acct.id, contractId: contract.id, to: m.from, cc: m.cc.filter((c) => !ourAddress(c.email)), purpose: 'final' }, { dependsOn: needsLink })
  if (x.kind === 'signed' && contract && contract.status !== 'Active') {
    p('mark-signed', `signed|${contract.id}`, `Mark ${contract.id} signed`, `${x.summary}. Confirming closes the deal as won, activates the contract and stores the signed copy.${x.match.confidence !== 'High' ? ' Check the file first: it came from an address or sender we can’t verify.' : ''}`, { contractId: contract.id, signedAt: m.date, file: x.signedAttachment, from: m.from }, { single: true, dependsOn: needsLink })
  }
  if (x.kind === 'amendment' && contract) p('amendment', `amend|${acct.id}|${mid}`, `Open an amendment for ${acct.name}`, `Creates an Expansion deal at Negotiation for the added site (${x.summary.replace(/^.+?: /, '')}). It amends ${contract.id}; Lucas won't draft a new MSA.`, { accountId: acct.id, contractId: contract.id, note: x.summary, text: splitQuoted(m.body).fresh }, { dependsOn: needsLink })
  if (x.kind === 'renewal' && contract) p('note', `renewal|${acct.id}|${mid}`, 'Flag the renewal as at risk', `${x.summary}. Adds a note and a follow-up on the renewal.`, { accountId: acct.id, text: `Renewal risk: ${x.summary}`, followUp: 'renewal' }, { dependsOn: needsLink })
  if ((x.kind === 'question' || x.kind === 'contract-request') && contract) p('draft-reply', `${x.kind}|${mid}`, x.kind === 'question' ? 'Draft an answer' : 'Resend the current version', x.kind === 'question' ? `${x.summary}. Drafts a reply for you to finish and approve.` : `Drafts an email with the latest version of ${contract.id} for you to approve.`, { accountId: acct.id, contractId: contract.id, to: m.from, cc: m.cc.filter((c) => !ourAddress(c.email)), purpose: x.kind, question: x.summary }, { dependsOn: needsLink })
  return out
}

/** Dedupe keys for a message as it arrived: its Message-ID and a fingerprint of what the sender wrote in it. A forwarded message inside has its own keys (unwrapForward, then dedupeKeys). */
export function dedupeKeys(m: MailMessage): string[] {
  const keys = [fingerprint({ from: m.from, subject: m.subject, text: splitQuoted(m.body).fresh, attachments: m.attachments })]
  if (m.messageId) keys.push(`mid:${m.messageId}`)
  return keys
}

export { fingerprint }
