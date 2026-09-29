import type { Account, Contact, Signal, SignalType } from '../types'
import { PRODUCT, SEGMENT_FIT } from '../data/products'

export interface Playbook {
  id: string
  name: string
  trigger: string
  roles: Contact['role'][]
  description: string
}

export const PLAYBOOKS: Playbook[] = [
  { id: 'ownership', name: 'New owner continuity', trigger: 'Ownership Change', roles: ['Owner', 'GM', 'CFO'], description: 'Introduce ThiboLiSoft to the new owner, confirm service continuity and review contract assignment.' },
  { id: 'leadership', name: 'New leader welcome', trigger: 'Leadership Change', roles: ['GM', 'Operations', 'CFO', 'Owner'], description: 'Welcome the new leader and offer a 30-minute platform walkthrough.' },
  { id: 'expansion', name: 'Expansion upsell', trigger: 'Expansion', roles: ['Operations', 'GM', 'Owner'], description: 'Offer to extend coverage (sites, barns, sensors) to the new capacity.' },
  { id: 'contraction', name: 'Right-size & retain', trigger: 'Contraction', roles: ['Owner', 'GM', 'CFO'], description: 'Proactive check-in to right-size the subscription before it churns.' },
  { id: 'integrator', name: 'Integrator change review', trigger: 'Integrator / Packer Change', roles: ['Owner', 'GM'], description: 'Review reporting and data-sharing setup for the new integrator or packer.' },
  { id: 'biosecurity', name: 'Biosecurity support', trigger: 'Biosecurity', roles: ['Veterinarian', 'Agronomist', 'Barn Manager', 'Operations'], description: 'Share HealthWatch or AgronomyView support during an animal or crop disease event.' },
  { id: 'regulatory', name: 'Compliance readiness', trigger: 'Regulatory', roles: ['Operations', 'GM', 'Owner'], description: 'Invite to a TraceLink compliance briefing on the new rule.' },
  { id: 'financial', name: 'Financial event', trigger: 'Financial', roles: ['CFO', 'Owner'], description: 'Adapt terms or timing to the customer’s financial event.' },
  { id: 'weather-heat', name: 'Heat-stress protocol', trigger: 'Weather: heat', roles: ['Barn Manager', 'Operations', 'GM'], description: 'Send the heat-stress checklist and verify BarnSense alarm thresholds before the heat arrives.' },
  { id: 'weather-cold', name: 'Cold / blizzard prep', trigger: 'Weather: cold', roles: ['Operations', 'Barn Manager', 'Owner'], description: 'Send the cold-stress and calving checklist; confirm heater and generator status.' },
  { id: 'weather-rain', name: 'Heavy-rain & lagoon check', trigger: 'Weather: heavy rain', roles: ['Operations', 'Owner'], description: 'Remind about lagoon freeboard and manure-application restrictions ahead of heavy rain.' },
  { id: 'weather-dry', name: 'Pasture stress review', trigger: 'Weather: dry & hot', roles: ['Owner', 'Operations'], description: 'Offer a PastureView stocking-rate and stock-water review.' },
]

export const PLAYBOOK: Record<string, Playbook> = Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p]))
export const PLAYBOOK_FOR_SIGNAL: Record<SignalType, string> = {
  'Ownership Change': 'ownership',
  'Leadership Change': 'leadership',
  Expansion: 'expansion',
  Contraction: 'contraction',
  'Integrator / Packer Change': 'integrator',
  Biosecurity: 'biosecurity',
  Regulatory: 'regulatory',
  Financial: 'financial',
}

export function pickContact(a: Account, roles: Contact['role'][]): Contact {
  for (const r of roles) {
    const c = [...a.contacts].sort((x, y) => y.since.localeCompare(x.since)).find((c) => c.role === r)
    if (c) return c
  }
  return a.contacts[0]
}

const first = (c: Contact) => c.name.split(' ')[0]

