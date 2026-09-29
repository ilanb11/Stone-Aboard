import type { Contact, Contract, Opportunity, Redline } from '../../types'
import type { CrmState } from '../../store'
import { CLAUSE, REDLINE_BY_KEY, renderClause } from '../../data/contracts'
import { PRODUCT, PRODUCTS, unitsFor } from '../../data/products'
import { expectedDiscount } from '../pricing'
import { dedupeKeys, extractRules, linkMatch, proposalsFor, trivialForward, unwrapForward, type MailCtx } from './pipeline'
import { demoEsign, demoMailbox, repEmail, type DemoData } from './demo'
import { normalize, normEmail, splitQuoted } from './text'
import type { ClauseChange, MailAttachment, MailExtraction, MailMatch, MailMessage, MailProposal, Party } from './types'

// Email tracking in the CRM store: connected mailboxes, every message read (with what the
// rules or Claude made of it), the CRM changes each one calls for, and signed copies.
// Only safe proposals apply on their own (logging a High-confidence email, recording an
// internal approval). Everything else waits for a rep, and nothing here ever sends email.

export interface Mailbox {
  owner: string
  address: string
  provider: 'Gmail' | 'Outlook'
  connectedAt: string
  lastSync?: string
}

export interface MailRecord {
  id: string
  msg: MailMessage
  x: MailExtraction
  /** Message-ID and content fingerprints: the same email synced twice, forwarded or pasted is one record. */
  keys: string[]
  /** Mailboxes it arrived in (a message cc'd to two reps is read once). */
  seenIn: string[]
  /** 'auto': matched with high confidence. 'confirmed': a rep linked or confirmed it. */
  linked?: 'auto' | 'confirmed'
  ingestedAt: string
}

export interface SignedCopy {
  contractId: string
  file: string
  from: string
  receivedAt: string
  recordId: string
  confirmedBy: string
  confirmedAt: string
}

export interface MailSlice {
  mailboxes: Record<string, Mailbox>
  mailRecords: MailRecord[]
  mailProposals: MailProposal[]
  signedCopies: Record<string, SignedCopy>
  connectMailbox: (owner: string, provider: Mailbox['provider']) => { added: number; proposals: number }
  disconnectMailbox: (owner: string) => void
  syncMailbox: (owner: string) => { added: number; proposals: number }
  /** Paste or forward an email by hand. Returns the record it landed in, or why it didn't. */
  ingestPasted: (raw: string, attachment?: { name: string; text: string }) => { status: 'added' | 'duplicate' | 'invalid'; recordId?: string; error?: string }
  linkRecord: (recordId: string, accountId: string) => void
  applyProposal: (id: string) => string | null
  dismissProposal: (id: string) => void
  applyAllSafe: (accountId?: string) => number
  /** Replace a message's reading (Claude re-read it). Pending proposals from it are replaced; applied ones stay. */
  replaceExtraction: (recordId: string, x: MailExtraction) => number
}

export const initialMail = () => ({
  mailboxes: {} as Record<string, Mailbox>,
  mailRecords: [] as MailRecord[],
  mailProposals: [] as MailProposal[],
  signedCopies: {} as Record<string, SignedCopy>,
})

type Set = (p: Partial<CrmState> | ((s: CrmState) => Partial<CrmState>)) => void

const DAY = 86400000
const now = () => new Date().toISOString()
const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export const recordKey = (m: MailMessage) => m.messageId || m.id
/** Proposals that can't apply yet: another step has to go first. */
export const blockedBy = (p: MailProposal, all: MailProposal[]) => (p.dependsOn ?? []).map((d) => all.find((q) => q.id === d)).filter((q): q is MailProposal => !!q && q.status !== 'Applied')
/** Waiting for a rep: proposed, not automatic. */
export const needsReview = (p: MailProposal) => p.status === 'Proposed'

// ---------- pasted mail ----------

function parseParty(s: string): Party | null {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || undefined, email: m[2].trim() }
  const e = s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)
  return e ? { email: e[0] } : null
}
const parseList = (s?: string) => (s ? s.split(/[,;](?![^<]*>)/).map(parseParty).filter((p): p is Party => !!p) : [])

const kindOf = (name: string): MailAttachment['kind'] => (/\.pdf$/i.test(name) ? 'pdf' : /\.docx?$/i.test(name) ? 'docx' : /\.(png|jpe?g|heic|gif)$/i.test(name) ? 'image' : 'other')

