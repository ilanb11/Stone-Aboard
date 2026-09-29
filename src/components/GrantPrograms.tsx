import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, CircleHelp, Landmark } from 'lucide-react'
import type { Account } from '../types'
import { STATES } from '../data/geo'
import { useCrm } from '../store'
import { num } from '../lib/format'
import { affectedAccounts, applicationsForChange, awardText, checkEligibility, deadlineText, describeEligibility, grantSource, grantsForChange, type CheckStatus, type Grant, type RegulatoryChange } from '../lib/grants'
import { Button, Chip } from './ui'

const STATUS_ICON: Record<CheckStatus, { icon: typeof CircleCheck; cls: string; word: string }> = {
  Met: { icon: CircleCheck, cls: 'text-good', word: 'Met' },
  'Not met': { icon: CircleAlert, cls: 'text-critical', word: 'Not met' },
  'To confirm': { icon: CircleHelp, cls: 'text-muted', word: 'To confirm' },
}

export function Deadline({ g }: { g: Grant }) {
  const d = deadlineText(g.deadline)
  if (!d.date) return <span>{d.label}</span>
  return (
    <span>
      <span className={`tabular ${d.days !== undefined && d.days <= 21 ? 'text-critical' : 'text-ink'}`}>{d.date}</span>
      <span className="text-muted"> · in {d.days} {d.days === 1 ? 'day' : 'days'}</span>
      <span className="block text-[12px] text-muted">{d.label}</span>
    </span>
  )
}

/** One program: amount, deadline and eligibility (checked against an account when given). */
export function GrantProgram({ g, account, action }: { g: Grant; account?: Account; action?: React.ReactNode }) {
  const checks = account ? checkEligibility(g, account) : undefined
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">{g.shortName}</div>
          <div className="text-[13px] text-ink-2">{g.name}</div>
          <div className="text-[12px] text-muted">{g.agency}</div>
        </div>
        <Chip tone={g.level === 'Federal' ? 'neutral' : 'dim'}>{g.level === 'State' && g.state ? `${STATES[g.state]?.name ?? g.state} program` : 'Federal program'}</Chip>
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <dt className="text-muted">Amount</dt>
          <dd className="mt-0.5 text-ink">{awardText(g)}</dd>
          <dd className="text-[12px] text-muted">{g.award.basis}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Deadline</dt>
          <dd className="mt-0.5">
            <Deadline g={g} />
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-muted">Eligibility</dt>
          <dd className="mt-1">
            <ul className="flex flex-col gap-1">
              {(checks ?? describeEligibility(g).map((label) => ({ label, status: undefined, detail: undefined }))).map((c) => {
                const st = c.status ? STATUS_ICON[c.status] : undefined
                const Icon = st?.icon
                return (
                  <li key={c.label} className="flex items-start gap-2 text-ink-2">
                    {Icon ? <Icon size={14} className={`mt-[2px] shrink-0 ${st.cls}`} aria-label={st.word} /> : <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-2" aria-hidden />}
                    <span className="min-w-0">
                      {c.label}
                      {c.detail && <span className="text-muted"> ({c.detail})</span>}
                      {c.status === 'To confirm' && <span className="text-muted"> · to confirm</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </dd>
        </div>
      </dl>
      {action && <div className="mt-3 flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  )
}

/** Grant funding attached to a regional rule change, with its pre-drafted applications. */
export function LawChangeGrants({ change }: { change: RegulatoryChange }) {
  const accounts = useCrm((s) => s.accounts)
  const apps = useCrm((s) => s.grantApplications)
  const triggered = useCrm((s) => s.grantTriggered[change.signal.id])
  const draftGrantsForSignal = useCrm((s) => s.draftGrantsForSignal)
  const affected = affectedAccounts(change, accounts)
  const customers = affected.filter((a) => a.status === 'Customer').length
  const grants = grantsForChange(change)
  const drafted = applicationsForChange(change, apps, accounts)
  return (
    <details className="group mt-3 rounded-[14px] bg-accent-soft">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-ink [&::-webkit-details-marker]:hidden">
        <Landmark size={14} aria-hidden />
        <span className="font-medium">Grant funding</span>
        <span className="text-ink-2">
          {grants.length ? `${grants.length} ${grants.length === 1 ? 'program' : 'programs'}` : 'No matching programs'} · {num(affected.length)} affected {affected.length === 1 ? 'account' : 'accounts'} ({num(customers)} {customers === 1 ? 'customer' : 'customers'}) · {num(drafted.length)} {drafted.length === 1 ? 'application' : 'applications'} drafted
        </span>
        <span className="ml-auto text-muted group-open:hidden">Show</span>
        <span className="ml-auto hidden text-muted group-open:inline">Hide</span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="max-w-[68ch] text-[13px] leading-relaxed text-ink-2">
          <span className="text-ink">{change.label}.</span> {change.scope}
        </p>
        {grants.map((g) => (
          <GrantProgram key={g.id} g={g} />
        ))}
        {!grants.length && <p className="text-[13px] text-muted">The grant directory has no program for this kind of rule in {STATES[change.signal.state!]?.name}.</p>}
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {drafted.length > 0 && (
            <Link to={`/signals?tab=grants&signal=${change.signal.id}`} className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-surface transition hover:opacity-90">
              Review {num(drafted.length)} {drafted.length === 1 ? 'application' : 'applications'}
            </Link>
          )}
          {!triggered && grants.length > 0 && affected.length > drafted.length && (
            <Button size="sm" onClick={() => draftGrantsForSignal(change.signal.id)}>
              Pre-draft applications for {num(affected.length - drafted.length)} {affected.length - drafted.length === 1 ? 'account' : 'accounts'}
            </Button>
          )}
          <span className="text-muted">Applications are drafts for review. Nothing is submitted.</span>
        </div>
        <p className="text-[12px] text-muted">{grantSource.disclaimer}</p>
      </div>
    </details>
  )
}
