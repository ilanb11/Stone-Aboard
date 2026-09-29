import type { Account, GrantApplication, GrantPracticeLine, GrantSectionId } from '../types'
import { OPERATION_LABEL } from '../types'
import { STATES } from '../data/geo'
import { num, sizeLabel } from './format'
import { pickContact } from './outreach'
import { checkEligibility, deadlineText, TOPIC_LABEL, type Grant, type GrantTopic, type RegulatoryChange } from './grants'

// Grant applications, pre-drafted from CRM data. Pure functions: the store decides
// when to draft and keeps the results as drafts. Nothing here submits anything, and
// there is no submission path: people file applications with the agency themselves.

/** One application per program and account, however many rule changes point at it. */
export const grantApplicationId = (grantId: string, accountId: string) => `GA-${grantId}-${accountId}`

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const long = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const stateName = (code: string) => STATES[code]?.name ?? code
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

export const UNIT_LABEL: Record<GrantPracticeLine['unit'], [string, string]> = {
  site: ['site', 'sites'],
  barn: ['barn', 'barns'],
  bin: ['grain bin', 'grain bins'],
  '1k head': ['thousand head', 'thousand head'],
  '100 acres': ['100 acres', '100-acre blocks'],
  operation: ['plan', 'plans'],
}
export const unitWord = (u: GrantPracticeLine['unit'], n: number) => UNIT_LABEL[u][n === 1 ? 0 : 1]

// A first application covers a first phase, not every site of a large system.
const PHASE_CAP: Record<GrantPracticeLine['unit'], number> = { site: 2, barn: 12, bin: 12, '1k head': 25, '100 acres': 20, operation: 1 }

function rawUnits(u: GrantPracticeLine['unit'], a: Account) {
  switch (u) {
    case 'site': return a.sites
    case 'barn': case 'bin': return a.barns
    case '1k head': return Math.ceil(a.headCount / 1000)
    case '100 acres': return Math.ceil(a.acres / 100)
    default: return 1
  }
}

/**
 * Up to two practices that answer the rule change for this operation, sized from the CRM
 * record. Topics are in priority order, so a setback rule leads with odor control.
 */
export function proposePractices(g: Grant, a: Account, topics: GrantTopic[]): GrantPracticeLine[] {
  const fits = g.practices.filter((p) => p.operations.includes(a.species))
  const rank = (p: (typeof fits)[number]) => topics.findIndex((t) => p.topics.includes(t))
  const picked = fits.filter((p) => rank(p) >= 0).sort((x, y) => rank(x) - rank(y))
  return (picked.length ? picked : fits).slice(0, 2).map((p) => ({ code: p.code, name: p.name, unit: p.unit, unitCost: p.unitCost, units: Math.max(1, Math.min(PHASE_CAP[p.unit], rawUnits(p.unit, a))) }))
}

export function draftGrantApplication(g: Grant, a: Account, changes: RegulatoryChange[], today = new Date()): GrantApplication {
  const topics = [...new Set(changes.flatMap((c) => c.topics))]
  return {
    id: grantApplicationId(g.id, a.id),
    grantId: g.id,
    accountId: a.id,
    signalIds: changes.map((c) => c.signal.id),
    status: 'Draft',
    createdAt: today.toISOString(),
    practices: proposePractices(g, a, topics),
  }
}

export function applicationBudget(app: Pick<GrantApplication, 'practices'>, g: Grant) {
  const projectCost = app.practices.reduce((s, p) => s + p.units * p.unitCost, 0)
  const share = Math.round(projectCost * (g.award.costSharePct / 100))
  const requested = Math.min(share, g.award.max)
  return { projectCost, costSharePct: g.award.costSharePct, requested, capped: share > g.award.max, producerShare: projectCost - requested }
}

export interface GrantDraftContext {
  app: GrantApplication
  grant: Grant
  account: Account
  changes: RegulatoryChange[]
}

export const SECTION_TITLES: Record<GrantSectionId, string> = {
  applicant: 'Applicant',
  operation: 'Operation',
  need: 'Why now',
  project: 'Proposed practices',
  budget: 'Budget',
  records: 'Records and verification',
}
export const SECTION_ORDER: GrantSectionId[] = ['applicant', 'operation', 'need', 'project', 'budget', 'records']

// How each ThiboLiSoft product helps document the application.
const RECORDS: Record<string, string> = {
  tracelink: 'TraceLink Compliance keeps the audit trail the program asks for (manure application, treatment and movement records) and exports it for the application and later spot checks.',
  herdtrack: 'HerdTrack Core inventory and closeouts document animal numbers for each site.',
  barnsense: 'BarnSense IoT ventilation and temperature logs support odor-control and animal-care practices.',
  fieldtrack: 'FieldTrack field records and yield maps document acres and practice locations.',
  agronomyview: 'AgronomyView nitrogen recommendations and satellite imagery document nutrient rates and cover crop establishment.',
  pastureview: 'PastureView grazing records support a prescribed grazing plan.',
  feedopt: 'FeedOptimizer ration records support nutrient balance calculations for manure.',
}