export function whitespace(a: Account): string[] {
  const have = new Set(a.subscriptions.map((s) => s.productId))
  return SEGMENT_FIT[a.segment].filter((p) => !have.has(p))
}

export function draftForSignal(a: Account, s: Signal, rep: string): { playbook: string; contact: Contact; subject: string; body: string } {
  const pb = PLAYBOOK[PLAYBOOK_FOR_SIGNAL[s.type]]
  const contact = pickContact(a, pb.roles)
  const customer = a.status === 'Customer'
  const hi = `Hi ${first(contact)},`
  const sig = `\n\nBest,\n${rep}\nThiboLiSoft`
  const ws = whitespace(a).map((p) => PRODUCT[p].name)
  // Field-crop accounts get the same playbooks with crop wording; livestock copy is unchanged.
  const grain = a.species === 'Grain'
  const core = grain ? 'FieldTrack' : 'HerdTrack'
  let subject = ''
  let body = ''
  switch (s.type) {
    case 'Ownership Change':
      subject = customer ? `Continuity for ${a.name} under new ownership` : `Supporting ${a.name} through the transition`
      body = customer
        ? `${hi}\n\nI saw the news: ${s.headline}. Congratulations. Nothing changes on your side: ${core} and your records keep running as usual.\n\nIt makes sense to review how the account is set up (users, sites and reporting) under the new structure. Could we find 30 minutes in the next two weeks?`
        : `${hi}\n\nCongratulations on the recent news: ${s.headline}. Ownership changes are usually when teams standardize records and reporting across sites. We help ${a.segment.toLowerCase()} operations do that without adding work for ${grain ? 'the field crew' : 'barn staff'}.\n\nWould a short call to compare notes be useful?`
      break
    case 'Leadership Change':
      subject = `Welcome to ${a.name}, and a quick hello from ThiboLiSoft`
      body = customer
        ? `${hi}\n\nCongratulations on the new role. ${a.name} has been running ThiboLiSoft for a while. I'd like to give you a 30-minute tour of how the team uses it today and hear your priorities for the next 12 months.\n\nDoes next week work?`
        : `${hi}\n\nCongratulations on joining ${a.name}. ${grain ? 'New leaders often take a fresh look at how field and harvest data flows. We help farms like yours keep field records in one place and catch problems earlier.' : 'New leaders often take a fresh look at how production data flows. We help operations like yours cut closeout time and catch issues earlier.'}\n\nOpen to a 20-minute intro?`
      break
    case 'Expansion':
      subject = `Coverage for ${a.name}'s new capacity`
      body = `${hi}\n\nCongratulations on the expansion (${s.headline.toLowerCase()}). ${customer ? `To bring the new capacity onto your current setup from day one, I can put together a quote for the added ${grain ? 'acres and bins' : 'sites'}${ws.length ? `, plus ${ws.slice(0, 2).join(' and ')}` : ''}.` : grain ? 'New ground and new bins are the easiest time to set up clean field records and monitoring from the start.' : 'New barns are the easiest time to set up clean records and sensors from the start.'}\n\nWant me to send numbers this week?`
      break
    case 'Contraction':
      subject = `Checking in: ${a.name}`
      body = `${hi}\n\nI heard about the changes at ${a.name} and wanted to reach out directly. If your footprint is changing, we can adjust your subscription so you only pay for what you use, and make sure your historical records stay accessible.\n\nCould we find 20 minutes to talk it through?`
      break
    case 'Integrator / Packer Change':
      subject = `Setting up reporting for your new partner`
      body = `${hi}\n\nI noticed ${s.headline.toLowerCase()}. We can set up ${grain ? 'delivery and settlement records' : 'closeout and compliance reports'} in the format your new partner expects, so the switch doesn't create extra paperwork.\n\nShall I send over the options?`
      break
    case 'Biosecurity':
      subject = grain ? `Crop disease support for ${a.name}` : `Biosecurity support for ${a.name}`
      body = `${hi}\n\nGiven ${s.headline.toLowerCase()}, I wanted to make sure you have what you need. ${grain ? (customer ? 'AgronomyView can flag disease pressure field by field from satellite imagery, and our agronomy team can help you set scouting priorities this week.' : 'Several farms nearby use AgronomyView to spot disease pressure early. Happy to share how they handle it.') : customer ? 'HealthWatch can flag mortality and treatment trends across your sites daily, and our team can help set that up this week at no cost.' : 'Several operations nearby use HealthWatch to track mortality and treatments across sites. Happy to share how they handle it.'}\n\nLet me know if a quick call would help.`
      break
    case 'Regulatory':
      subject = `What the new rule means for ${a.name}`
      body = `${hi}\n\nHeads up on ${s.headline.toLowerCase()}. We're running a 30-minute TraceLink briefing on what records you'll need and how to automate them.\n\nWant me to save you a seat?`
      break
    case 'Financial':
      subject = `Flexible options for ${a.name}`
      body = `${hi}\n\nI saw ${s.headline.toLowerCase()}. ${customer ? 'If it helps, we can adjust billing timing, for example quarterly in arrears, to line up with your cash flow.' : 'If you are planning upgrades with the new capital, we can phase implementation to match your timeline.'}\n\nHappy to talk options.`
      break
  }
  return { playbook: pb.id, contact, subject, body: body + sig }
}

