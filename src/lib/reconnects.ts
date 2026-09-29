import type { Account, Activity, Opportunity, Outreach, Signal } from '../types'
import { PRODUCT } from '../data/products'
import { pickContact } from './outreach'

// Reconnects: lost and on-ice deals worth reopening. Each one is scored from the
// rep's notes on the account (when they said to come back, or what would change
// their mind) and from what has happened since (new leaders, expansions, money,
// integrator moves, a competitor contract coming up). Pure functions.

const DAY = 86400000
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export interface ReconnectWindow {
  from: Date
  to: Date
  /** Plain words for when to reach out, from the note. */
  label: string
  /** The same timing as the customer would put it, for the email ("after harvest", "in July"). */
  ask: string
}

/** A delay the rep wrote in days, as the customer would say it. */
const inAbout = (days: number) => (days < 45 ? 'in a month or so' : days < 75 ? 'in a couple of months' : `in about ${Math.round(days / 30)} months`)

/** Timing the rep wrote down: "after harvest", "in January", "in 60 days", "before it renews". */
export function noteWindow(text: string, noteDate: Date, a?: Pick<Account, 'competitorRenewal'>): ReconnectWindow | null {
  const t = text.toLowerCase()
  const y = noteDate.getFullYear()
  const span = (from: Date, days: number, label: string, ask = label) => ({ from, to: new Date(from.getTime() + days * DAY), label, ask })
  // This year's window, unless it had already closed when the note was written.
  const yearly = (m: number, d: number, days: number, label: string, ask = label) => {
    const x = new Date(y, m, d)
    return span(x.getTime() + days * DAY < noteDate.getTime() ? new Date(y + 1, m, d) : x, days, label, ask)
  }
  const inMonth = (i: number) => yearly(i, 1, 45, `in ${MONTHS[i][0].toUpperCase()}${MONTHS[i].slice(1)}`)
  let m: RegExpMatchArray | null
  if ((m = t.match(/in (\d+) days/))) return span(new Date(noteDate.getTime() + Number(m[1]) * DAY), 30, `${m[1]} days after the note`, inAbout(Number(m[1])))
  if ((m = t.match(/(\d+) days to/))) return span(new Date(noteDate.getTime() + Number(m[1]) * DAY), 45, `after ${m[1]} days`, inAbout(Number(m[1])))
  // "Call in July" is the month the customer named, even when a renewal date is on file.
  let i = MONTHS.findIndex((x) => t.includes(`call in ${x}`))
  if (i >= 0) return inMonth(i)
  if (/after harvest/.test(t) || /early november/.test(t)) return yearly(9, 15, 60, 'after harvest')
  if (/budget|january/.test(t)) return yearly(11, 1, 75, 'for next year’s budget (December to mid-February)', 'in time for next year’s budget')
  if (/spring/.test(t)) return yearly(2, 1, 90, 'in the spring')
  if (/this fall/.test(t)) return span(new Date(y, 8, 1), 90, 'this fall')
  if (/in the fall/.test(t)) return yearly(8, 1, 90, 'in the fall')
  i = MONTHS.findIndex((x) => t.includes(`in ${x}`))
  if (i >= 0) return inMonth(i)
  if (/renews/.test(t) && a?.competitorRenewal) {
    const r = new Date(a.competitorRenewal)
    return { from: new Date(r.getTime() - 90 * DAY), to: r, label: 'before their current contract renews', ask: 'before your current contract renews' }
  }
  if (/next month/.test(t)) return span(new Date(noteDate.getTime() + 35 * DAY), 45, 'about a month after the note', 'in a month or so')
  return null
}

/** What the note says would change their mind, matched to a signal type. */
const CONDITIONS: { test: RegExp; signal: Signal['type']; label: string }[] = [
  { test: /new (farm )?manager|replacement|production manager|new leader/, signal: 'Leadership Change', label: 'the new manager they were waiting for' },
  { test: /integrator|packer/, signal: 'Integrator / Packer Change', label: 'a change of integrator' },
  { test: /next barn|expan/, signal: 'Expansion', label: 'the expansion the note mentions' },
  { test: /lender|banker|budget/, signal: 'Financial', label: 'new financing' },
]