export function generatedSections(ctx: GrantDraftContext): Record<GrantSectionId, string> {
  const { app, grant: g, account: a, changes } = ctx
  const owner = pickContact(a, ['Owner', 'GM', 'CFO'])
  const budget = applicationBudget(app, g)
  const partner = a.integrator ? `${a.species === 'Hog' ? 'Integrator' : a.species === 'Cattle' ? 'Packer' : 'Grain marketing'}: ${a.integrator}.` : ''
  const crops = a.species === 'Grain' && a.crops?.length ? `, growing ${a.crops.join(', ').toLowerCase()}` : ''
  const facilities = a.barns ? ` and ${a.barns} ${a.species === 'Grain' ? (a.barns === 1 ? 'grain bin' : 'grain bins') : a.barns === 1 ? 'barn' : 'barns'}` : ''
  const records = a.subscriptions.map((s) => RECORDS[s.productId]).filter(Boolean)
  const capped = app.practices.some((p) => p.units >= PHASE_CAP[p.unit] && p.unit !== 'operation')
  return {
    applicant: [
      `Applicant: ${a.name}`,
      `Ownership: ${a.ownership}${a.parentCompany ? `, owned by ${a.parentCompany}` : ''}`,
      `Primary contact: ${owner.name}, ${owner.title} (${owner.email})`,
      `Location: ${a.county} County, ${stateName(a.state)}`,
      'FSA farm and tract numbers: [add before submitting]',
    ].join('\n'),
    operation: `${a.name} is ${article(a.segment)} ${a.segment.toLowerCase()} ${OPERATION_LABEL[a.species].toLowerCase()} operation in ${a.county} County, ${stateName(a.state)}, founded in ${a.yearFounded}. It runs ${sizeLabel(a)}${crops} on ${a.sites} ${a.sites === 1 ? 'site' : 'sites'}${facilities}, with ${num(a.acres)} acres and about ${num(a.employees)} ${a.employees === 1 ? 'employee' : 'employees'}. ${partner}`.trim(),
    need: changes
      .map((c) => `On ${long(c.signal.date)}: ${c.signal.headline}. ${c.signal.detail}\n${c.why(a)}`)
      .join('\n\n'),
    project: [
      ...app.practices.map((p) => `• ${p.name}${p.code ? ` (NRCS practice ${p.code})` : ''}: ${num(p.units)} ${unitWord(p.unit, p.units)} at ${usd(p.unitCost)} each, ${usd(p.units * p.unitCost)}`),
      '',
      `These practices address ${[...new Set(changes.flatMap((c) => c.topics))].map((t) => TOPIC_LABEL[t]).join(', ')}.${capped ? ' This application covers a first phase; later sites can follow in a second contract.' : ''} Installation within 12 months of contract approval.`,
    ].join('\n'),
    budget: [
      `Estimated project cost: ${usd(budget.projectCost)}`,
      `Program share: ${budget.costSharePct}%. ${g.award.basis}.`,
      `Amount requested: ${usd(budget.requested)}${budget.capped ? ' (capped at the program maximum)' : ''}`,
      `Applicant share: ${usd(budget.producerShare)}`,
    ].join('\n'),
    records: records.length
      ? records.join('\n')
      : `The applicant will supply its own records. ThiboLiSoft ${a.species === 'Grain' ? 'FieldTrack' : 'TraceLink Compliance'} can keep the practice records the program asks for.`,
  }
}

export const sectionText = (ctx: GrantDraftContext, id: GrantSectionId, generated = generatedSections(ctx)) => ctx.app.edits?.[id] ?? generated[id]

/** What a person still has to supply before this can be filed. */
export function missingItems(ctx: GrantDraftContext): string[] {
  return [
    ...checkEligibility(ctx.grant, ctx.account)
      .filter((c) => c.status === 'To confirm')
      .map((c) => c.label),
    ...(ctx.grant.eligibility.some((c) => c.kind === 'confirm' && /Farm Service Agency/.test(c.label)) ? [] : ['Farm Service Agency farm and tract numbers']),
    'Contractor quotes for each practice',
  ]
}

/** The full application as plain text, for review, copying or export. */
export function renderGrantApplication(ctx: GrantDraftContext, rep: string): string {
  const { grant: g, account: a } = ctx
  const gen = generatedSections(ctx)
  const dl = deadlineText(g.deadline)
  return [
    `${g.name} (${g.shortName})`,
    `${g.agency}`,
    `Application draft for ${a.name}, prepared by Herdbook for ${rep} on ${long(ctx.app.createdAt)}. Not submitted.`,
    `Deadline: ${dl.date ? `${dl.date} (${dl.label})` : dl.label}. Submit through: ${g.applyVia}.`,
    '',
    ...SECTION_ORDER.flatMap((id) => [SECTION_TITLES[id], sectionText(ctx, id, gen), '']),
    'Attachments',
    ...g.attachments.map((x) => `• ${x}`),
    '',
    'Still needed before submitting',
    ...missingItems(ctx).map((x) => `• ${x}`),
  ].join('\n')
}