/** A pasted email: optional header lines (From, To, Cc, Subject, Date), then the body. A pasted forward is from the rep. */
export function parsePasted(raw: string, rep: string, attachment?: { name: string; text: string }): MailMessage | null {
  const t = normalize(raw).trim()
  if (!t) return null
  const lines = t.split('\n')
  const head: Record<string, string> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const h = lines[i].match(/^(From|To|Cc|Subject|Date|Sent|Message-ID|In-Reply-To):\s*(.*)$/i)
    if (h) head[h[1].toLowerCase()] = h[2].trim()
    else break
  }
  const body = lines.slice(i).join('\n').trim()
  const me: Party = { name: rep, email: repEmail(rep) }
  const forwarded = /-{2,}\s*Forwarded message/i.test(body)
  const from = head.from ? parseParty(head.from) : forwarded ? me : null
  if (!from || !body) return null
  const when = Date.parse(head.date ?? head.sent ?? '')
  const files: MailAttachment[] = attachment?.name.trim() ? [{ name: attachment.name.trim(), kind: kindOf(attachment.name), text: attachment.text.trim() || undefined }] : []
  return {
    id: `MM-P${hash(t + (attachment?.name ?? ''))}`,
    messageId: head['message-id']?.replace(/^<?/, '<').replace(/>?$/, '>') ?? '',
    inReplyTo: head['in-reply-to'] || undefined,
    mailbox: rep,
    from,
    to: parseList(head.to).length ? parseList(head.to) : [me],
    cc: parseList(head.cc),
    subject: head.subject ?? '(no subject)',
    date: Number.isFinite(when) ? new Date(when).toISOString() : now(),
    body,
    attachments: files,
    source: 'paste',
  }
}

// ---------- the slice ----------

/** What the pipeline needs to read a message: the book, the messages already read, and the changes still waiting. */
export const ctxOf = (st: Pick<CrmState, 'accounts' | 'contracts' | 'opportunities'>, records: MailRecord[], pending: MailProposal[]): MailCtx => ({
  accounts: st.accounts,
  contracts: st.contracts,
  opportunities: st.opportunities,
  known: Object.fromEntries(records.filter((r) => r.msg.messageId).map((r) => [r.msg.messageId, { direction: r.x.direction, match: r.linked === 'confirmed' ? { ...r.x.match, confidence: 'High' as const } : r.x.match, kind: r.x.kind }])),
  pending: pending.filter((p) => p.status === 'Proposed'),
})

