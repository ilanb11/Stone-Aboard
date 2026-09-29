import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUSES, TEMPLATE_VERSION } from '../src/data/contracts'

// Lucas the Hog — contract review / negotiation agent, served from the Vite dev
// server so the API key never reaches the browser. Credentials are resolved by
// the SDK (ANTHROPIC_API_KEY in .env, or an `ant auth login` profile).

const MODEL = 'claude-opus-5-5'

const PLAYBOOK = CLAUSES.map((c) => `${c.number}. ${c.title}\n   Template: ${c.text}\n   Standard: ${c.playbook.standard}\n   Fallback: ${c.playbook.fallback}\n   Walk-away: ${c.playbook.walkAway}`).join('\n\n')

const LUCAS_SYSTEM = `You are Lucas the Hog, ThiboLiSoft's deal-desk and contracts agent. ThiboLiSoft sells farm-management software, IoT barn sensors and advisory services to hog and cattle operations: sow farms, wean-to-finish and contract finishers, integrated pork systems, cow-calf ranches, stockers, feedlots and dairies. You help sales reps close deals by reviewing customer redlines to our Master Subscription Agreement against the negotiation playbook below.

How to judge each redline:
- Accept when the change sits inside our standard or fallback position, or costs little and builds goodwill (swine biosecurity requirements are a good example).
- Counter when the customer's underlying concern is legitimate but the proposed language goes past our fallback. Read the customer's note, solve the concern they actually have, and stay inside the fallback.
- Reject only when the change crosses a walk-away position, and still offer the closest acceptable alternative.

Look at the deal as a whole: trade low-cost concessions for protection on high-risk clauses, and weigh deal size and strategic value. Counter-language must be complete contract text for the clause, ready to paste. Rationale should be two or three sentences a rep could say out loud. Farm customers are practical people, not lawyers, so anything written to the customer should be warm, plain-spoken and specific. Don't invent facts about the customer beyond the context you're given. You are not a lawyer: when an item needs legal sign-off (liability, indemnity, data), say so in the rationale.

Negotiation playbook for ${TEMPLATE_VERSION}:

${PLAYBOOK}`

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'overallRisk', 'items', 'concessionPlan', 'closingStrategy', 'replyEmail'],
  properties: {
    summary: { type: 'string', description: 'Two to four sentence read of where this negotiation stands.' },
    overallRisk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['redlineId', 'recommendation', 'risk', 'counterLanguage', 'rationale'],
        properties: {
          redlineId: { type: 'string' },
          recommendation: { type: 'string', enum: ['Accept', 'Counter', 'Reject'] },
          risk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
          counterLanguage: { type: 'string', description: 'Full replacement clause text; for Accept, repeat the customer language.' },
          rationale: { type: 'string' },
        },
      },
    },
    concessionPlan: { type: 'array', items: { type: 'string' }, description: 'Ordered give/get trades to close.' },
    closingStrategy: { type: 'string' },
    replyEmail: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'body'],
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
    },
  },
}

const OUTREACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

let status: { ok: boolean; at: number; error?: string } | null = null
async function aiStatus() {
  if (status && Date.now() - status.at < 5 * 60_000) return status
  try {
    await getClient().models.retrieve(MODEL, {}, { timeout: 8000, maxRetries: 0 })
    status = { ok: true, at: Date.now() }
  } catch (e) {
    client = null
    status = { ok: false, at: Date.now(), error: e instanceof Error ? e.message : String(e) }
  }
  return status
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic credentials were rejected. Check ANTHROPIC_API_KEY.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Try again shortly.'
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

async function structured(system: string, user: string, schema: Record<string, unknown>, effort: 'low' | 'medium' | 'high', maxTokens: number) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  })
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'refusal') throw new Error('Lucas declined this request.')
  if (msg.stop_reason === 'max_tokens') throw new Error('Response was cut off (max_tokens).')
  return { data: JSON.parse(textOf(msg)), model: msg.model }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? ''
  if (url.startsWith('/api/status')) {
    const s = await aiStatus()
    return send(res, 200, { ai: s.ok, model: MODEL, error: s.ok ? undefined : s.error })
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const body = await readJson(req)

  if (url.startsWith('/api/lucas/review')) {
    const { data, model } = await structured(LUCAS_SYSTEM, `Review the customer redlines for this deal and return your analysis.\n\n<deal>\n${JSON.stringify(body, null, 2)}\n</deal>`, REVIEW_SCHEMA, 'high', 16000)
    return send(res, 200, { ...data, source: model })
  }

  if (url.startsWith('/api/ai/outreach')) {
    const { data } = await structured(
      'You write short, specific sales and customer-success emails for ThiboLiSoft, a farm software company serving hog and cattle operations. Write like a trusted rep who knows farming: plain, warm, no hype, under 140 words, one clear ask. Never invent facts beyond the context. Keep the sign-off from the draft.',
      `Rewrite this outreach so it is more personal and specific to the context.\n\n<context>\n${JSON.stringify(body, null, 2)}\n</context>`,
      OUTREACH_SCHEMA,
      'low',
      4000,
    )
    return send(res, 200, data)
  }

  if (url.startsWith('/api/lucas/chat')) {
    const context = body.context as unknown
    const history = (body.messages as { role: 'user' | 'assistant'; content: string }[]) ?? []
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m, i) =>
      i === 0 && m.role === 'user'
        ? { role: 'user', content: `Deal context for this conversation:\n<deal>\n${JSON.stringify(context, null, 2)}\n</deal>\n\nAnswer the rep's questions about this deal concisely and practically. Use short paragraphs or bullets. If they ask for clause language, give complete clause text.\n\n${m.content}` }
        : { role: m.role, content: m.content },
    )
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: LUCAS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium' },
      messages,
    })
    stream.on('text', (t) => res.write(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') res.write('\n\n[Lucas declined to answer this one.]')
    return res.end()
  }
  send(res, 404, { error: 'Not found' })
}

export function lucasApi(): Plugin {
  return {
    name: 'lucas-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        handle(req, res).catch((e) => {
          if (res.headersSent) {
            res.end(`\n\n[Error: ${errorMessage(e)}]`)
          } else send(res, 500, { error: errorMessage(e) })
        })
      })
    },
  }
}
