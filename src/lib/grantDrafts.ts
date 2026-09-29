import type { Account, GrantApplication, GrantFundedLine, GrantSectionId, Opportunity, Outreach } from '../types'
import { OPERATION_LABEL } from '../types'
import { STATES } from '../data/geo'
import { PRODUCT } from '../data/products'
import { num, sizeLabel } from './format'
import { pickContact } from './outreach'
import { checkEligibility, coverageFor, deadlineText, type Coverage, type Grant, type Purchase, type RegulatoryChange } from './grants'

// Grant applications and tax-credit notes, pre-drafted from CRM data. Every one is tied
// to something the customer is buying from us (an open deal or a renewal) and funds part
// of it. Pure functions: the store decides when to draft and keeps the results. Nothing
// here submits anything; people file applications with the agency themselves.

/** One application per program and account, however many rule changes point at it. */
export const grantApplicationId = (grantId: string, accountId: string) => `GA-${grantId}-${accountId}`

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const long = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const stateName = (code: string) => STATES[code]?.name ?? code
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

export function draftGrantApplication(g: Grant, a: Account, purchase: Purchase, changes: RegulatoryChange[], today = new Date()): GrantApplication {
  const cov = coverageFor(g, purchase)
  return {
    id: grantApplicationId(g.id, a.id),
    grantId: g.id,
    accountId: a.id,
    signalIds: changes.map((c) => c.signal.id),
    kind: g.kind,
    purchase: { kind: purchase.kind, opportunityId: purchase.opportunityId, when: purchase.when, annualCost: purchase.annualCost },
    lines: cov.lines.map((l) => ({ ...l, name: PRODUCT[l.productId]?.name ?? l.productId })),
    status: 'Draft',
    createdAt: today.toISOString(),
  }
}

/** The funding math for a stored application. */
export function applicationBudget(app: Pick<GrantApplication, 'lines' | 'purchase'>, g: Grant) {
  const eligibleCost = app.lines.filter((l) => l.eligible).reduce((s, l) => s + l.annualCost, 0)
  const share = Math.round((eligibleCost * g.funds.sharePct) / 100)
  const requested = Math.min(share, g.award.max)
  const projectCost = app.purchase.annualCost
  return { projectCost, eligibleCost, costSharePct: g.funds.sharePct, requested, capped: share > g.award.max, producerShare: Math.max(0, projectCost - requested), coverage: projectCost ? requested / projectCost : 0 }
}

/** Rough R&D credit for a tax note: 6 to 10% of the purchase. An estimate for the accountant, never money requested. */
export const creditRange = (app: Pick<GrantApplication, 'purchase'>) => ({ low: app.purchase.annualCost * 0.06, high: app.purchase.annualCost * 0.1 })

const andList = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * What the coverage figure is a share of. An expansion is priced on the added products
 * only, so its coverage is of the add-on, not the whole subscription.
 */
export function coveredPurchase(app: Pick<GrantApplication, 'purchase' | 'lines'>, you = false) {
  if (app.purchase.kind === 'Expansion') return `the ${andList(app.lines.map((l) => l.name))} ${app.lines.length === 1 ? 'add-on' : 'add-ons'}`
  if (app.purchase.kind === 'Renewal') return you ? 'your renewal year' : 'the renewal year'
  return you ? 'your first year with us' : 'the first year with us'
}

/** Why a draft no longer funds a purchase (its deal was lost or shelved, or the account churned), or null while it does. */
export function purchaseLapse(app: Pick<GrantApplication, 'purchase'>, a: Pick<Account, 'status'>, opps: Pick<Opportunity, 'id' | 'stage'>[]): string | null {
  if (a.status === 'Churned') return 'Account churned'
  const o = app.purchase.opportunityId ? opps.find((x) => x.id === app.purchase.opportunityId) : undefined
  if (o?.stage === 'Closed Lost') return 'Deal lost'
  if (o?.stage === 'On Ice') return 'Deal on ice'
  return null
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
  project: 'Technology to be funded',
  budget: 'Budget',
  records: 'Records and verification',
  activities: 'Activities that may qualify',
  costs: 'Costs and estimated credit',
  accountant: 'Questions for your accountant',
}
export const SECTION_ORDER: GrantSectionId[] = ['applicant', 'operation', 'need', 'project', 'budget', 'records']
export const TAX_SECTION_ORDER: GrantSectionId[] = ['applicant', 'activities', 'costs', 'records', 'accountant']
export const sectionsFor = (app: Pick<GrantApplication, 'kind'>) => (app.kind === 'Tax credit' ? TAX_SECTION_ORDER : SECTION_ORDER)

