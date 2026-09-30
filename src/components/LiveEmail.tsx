import { Mail, RefreshCw } from 'lucide-react'
import { useCrm } from '../store'
import type { Outreach } from '../types'
import { deliverOutreach, refreshMailStatus, useMailStatus } from '../lib/liveMail'
import { relDays } from '../lib/format'
import { Button, StatusBadge } from './ui'

/** Outreach page: turn real email on or off, and see where it goes and how many are left. */
export function LiveEmailCard() {
  const on = useCrm((s) => s.liveEmail)
  const setOn = useCrm((s) => s.setLiveEmail)
  const st = useMailStatus()
  const ready = !!st?.configured && st.remaining > 0
  return (
    <section className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
      <div className="min-w-0 max-w-[70ch]">
        <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <Mail size={15} aria-hidden /> Real email (test inbox)
          {on && ready && <StatusBadge tone="good">On</StatusBadge>}
        </div>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          {st === null
            ? 'Checking the mail server…'
            : !st.configured
              ? st.reason
              : `When on, an email you approve also goes to ${st.to}, whoever it was drafted for, with its invoice attached as a PDF. Automatic sends stay simulated. ${st.remaining} of ${st.max} test emails left.`}
        </p>
        {st?.configured && st.remaining === 0 && <p className="mt-1 text-[13px] text-serious">{st.reason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void refreshMailStatus()} title="Check again"><RefreshCw size={12} /></Button>
        <label className={`flex items-center gap-2 text-[13px] ${st?.configured ? 'cursor-pointer text-ink' : 'text-muted'}`}>
          <input type="checkbox" className="h-4 w-4" disabled={!st?.configured} checked={on && !!st?.configured} onChange={(e) => setOn(e.target.checked)} />
          Send real email
        </label>
      </div>
    </section>
  )
}

/** One line next to a send button, so nobody sends a real email by surprise. */
export function LiveEmailNote() {
  const on = useCrm((s) => s.liveEmail)
  const st = useMailStatus()
  if (!on || !st?.configured) return null
  return (
    <p className="text-[13px] text-ink-2">
      Real email is on: sending also emails {st.to}{st.remaining ? ` (${st.remaining} of ${st.max} left)` : ''}.
      {!st.remaining && <span className="text-serious"> The test limit is used up, so it stays simulated.</span>}
    </p>
  )
}

/** Where a sent email really went. */
export function DeliveryBadge({ o }: { o: Outreach }) {
  const on = useCrm((s) => s.liveEmail)
  const d = o.delivery
  if (!d) return null
  if (d.status === 'Sending') return <StatusBadge tone="neutral">Sending to test inbox…</StatusBadge>
  if (d.status === 'Delivered') return <StatusBadge tone="good" title={d.providerId ? `Resend id ${d.providerId}` : undefined}>Delivered to {d.to} <span className="text-muted">{relDays(d.at)}</span></StatusBadge>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge tone="critical" title={d.error}>Not delivered</StatusBadge>
      <span className="text-[12px] text-muted">{d.error}</span>
      {on && <Button size="sm" variant="ghost" onClick={() => void deliverOutreach(o.id)}>Try again</Button>}
    </span>
  )
}