export type WeatherKind = 'heat' | 'cold' | 'rain' | 'dry'

export function draftForWeather(a: Account, kind: WeatherKind, when: string, detail: string, rep: string) {
  const pb = PLAYBOOK[`weather-${kind}`]
  const contact = pickContact(a, pb.roles)
  const hi = `Hi ${first(contact)},`
  const sig = `\n\nBest,\n${rep}\nThiboLiSoft Customer Success`
  const has = (p: string) => a.subscriptions.some((s) => s.productId === p)
  const bodies: Record<WeatherKind, [string, string]> = {
    heat: [
      `Heat-stress prep for ${when}`,
      `${hi}\n\nThe forecast for your area shows ${detail} around ${when}. A few quick checks:\n\n• Inlets, fans and cool cells cleaned and tested\n• Water flow verified at every drinker/tank\n• Feeding moved to cooler hours\n${has('barnsense') ? '• BarnSense high-temp alarm thresholds confirmed (we can lower them for the week)\n' : '• If you want temperature alarms before next summer, BarnSense can be installed in a day\n'}\nReply if you want us to adjust alarm settings remotely.`,
    ],
    cold: [
      `Cold-weather prep for ${when}`,
      `${hi}\n\nWe're tracking ${detail} for your area around ${when}. Suggested checks:\n\n• Generators load-tested and fuelled\n• Heaters, waterers and tank heaters working\n• Windbreaks and bedding ready${a.segment === 'Cow-Calf' ? '; calving pens staged' : ''}\n${has('barnsense') ? '• BarnSense low-temp and power-loss alarms routed to on-call phones\n' : ''}\nLet us know if you need anything before it hits.`,
    ],
    rain: [
      `Heavy rain expected ${when}`,
      `${hi}\n\nThe forecast shows ${detail} around ${when}. A quick reminder to check lagoon and pit freeboard, pause manure application, and keep an eye on access roads for feed deliveries.\n\nWe can pull your recent manure and storage records from HerdTrack if you need them for your nutrient management plan.`,
    ],
    dry: [
      `Dry, hot stretch ahead: pasture check`,
      `${hi}\n\nThe forecast shows ${detail}. ${has('pastureview') ? 'PastureView flags paddocks trending below target forage, and we can run a stocking-rate review with you this week.' : 'With a hot, dry week coming, it is worth checking forage and stock water. PastureView can monitor both by satellite.'}\n\nWant to set up a quick review?`,
    ],
  }
  const [subject, body] = bodies[kind]
  return { playbook: pb.id, contact, subject, body: body + sig }
}