export function createMailSlice(set: Set, get: () => CrmState, seed: DemoData, user: string): MailSlice {

  /** Read messages into the CRM in date order. Duplicates (same Message-ID, or the same text forwarded or pasted) are recorded once. */
  const ingest = (incoming: MailMessage[]) => {
    const st = get()
    const records = [...st.mailRecords]
    const proposals = [...st.mailProposals]
    const byKey = new Map<string, MailRecord>()
    for (const r of records) for (const k of r.keys) byKey.set(k, r)
    const propKeys = new Set(proposals.map((p) => p.key))
    const fresh: MailProposal[] = []
    const added: MailRecord[] = []
    const touched = new Set<string>()
    const replace = (r: MailRecord, patch: Partial<MailRecord>) => {
      const next = { ...r, ...patch }
      records[records.indexOf(r)] = next
      for (const k of next.keys) byKey.set(k, next)
      return next
    }
    const findDup = (keys: string[], m: MailMessage) => {
      for (const k of keys) {
        const r = byKey.get(k)
        if (r) return r
      }
      // The same text without its attachment (a forward that dropped the file), or with it.
      const text = keys[0].split('|').slice(0, 3).join('|')
      const r = records.find((x) => x.keys[0]?.split('|').slice(0, 3).join('|') === text)
      return r && (!m.attachments.length || !r.msg.attachments.length) ? r : undefined
    }
    const one = (m: MailMessage, hint?: MailMatch): MailRecord => {
      const keys = dedupeKeys(m)
      const dup = findDup(keys, m)
      if (dup) {
        const patch: Partial<MailRecord> = { keys: [...new Set([...dup.keys, ...keys])] }
        if (!dup.seenIn.includes(m.mailbox)) patch.seenIn = [...dup.seenIn, m.mailbox]
        if (!dup.msg.attachments.length && m.attachments.length) patch.msg = { ...dup.msg, attachments: m.attachments }
        touched.add(dup.id)
        return replace(dup, patch)
      }
      const ctx = ctxOf(get(), records, [...fresh, ...proposals])
      const x = extractRules(m, ctx, new Date(), hint)
      const rec: MailRecord = { id: m.id, msg: m, x, keys, seenIn: [m.mailbox], linked: x.match.accountId && x.match.confidence === 'High' ? 'auto' : undefined, ingestedAt: now() }
      records.unshift(rec)
      for (const k of keys) byKey.set(k, rec)
      added.push(rec)
      for (const p of proposalsFor(m, x, ctx)) {
        if (propKeys.has(p.key)) continue
        propKeys.add(p.key)
        fresh.push(p)
      }
      return rec
    }
    for (const m of [...incoming].sort((a, b) => a.date.localeCompare(b.date))) {
      const inner = unwrapForward(m)
      if (!inner) {
        one(m)
        continue
      }
      // A forward holds an earlier customer email: read that one on its own (usually a duplicate).
      const orig = one({ ...inner, id: `${m.id}-fwd` })
      if (trivialForward(m)) {
        const keys = dedupeKeys(m)
        replace(orig, { keys: [...new Set([...orig.keys, ...keys])] })
        continue
      }
      one(m, orig.x.match.accountId ? { ...orig.x.match, reason: `Forwards ${orig.msg.from.name ?? orig.msg.from.email}'s email` } : undefined)
    }
    set({ mailRecords: records, mailProposals: [...fresh, ...proposals] })
    for (const p of fresh) if (p.auto) get().applyProposal(p.id)
    return { added: added.length, proposals: fresh.filter((p) => !p.auto).length, duplicates: touched.size, records: added }
  }

  const patchContract = (id: string, f: (c: Contract) => Contract) => set((s) => ({ contracts: s.contracts.map((c) => (c.id === id ? f(c) : c)) }))
  const recordFor = (p: MailProposal) => get().mailRecords.find((r) => recordKey(r.msg) === p.messageId)

  /** The CRM change itself. Returns an error message, or null when it applied. */
  const applyOne = (p: MailProposal): string | null => {
    const st = get()
    const rec = recordFor(p)
    const pl = p.payload as Record<string, unknown>
    const who = rec?.msg.from.name ?? rec?.msg.from.email ?? 'the customer'
    const contract = p.contractId ? st.contracts.find((c) => c.id === p.contractId) : undefined
    const account = p.accountId ? st.accounts.find((a) => a.id === p.accountId) : undefined
    switch (p.kind) {
      case 'log-activity': {
        const date = String(pl.date ?? now())
        set((s) => ({
          activities: s.activities.some((v) => v.id === `V-MAIL-${p.id}`) ? s.activities : [{ id: `V-MAIL-${p.id}`, accountId: String(pl.accountId), date, author: 'Email tracking', kind: pl.activityKind === 'Contract' ? 'Contract' : 'Email', text: String(pl.text) }, ...s.activities],
          // Only the customer writing to us counts as contact; our own emails don't make a deal less stale.
          accounts: pl.inbound ? s.accounts.map((a) => (a.id === pl.accountId && a.lastContact < date ? { ...a, lastContact: date } : a)) : s.accounts,
          // Confirming a link by hand makes the thread trusted for the emails that follow.
          mailRecords: rec ? s.mailRecords.map((r) => (r.id === rec.id ? { ...r, linked: p.auto ? r.linked ?? 'auto' : 'confirmed' } : r)) : s.mailRecords,
        }))
        return null
      }
      case 'add-contact': {
        if (!account) return 'The account no longer exists.'
        if (pl.altEmail) {
          const c = account.contacts.find((x) => x.id === pl.contactId) ?? account.contacts.find((x) => x.name.toLowerCase() === String(pl.contactName ?? '').toLowerCase())
          if (!c) return `${pl.contactName ?? 'The contact'} isn't on ${account.name} yet.`
          const alt = String(pl.altEmail)
          if (normEmail(c.email) === normEmail(alt) || c.altEmails?.some((e) => normEmail(e) === normEmail(alt))) return null
          set((s) => ({ accounts: s.accounts.map((a) => (a.id === account.id ? { ...a, contacts: a.contacts.map((x) => (x.id === c.id ? { ...x, altEmails: [...(x.altEmails ?? []), alt] } : x)) } : a)) }))
          get().log(account.id, 'Note', `Added ${alt} as another address for ${c.name} (from tracked email).`)
          return null
        }
        if (account.contacts.some((x) => normEmail(x.email) === normEmail(String(pl.email)))) return null
        const ct: Contact = { id: `CT-M${hash(String(pl.email))}`, name: String(pl.name), title: String(pl.title ?? 'Contact'), role: (pl.role as Contact['role']) ?? 'Operations', email: String(pl.email), since: now() }
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === account.id ? { ...a, contacts: [...a.contacts, ct] } : a)) }))
        get().log(account.id, 'Note', `Added ${ct.name} (${ct.title}, ${ct.email}) as a contact from ${who}'s email.`)
        return null
      }
      case 'add-redline': {
        if (!contract) return 'The contract no longer exists.'
        if (contract.status !== 'In Negotiation' && contract.status !== 'Draft') return `${contract.id} is ${contract.status.toLowerCase()}; redlines only go on a contract in negotiation.`
        const clauseId = String(pl.clauseId)
        const cl = CLAUSE[clauseId]
        if (!cl) return 'Unknown clause.'
        const lib = pl.libraryKey ? REDLINE_BY_KEY[String(pl.libraryKey)] : undefined
        const vars = { termMonths: contract.termMonths, renewalNoticeDays: contract.renewalNoticeDays, capPct: contract.price.capPct ?? 5, noticeDays: contract.price.noticeDays }
        const quote = String(pl.quote ?? '')
        const r: Redline = {
          id: `${contract.id}-M${hash(p.key)}`,
          clauseId,
          key: lib?.key ?? `custom-${clauseId}`,
          original: renderClause(cl, vars),
          proposed: lib?.proposed ?? quote,
          customerNote: quote,
          source: { messageId: p.messageId, from: who, at: rec?.msg.date ?? now() },
        }
        if (contract.redlines.some((x) => x.id === r.id)) return null
        patchContract(contract.id, (c) => ({ ...c, redlines: [...c.redlines, r] }))
        get().log(contract.accountId, 'Contract', `Redline added to ${contract.id} from ${who}'s email: ${cl.number}. ${cl.title}.`)
        return null
      }
      case 'agree-redline': {
        if (!contract) return 'The contract no longer exists.'
        const r = contract.redlines.find((x) => x.id === pl.redlineId) ?? contract.redlines.find((x) => x.clauseId === pl.clauseId && !x.agreed)
        if (!r) return 'That redline is no longer on the contract.'
        const v = pl.value as ClauseChange['value'] | undefined
        const terms: Partial<Contract> = {}
        if (v?.field === 'paymentDays') terms.paymentTerms = `Net ${v.to}`
        if (v?.field === 'termMonths') terms.termMonths = Number(v.to)
        if (v?.field === 'renewalNoticeDays') terms.renewalNoticeDays = Number(v.to)
        if (v?.field === 'autoRenew') terms.autoRenew = !!v.to
        if (v?.field === 'capPct') terms.price = { ...contract.price, capPct: Number(v.to) }
        const agreed = { at: rec?.msg.date ?? now(), value: pl.valueLabel ? String(pl.valueLabel) : undefined, quote: String(pl.quote ?? ''), messageId: p.messageId, by: who }
        patchContract(contract.id, (c) => ({ ...c, ...terms, redlines: c.redlines.map((x) => (x.id === r.id ? { ...x, agreed } : x)) }))
        // The agreed position is our counter unless the rep already recorded a decision.
        if (!st.decisions[contract.id]?.[r.id]) st.setDecision(contract.id, r.id, { decision: 'Counter', language: REDLINE_BY_KEY[r.key]?.offline.counter ?? r.proposed })
        get().log(contract.accountId, 'Contract', `${who} agreed ${CLAUSE[r.clauseId]?.title}${agreed.value ? ` at ${agreed.value}` : ''} on ${contract.id} (tracked email).`)
        return null
      }
      case 'move-stage': {
        const o = st.opportunities.find((x) => x.id === pl.opportunityId)
        if (!o) return 'The deal no longer exists.'
        if (!['Prospect', 'Demo', 'Negotiation'].includes(o.stage)) return `The deal is ${o.stage}; reopen it first.`
        const a = st.accounts.find((x) => x.id === o.accountId)
        if (!a) return 'The account no longer exists.'
        const at = now()
        // Their paper: Lucas reviews it, but doesn't draft our MSA. Marking negotiation as started skips the draft.
        set((s) => ({ opportunities: s.opportunities.map((x) => (x.id === o.id ? { ...x, negotiationStartedAt: x.negotiationStartedAt ?? at } : x)) }))
        if (o.stage !== 'Negotiation') get().moveOpp(o.id, 'Negotiation')
        if (!o.contractId) {
          const c = customerPaper(a, o, String(pl.document ?? 'their agreement'), (pl.changes as ClauseChange[] | undefined) ?? [], p, who, rec?.msg.date ?? at)
          set((s) => ({ contracts: s.contracts.some((x) => x.id === c.id) ? s.contracts : [c, ...s.contracts], opportunities: s.opportunities.map((x) => (x.id === o.id ? { ...x, contractId: c.id } : x)) }))
          get().log(a.id, 'Contract', `${who} sent their own paper (${pl.document ?? 'attached'}). Recorded as ${c.id} for Lucas to review, with ${c.redlines.length} ${c.redlines.length === 1 ? 'term' : 'terms'} that differ from our MSA.`)
        }
        return null
      }
      case 'mark-signed': {
        if (!contract) return 'The contract no longer exists.'
        if (contract.status === 'Active') return null
        if (contract.status === 'Void' || contract.status === 'Expired') return `${contract.id} is ${contract.status.toLowerCase()}.`
        const signedAt = String(pl.signedAt ?? now())
        st.signContract(contract.id)
        // The deal closes on the day it was signed, so it books in the right month.
        const end = new Date(signedAt)
        end.setMonth(end.getMonth() + contract.termMonths)
        const opp = get().opportunities.find((o) => o.contractId === contract.id || o.id === contract.opportunityId)
        set((s) => ({
          contracts: s.contracts.map((c) => (c.id === contract.id ? { ...c, start: signedAt, end: end.toISOString() } : c)),
          opportunities: s.opportunities.map((o) => (o.id === opp?.id ? { ...o, stageChangedAt: signedAt, closeDate: signedAt } : o)),
          signedCopies: { ...s.signedCopies, [contract.id]: { contractId: contract.id, file: String(pl.file ?? 'signed copy'), from: rec ? `${rec.msg.from.name ? `${rec.msg.from.name} <${rec.msg.from.email}>` : rec.msg.from.email}` : who, receivedAt: rec?.msg.date ?? signedAt, recordId: rec?.id ?? '', confirmedBy: user, confirmedAt: now() } },
        }))
        get().log(contract.accountId, 'Contract', `Signed copy of ${contract.id} (${pl.file ?? 'attached'}) received by email from ${who}; confirmed by ${user} and stored with the contract. Next: countersign and send back the fully executed copy.`)
        return null
      }
      case 'amendment': {
        if (!account) return 'The account no longer exists.'
        const text = String(pl.text ?? pl.note ?? '')
        const lines = amendmentLines(text, account)
        const arr = Math.round(lines.reduce((sum, l) => sum + l.units * l.unitPrice, 0) * 12)
        const at = now()
        const o: Opportunity = {
          id: `O-M${hash(p.key)}`,
          accountId: account.id,
          type: 'Expansion',
          stage: 'Negotiation',
          arr: arr || 5000,
          products: lines.length ? lines.map((l) => l.productId) : account.subscriptions.slice(0, 1).map((x) => x.productId),
          owner: account.rep,
          createdAt: at,
          closeDate: new Date(Date.now() + 30 * DAY).toISOString(),
          // An amendment to a signed agreement: no new MSA for Lucas to draft.
          negotiationStartedAt: at,
          stageChangedAt: at,
          reason: undefined,
        }
        if (st.opportunities.some((x) => x.id === o.id)) return null
        set((s) => ({ opportunities: [o, ...s.opportunities] }))
        get().log(account.id, 'System', `Amendment to ${pl.contractId ?? 'the agreement'} opened from ${who}'s email: ${lines.map((l) => `${l.units} × ${PRODUCT[l.productId].name}`).join(', ') || 'scope to confirm'} (about $${(o.arr / 1000).toFixed(1)}k a year).`)
        return null
      }
      case 'draft-reply': {
        if (!account) return 'The account no longer exists.'
        const to = pl.to as Party | undefined
        const draft = replyDraft(String(pl.purpose), account.name, contract, who, rec, user, String(pl.question ?? ''))
        const id = st.queueOutreach({ accountId: account.id, trigger: `Email from ${who}`, playbook: 'mail-reply', contactName: to?.name ?? to?.email ?? who, contactEmail: to?.email ?? '', subject: draft.subject, body: draft.body, auto: false, contractId: contract?.id, status: 'Draft' })
        set((s) => ({ mailProposals: s.mailProposals.map((q) => (q.id === p.id ? { ...q, payload: { ...q.payload, outreachId: id } } : q)) }))
        return null
      }
      case 'note': {
        if (!pl.accountId) return 'No account.'
        get().log(String(pl.accountId), pl.followUp ? 'Note' : 'Contract', String(pl.text))
        return null
      }
      default:
        return 'This kind of change is shown for information only.'
    }
  }

  const apply = (id: string): string | null => {
    const st = get()
    const p = st.mailProposals.find((x) => x.id === id)
    if (!p) return 'Not found.'
    if (p.status !== 'Proposed') return null
    const blocked = blockedBy(p, st.mailProposals)
    if (blocked.length) return `First: ${blocked[0].title}.`
    const err = applyOne(p)
    if (err) return err
    set((s) => ({ mailProposals: s.mailProposals.map((q) => (q.id === id ? { ...q, status: 'Applied', appliedAt: now() } : q)) }))
    return null
  }

  return {
    ...initialMail(),
    connectMailbox: (owner, provider) => {
      set((s) => ({ mailboxes: { ...s.mailboxes, [owner]: { owner, address: repEmail(owner), provider, connectedAt: now() } } }))
      return get().syncMailbox(owner)
    },
    disconnectMailbox: (owner) =>
      set((s) => {
        const next = { ...s.mailboxes }
        delete next[owner]
        return { mailboxes: next }
      }),
    syncMailbox: (owner) => {
      if (!get().mailboxes[owner]) return { added: 0, proposals: 0 }
      // Demo connector: a seeded mailbox built from the book. A live connector (Gmail API, Microsoft Graph) returns the same records.
      const mine = demoMailbox(seed, owner)
      const used = [...new Set(mine.flatMap((m) => [...`${m.subject} ${m.body}`.matchAll(/\bK\d{4}\b/g)].map((x) => x[0])))]
      const res = ingest([...mine, ...(owner === user ? [] : demoEsign(seed, owner, used))])
      set((s) => ({ mailboxes: { ...s.mailboxes, [owner]: { ...s.mailboxes[owner], lastSync: now() } } }))
      return { added: res.added, proposals: res.proposals }
    },
    ingestPasted: (raw, attachment) => {
      const m = parsePasted(raw, user, attachment)
      if (!m) return { status: 'invalid', error: 'Paste the whole email, starting with its From: line (or a forwarded message).' }
      const res = ingest([m])
      if (res.added) return { status: 'added', recordId: res.records[res.records.length - 1].id }
      const inner = unwrapForward(m)
      const dupKeys = dedupeKeys(inner ?? m)
      const dup = get().mailRecords.find((r) => r.keys.some((k) => dupKeys.includes(k)))
      return { status: 'duplicate', recordId: dup?.id }
    },
    linkRecord: (recordId, accountId) => {
      const st = get()
      const rec = st.mailRecords.find((r) => r.id === recordId)
      if (!rec) return
      const ctx = ctxOf(st, st.mailRecords.filter((r) => r.id !== recordId), st.mailProposals)
      const match = linkMatch(accountId, rec.msg, ctx)
      if (!match) return
      const x = extractRules(rec.msg, ctx, new Date(), match)
      const mid = recordKey(rec.msg)
      // Proposals from the old reading that never applied are replaced by the new ones.
      const kept = st.mailProposals.map((p) => (p.messageId === mid && p.status === 'Proposed' ? { ...p, status: 'Obsolete' as const } : p))
      const have = new Set(kept.filter((p) => p.status !== 'Obsolete').map((p) => p.key))
      const fresh = proposalsFor(rec.msg, x, { ...ctx, pending: kept.filter((p) => p.status === 'Proposed') }).filter((p) => !have.has(p.key) || p.kind === 'log-activity')
      const ids = new Set(fresh.map((p) => p.id))
      set({ mailRecords: st.mailRecords.map((r) => (r.id === recordId ? { ...r, x, linked: 'confirmed' } : r)), mailProposals: [...fresh.map((p) => (p.kind === 'log-activity' ? { ...p, auto: true, title: `Logged on ${st.accounts.find((a) => a.id === accountId)?.name}` } : p)), ...kept.filter((p) => !ids.has(p.id))] })
      for (const p of fresh) if (p.kind === 'log-activity' || p.auto) get().applyProposal(p.id)
    },
    applyProposal: apply,
    dismissProposal: (id) =>
      set((s) => {
        // Anything that depended on it can't apply any more.
        const gone = new Set([id])
        let grew = true
        while (grew) {
          grew = false
          for (const p of s.mailProposals) if (!gone.has(p.id) && p.status === 'Proposed' && p.dependsOn?.some((d) => gone.has(d))) (gone.add(p.id), (grew = true))
        }
        return { mailProposals: s.mailProposals.map((p) => (p.id === id ? { ...p, status: 'Dismissed' } : gone.has(p.id) ? { ...p, status: 'Obsolete' } : p)) }
      }),
    applyAllSafe: (accountId) => {
      let n = 0
      for (let pass = 0; pass < 6; pass++) {
        const st = get()
        const flagged = new Set(st.mailRecords.filter((r) => r.x.flags?.includes('injection')).map((r) => recordKey(r.msg)))
        const ready = st.mailProposals.filter((p) => p.status === 'Proposed' && !p.single && p.confidence !== 'Low' && p.kind !== 'log-activity' && !flagged.has(p.messageId) && (!accountId || p.accountId === accountId) && !blockedBy(p, st.mailProposals).length)
        if (!ready.length) break
        for (const p of ready) if (!apply(p.id)) n++
      }
      return n
    },
    replaceExtraction: (recordId, x) => {
      const st = get()
      const rec = st.mailRecords.find((r) => r.id === recordId)
      if (!rec) return 0
      const mid = recordKey(rec.msg)
      const others = st.mailProposals.filter((p) => p.messageId !== mid)
      const ctx = ctxOf(st, st.mailRecords.filter((r) => r.id !== recordId), others)
      const next = proposalsFor(rec.msg, { ...x, match: rec.linked === 'confirmed' ? { ...x.match, confidence: 'High' } : x.match }, ctx)
      const nextKeys = new Set(next.map((p) => p.key))
      const mineOld = st.mailProposals.filter((p) => p.messageId === mid)
      const oldKeys = new Set(mineOld.map((p) => p.key))
      const allKeys = new Set(st.mailProposals.map((p) => p.key))
      const updated = st.mailProposals.map((p) => (p.messageId === mid && p.status === 'Proposed' && !nextKeys.has(p.key) ? { ...p, status: 'Obsolete' as const } : p))
      const add = next.filter((p) => !oldKeys.has(p.key) && !allKeys.has(p.key))
      set({ mailRecords: st.mailRecords.map((r) => (r.id === recordId ? { ...r, x } : r)), mailProposals: [...add, ...updated] })
      for (const p of add) if (p.auto) get().applyProposal(p.id)
      return add.length
    },
  }
}

