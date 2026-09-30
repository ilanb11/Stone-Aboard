import type { ServerResponse } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Real email for the demo, sent through Resend (https://resend.com) from the dev server so
// the API key never reaches the browser. Guard rails, all enforced here rather than in the
// page:
// - One recipient: every email goes to MAIL_TEST_TO, whoever it was drafted for. The page
//   can't choose the address.
// - A hard cap: at most MAIL_MAX_SENDS emails (never more than HARD_CAP), counted in
//   .mail-log.json so restarting the server doesn't reset it. Delete that file to reset.
// - Once per message: an outreach id that was sent (or might have been) is never sent again.
// Automatic sends in the CRM stay simulated; only a person's click calls this.

const HARD_CAP = 5
const LOG = join(process.cwd(), '.mail-log.json')
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

interface LogEntry {
  outreachId: string
  subject: string
  to: string
  at: string
  /** 'unknown': the request may have reached Resend (a timeout); it counts as sent. */
  status: 'sending' | 'sent' | 'failed' | 'unknown'
  providerId?: string
  error?: string
}

/** A mail setting: the process environment, else .env read fresh, so a key pasted in takes effect without a restart. */
function setting(k: string): string {
  if (process.env[k]?.trim()) return process.env[k]!.trim()
  try {
    const file = join(process.cwd(), '.env')
    const m = existsSync(file) ? readFileSync(file, 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')) : null
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

function config() {
  const raw = setting('MAIL_MAX_SENDS')
  const n = Number(raw)
  const to = setting('MAIL_TEST_TO')
  return {
    key: setting('RESEND_API_KEY'),
    to: EMAIL.test(to) ? to : '',
    max: Math.min(HARD_CAP, raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : HARD_CAP),
    from: setting('MAIL_FROM') || 'Herdbook demo <onboarding@resend.dev>',
  }
}

const readLog = (): LogEntry[] => {
  try {
    return existsSync(LOG) ? (JSON.parse(readFileSync(LOG, 'utf8')) as LogEntry[]) : []
  } catch {
    // A damaged log must not reopen the cap: treat it as full until someone looks at it.
    return Array.from({ length: HARD_CAP }, (_, i) => ({ outreachId: `unreadable-${i}`, subject: '', to: '', at: '', status: 'unknown' as const }))
  }
}
const writeLog = (log: LogEntry[]) => writeFileSync(LOG, JSON.stringify(log, null, 2))
const counted = (log: LogEntry[]) => log.filter((e) => e.status !== 'failed').length

function status() {
  const c = config()
  const log = readLog()
  const used = counted(log)
  const reason = !c.key ? 'Paste your Resend API key after RESEND_API_KEY= in .env, save, then press the refresh button here.' : !c.to ? 'Add MAIL_TEST_TO (your own address) to .env, save, then press the refresh button here.' : used >= c.max ? `The limit of ${c.max} test emails is used up. Delete .mail-log.json to reset it.` : undefined
  return { configured: !!c.key && !!c.to, to: c.to, sent: used, max: c.max, remaining: Math.max(0, c.max - used), reason, recent: log.slice(-5).reverse().map(({ subject, at, status }) => ({ subject, at, status })) }
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

interface SendBody {
  outreachId?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
  attachments?: unknown
}

// Sends run one at a time, so two quick clicks can't both slip under the cap.
let queue: Promise<unknown> = Promise.resolve()

async function deliver(body: SendBody) {
  const c = config()
  const outreachId = typeof body.outreachId === 'string' ? body.outreachId.slice(0, 80) : ''
  const subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').slice(0, 200) : ''
  const text = typeof body.text === 'string' ? body.text.slice(0, 20_000) : ''
  const html = typeof body.html === 'string' ? body.html.slice(0, 200_000) : undefined
  const files = (Array.isArray(body.attachments) ? body.attachments : [])
    .slice(0, 2)
    .filter((f): f is { filename: string; content: string } => !!f && typeof f.filename === 'string' && typeof f.content === 'string' && f.content.length <= 3_000_000)
    .map((f) => ({ filename: f.filename.replace(/[^\w .()-]/g, '_').slice(0, 100), content: f.content }))
  if (!c.key || !c.to) return { code: 503, body: { error: status().reason } }
  if (!outreachId || !subject || !text) return { code: 400, body: { error: 'Expected outreachId, subject and text.' } }
  const log = readLog()
  const prior = log.find((e) => e.outreachId === outreachId && e.status !== 'failed')
  if (prior) return { code: 409, body: { error: 'This email was already sent to the test inbox.', to: prior.to, at: prior.at } }
  if (counted(log) >= c.max) return { code: 429, body: { error: `The limit of ${c.max} test emails is used up. Delete .mail-log.json in the project folder to reset it.` } }

  // Reserve the slot before calling out, so a crash mid-send still counts against the cap.
  const entry: LogEntry = { outreachId, subject, to: c.to, at: new Date().toISOString(), status: 'sending' }
  log.push(entry)
  writeLog(log)
  const finish = (patch: Partial<LogEntry>) => {
    const next = readLog().map((e) => (e.outreachId === outreachId && e.at === entry.at ? { ...e, ...patch } : e))
    writeLog(next)
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `herdbook-${outreachId}` },
      body: JSON.stringify({ from: c.from, to: [c.to], subject: `[Herdbook demo] ${subject}`, text, html, attachments: files.length ? files : undefined }),
      signal: AbortSignal.timeout(20_000),
    })
    const json = (await r.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!r.ok) {
      // Resend refused it, so nothing went out and the slot is freed.
      finish({ status: 'failed', error: json.message ?? `HTTP ${r.status}` })
      return { code: 502, body: { error: `Resend refused the email: ${json.message ?? `HTTP ${r.status}`}` } }
    }
    finish({ status: 'sent', providerId: json.id })
    return { code: 200, body: { ...status(), id: json.id } }
  } catch (e) {
    // A timeout may still have delivered: keep it counted and don't retry this message.
    finish({ status: 'unknown', error: e instanceof Error ? e.message : String(e) })
    return { code: 504, body: { error: `No answer from Resend (${e instanceof Error ? e.message : String(e)}). Check your inbox before trying another email; this one won't be resent.` } }
  }
}

/** /api/mail/status (GET) and /api/mail/send (POST). Returns false when the url isn't a mail route. */
export async function handleMail(url: string, method: string, readBody: () => Promise<Record<string, unknown>>, res: ServerResponse): Promise<boolean> {
  if (url.startsWith('/api/mail/status')) {
    send(res, 200, status())
    return true
  }
  if (url.startsWith('/api/mail/send')) {
    if (method !== 'POST') {
      send(res, 405, { error: 'POST only' })
      return true
    }
    const body = await readBody()
    const run = queue.then(() => deliver(body))
    queue = run.catch(() => undefined)
    const out = await run
    send(res, out.code, out.body)
    return true
  }
  return false
}