// How each ThiboLiSoft product helps document the application.
const RECORDS: Record<string, string> = {
  tracelink: 'TraceLink Compliance keeps the audit trail the program asks for (manure application, treatment and movement records) and exports it for the application and later spot checks.',
  herdtrack: 'HerdTrack Core inventory and closeouts document animal numbers for each site.',
  barnsense: 'BarnSense IoT ventilation and fan logs show energy use before and after, which the program asks for.',
  binsense: 'BinSense aeration logs show fan hours saved.',
  fieldtrack: 'FieldTrack field records and yield maps document acres and practice locations.',
  agronomyview: 'AgronomyView nitrogen recommendations and satellite imagery document nutrient rates and cover crop establishment.',
  pastureview: 'PastureView grazing records support a prescribed grazing plan.',
  feedopt: 'FeedOptimizer ration records support nutrient balance calculations for manure.',
}

// Trials each product makes measurable (for the R&D credit worksheet).
const TRIALS: Record<string, string> = {
  feedopt: 'Ration trials: testing new diets or feed additives against a control group, measured on gain and feed efficiency.',
  barnsense: 'Ventilation trials: testing setpoints or fan staging to cut heat stress and energy use, measured barn by barn.',
  agronomyview: 'Nitrogen-rate and variable-rate trials: strip trials against the standard rate, measured on yield maps.',
  fieldtrack: 'Seeding-rate and hybrid trials across fields, with yield maps as the measurement.',
  healthwatch: 'Treatment protocol trials: comparing vaccination or treatment programs on mortality and cost.',
  herdtrack: 'Production trials (weaning age, stocking density) tracked through closeouts.',
  pastureview: 'Grazing rotation trials measured on forage and weight gain.',
  binsense: 'Aeration strategy trials measured on grain condition and fan hours.',
  advisory: 'Structured trials designed with our advisors.',
}

const purchaseText = (app: GrantApplication, a: Account) =>
  app.purchase.kind === 'Renewal'
    ? `${a.name} renews its ThiboLiSoft subscription on ${long(app.purchase.when)}`
    : app.purchase.kind === 'Expansion'
      ? `${a.name} is adding to its ThiboLiSoft subscription, expected ${long(app.purchase.when)}`
      : `${a.name} is starting a ThiboLiSoft subscription, expected ${long(app.purchase.when)}`

