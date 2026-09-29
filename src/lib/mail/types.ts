// Email tracking for Lucas the Hog: the records that flow from a rep's mailbox into the CRM.

export interface Party {
  name?: string
  email: string
}

export interface MailAttachment {
  name: string
  kind: 'pdf' | 'docx' | 'image' | 'other'
  /** Text layer, when there is one (seeded demo files carry it; a live connector would parse the file). */
  text?: string
}

export interface MailMessage {
  /** Our id for the message. */
  id: string
  /** RFC 5322 Message-ID; the primary dedupe key. */
  messageId: string
  inReplyTo?: string
  references?: string[]
  /** Whose mailbox it was synced from (a rep), or who pasted it. */
  mailbox: string
  from: Party
  to: Party[]
  cc: Party[]
  subject: string
  date: string
  /** Plain-text body as received, quotes included. */
  body: string
  attachments: MailAttachment[]
  source: 'sync' | 'paste' | 'forward'
}

/** What an email means for a deal. */
export type MailKind =
  | 'contract-sent'
  | 'contract-request'
  | 'question'
  | 'redlines'
  | 'counter'
  | 'acceptance'
  | 'verbal-yes'
  | 'signed'
  | 'amendment'
  | 'renewal'
  | 'internal-approval'
  | 'discussion'
  | 'auto-reply'
  | 'unrelated'

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  'contract-sent': 'Contract sent',
  'contract-request': 'Asked for the contract',
  question: 'Question',
  redlines: 'Redlines',
  counter: 'Our counter',
  acceptance: 'Accepted terms',
  'verbal-yes': 'Verbal yes',
  signed: 'Signed copy',
  amendment: 'Amendment request',
  renewal: 'Renewal',
  'internal-approval': 'Internal approval',
  discussion: 'Discussion',
  'auto-reply': 'Auto-reply',
  unrelated: 'Not about a deal',
}

/** One clause-level change the email asks for, accepts or rejects. */
export interface ClauseChange {
  clauseId: string
  action: 'ask' | 'accept' | 'reject'
  /** Library redline key when the ask matches a known one. */
  libraryKey?: string
  /** Proposed contract language, when the email gives it. */
  proposed?: string
  /** Structured value the change sets (e.g. payment days), when there is one. */
  value?: { field: 'paymentDays' | 'liabilityMonths' | 'termMonths' | 'capPct' | 'renewalNoticeDays' | 'autoRenew'; to: number | boolean }
  /** Verbatim evidence from the email. */
  quote: string
}

export type Confidence = 'High' | 'Medium' | 'Low'

export interface MailMatch {
  accountId?: string
  contactId?: string
  opportunityId?: string
  contractId?: string
  confidence: Confidence
  /** How the match was made, in plain words. */
  reason: string
  /** The sender isn't a known contact at the account. */
  newContact?: Party
}

export interface MailExtraction {
  messageId: string
  direction: 'inbound' | 'outbound' | 'internal'
  kind: MailKind
  match: MailMatch
  summary: string
  changes: ClauseChange[]
  /** A signed copy or e-sign completion is attached. */
  signedAttachment?: string
  by: 'rules' | 'ai'
  /** The Claude model that read it, when by is 'ai'. */
  model?: string
  at: string
  /** Why the result is held back (e.g. waiting for the message it replies to). */
  hold?: string
  /** Things a reviewer should know before applying anything from this email. */
  flags?: MailFlag[]
  warnings?: string[]
}

export type MailFlag = 'injection' | 'unverified_sender' | 'missing_attachment' | 'walk_away'

export const MAIL_FLAG_LABEL: Record<MailFlag, string> = {
  injection: 'Contains instructions aimed at an assistant (ignored)',
  unverified_sender: "Sender can't be verified",
  missing_attachment: 'Mentions an attachment that isn’t there',
  walk_away: 'Asks for a walk-away position',
}

export type ProposalKind =
  | 'log-activity'
  | 'link-thread'
  | 'add-contact'
  | 'add-redline'
  | 'agree-redline'
  | 'update-terms'
  | 'move-stage'
  | 'create-deal'
  | 'mark-signed'
  | 'amendment'
  | 'draft-reply'
  | 'note'

/** A change to the CRM an email calls for. Safe ones apply on their own; the rest wait for a click. */
export interface MailProposal {
  id: string
  /** Dedupe key across messages and engines: the same change proposed twice stays one card. */
  key: string
  messageId: string
  kind: ProposalKind
  accountId?: string
  contractId?: string
  opportunityId?: string
  title: string
  detail: string
  payload: Record<string, unknown>
  confidence: Confidence
  /** Applies without a click (activity log, thread link). */
  auto: boolean
  /** Never applied in bulk ("apply all"): signatures and stage changes. */
  single?: boolean
  status: 'Proposed' | 'Applied' | 'Dismissed' | 'Obsolete'
  createdAt: string
  appliedAt?: string
  /** Proposals that must apply first. */
  dependsOn?: string[]
}
