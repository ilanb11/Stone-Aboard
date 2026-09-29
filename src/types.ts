export type RegionName =
  | 'Pacific'
  | 'Mountain'
  | 'Northern Plains'
  | 'Southern Plains'
  | 'Lake States'
  | 'Corn Belt'
  | 'Delta States'
  | 'Appalachian'
  | 'Southeast'
  | 'Northeast'

/** Operation type. The field is still called `species` for history; 'Grain' = field crops. */
export type Species = 'Hog' | 'Cattle' | 'Grain'
export const OPERATION_TYPES: readonly Species[] = ['Hog', 'Cattle', 'Grain']
export const OPERATION_LABEL: Record<Species, string> = { Hog: 'Hog', Cattle: 'Cattle', Grain: 'Field crops' }
/** Filter options shared by every page that filters by operation type. */
export const OPERATION_OPTIONS: { value: 'All' | Species; label: string }[] = [
  { value: 'All', label: 'All operations' },
  ...OPERATION_TYPES.map((s) => ({ value: s, label: OPERATION_LABEL[s] })),
]
export type HogSegment = 'Sow Farm' | 'Wean-to-Finish' | 'Farrow-to-Finish' | 'Contract Finisher' | 'Integrated System'
export type CattleSegment = 'Cow-Calf' | 'Stocker / Backgrounder' | 'Feedlot' | 'Dairy'
export type GrainSegment = 'Corn & Soybean' | 'Wheat & Small Grains' | 'Irrigated Row Crop' | 'Diversified Grain'
export type Segment = HogSegment | CattleSegment | GrainSegment
export const GRAIN_SEGMENTS: readonly GrainSegment[] = ['Corn & Soybean', 'Wheat & Small Grains', 'Irrigated Row Crop', 'Diversified Grain']
export type AccountStatus = 'Customer' | 'Prospect' | 'Churned'
export type Ownership = 'Family' | 'Multi-generational Family' | 'Corporate' | 'Integrator-owned' | 'Cooperative' | 'PE-backed'

export interface Contact {
  id: string
  name: string
  title: string
  role: 'Owner' | 'GM' | 'CFO' | 'Operations' | 'Barn Manager' | 'Veterinarian' | 'Nutritionist' | 'Agronomist'
  email: string
  since: string
}

export interface Subscription {
  productId: string
  units: number
  unitPrice: number // monthly price per unit
}

export interface Account {
  id: string
  name: string
  species: Species
  segment: Segment
  state: string
  county: string
  region: RegionName
  lat: number
  lon: number
  headCount: number // hogs: pigs on hand (sows for sow farms); cattle: head / cows; field crops: 0
  sites: number
  barns: number // livestock: barns; field crops: grain bins
  acres: number
  crops?: string[] // field crops only, main crops first
  employees: number
  yearFounded: number
  ownership: Ownership
  parentCompany?: string
  integrator?: string
  status: AccountStatus
  rep: string
  contacts: Contact[]
  subscriptions: Subscription[]
  contractId?: string
  competitor?: string
  competitorRenewal?: string
  health: { usage: number; openTickets: number; daysLate: number; nps: number }
  lastContact: string
}

export type PriceMechanism = 'Fixed for term' | 'Annual CPI escalator' | 'Annual increase with notice' | 'Renegotiate at renewal' | 'Multi-year price lock'

export interface Contract {
  id: string
  accountId: string
  template: string
  status: 'Active' | 'In Negotiation' | 'Expired'
  start: string
  end: string
  termMonths: number
  autoRenew: boolean
  renewalNoticeDays: number
  paymentTerms: string
  price: {
    mechanism: PriceMechanism
    capPct?: number
    noticeDays: number
    lockUntil?: string
  }
  mfn: boolean
  assignmentOnChangeOfControl: 'Consent required' | 'Permitted with notice'
  redlines: Redline[]
  opportunityId?: string
}

export interface Redline {
  id: string
  clauseId: string
  key: string // library key used by the offline playbook
  original: string
  proposed: string
  customerNote: string
}

/** The one source of truth for pipeline stages, in board order. */
export const OPP_STAGES = ['Prospect', 'Demo', 'Negotiation', 'Closed Won', 'Closed Lost', 'On Ice'] as const
export type OppStage = (typeof OPP_STAGES)[number]
/** Active pipeline: counted in pipeline value and ranked. */
export const OPEN_OPP_STAGES: OppStage[] = ['Prospect', 'Demo', 'Negotiation']
/** Finished deals. On Ice is parked: neither open nor closed. */
export const CLOSED_OPP_STAGES: OppStage[] = ['Closed Won', 'Closed Lost']
export const isOpenStage = (s: OppStage) => OPEN_OPP_STAGES.includes(s)
export const isClosedStage = (s: OppStage) => CLOSED_OPP_STAGES.includes(s)
export type OppType = 'New Logo' | 'Expansion' | 'Renewal' | 'Price Normalization'

export interface Opportunity {
  id: string
  accountId: string
  type: OppType
  stage: OppStage
  arr: number
  products: string[]
  owner: string
  createdAt: string
  closeDate: string
  contractId?: string
  /** Why a deal was lost or put on ice. */
  reason?: string
}

export type SignalType =
  | 'Ownership Change'
  | 'Leadership Change'
  | 'Expansion'
  | 'Contraction'
  | 'Integrator / Packer Change'
  | 'Biosecurity'
  | 'Regulatory'
  | 'Financial'

export interface Signal {
  id: string
  date: string
  type: SignalType
  headline: string
  detail: string
  accountId?: string
  state?: string
  severity: 'High' | 'Medium' | 'Low'
  source: string
}

export type OutreachStatus = 'Draft' | 'Approved' | 'Sent' | 'Skipped'

export interface Outreach {
  id: string
  accountId: string
  signalId?: string
  trigger: string
  playbook: string
  contactName: string
  contactEmail: string
  subject: string
  body: string
  status: OutreachStatus
  createdAt: string
  sentAt?: string
  auto: boolean
}

export interface Activity {
  id: string
  accountId: string
  date: string
  author: string
  kind: 'Note' | 'Email' | 'Call' | 'System' | 'Pricing' | 'Contract'
  text: string
}