export function generatedSections(ctx: GrantDraftContext): Partial<Record<GrantSectionId, string>> {
  const { app, grant: g, account: a, changes } = ctx
  const owner = pickContact(a, ['Owner', 'GM', 'CFO'])
  const budget = applicationBudget(app, g)
  const partner = a.integrator ? `${a.species === 'Hog' ? 'Integrator' : a.species === 'Cattle' ? 'Packer' : 'Grain marketing'}: ${a.integrator}.` : ''
  const crops = a.species === 'Grain' && a.crops?.length ? `, growing ${a.crops.join(', ').toLowerCase()}` : ''
  const facilities = a.barns ? ` and ${a.barns} ${a.species === 'Grain' ? (a.barns === 1 ? 'grain bin' : 'grain bins') : a.barns === 1 ? 'barn' : 'barns'}` : ''
  const applicant = [
    `Applicant: ${a.name}`,
    `Ownership: ${a.ownership}${a.parentCompany ? `, owned by ${a.parentCompany}` : ''}`,
    `Primary contact: ${owner.name}, ${owner.title} (${owner.email})`,
    `Location: ${a.county} County, ${stateName(a.state)}`,
    g.kind === 'Tax credit' ? 'Accountant: [add name and firm]' : 'FSA farm and tract numbers: [add before submitting]',
  ].join('\n')
  const records = app.lines.map((l) => RECORDS[l.productId]).filter(Boolean)
  const recordsText = records.length ? records.join('\n') : 'ThiboLiSoft keeps the records the program asks for and exports them for the application.'

  if (g.kind === 'Tax credit') {
    const trials = [...new Set(app.lines.map((l) => TRIALS[l.productId]).filter(Boolean))]
    const { low, high } = creditRange(app)
    return {
      applicant,
      activities: [
        `${purchaseText(app, a)}. If the operation uses it to run structured trials, the work may count as qualified research:`,
        ...trials.map((t) => `• ${t}`),
        '',
        'Routine use (day-to-day monitoring, standard reports) does not qualify on its own; the trial has to test something uncertain and be documented as it happens.',
      ].join('\n'),
      costs: [
        `Annual ThiboLiSoft cost: ${usd(app.purchase.annualCost)}. The share used for trials, plus staff time on trial design and measurement, may count as qualified research expenses.`,
        `Rough credit if most of the subscription supports trials: ${usd(low)} to ${usd(high)} a year (6 to 10% of qualified expenses under the simplified method). Staff wages on trials usually matter more than the software.`,
        'A qualified small business (under $5 million in gross receipts) may be able to apply the credit against payroll taxes instead of income tax.',
      ].join('\n'),
      records: recordsText,
      accountant: [
        'Do our planned trials meet the four-part test for qualified research?',
        'Which costs count: staff time, the subscription share used for trials, trial supplies?',
        `Is there a ${stateName(a.state)} R&D credit on top of the federal one?`,
        'Should the software and sensors be expensed under Section 179 instead of, or as well as, the R&D credit?',
        'Should we elect the payroll tax offset as a qualified small business?',
      ]
        .map((q) => `• ${q}`)
        .join('\n'),
    }
  }

  return {
    applicant,
    operation: `${a.name} is ${article(a.segment)} ${a.segment.toLowerCase()} ${OPERATION_LABEL[a.species].toLowerCase()} operation in ${a.county} County, ${stateName(a.state)}, founded in ${a.yearFounded}. It runs ${sizeLabel(a)}${crops} on ${a.sites} ${a.sites === 1 ? 'site' : 'sites'}${facilities}, with ${num(a.acres)} acres and about ${num(a.employees)} ${a.employees === 1 ? 'employee' : 'employees'}. ${partner}`.trim(),
    need: [`${purchaseText(app, a)}. ${g.funds.note}`, ...changes.map((c) => `On ${long(c.signal.date)}: ${c.signal.headline}. ${c.why(a)}`)].join('\n\n'),
    project: [
      ...app.lines.map((l) => `• ${l.name}: ${num(l.units)} ${l.units === 1 ? 'unit' : 'units'}, ${usd(l.annualCost)} a year${l.eligible ? '' : ' (not eligible under this program; paid by the applicant)'}`),
      '',
      'Installation and onboarding within 60 days of award.',
    ].join('\n'),
    budget: [
      `First-year cost of the ThiboLiSoft purchase: ${usd(budget.projectCost)}`,
      `Eligible under this program: ${usd(budget.eligibleCost)}`,
      `Program share: ${budget.costSharePct}% of eligible cost. ${g.award.basis}.`,
      `Amount requested: ${usd(budget.requested)}${budget.capped ? ' (capped at the program maximum)' : ''}, ${Math.round(budget.coverage * 100)}% of the first-year cost`,
      `Applicant share: ${usd(budget.producerShare)}`,
    ].join('\n'),
    records: recordsText,
  }
}

export const sectionText = (ctx: GrantDraftContext, id: GrantSectionId, generated = generatedSections(ctx)) => ctx.app.edits?.[id] ?? generated[id] ?? ''

/** What a person still has to supply before this can be filed. */
export function missingItems(ctx: GrantDraftContext): string[] {
  const confirm = checkEligibility(ctx.grant, ctx.account)
    .filter((c) => c.status === 'To confirm')
    .map((c) => c.label)
  if (ctx.grant.kind === 'Tax credit') return [...confirm, 'Trial plan for the year, written before the trials start']
  return [...confirm, ...(ctx.grant.eligibility.some((c) => c.kind === 'confirm' && /Farm Service Agency/.test(c.label)) ? [] : ['Farm Service Agency farm and tract numbers']), 'Signed ThiboLiSoft quote or order form for the funded products']
}