/** Words in a newer note that show the customer warming up, and ones that say they haven't. */
const WARM = /\b(ask(s|ed|ing)?|interest(ed)?|keen|pric(e|es|ing)|quote|proposal|demo|reference|send|call(ed)? (me |us )?back|meet(ing)?)\b/i
const COLD = /not interested|no interest|lost interest|(don[’']t|do not) (call|contact)|stop calling/i

export type ReconnectTiming = 'Now' | 'Soon' | 'Later'

export interface Reconnect {
  opp: Opportunity
  account: Account
  score: number
  timing: ReconnectTiming
  /** When to reach out. */
  due: Date
  reasons: string[]
  /** The note the suggestion rests on. */
  note?: Activity
  window?: ReconnectWindow
  contact: { name: string; title: string; email: string }
  /** One line to open the email with. */
  angle: string
}

export function scoreReconnect(o: Opportunity, a: Account, notes: Activity[], signals: Signal[], today = new Date()): Reconnect | null {
  if (o.stage !== 'Closed Lost' && o.stage !== 'On Ice') return null
  if (a.status === 'Customer' && o.type === 'New Logo') return null // they came back on their own
  const since = new Date(o.stageChangedAt ?? o.closeDate)
  const ageDays = (today.getTime() - since.getTime()) / DAY
  const accountNotes = notes.filter((n) => n.accountId === a.id && (n.kind === 'Note' || n.kind === 'Call')).sort((x, y) => y.date.localeCompare(x.date))
  const reasons: string[] = []
  let score = 15
  let angle = ''
  // The rep's note on this deal when it stalled; else the newest note from then on (or the day before), else the newest one.
  const main =
    accountNotes.find((n) => n.id === `V-R-${o.id}` && new Date(n.date) >= since) ??
    accountNotes.find((n) => new Date(n.date).getTime() >= since.getTime() - DAY) ??
    accountNotes[0]
  const window = main ? noteWindow(main.text, new Date(main.date), a) : null
  // Events since the deal stalled, and whether one is the change the note was waiting for.
  const after = signals.filter((s) => s.accountId === a.id && new Date(s.date) > since)
  const cond = main ? CONDITIONS.find((c) => c.test.test(main.text.toLowerCase())) : undefined
  const waited = !!cond && after.some((s) => s.type === cond.signal)
  // A fresh loss gets a month's rest unless that change has happened.
  const resting = ageDays < 30 && !waited
  let due = window?.from ?? new Date(since.getTime() + (o.stage === 'On Ice' ? 90 : 180) * DAY)
  if (window) {
    if (today >= window.from && today <= window.to) {
      score += 35
      reasons.push(`The note says to come back ${window.label}${resting ? '' : ', which is now'}`)
      angle = `When we last spoke you asked me to check back ${window.ask}.`
    } else if (window.from > today && window.from.getTime() - today.getTime() < 30 * DAY) {
      score += 20
      if (!waited) reasons.push(`The note says to come back ${window.label}, starting ${window.from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
      angle = `You asked me to check back ${window.ask}, and I wanted to get something on the calendar ahead of that.`
    } else if (window.to < today) {
      score += 10
      reasons.push(`The follow-up the note asked for (${window.label}) has passed`)
      angle = `I meant to check back ${window.ask} and didn’t want to let it slip further.`
      due = today
    }
  }
  for (const s of after) {
    const w = s.type === 'Leadership Change' ? 25 : s.type === 'Ownership Change' ? 22 : s.type === 'Expansion' ? 22 : s.type === 'Integrator / Packer Change' ? 18 : s.type === 'Financial' ? 12 : 0
    if (!w) continue
    const met = cond?.signal === s.type
    score += met ? w + 15 : w
    reasons.push(met ? `${s.headline} (the change the note was waiting for)` : s.headline)
    if (!angle || met) angle = s.type === 'Leadership Change' ? 'Congratulations on the new role.' : s.type === 'Expansion' ? 'Congratulations on the expansion.' : s.type === 'Ownership Change' ? 'I saw the news about the new ownership.' : s.type === 'Financial' ? 'I heard the financing came through.' : 'I saw you’re working with a new partner.'
    if (met || new Date(s.date) > due || !window) due = today
  }
  // A real vendor contract renewing soon (spreadsheets don't renew).
  if (a.competitorRenewal && !/spreadsheet|paper|none/i.test(a.competitor ?? '')) {
    const d = (new Date(a.competitorRenewal).getTime() - today.getTime()) / DAY
    if (d > 0 && d < 120) {
      score += 25
      reasons.push(`${a.competitor ?? 'Their current vendor'} renews in ${Math.round(d)} days`)
      if (!angle) angle = `Your ${a.competitor ?? 'current'} agreement comes up soon, and I’d like to give you a real alternative before it renews.`
    }
  }
  // A warm-up since the stall: the seeded ones, or a note logged in the app that shows interest.
  // Seeded check-ins (V-<account>) are routine, and app-logged notes never have a "V-" id.
  const later = accountNotes.find((n) => n !== main && new Date(n.date) > since && (n.id.startsWith('V-R2-') || (!n.id.startsWith('V-') && WARM.test(n.text) && !COLD.test(n.text))))
  if (later) {
    score += 12
    reasons.push(`Newer note: “${later.text}”`)
  }
  if (ageDays < 30) {
    score -= 25
    if (resting) {
      reasons.push('Stalled less than a month ago; give it time')
      const rested = new Date(since.getTime() + 30 * DAY)
      if (due < rested) due = rested
    }
  } else if (ageDays > 400) score -= 10
  // Bigger deals are worth more effort.
  score += Math.min(12, Math.log10(Math.max(1000, o.arr)) * 3 - 9)
  score = Math.max(0, Math.min(100, Math.round(score)))
  if (!reasons.length) reasons.push(o.stage === 'On Ice' ? `On ice ${Math.round(ageDays)} days: ${o.reason ?? 'no reason noted'}` : `Lost ${Math.round(ageDays)} days ago: ${o.reason ?? 'no reason noted'}`)
  // A high score doesn't jump the note's timing or a fresh loss's rest; the change the note was waiting for does.
  const hold = resting || (!waited && !!window && window.from > today)
  const timing: ReconnectTiming = !hold && (due <= today || score >= 55) ? 'Now' : due.getTime() - today.getTime() < 45 * DAY ? 'Soon' : 'Later'
  const leader = after.find((s) => s.type === 'Leadership Change')
  const newest = leader ? [...a.contacts].sort((x, y) => y.since.localeCompare(x.since))[0] : undefined
  const c = newest ?? pickContact(a, ['Owner', 'GM', 'CFO'])
  return {
    opp: o,
    account: a,
    score,
    timing,
    due: due < today ? today : due,
    reasons,
    note: main,
    window: window ?? undefined,
    contact: { name: c.name, title: c.title, email: c.email },
    angle: angle || 'It’s been a while, and a few things have changed on our side that fit what you were after.',
  }
}

/** The latest lost or on-ice deal per account that hasn't been reopened, scored and ranked. */
export function findReconnects(opps: Opportunity[], byId: Record<string, Account>, notes: Activity[], signals: Signal[], today = new Date()): Reconnect[] {
  const latest = new Map<string, Opportunity>()
  const hasOpen = new Set(opps.filter((o) => ['Prospect', 'Demo', 'Negotiation'].includes(o.stage)).map((o) => o.accountId))
  for (const o of opps) {
    if ((o.stage !== 'Closed Lost' && o.stage !== 'On Ice') || hasOpen.has(o.accountId)) continue
    const cur = latest.get(o.accountId)
    if (!cur || (o.stageChangedAt ?? o.closeDate) > (cur.stageChangedAt ?? cur.closeDate)) latest.set(o.accountId, o)
  }
  return [...latest.values()]
    .map((o) => (byId[o.accountId] ? scoreReconnect(o, byId[o.accountId], notes, signals, today) : null))
    .filter((r) => !!r)
    .sort((x, y) => y.score - x.score || x.due.getTime() - y.due.getTime())
}

/** A reconnect email, always a draft for the rep to approve. */
export function draftReconnect(r: Reconnect): Omit<Outreach, 'id' | 'createdAt' | 'status'> {
  const first = r.contact.name.split(' ')[0]
  const products = r.opp.products.map((p) => PRODUCT[p]?.name).filter(Boolean)
  const what = products.length > 1 ? `${products.slice(0, -1).join(', ')} and ${products[products.length - 1]}` : products[0] ?? 'our platform'
  const body = [
    `Hi ${first},`,
    '',
    // The loss reason stays out: it's the rep's shorthand, not something to tell the customer.
    `${r.angle} We talked earlier about ${what} for ${r.account.name}, and the timing wasn’t right.`,
    '',
    `If it’s useful, I can show you what operations like yours have gotten out of it this year, and put together pricing that fits where you are now. Would a 20-minute call next week work?`,
    '',
    'Best,',
    r.account.rep,
    'ThiboLiSoft',
  ].join('\n')
  return {
    accountId: r.account.id,
    trigger: `Reconnect (${r.opp.stage === 'On Ice' ? 'on ice' : 'lost'}: ${r.opp.reason ?? 'no reason'})`,
    playbook: 'reconnect',
    contactName: r.contact.name,
    contactEmail: r.contact.email,
    subject: `${r.account.name}: picking our conversation back up`,
    body,
    auto: false,
  }
}
