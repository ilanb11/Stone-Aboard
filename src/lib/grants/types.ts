import type { GrantPracticeLine, Species } from '../../types'

// Grant directory contract. Everything outside src/lib/grants talks to a GrantSource,
// so the seeded catalog can be swapped for a live one (Grants.gov search, NRCS program
// data, state agriculture departments) without touching the pages or the drafts.

/** What a program pays for. Regulatory changes are mapped onto the same topics. */
export type GrantTopic = 'siting-odor' | 'manure' | 'nutrients' | 'water-quality' | 'traceability' | 'animal-housing' | 'conservation'

export const TOPIC_LABEL: Record<GrantTopic, string> = {
  'siting-odor': 'barn siting and odor control',
  manure: 'manure storage and handling',
  nutrients: 'nutrient management',
  'water-quality': 'water quality',
  traceability: 'animal traceability',
  'animal-housing': 'animal housing',
  conservation: 'conservation practices',
}

export type DeadlineRule =
  | { kind: 'annual'; month: number; day: number; label: string } // month is 1-12
  | { kind: 'quarterly'; dates: [month: number, day: number][]; label: string }
  | { kind: 'rolling'; label: string }

/** Eligibility, as data: the CRM can check state and operation; everything else needs the applicant. */
export type Criterion =
  | { kind: 'state'; states: string[] }
  | { kind: 'operation'; operations: Species[] }
  | { kind: 'confirm'; label: string }

export interface Practice {
  /** NRCS conservation practice standard, when there is one. */
  code?: string
  name: string
  topics: GrantTopic[]
  operations: Species[]
  unit: GrantPracticeLine['unit']
  /** Estimated installed cost per unit, USD. */
  unitCost: number
}

export interface Grant {
  id: string
  name: string
  shortName: string
  agency: string
  level: 'Federal' | 'State'
  /** State programs only. */
  state?: string
  summary: string
  topics: GrantTopic[]
  operations: Species[]
  eligibility: Criterion[]
  award: { max: number; costSharePct: number; basis: string }
  deadline: DeadlineRule
  practices: Practice[]
  /** Forms and documents an application needs. */
  attachments: string[]
  /** Where a person submits it. Herdbook never does. */
  applyVia: string
  sourceUrl?: string
}

export interface GrantQuery {
  state: string
  topics: GrantTopic[]
  operations?: Species[]
}

/** Any grant catalog. A live connector syncs into a snapshot and serves it through the same calls. */
export interface GrantSource {
  readonly name: string
  /** Plain-language note on how current and how exact the data is. */
  readonly disclaimer: string
  list(): Grant[]
  get(id: string): Grant | undefined
  /** Federal programs plus programs of that state, covering at least one topic and operation type. */
  find(q: GrantQuery): Grant[]
}
