import type { Account, Contract, Opportunity } from '../types'
import { CLAUSE, REDLINE_BY_KEY, REDLINE_LIBRARY } from '../data/contracts'
import { PRODUCT } from '../data/products'

export interface LucasItem {
  redlineId: string
  recommendation: 'Accept' | 'Counter' | 'Reject'
  risk: 'Low' | 'Medium' | 'High'
  counterLanguage: string
  rationale: string
}

export interface LucasReview {
  summary: string
  overallRisk: 'Low' | 'Medium' | 'High'
  items: LucasItem[]
  concessionPlan: string[]
  closingStrategy: string
  replyEmail: { subject: string; body: string }
  source: string
  createdAt: string
}

let statusPromise: Promise<{ ai: boolean; model: string; error?: string }> | null = null
export function lucasStatus() {
  if (import.meta.env.VITE_ARTIFACT) {
    statusPromise ??= Promise.resolve({ ai: false, model: 'offline', error: 'Published demo link: Lucas runs on the playbook rules. Run the app locally with an API key for AI review.' })
    return statusPromise
  }
  statusPromise ??= fetch('/api/status')
    .then((r) => (r.ok ? r.json() : { ai: false, model: 'offline', error: `HTTP ${r.status}` }))
    .then((st: { ai: boolean; model: string; error?: string }) =>
      st.ai || !st.error || !/authentication|api.?key|credential/i.test(st.error) ? st : { ...st, error: 'No Anthropic API key is set on the server.' },
    )
    .catch(() => ({ ai: false, model: 'offline', error: 'API server not reachable (static build?)' }))
  return statusPromise
}

export function dealContext(account: Account, contract: Contract, opp?: Opportunity, rep?: string) {
  return {
    rep,
    customer: {
      name: account.name,
      species: account.species,
      segment: account.segment,
      location: `${account.county} County, ${account.state}`,
      headCount: account.headCount,
      sites: account.sites,
      barns: account.barns,
      ownership: account.ownership,
      parentCompany: account.parentCompany,
      integratorOrPacker: account.integrator,
      status: account.status,
      decisionMakers: account.contacts.filter((c) => ['Owner', 'GM', 'CFO'].includes(c.role)).map((c) => `${c.name} (${c.title})`),
    },
    opportunity: opp ? { type: opp.type, arr: opp.arr, products: opp.products.map((p) => PRODUCT[p].name), closeDate: opp.closeDate } : undefined,
    contract: { id: contract.id, template: contract.template, termMonths: contract.termMonths, paymentTerms: contract.paymentTerms, pricing: contract.price, autoRenew: contract.autoRenew },
    redlines: contract.redlines.map((r) => ({ redlineId: r.id, clause: `${CLAUSE[r.clauseId].number}. ${CLAUSE[r.clauseId].title}`, ourLanguage: r.original, customerProposal: r.proposed, customerNote: r.customerNote })),
  }
}

export function offlineReview(account: Account, contract: Contract, rep: string): LucasReview {
  const items: LucasItem[] = contract.redlines.map((r) => {
    // Asks read from email or customer paper can carry a custom key: use the playbook entry for the same clause.
    const t = REDLINE_BY_KEY[r.key] ?? REDLINE_LIBRARY.find((x) => x.clauseId === r.clauseId)
    if (!t) return { redlineId: r.id, recommendation: 'Counter' as const, risk: 'Medium' as const, counterLanguage: r.original, rationale: `No playbook entry for this ask on ${CLAUSE[r.clauseId]?.title ?? r.clauseId}. Hold our template language and ask what problem the change solves for them.` }
    return { redlineId: r.id, recommendation: t.offline.recommendation, risk: t.offline.risk, counterLanguage: t.offline.counter ?? r.proposed, rationale: t.offline.rationale }
  })
  const high = items.filter((i) => i.risk === 'High').length
  const accepts = contract.redlines.filter((_, i) => items[i].recommendation === 'Accept').map((r) => CLAUSE[r.clauseId].title)
  const hard = contract.redlines.filter((_, i) => items[i].risk === 'High').map((r) => CLAUSE[r.clauseId].title)
  const owner = account.contacts.find((c) => ['Owner', 'GM'].includes(c.role)) ?? account.contacts[0]
  return {
    summary: `${account.name} sent ${items.length} redlines. ${accepts.length} can be accepted as-is, and ${high} ${high === 1 ? 'is' : 'are'} high-risk and need a counter or rejection.`,
    overallRisk: high >= 2 ? 'High' : high === 1 ? 'Medium' : 'Low',
    items,
    concessionPlan: [
      ...(accepts.length ? [`Give: accept ${accepts.join(', ')} up front to build goodwill.`] : []),
      ...(hard.length ? [`Get: hold the playbook fallback on ${hard.join(', ')}.`] : []),
      'If they push back again, offer a 24-month price lock in exchange for keeping the liability cap and auto-renewal.',
    ],
    closingStrategy: 'Send the counter package within 48 hours, and set up a 30-minute call with the decision-maker to walk through the high-risk items live rather than trading documents.',
    replyEmail: {
      subject: `${account.name}: our response on the agreement`,
      body: `Hi ${owner.name.split(' ')[0]},\n\nThanks for the markup. We can accept ${accepts.length ? accepts.join(', ') : 'several of your changes'} as proposed. On ${hard.length ? hard.join(' and ') : 'the remaining points'}, we've suggested language that addresses the concern in your notes while keeping the agreement workable for both sides.\n\nThe redline is attached. Could we do a 30-minute call this week to close out the last items?\n\nBest,\n${rep}`,
    },
    source: 'offline-playbook',
    createdAt: new Date().toISOString(),
  }
}

export async function reviewContract(account: Account, contract: Contract, opp: Opportunity | undefined, rep: string): Promise<{ review: LucasReview; error?: string }> {
  const st = await lucasStatus()
  // Offline is an expected mode (no key, or the published demo), not an error; the status line already says so.
  if (!st.ai) return { review: offlineReview(account, contract, rep) }
  try {
    const r = await fetch('/api/lucas/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dealContext(account, contract, opp, rep)) })
    const json = await r.json()
    if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`)
    return { review: { ...json, createdAt: new Date().toISOString() } }
  } catch (e) {
    return { review: offlineReview(account, contract, rep), error: e instanceof Error ? e.message : String(e) }
  }
}

export async function chatWithLucas(context: unknown, messages: { role: 'user' | 'assistant'; content: string }[], onDelta: (t: string) => void): Promise<void> {
  const st = await lucasStatus()
  if (!st.ai) {
    onDelta(
      "I'm running in offline playbook mode right now, so I can only give you the standard positions. Add an `ANTHROPIC_API_KEY` to `.env` and restart the dev server so I can reason about this deal properly.\n\nIn the meantime: accept anything inside our fallback positions, counter liability and termination asks with the playbook fallback, and never agree to uncapped indemnity or livestock-loss liability.",
    )
    return
  }
  const r = await fetch('/api/lucas/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, messages }) })
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error ?? `HTTP ${r.status}`)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onDelta(dec.decode(value, { stream: true }))
  }
}

export async function aiRewriteOutreach(payload: unknown): Promise<{ subject: string; body: string } | { error: string }> {
  const st = await lucasStatus()
  if (!st.ai) return { error: 'AI is offline. Add ANTHROPIC_API_KEY to .env to enable rewrites.' }
  try {
    const r = await fetch('/api/ai/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const j = await r.json()
    return r.ok ? j : { error: j.error ?? `HTTP ${r.status}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