// ---------- helpers for the apply step ----------

/** Units and products an amendment email asks for ("one more HerdTrack site and 10 BarnSense barns"). */
function amendmentLines(text: string, a: CrmState['accounts'][number]) {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twelve: 12 }
  const out: { productId: string; units: number; unitPrice: number }[] = []
  for (const p of PRODUCTS) {
    const short = p.name.split(' ')[0]
    const m = text.match(new RegExp(`(\\d+|${Object.keys(words).join('|')})\\s+(?:more\\s+|additional\\s+)?(?:\\w+\\s+){0,1}?${short}\\b`, 'i'))
    if (!m) continue
    const units = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1].toLowerCase()] ?? 1
    const sub = a.subscriptions.find((x) => x.productId === p.id)
    out.push({ productId: p.id, units, unitPrice: sub?.unitPrice ?? p.listPrice })
  }
  return out
}

/** Their own agreement, recorded as a contract in negotiation so Lucas can review how it departs from ours. */
function customerPaper(a: CrmState['accounts'][number], o: Opportunity, doc: string, changes: ClauseChange[], p: MailProposal, who: string, at: string): Contract {
  const id = `KC-${o.id}`
  const vars = { termMonths: 12, renewalNoticeDays: 60, capPct: 5, noticeDays: 60 }
  const pay = changes.find((c) => c.value?.field === 'paymentDays')
  const products = o.products.length ? o.products : ['herdtrack']
  const list = products.reduce((sum, pid) => sum + unitsFor(pid, a) * PRODUCT[pid].listPrice, 0)
  const d = expectedDiscount(list)
  const end = new Date(at)
  end.setMonth(end.getMonth() + 12)
  return {
    id,
    accountId: a.id,
    template: `Customer paper: ${doc}`,
    status: 'In Negotiation',
    start: at,
    end: end.toISOString(),
    termMonths: 12,
    autoRenew: false,
    renewalNoticeDays: 60,
    paymentTerms: pay ? `Net ${pay.value!.to}` : 'Net 30',
    price: { mechanism: 'Fixed for term', noticeDays: 60 },
    mfn: false,
    assignmentOnChangeOfControl: 'Consent required',
    opportunityId: o.id,
    orderForm: products.map((pid) => ({ productId: pid, units: unitsFor(pid, a), unitPrice: Math.round(PRODUCT[pid].listPrice * (1 - d) * 100) / 100, listPrice: PRODUCT[pid].listPrice })),
    redlines: changes
      .filter((c) => CLAUSE[c.clauseId])
      .map((c, i) => ({
        id: `${id}-R${i + 1}`,
        clauseId: c.clauseId,
        key: c.libraryKey ?? `custom-${c.clauseId}`,
        original: renderClause(CLAUSE[c.clauseId], vars),
        proposed: c.proposed ?? c.quote,
        customerNote: `From ${doc}`,
        source: { messageId: p.messageId, from: who, at },
      })),
  }
}

