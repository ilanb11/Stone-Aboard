import { cleanSendBody, mailConfig, maskEmail, resendSend, resendSentCount, samePasscode } from '../../server/mailCore.js'

// Real demo email on Vercel: GET /api/mail/status and POST /api/mail/send. Same rules as the
// local dev server (server/mailCore.ts), with two differences for a public site:
// - Sending needs the passcode in MAIL_SEND_PASSCODE (sent by the page as x-herdbook-passcode).
//   Without it the function sends nothing and shows only a masked address.
// - With MAIL_MAX_SENDS set, the cap is counted from Resend's own history (functions keep no
//   files between calls), which needs a Full access Resend key. With it unset there is no cap
//   and a send-only key is enough.

interface Req {
  method?: string
  query: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface Res {
  status: (code: number) => Res
  setHeader: (k: string, v: string) => void
  json: (body: unknown) => void
}

const env = (k: string) => (process.env[k] ?? '').trim()
const header = (r: Req, k: string) => {
  const v = r.headers[k]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

async function status(unlocked: boolean) {
  const c = mailConfig(env)
  const base = { needsPasscode: true, unlocked, max: c.max, to: unlocked ? c.to : c.to ? maskEmail(c.to) : '' }
  if (!c.key || !c.to) return { ...base, configured: false, sent: 0, remaining: 0, reason: 'Real email is not set up on this deployment: add RESEND_API_KEY and MAIL_TEST_TO in the Vercel project settings and redeploy.' }
  if (!c.passcode) return { ...base, configured: false, sent: 0, remaining: 0, reason: 'Add MAIL_SEND_PASSCODE in the Vercel project settings and redeploy; the public site never sends without it.' }
  // No cap, nothing to count: a send-only key works.
  if (c.max === null) return { ...base, configured: true, sent: null, remaining: null, reason: unlocked ? undefined : 'Enter the demo passcode to send.' }
  const n = await resendSentCount(c.key)
  if ('error' in n) return { ...base, configured: false, sent: 0, remaining: 0, reason: n.restricted ? "The Resend key on Vercel can only send, so the site can't count what was sent and won't send. Create a Full access key in Resend and use it for RESEND_API_KEY on Vercel." : n.error }
  const remaining = Math.max(0, c.max - n.count)
  return { ...base, configured: true, sent: n.count, remaining, reason: remaining ? (unlocked ? undefined : 'Enter the demo passcode to send.') : `The limit of ${c.max} test emails is used up (counted from Resend's history for the last 30 days).` }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  const action = String(Array.isArray(req.query.action) ? req.query.action[0] : req.query.action ?? '')
  const c = mailConfig(env)
  const unlocked = !!c.passcode && samePasscode(header(req, 'x-herdbook-passcode'), c.passcode)

  if (action === 'status') return res.status(200).json(await status(unlocked))
  if (action !== 'send') return res.status(404).json({ error: 'Not found' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!unlocked) return res.status(401).json({ error: c.passcode ? 'Wrong or missing demo passcode.' : 'Sending is off: MAIL_SEND_PASSCODE is not set on this deployment.' })

  const st = await status(true)
  if (!st.configured) return res.status(503).json({ error: st.reason })
  if (st.remaining !== null && st.remaining <= 0) return res.status(429).json({ error: st.reason })
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  const m = cleanSendBody(body)
  if ('error' in m) return res.status(400).json(m)
  const r = await resendSend(c, m)
  if (!r.ok) return res.status(r.refused ? 502 : 504).json({ error: r.error })
  return res.status(200).json({ ...(await status(true)), id: r.id })
}