/** The full application (or accountant worksheet) as plain text, for review, copying or export. */
export function renderGrantApplication(ctx: GrantDraftContext, rep: string): string {
  const { grant: g, account: a } = ctx
  const gen = generatedSections(ctx)
  const dl = deadlineText(g.deadline)
  const tax = g.kind === 'Tax credit'
  return [
    `${g.name} (${g.shortName})`,
    `${g.agency}`,
    tax ? `Worksheet for ${a.name} to review with their accountant, prepared by Herdbook for ${rep} on ${long(ctx.app.createdAt)}. Not tax advice.` : `Application draft for ${a.name}, prepared by Herdbook for ${rep} on ${long(ctx.app.createdAt)}. Not submitted.`,
    `${tax ? 'Timing' : 'Deadline'}: ${dl.date ? `${dl.date} (${dl.label})` : dl.label}. ${tax ? 'Claimed through' : 'Submit through'}: ${g.applyVia}.`,
    '',
    ...sectionsFor(ctx.app).flatMap((id) => [SECTION_TITLES[id], sectionText(ctx, id, gen), '']),
    tax ? 'Supporting documents' : 'Attachments',
    ...g.attachments.map((x) => `• ${x}`),
    '',
    'Still needed',
    ...missingItems(ctx).map((x) => `• ${x}`),
  ].join('\n')
}

/** The customer email that goes with an application or a tax-credit note. Always a draft. */
export function draftGrantEmail(ctx: GrantDraftContext): Omit<Outreach, 'id' | 'createdAt' | 'status'> {
  const { grant: g, account: a, app } = ctx
  const c = pickContact(a, g.kind === 'Tax credit' ? ['CFO', 'Owner', 'GM'] : ['Owner', 'GM', 'CFO'])
  const first = c.name.split(' ')[0]
  const b = applicationBudget(app, g)
  const pct = Math.round(b.coverage * 100)
  const body =
    g.kind === 'Tax credit'
      ? [
          `Hi ${first},`,
          '',
          'Something to raise with your accountant: if you use ThiboLiSoft to run structured trials (rations, ventilation settings or seeding rates), part of the cost and your team’s time on those trials may qualify for the federal R&D tax credit. Operations like yours often don’t claim it.',
          '',
          'I’ve put together a one-page worksheet with the trials our tools support, the costs that may count and the questions to ask. Happy to send it to your accountant directly.',
          '',
          'Best,',
          a.rep,
          'ThiboLiSoft',
        ].join('\n')
      : [
          `Hi ${first},`,
          '',
          `Good news on cost: ${g.name} (${g.shortName}) can pay for about ${pct}% of ${coveredPurchase(app, true)}, roughly ${usd(b.requested)} of ${usd(b.projectCost)}. ${g.funds.note}`,
          '',
          `I’ve pre-filled the application from what we know about ${a.name}. It needs a few details only you have (your FSA farm number, for one) before it goes to ${g.applyVia.charAt(0).toLowerCase() + g.applyVia.slice(1)}. Can we take 15 minutes this week to finish it together?`,
          '',
          'Best,',
          a.rep,
          'ThiboLiSoft',
        ].join('\n')
  return {
    accountId: a.id,
    // The program name in the trigger ties the email to its application (see isGrantEmailFor).
    trigger: g.kind === 'Tax credit' ? `${g.shortName} note for the accountant` : `Grant application (${g.shortName}, ${pct}% of ${coveredPurchase(app)})`,
    playbook: g.kind === 'Tax credit' ? 'tax-credit' : 'grant-intro',
    contactName: c.name,
    contactEmail: c.email,
    subject: g.kind === 'Tax credit' ? `${a.name}: an R&D tax credit to check with your accountant` : `${a.name}: ${g.shortName} can cover ${pct}% of ${coveredPurchase(app, true)}`,
    body,
    auto: false,
  }
}

/** Whether an outreach email is this application's customer email: same account and playbook, naming the program, drafted since. */
export function isGrantEmailFor(o: Pick<Outreach, 'accountId' | 'playbook' | 'trigger' | 'subject' | 'createdAt'>, app: Pick<GrantApplication, 'accountId' | 'createdAt'>, g: Grant) {
  return o.accountId === app.accountId && o.playbook === (g.kind === 'Tax credit' ? 'tax-credit' : 'grant-intro') && o.createdAt >= app.createdAt && `${o.trigger}\n${o.subject}`.includes(g.shortName)
}

export type { Coverage, GrantFundedLine }
