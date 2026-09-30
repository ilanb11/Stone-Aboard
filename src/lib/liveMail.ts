import { useEffect, useState } from 'react'
import { useCrm } from '../store'
import type { Invoice, Outreach } from '../types'
import { invoicePdf } from './invoicePdf'

// Real email for the demo. The CRM's "Sent" stays a simulation unless Real email is on; then
// an email a person approves also goes to the test inbox, through the local dev server
// (server/mail.ts) or the Vercel function (api/mail/[action].ts). Both fix the recipient and
// cap the count; the public site also needs the demo passcode. Automatic sends never come
// through here: only the approve buttons call deliverOutreach.

export interface MailStatus {
  configured: boolean
  to: string
  sent: number
  max: number
  remaining: number
  reason?: string
  /** The public deployment: sending needs the demo passcode. */
  needsPasscode?: boolean
  unlocked?: boolean
}

const OFFLINE: MailStatus = { configured: false, to: '', sent: 0, max: 0, remaining: 0, reason: "Real email isn't available in this copy of the demo; sending is simulated." }

// The passcode is a per-browser convenience; it's checked on the server for every send.
const PASS_KEY = 'herdbook-mail-passcode'
export function getPasscode(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setPasscode(v: string) {
  try {
    if (v) localStorage.setItem(PASS_KEY, v)
    else localStorage.removeItem(PASS_KEY)
  } catch {
    // Storage blocked: the passcode lasts until the page reloads.
    memoryPass = v
  }
  memoryPass = v
}
let memoryPass = ''
const passHeader = (): Record<string, string> => {
  const p = getPasscode() || memoryPass
  return p ? { 'x-herdbook-passcode': p } : {}
}

let current: MailStatus | null = null
const listeners = new Set<(s: MailStatus) => void>()
const publish = (s: MailStatus) => {
  current = s
  for (const l of listeners) l(s)
}

export async function refreshMailStatus(): Promise<MailStatus> {
  if (import.meta.env.VITE_ARTIFACT) return (publish(OFFLINE), OFFLINE)
  try {
    const r = await fetch('/api/mail/status', { headers: passHeader() })
    const ok = r.ok && (r.headers.get('content-type') ?? '').includes('json')
    const s = ok ? ((await r.json()) as MailStatus) : OFFLINE
    publish(s)
    return s
  } catch {
    publish(OFFLINE)
    return OFFLINE
  }
}

/** The server's mail status (recipient, how many test emails are left), kept fresh after each send. */
export function useMailStatus(): MailStatus | null {
  const [s, setS] = useState<MailStatus | null>(current)
  useEffect(() => {
    listeners.add(setS)
    if (!current) void refreshMailStatus()
    return () => void listeners.delete(setS)
  }, [])
  return s
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function invoiceHtml(inv: Invoice) {
  const rows = inv.lines
    .map((l) => `<tr><td style="padding:6px 8px;border-top:1px solid #e5e5e5">${esc(l.description)}${l.unitPrice !== l.previousUnitPrice ? `<div style="color:#777;font-size:12px">was ${usd(l.previousUnitPrice)}</div>` : ''}</td><td style="padding:6px 8px;border-top:1px solid #e5e5e5;text-align:right">${l.units.toLocaleString('en-US')}</td><td style="padding:6px 8px;border-top:1px solid #e5e5e5;text-align:right">${usd(l.unitPrice)}</td><td style="padding:6px 8px;border-top:1px solid #e5e5e5;text-align:right">${usd(l.amount)}</td></tr>`)
    .join('')
  return `<div style="margin-top:20px;border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px">
<div style="font-weight:bold">Invoice ${esc(inv.id)}</div>
<div style="color:#666;font-size:12px">Issued ${esc(new Date(inv.issueDate).toDateString())} · due ${esc(new Date(inv.dueDate).toDateString())} (${esc(inv.paymentTerms)}) · bill to ${esc(inv.billTo.name)}</div>
<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px"><thead><tr style="color:#777;text-align:left"><th style="padding:6px 8px;font-weight:normal">Item</th><th style="padding:6px 8px;font-weight:normal;text-align:right">Qty</th><th style="padding:6px 8px;font-weight:normal;text-align:right">Unit price / mo</th><th style="padding:6px 8px;font-weight:normal;text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3" style="padding:8px;border-top:1px solid #ccc;text-align:right;color:#555">Total due each month (was ${usd(inv.previousTotal)})</td><td style="padding:8px;border-top:1px solid #ccc;text-align:right;font-weight:bold">${usd(inv.total)}</td></tr></tfoot></table>
<div style="color:#777;font-size:12px;margin-top:8px">${esc(inv.memo)} The invoice is attached as a PDF.</div></div>`
}

async function toBase64(b: Blob) {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Deliver an approved email to the test inbox, when Real email is on. Call it right after the
 * approve action; it does nothing for drafts, auto-sends, or an email that already went.
 */
export async function deliverOutreach(outreachId: string): Promise<void> {
  const st = useCrm.getState()
  // Only an approve click calls this, for the email it approved, so a playbook-drafted email
  // ("Auto" drafts) goes out like any other once a person approves it. Emails auto-sent by a
  // playbook never reach this function and stay simulated.
  if (!st.liveEmail) {
    if (current?.configured) st.notify({ text: 'Marked sent in the CRM only (simulated). Tick "Send real email" on Automated outreach to deliver approved emails to the test inbox.' })
    return
  }
  const o: Outreach | undefined = st.outreach.find((x) => x.id === outreachId)
  if (!o || o.status !== 'Sent' || (o.delivery && o.delivery.status !== 'Failed')) return
  if (current && (!current.configured || (current.needsPasscode && !current.unlocked))) {
    st.notify({ text: `Not delivered: ${current.reason ?? 'real email is not set up'}` })
    return
  }
  const a = st.accounts.find((x) => x.id === o.accountId)
  const inv = o.invoiceId ? st.invoices.find((i) => i.id === o.invoiceId) : undefined
  st.updateOutreach(o.id, { delivery: { status: 'Sending', at: new Date().toISOString() } })
  try {
    const note = `Herdbook CRM demo: drafted for ${o.contactName} <${o.contactEmail}>${a ? ` at ${a.name}` : ''}. Only the demo's test inbox receives it.`
    const attachments = inv ? [{ filename: `Invoice ${inv.id}.pdf`, content: await toBase64(await invoicePdf(inv)) }] : []
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111;max-width:640px">
<p style="font-size:12px;color:#777;border-bottom:1px solid #e5e5e5;padding-bottom:8px;margin:0 0 14px">${esc(note)}</p>
<div style="white-space:pre-wrap">${esc(o.body)}</div>${inv ? invoiceHtml(inv) : ''}</div>`
    const r = await fetch('/api/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json', ...passHeader() }, body: JSON.stringify({ outreachId: o.id, subject: o.subject, text: `${note}\n\n${o.body}${inv ? `\n\nInvoice ${inv.id}: $${inv.total.toLocaleString('en-US')} a month (attached as a PDF).` : ''}`, html, attachments }) })
    const json = (await r.json().catch(() => ({}))) as { id?: string; to?: string; error?: string }
    if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`)
    useCrm.getState().updateOutreach(o.id, { delivery: { status: 'Delivered', at: new Date().toISOString(), to: json.to, providerId: json.id } })
    useCrm.getState().log(o.accountId, 'Email', `Delivered "${o.subject}"${inv ? ` with invoice ${inv.id}` : ''} to the demo test inbox (${json.to}).`)
    useCrm.getState().notify({ text: `Real email sent to ${json.to}${inv ? ' with the invoice PDF' : ''}.` })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    useCrm.getState().updateOutreach(o.id, { delivery: { status: 'Failed', at: new Date().toISOString(), error } })
    useCrm.getState().notify({ text: `Not delivered: ${error}` })
  } finally {
    void refreshMailStatus()
  }
}