/** A reply for the rep to finish and approve. Nothing sends from here. */
function replyDraft(purpose: string, accountName: string, c: Contract | undefined, who: string, rec: MailRecord | undefined, rep: string, question: string) {
  const firstName = who.split(' ')[0]
  const subj = rec?.msg.subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, '') ?? accountName
  if (purpose === 'final' && c) {
    const agreed = c.redlines.filter((r) => r.agreed).map((r) => `- ${CLAUSE[r.clauseId]?.number}. ${CLAUSE[r.clauseId]?.title}: ${r.agreed!.value ?? 'as agreed'}`)
    const open = c.redlines.filter((r) => !r.agreed).map((r) => `- ${CLAUSE[r.clauseId]?.number}. ${CLAUSE[r.clauseId]?.title}`)
    return {
      subject: `Final agreement for signature: ${accountName} (${c.id})`,
      body: `Hi ${firstName},\n\nThanks for confirming. The final agreement for ${accountName} is attached for signature (${c.id}, ${c.template}). It reflects what we agreed:\n${agreed.length ? agreed.join('\n') : '- The terms in our last email'}\n- Payment terms: ${c.paymentTerms}\n- Term: ${c.termMonths} months${open.length ? `\n\nStill to confirm before you sign:\n${open.join('\n')}` : ''}\n\nOnce it's signed, reply with the signed copy and we'll countersign and schedule onboarding.\n\nBest,\n${rep}\nRef ${c.id}`,
    }
  }
  if (purpose === 'question') {
    const cl = Object.values(CLAUSE).find((x) => new RegExp(`\\b${x.title.split(' ')[0]}`, 'i').test(`${question} ${rec?.msg.body ?? ''}`))
    return {
      subject: `Re: ${subj}`,
      body: `Hi ${firstName},\n\nGood question${cl ? ` on section ${cl.number}, ${cl.title}` : ''}. [Your answer here: Lucas can suggest wording on the contract page.]${cl ? `\n\nFor reference, the clause today reads: "${cl.text.slice(0, 280)}${cl.text.length > 280 ? '…' : ''}"` : ''}\n\nBest,\n${rep}${c ? `\nRef ${c.id}` : ''}`,
    }
  }
  return {
    subject: `Re: ${subj}`,
    body: `Hi ${firstName},\n\nHere's the current version of the agreement${c ? ` (${c.id})` : ''} again. Mark up anything that doesn't work and I'll turn it around quickly.\n\nBest,\n${rep}${c ? `\nRef ${c.id}` : ''}`,
  }
}

/** A message's thread: every record whose Message-ID it references, or that references it, plus same-subject mail on the same account. */
export function threadOf(rec: MailRecord, all: MailRecord[]): MailRecord[] {
  const subj = (s: string) => s.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/gi, '').trim().toLowerCase()
  const s = subj(rec.msg.subject)
  return all
    .filter((r) => r.x.match.accountId && r.x.match.accountId === rec.x.match.accountId && (subj(r.msg.subject) === s || r.msg.references?.includes(rec.msg.messageId) || rec.msg.references?.includes(r.msg.messageId)))
    .sort((a, b) => a.msg.date.localeCompare(b.msg.date))
}

export { splitQuoted }
