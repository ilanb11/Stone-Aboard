import type { Account, Contract, Opportunity } from '../../types'
import { CLAUSE } from '../../data/contracts'
import type { MailMessage, Party } from './types'

// A demo mailbox per rep, built from the seed data so it never needs storing and is the
// same on every load. It walks one negotiation through the whole sales cycle and adds
// the edge cases the pipeline has to handle. A live connector (Gmail API, Microsoft
// Graph) produces the same MailMessage records.

export interface DemoData {
  accounts: Account[]
  contracts: Contract[]
  opportunities: Opportunity[]
  today?: Date
}

const DAY = 86400000
export const repEmail = (rep: string) => `${rep.toLowerCase().replace(/\s+/g, '.')}@thibolisoft.com`
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const domainOf = (a: Account) => a.contacts[0]?.email.split('@')[1] ?? `${slug(a.name)}.example`
const first = (n: string) => n.split(' ')[0]

/** Our counter on each clause, in the words a rep would use in an email (the playbook fallbacks). */
const COUNTER_SHORT: Record<string, { ours: string; yes: string }> = {
  payment: { ours: 'Net 45, or Net 60 if you prepay annually.', yes: "Net 45 works for us. We won't prepay." },
  liability: { ours: "18 months of fees. We can't cover livestock mortality; your farm policy is the right place for that risk.", yes: 'OK with 18 months of fees.' },
  termination: { ours: "After the first 12 months you can terminate on 90 days' notice with a three-month fee.", yes: 'OK, that covers a bad market year.' },
  hardware: { ours: '24-month warranty, replacements ship within two business days, and a spare kit at cost.', yes: "Fine, we'll take the spare kit." },
  term: { ours: 'It renews automatically, with a reminder from us 30 days before the notice date.', yes: 'OK with the reminder.' },
  data: { ours: 'You own your data. We only use de-identified benchmarks, never sell farm data, and you can opt out.', yes: 'Agreed.' },
  indemnity: { ours: 'Breach indemnity capped at 2x annual fees.', yes: 'OK.' },
  sla: { ours: '99.7% uptime, with SMS fallback for BarnSense alarms.', yes: 'Works for us.' },
  fees: { ours: 'Annual CPI adjustment, 2% floor and 4% cap, on 60 days’ notice.', yes: 'OK.' },
  biosecurity: { ours: 'Accepted as written.', yes: 'Good.' },
  law: { ours: 'Your home state law is fine.', yes: 'Good.' },
  assignment: { ours: 'Assignable to a buyer of the operation on written notice.', yes: 'OK.' },
}

