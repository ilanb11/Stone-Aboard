// Text handling for tracked email: normalization, quote splitting, fingerprints,
// and the small parsers the offline rules rely on. Pure functions.

/** Straight quotes and apostrophes, one space, no zero-width characters. Every regex runs on this. */
export const normalize = (t: string) =>
  t
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\r\n?/g, '\n')

/** Split a body into what the sender wrote now and the quoted history below it. */
export function splitQuoted(body: string): { fresh: string; quoted: string; inline: boolean } {
  const t = normalize(body)
  const lines = t.split('\n')
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(l) || /^From:\s.+/i.test(l) || /^>/.test(l)) {
      cut = i
      break
    }
  }
  const fresh = lines.slice(0, cut).join('\n').trim()
  const quoted = lines.slice(cut).join('\n').trim()
  // "See my answers inline" means the new content is inside the quote.
  const inline = /\b(inline|in red|see below|answers? below|responses? below|comments? below)\b/i.test(fresh) && quoted.length > 0
  return { fresh, quoted, inline }
}

/** Lines the customer added inside a quoted message (answers written inline). */
export function inlineAnswers(quoted: string): string {
  return quoted
    .split('\n')
    .filter((l) => !/^>/.test(l) && !/^(On .+wrote:|From:|Sent:|To:|Subject:|Cc:)/i.test(l) && l.trim())
    .join('\n')
}

/** Inline answers, each paired with the quoted line it answers ("> 3. Payment Terms: Net 45" then "Works for us"). */
export function inlinePairs(quoted: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = []
  let q = ''
  for (const l of quoted.split('\n')) {
    if (/^>/.test(l)) {
      q = l.replace(/^>+\s?/, '').trim()
      continue
    }
    if (!l.trim() || /^(On .+wrote:|From:|Sent:|To:|Subject:|Cc:)/i.test(l)) continue
    out.push({ q, a: l.trim() })
  }
  return out
}

/** Normalize a subject for threading: no Re:/Fwd: prefixes, lower case, single spaces. */
export const threadSubject = (s: string) =>
  normalize(s)
    .replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h.toString(36)
}

/**
 * Content fingerprint that survives a forward or a paste: sender, thread subject and
 * the new text with links, images and whitespace removed. No dates (forwards show
 * local time without a zone); attachments are part of it when present.
 */
export function fingerprint(m: { from: { email: string }; subject: string; text: string; attachments?: { name: string }[] }): string {
  const body = normalize(m.text)
    .replace(/<https?:[^>]+>|https?:\/\/\S+/g, '')
    .replace(/\[image:[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 600)
  const files = (m.attachments ?? []).map((a) => a.name.toLowerCase()).sort().join('|')
  return `fp:${m.from.email.toLowerCase()}|${hash(threadSubject(m.subject))}|${hash(body)}|${hash(files)}`
}

export const emailDomain = (e: string) => e.toLowerCase().split('@')[1] ?? ''
export const normEmail = (e: string) => e.toLowerCase().replace(/\s+/g, '').trim()
export const FREEMAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'protonmail.com'])
/** Our own domains: mail from these is outbound or internal. */
export const OUR_DOMAINS = new Set(['thibolisoft.com', 'thibolisoft.example'])
export const ourAddress = (e: string) => OUR_DOMAINS.has(emailDomain(e))

// ---------- the parsers the rules use ----------

/** Signed, or only talking about signing? Negations ("hasn't signed", "will sign") win. "Signed off" means approved. */
export function signatureState(text: string): 'signed' | 'intended' | 'none' {
  const t = normalize(text).toLowerCase()
  if (!/\bsign(ed|ature)?\b|\bcountersigned\b|\bexecuted\b|\bdocusign\b/.test(t)) return 'none'
  const neg = /(?:\b(?:not|never|yet to|before|once|when|will|ready to|going to|plan to|about to|can|could|to)|n't)\s+(?:\w+\s+){0,2}(?:sign|execute)/.test(t)
  const done = /\b(signed|executed|countersigned)\b(?!\s+off)|\bsignature (page|attached)|\bcompleted:?\s/.test(t)
  if (done && !/\bhasn't signed|haven't signed|didn't sign|not (yet )?signed|not been signed/.test(t)) return 'signed'
  return neg || /\bsign\b/.test(t) ? 'intended' : 'none'
}

/** Net payment days, taking "instead of", "from X to Y" and "rather than" into account. Null when ambiguous. */
export function paymentDays(text: string, current?: number): number | null {
  const t = normalize(text).toLowerCase()
  const fromTo = t.match(/from (?:net )?(\d{2})\b[^.]{0,30}?\bto (?:net )?(\d{2})\b/)
  if (fromTo) return Number(fromTo[2])
  // The value the sender is asking for or would accept.
  const ask = t.match(/(?:could live with|can live with|can do|could do|we need|we'd need|we want|we'd accept|we can accept|how about|propose|proposing|asking for|works for us at)\s+(?:net[ -]?)?(\d{2})\b/)
  if (ask) return Number(ask[1])
  const insteadA = t.match(/instead of (?:net )?(\d{2})[^.]*?(?:net )?(\d{2})/)
  if (insteadA) return Number(insteadA[2])
  const insteadB = t.match(/(?:net )(\d{2})[^.]*?(?:instead of|rather than) (?:net )?(\d{2})/)
  if (insteadB) return Number(insteadB[1])
  const all = [...t.matchAll(/\bnet[ -]?(\d{2})\b|\b(\d{2}) days (?:from|after|of) (?:the )?invoice|\((\d{2})\) days/g)].map((m) => Number(m[1] ?? m[2] ?? m[3]))
  const distinct = [...new Set(all.filter((n) => n !== current))]
  return distinct.length === 1 ? distinct[0] : null
}

/** Liability cap in months of fees ("18 months", "3x fees"). */
export function liabilityMonths(text: string): number | null {
  const t = normalize(text).toLowerCase()
  if (!/liabil|cap/.test(t)) return null
  const m = t.match(/(\d{1,2})[ -]months?(?: of fees)?/)
  if (m) return Number(m[1])
  const x = t.match(/(\d)(?:x| times) (?:the )?(?:annual )?fees/)
  return x ? Number(x[1]) * 12 : null
}

/** Acceptance, but not "not agreed", "can't go ahead" or "agree with most, except". */
export function acceptance(text: string): 'all' | 'partial' | 'none' {
  const t = normalize(text).toLowerCase()
  const yes = /(?<!not |n't |never )\b(agree|agreed|accept|accepted|works for us|looks good|good to go|we're good|fine with|approved|go ahead|move forward|happy with)\b/.test(t)
  if (!yes) return 'none'
  if (/\b(not|n't|never)\s+(?:\w+\s+){0,2}(agree|accept|approve|go ahead|good)/.test(t)) return 'none'
  return /\b(except|but|other than|apart from|however|still need|one change|one thing)\b/.test(t) ? 'partial' : 'all'
}

export const isAutoReply = (subject: string, text: string) => /out of (the )?office|automatic reply|auto-?reply|away until|on vacation|limited access to email/i.test(`${subject} ${text}`)
