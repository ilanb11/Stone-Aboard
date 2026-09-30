import type { ServerResponse } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARD_CAP, cleanSendBody, mailConfig, resendSend, resendSentCount } from './mailCore'

// Real email for the demo from the local dev server (the Vercel deployment uses
// api/mail/[action].ts with the same rules from mailCore.ts). Guard rails, enforced here
// rather than in the page:
// - One recipient: every email goes to MAIL_TEST_TO, whoever it was drafted for.
// - A hard cap of 5, counted in .mail-log.json so restarting doesn't reset it (delete the
//   file to reset), and also in Resend's own history when the key can read it, so the
//   local server and Vercel share one limit.
// - Once per message: an outreach id that was sent (or might have been) is never sent again.
// Automatic sends in the CRM stay simulated; only a person's click calls this.

const LOG = join(process.cwd(), '.mail-log.json')

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
const config = () => mailConfig(setting)

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

/** Sends so far: the local log, or Resend's history if that shows more (sends from Vercel). */
async function used(key: string, log: LogEntry[]) {
  const local = counted(log)
  if (!key) return local
  const remote = await resendSentCount(key)
  return 'count' in remote ? Math.max(local, remote.count) : local
}

async function status() {
  const c = config()
  const log = readLog()
  const n = await used(c.key, log)
  const reason = !c.key ? 'Paste your Resend API key after RESEND_API_KEY= in .env, save, then press the refresh button here.' : !c.to ? 'Add MAIL_TEST_TO (your own address) to .env, save, then press the refresh button here.' : n >= c.max ? `The limit of ${c.max} test emails is used up. Delete .mail-log.json to reset the local count.` : undefined
  return { configured: !!c.key && !!c.to, to: c.to, sent: n, max: c.max, remaining: Math.max(0, c.max - n), reason, needsPasscode: false, recent: log.slice(-5).reverse().map(({ subject, at, status }) => ({ subject, at, status })) }
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Sends run one at a time, so two quick clicks can't both slip under the cap.
let queue: Promise<unknown> = Promise.resolve()

async function deliver(body: Record<string, unknown>) {
  const c = config()
  if (!c.key || !c.to) return { code: 503, body: { error: (await status()).reason } }
  const m = cleanSendBody(body)
  if ('error' in m) return { code: 400, body: m }
  const log = readLog()
  const prior = log.find((e) => e.outreachId === m.outreachId && e.status !== 'failed')
  if (prior) return { code: 409, body: { error: 'This email was already sent to the test inbox.', to: prior.to, at: prior.at } }
  if ((await used(c.key, log)) >= c.max) return { code: 429, body: { error: `The limit of ${c.max} test emails is used up.` } }

  // Reserve the slot before calling out, so a crash mid-send still counts against the cap.
  const entry: LogEntry = { outreachId: m.outreachId, subject: m.subject, to: c.to, at: new Date().toISOString(), status: 'sending' }
  log.push(entry)
  writeLog(log)
  const finish = (patch: Partial<LogEntry>) => writeLog(readLog().map((e) => (e.outreachId === m.outreachId && e.at === entry.at ? { ...e, ...patch } : e)))
  const r = await resendSend(c, m)
  if (r.ok) {
    finish({ status: 'sent', providerId: r.id })
    return { code: 200, body: { ...(await status()), id: r.id } }
  }
  // Refused: nothing went out and the slot is freed. No answer: it may have gone, so it stays counted.
  finish({ status: r.refused ? 'failed' : 'unknown', error: r.error })
  return { code: r.refused ? 502 : 504, body: { error: r.error } }
}

/** /api/mail/status (GET) and /api/mail/send (POST). Returns false when the url isn't a mail route. */
export async function handleMail(url: string, method: string, readBody: () => Promise<Record<string, unknown>>, res: ServerResponse): Promise<boolean> {
  if (url.startsWith('/api/mail/status')) {
    send(res, 200, await status())
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