export function demoMailbox(d: DemoData, mailboxOwner: string): MailMessage[] {
  const today = d.today ?? new Date()
  const at = (days: number, hour = 9) => {
    const t = new Date(today.getTime() - days * DAY)
    t.setHours(hour, 12, 0, 0)
    return t.toISOString()
  }
  const byId = Object.fromEntries(d.accounts.map((a) => [a.id, a]))
  const owner = (a: Account) => a.contacts.find((c) => c.role === 'Owner') ?? a.contacts[0]
  const me: Party = { name: mailboxOwner, email: repEmail(mailboxOwner) }
  const out: MailMessage[] = []
  let n = 0
  const msg = (m: Omit<MailMessage, 'id' | 'mailbox' | 'source' | 'attachments' | 'cc'> & Partial<Pick<MailMessage, 'attachments' | 'cc' | 'source'>>) => {
    n++
    const full: MailMessage = { id: `MM-${slug(mailboxOwner).slice(0, 6)}-${n}`, mailbox: mailboxOwner, source: 'sync', attachments: [], cc: [], ...m }
    out.push(full)
    return full
  }
  const mid = (tag: string, dom: string) => `<${tag}.${slug(mailboxOwner).slice(0, 6)}@${dom}>`

  // The main negotiation: an In Negotiation contract this rep owns, with at least two redlines.
  const neg = d.contracts.find((c) => c.status === 'In Negotiation' && byId[c.accountId]?.rep === mailboxOwner && c.redlines.length >= 2 && byId[c.accountId].contacts.length >= 1)
  if (neg) {
    const a = byId[neg.accountId]
    const dom = domainOf(a)
    const o = owner(a)
    const cfo: Party = { name: 'Dana Whitfield', email: `dana.whitfield@${dom}` }
    const cfoPersonal: Party = { name: 'Dana Whitfield', email: 'dana.whitfield.farm@gmail.com' }
    const subj = `Proposed agreement for ${a.name}`
    const m1 = msg({ messageId: mid('m1', 'thibolisoft.com'), from: me, to: [{ name: o.name, email: o.email }], subject: subj, date: at(12, 8), body: `Hi ${first(o.name)},\n\nAs promised, the proposed agreement for ${a.name} is attached (${neg.id}). Mark up anything that doesn't work and I'll turn it around quickly.\n\nBest,\n${mailboxOwner}\nThiboLiSoft\nRef ${neg.id}`, attachments: [{ name: `${neg.id}_MSA.pdf`, kind: 'pdf', text: `${neg.template} ${neg.id} Master Subscription Agreement` }] })
    const m2 = msg({ messageId: mid('m2', dom), inReplyTo: m1.messageId, references: [m1.messageId], from: { name: o.name, email: o.email }, to: [me], cc: [cfo], subject: `Re: ${subj}`, date: at(11, 14), body: `Thanks ${first(mailboxOwner)}. Looping in Dana Whitfield, our new CFO. She'll handle the paperwork from here.\n\n${o.name}\n\nOn ${new Date(m1.date).toDateString()}, ${mailboxOwner} wrote:\n> As promised, the proposed agreement for ${a.name} is attached.` })
    const m3body = `Hi ${first(mailboxOwner)},\n\nThanks for sending this over. Two changes before we can sign:\n\n1. Payment terms: instead of Net 30 we need Net 60. Our cash flow follows the packer payments.\n2. Limitation of liability: we need three times the annual fees, and coverage if a BarnSense alarm fails and we lose animals.\n\nOur markup is attached.\n\nDana Whitfield\nCFO, ${a.name}`
    const m3 = msg({ messageId: mid('m3', dom), inReplyTo: m2.messageId, references: [m1.messageId, m2.messageId], from: cfo, to: [me], cc: [{ name: o.name, email: o.email }], subject: `Re: ${subj}`, date: at(9, 10), body: m3body, attachments: [{ name: `${a.name.replace(/\s+/g, '_')}_MSA_markup_v2.pdf`, kind: 'pdf', text: `3. Payment Terms. Invoices are payable within sixty (60) days of the invoice date.\n6. Limitation of Liability. Each party's aggregate liability is limited to three (3) times the Fees paid in the twelve (12) months preceding the claim, and ThiboLiSoft is liable for animal losses caused by failure of BarnSense alarms.` }] })
    const legal: Party = { name: 'Contracts Desk', email: 'legal@thibolisoft.com' }
    const m4 = msg({ messageId: mid('m4', 'thibolisoft.com'), from: me, to: [legal], subject: `Fwd: ${subj}: liability ask`, date: at(8, 9), body: `Can we offer 18 months of fees on liability for ${a.name}? They're asking for 3x plus animal losses.\n\n---------- Forwarded message ---------\nFrom: Dana Whitfield <${cfo.email}>\nSubject: Re: ${subj}\n\n${m3body}` })
    msg({ messageId: mid('m5', 'thibolisoft.com'), inReplyTo: m4.messageId, references: [m4.messageId], from: legal, to: [me], subject: `Re: Fwd: ${subj}: liability ask`, date: at(8, 15), body: `Approved: 18 months of fees for ${a.name} (playbook fallback). No liability for livestock mortality.\n\nContracts Desk` })
    // Our counter answers every open point: the ones already on the contract and the two Dana just raised.
    const points = [...new Set([...neg.redlines.map((r) => r.clauseId), 'payment', 'liability'])].sort((x, y) => CLAUSE[x].number - CLAUSE[y].number)
    const counterLines = points.map((id) => `${CLAUSE[id].number}. ${CLAUSE[id].title}: ${COUNTER_SHORT[id]?.ours ?? 'We can accept your change.'}`)
    const m6 = msg({ messageId: mid('m6', 'thibolisoft.com'), inReplyTo: m3.messageId, references: [m1.messageId, m3.messageId], from: me, to: [cfo], cc: [{ name: o.name, email: o.email }], subject: `Re: ${subj}`, date: at(7, 11), body: `Hi Dana,\n\nThanks for the markup. Our counter on each open point:\n${counterLines.join('\n')}\n\nBest,\n${mailboxOwner}\nRef ${neg.id}` })
    // The GM agrees with the CFO: that's customer-internal, not acceptance of our terms.
    msg({ messageId: mid('m7', dom), inReplyTo: m3.messageId, references: [m1.messageId, m3.messageId], from: { name: o.name, email: o.email }, to: [cfo], cc: [me], subject: `Re: ${subj}`, date: at(6, 16), body: `Agreed, works for us. Dana, go ahead and push on the terms.\n\n${o.name}` })
    msg({ messageId: mid('m8', dom), inReplyTo: m6.messageId, references: [m1.messageId, m3.messageId, m6.messageId], from: cfo, to: [me], cc: [{ name: o.name, email: o.email }], subject: `Re: ${subj}`, date: at(4, 13), body: `See my answers inline below.\n\nOn ${new Date(m6.date).toDateString()}, ${mailboxOwner} wrote:\n${points.map((id, i) => `> ${counterLines[i]}\n${COUNTER_SHORT[id]?.yes ?? 'OK.'}`).join('\n')}` })
    msg({ messageId: mid('m9', dom), inReplyTo: m6.messageId, references: [m1.messageId, m6.messageId], from: { name: o.name, email: o.email }, to: [me], cc: [cfo], subject: `Re: ${subj}`, date: at(3, 9), body: `Looks good. Send the final and we'll sign this week.\n\n${o.name}` })
    msg({ messageId: mid('m10', 'mail.gmail.com'), references: [m1.messageId, m6.messageId], from: cfoPersonal, to: [me], subject: `Signed agreement`, date: at(1, 20), body: `Here you go, signed. Sending from my own email, I'm on the road.\n\nDana`, attachments: [{ name: 'Scan_signed.pdf', kind: 'pdf', text: `${neg.template} Master Subscription Agreement ${neg.id} between ThiboLiSoft and ${a.name}. ${CLAUSE.payment.number}. ${CLAUSE.payment.title}: forty-five (45) days. Signatures: /s/ Dana Whitfield, CFO, ${a.name}.` }] })
    // A forward of the redline email by the rep (the same message again).
    msg({ messageId: mid('m11', 'thibolisoft.com'), from: me, to: [me], subject: `Fwd: Re: ${subj}`, date: at(9, 18), source: 'forward', body: `For the file.\n\n---------- Forwarded message ---------\nFrom: Dana Whitfield <${cfo.email}>\nDate: ${new Date(m3.date).toLocaleString('en-US')}\nSubject: Re: ${subj}\nTo: ${me.name} <${me.email}>\n\n${m3body}`, attachments: m3.attachments })
  }

  // A prospect sends its own paper while the deal is at Demo.
  const demo = d.opportunities.find((o) => o.stage === 'Demo' && o.type === 'New Logo' && byId[o.accountId]?.rep === mailboxOwner && byId[o.accountId].status === 'Prospect' && !o.contractId)
  if (demo) {
    const a = byId[demo.accountId]
    const o = owner(a)
    msg({ messageId: mid('p1', domainOf(a)), from: { name: o.name, email: o.email }, to: [me], subject: `Vendor agreement for ${a.name}`, date: at(2, 10), body: `Hi ${first(mailboxOwner)},\n\nWe'd like to go ahead. Our lawyer wants to use our standard vendor agreement; it's attached for your review. Let us know if you can sign on our paper.\n\n${o.name}`, attachments: [{ name: 'Vendor_Agreement.docx', kind: 'docx', text: 'Vendor Services Agreement. Payment within sixty (60) days. Either party may terminate on thirty (30) days notice.' }] })
  }

  // An existing customer wants to add a site mid-term: an amendment, not a new MSA.
  const cust = d.accounts.find((a) => a.rep === mailboxOwner && a.status === 'Customer' && a.contractId && a.species === 'Hog' && a.subscriptions.some((s) => s.productId === 'barnsense'))
  if (cust) {
    const o = owner(cust)
    msg({ messageId: mid('a1', domainOf(cust)), from: { name: o.name, email: o.email }, to: [me], subject: `Adding our second sow unit`, date: at(5, 8), body: `Hi ${first(mailboxOwner)},\n\nWe're bringing a second sow unit online next month. Can we add it to our agreement: one more HerdTrack site and 10 BarnSense barns? Same terms as today.\n\n${o.name}` })
  }

  // A customer pushing back ahead of renewal.
  const ren = d.accounts.find((a) => a.rep === mailboxOwner && a.status === 'Customer' && a.contractId && a.id !== cust?.id && d.contracts.some((c) => c.id === a.contractId && new Date(c.end).getTime() - today.getTime() < 150 * DAY && new Date(c.end) > today))
  if (ren) {
    const o = owner(ren)
    msg({ messageId: mid('r1', domainOf(ren)), from: { name: o.name, email: o.email }, to: [me], subject: `Our renewal`, date: at(2, 15), body: `${first(mailboxOwner)}, our agreement is up for renewal soon. Before it renews we'd like to renegotiate pricing; margins are tight this year.\n\n${o.name}` })
  }

  // A clause question on another negotiation.
  const q = d.contracts.find((c) => c.status === 'In Negotiation' && byId[c.accountId]?.rep === mailboxOwner && c.id !== neg?.id)
  if (q) {
    const a = byId[q.accountId]
    const o = owner(a)
    msg({ messageId: mid('q1', domainOf(a)), from: { name: o.name, email: o.email }, to: [me], subject: `Question on section 5 (${q.id})`, date: at(1, 11), body: `Quick question on section 5, Data Ownership: does the benchmarking opt-out also cover what our integrator sees? Nothing else from our side.\n\n${o.name}` })
    // And an out-of-office from the same account.
    msg({ messageId: mid('q2', domainOf(a)), from: { name: a.contacts[a.contacts.length - 1].name, email: a.contacts[a.contacts.length - 1].email }, to: [me], subject: `Automatic reply: Re: ${q.id}`, date: at(1, 11), body: `I'm out of the office until next Monday with limited access to email.` })
  }

  // Not about any deal.
  msg({ messageId: mid('n1', 'agsupplynews.example'), from: { name: 'Ag Supply News', email: 'news@agsupplynews.example' }, to: [me], subject: `This week in feed prices`, date: at(2, 6), body: `Corn futures are up 2% this week. Read the full market report on our site.` })

  return out
}

