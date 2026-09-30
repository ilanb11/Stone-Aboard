// Shared by the local dev server (server/mail.ts) and the Vercel function (api/mail/[action].ts):
// the rules for real demo email, and the calls to Resend. No Node-only imports, so both
// runtimes can use it.
//
// The rules: one recipient (MAIL_TEST_TO, never an address from the page), each message once,
// and an optional cap: with MAIL_MAX_SENDS set, at most that many emails (counted from Resend's
// own history on Vercel, which needs a Full access key); without it there's no limit and a
// send-only key is enough. Every email's subject starts with PREFIX, which is how the sent ones
// are recognized in that history (kept 30 days on the free plan).

const HISTORY_STOP = 1000
export const PREFIX = '[Herdbook demo] '
export const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export interface MailConfig {
  key: string
  to: string
  /** null: no limit. */
  max: number | null
  from: string
  /** Required on a public deployment: without it, anyone who found the site could send. */
  passcode: string
}

export function mailConfig(get: (k: string) => string): MailConfig {
  const raw = get('MAIL_MAX_SENDS')
  const n = Number(raw)
  const to = get('MAIL_TEST_TO')
  return {
    key: get('RESEND_API_KEY'),
    to: EMAIL.test(to) ? to : '',
    max: raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null,
    from: get('MAIL_FROM') || 'Herdbook demo <onboarding@resend.dev>',
    passcode: get('MAIL_SEND_PASSCODE'),
  }
}

/** j***@example.com: enough to recognize your own address, without publishing it. */
export const maskEmail = (e: string) => e.replace(/^(.)[^@]*/, '$1***')

/** Constant-time compare, so the passcode can't be guessed a character at a time. */
export function samePasscode(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/**
 * How many demo emails Resend has sent for this account (subjects starting with PREFIX).
 * Needs a Full access key: a send-only key can't read the history.
 */
export async function resendSentCount(key: string, stopAt = HISTORY_STOP): Promise<{ count: number } | { error: string; restricted: boolean }> {
  let count = 0
  let after = ''
  for (let page = 0; page < 10; page++) {
    let r: Response
    try {
      r = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
    } catch (e) {
      return { error: `Couldn't reach Resend to count sent emails (${e instanceof Error ? e.message : String(e)}).`, restricted: false }
    }
    const json = (await r.json().catch(() => ({}))) as { data?: { id: string; subject?: string }[]; has_more?: boolean; name?: string; message?: string }
    if (!r.ok) return { error: json.message ?? `Resend answered HTTP ${r.status}`, restricted: json.name === 'restricted_api_key' }
    const data = json.data ?? []
    count += data.filter((e) => (e.subject ?? '').startsWith(PREFIX.trim())).length
    if (count >= stopAt || !json.has_more || !data.length) break
    after = data[data.length - 1].id
  }
  return { count }
}

export interface CleanSend {
  outreachId: string
  subject: string
  text: string
  html?: string
  files: { filename: string; content: string }[]
}

/** Validate and trim what the page sent. The page never chooses the recipient. */
export function cleanSendBody(body: Record<string, unknown>): CleanSend | { error: string } {
  const outreachId = typeof body.outreachId === 'string' ? body.outreachId.slice(0, 80) : ''
  const subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').slice(0, 200) : ''
  const text = typeof body.text === 'string' ? body.text.slice(0, 20_000) : ''
  const html = typeof body.html === 'string' ? body.html.slice(0, 200_000) : undefined
  const files = (Array.isArray(body.attachments) ? body.attachments : [])
    .slice(0, 2)
    .filter((f): f is { filename: string; content: string } => !!f && typeof f.filename === 'string' && typeof f.content === 'string' && f.content.length <= 3_000_000)
    .map((f) => ({ filename: f.filename.replace(/[^\w .()-]/g, '_').slice(0, 100), content: f.content }))
  if (!outreachId || !subject || !text) return { error: 'Expected outreachId, subject and text.' }
  return { outreachId, subject, text, html, files }
}

/** Send one email through Resend. 'refused' means Resend rejected it, so nothing went out. */
export async function resendSend(c: MailConfig, m: CleanSend): Promise<{ ok: true; id?: string } | { ok: false; refused: boolean; error: string }> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // Resend drops a repeat of the same key within 24 hours, so a retried request can't send twice.
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `herdbook-${m.outreachId}` },
      body: JSON.stringify({ from: c.from, to: [c.to], subject: `${PREFIX}${m.subject}`, text: m.text, html: m.html, attachments: m.files.length ? m.files : undefined }),
      signal: AbortSignal.timeout(20_000),
    })
    const json = (await r.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!r.ok) return { ok: false, refused: true, error: `Resend refused the email: ${json.message ?? `HTTP ${r.status}`}` }
    return { ok: true, id: json.id }
  } catch (e) {
    return { ok: false, refused: false, error: `No answer from Resend (${e instanceof Error ? e.message : String(e)}). Check your inbox before trying another email; this one won't be resent.` }
  }
}