/** A DocuSign completion in another rep's mailbox: signed, but the sender can be spoofed, so it needs a click. */
export function demoEsign(d: DemoData, mailboxOwner: string, exclude: string[] = []): MailMessage[] {
  const today = d.today ?? new Date()
  const byId = Object.fromEntries(d.accounts.map((a) => [a.id, a]))
  const c = d.contracts.find((x) => x.status === 'In Negotiation' && byId[x.accountId]?.rep === mailboxOwner && !exclude.includes(x.id))
  if (!c) return []
  const a = byId[c.accountId]
  const t = new Date(today.getTime() - DAY)
  return [
    {
      id: `MM-${slug(mailboxOwner).slice(0, 6)}-e1`,
      messageId: `<esign.${c.id}@docusign.net>`,
      mailbox: mailboxOwner,
      source: 'sync',
      from: { name: 'DocuSign', email: 'dse@docusign.net' },
      to: [{ name: mailboxOwner, email: repEmail(mailboxOwner) }],
      cc: [],
      subject: `Completed: ThiboLiSoft MSA - ${a.name} (${c.id})`,
      date: t.toISOString(),
      body: `All parties have completed the envelope "ThiboLiSoft MSA - ${a.name} (${c.id})". The executed document is attached.`,
      attachments: [{ name: `${c.id}_executed.pdf`, kind: 'pdf', text: `${c.template} ${c.id} executed. Signatures: ${a.contacts[0].name}; ${mailboxOwner}.` }],
    },
  ]
}
