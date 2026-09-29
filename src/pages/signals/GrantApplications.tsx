import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TEAM } from '../../data/generate'
import { useBook, lawChangeBySignal, lawChanges } from '../../lib/useData'
import { useCrm } from '../../store'
import { Button, Card, Chip, Select, StatusBadge, TextInput } from '../../components/ui'
import { type Geo, accountInGeo, GeoTag } from '../../components/GeoFilter'
import { Deadline, GrantProgram } from '../../components/GrantPrograms'
import { money, num } from '../../lib/format'
import { COVERAGE_THRESHOLD, applicationsForChange, grantMatchesForAccount, grantSource, nextDeadline, purchaseFor } from '../../lib/grants'
import { applicationBudget, creditRange, grantApplicationId, purchaseLapse } from '../../lib/grantDrafts'
import { Pager } from '../../components/Pager'

const PAGE = 15
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

/** One account's grant programs, from Pipeline Review or an account link (?account=A0123). */
function AccountGrants({ accountId }: { accountId: string }) {
  const book = useBook()
  const apps = useCrm((s) => s.grantApplications)
  const addGrantApplication = useCrm((s) => s.addGrantApplication)
  const nav = useNavigate()
  const a = book.byId[accountId]
  if (!a) return null
  const purchase = purchaseFor(a, book.opportunities, a.contractId ? book.contractById[a.contractId] : undefined)
  const matches = grantMatchesForAccount(a, lawChanges, purchase)
  return (
    <Card title={`Grant programs for ${a.name}`} action={<Link to={`/accounts/${a.id}`} className="text-[13px] text-ink underline underline-offset-4">Open account</Link>}>
      {!purchase && <p className="text-[14px] text-muted">{a.name} isn’t buying from us right now (no open deal or renewal in the next five months), so there’s nothing for a grant to fund.</p>}
      {purchase && !matches.length && <p className="text-[14px] text-muted">No program in the directory funds the products in {a.name}’s {purchase.kind === 'Renewal' ? 'renewal' : 'deal'}.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {matches.map((m) => {
          const id = grantApplicationId(m.grant.id, a.id)
          const has = apps.some((x) => x.id === id)
          return (
            <GrantProgram
              key={m.grant.id}
              g={m.grant}
              account={a}
              action={
                <>
                  {has ? (
                    <Link to={`/grants/${id}`} className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] text-surface transition hover:opacity-90">
                      Open application draft
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        const made = addGrantApplication(m.grant.id, a.id, m.changes.map((c) => c.signal.id))
                        if (made) nav(`/grants/${made}`)
                      }}
                    >
                      Draft application
                    </Button>
                  )}
                  <span className={`text-[12px] ${m.coverage.coverage >= COVERAGE_THRESHOLD ? 'text-good-text' : 'text-muted'}`}>
                    Covers {Math.round(m.coverage.coverage * 100)}% of the {purchase?.kind === 'Renewal' ? 'renewal' : 'deal'} ({usd(m.coverage.funded)} of {usd(purchase?.annualCost ?? 0)})
                    {m.coverage.coverage < COVERAGE_THRESHOLD ? ', below the 50% bar for an automatic draft' : ''}
                    {m.changes.length ? `. Timely because of: ${m.changes.map((c) => `${c.label} (${c.signal.state})`).join('; ')}` : ''}
                  </span>
                </>
              }
            />
          )
        })}
      </div>
    </Card>
  )
}

export function GrantApplicationsView({ geo }: { geo: Geo }) {
  const book = useBook()
  const apps = useCrm((s) => s.grantApplications)
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const get = (k: string, d = 'All') => params.get(k) ?? d
  const signalId = params.get('signal')
  const accountId = params.get('account')
  // The area filter and the signal and account links change the list from outside the view's own filters.
  const scope = [geo.region, geo.state, geo.county, signalId, accountId].join('|')
  const [pageFor, setPageFor] = useState(scope)
  if (pageFor !== scope) {
    setPageFor(scope)
    setPage(0)
  }
  const status = get('gstatus')
  const program = get('program')
  const rep = get('rep')
  const q = get('gq', '')
  const upd = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (!v || v === 'All') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )
    setPage(0)
  }

  const rows = useMemo(() => {
    const today = new Date()
    return apps
      .map((app) => {
        const g = grantSource.get(app.grantId)
        const a = book.byId[app.accountId]
        const b = g && applicationBudget(app, g)
        // A draft is only worth filing while the purchase it funds is still happening.
        const lapse = a ? purchaseLapse(app, a, book.opportunities) : null
        return g && a && b ? { app, g, a, lapse, requested: b.requested, coverage: b.coverage, due: nextDeadline(g.deadline, today)?.getTime() ?? Infinity } : null
      })
      .filter((r) => !!r)
      .sort((x, y) => Number(!!x.lapse) - Number(!!y.lapse) || x.due - y.due || (x.a.status === y.a.status ? x.a.name.localeCompare(y.a.name) : x.a.status === 'Customer' ? -1 : 1))
  }, [apps, book])

  const forChange = useMemo(() => {
    const ch = signalId ? lawChangeBySignal[signalId] : undefined
    return ch ? new Set(applicationsForChange(ch, apps, book.accounts).map((x) => x.id)) : undefined
  }, [signalId, apps, book.accounts])
  const shown = rows.filter(({ app, g, a }) => {
    if (!accountInGeo(a, geo)) return false
    if (forChange && !forChange.has(app.id)) return false
    if (accountId && a.id !== accountId) return false
    if (status !== 'All' && app.status !== status) return false
    if (program !== 'All' && g.id !== program) return false
    if (rep !== 'All' && a.rep !== rep) return false
    if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const live = shown.filter((r) => !r.lapse)
  const lapsed = shown.length - live.length
  const reviewed = live.filter((r) => r.app.status === 'Reviewed').length
  // Tax notes are an estimate for the accountant, not money requested from an agency.
  const requested = live.reduce((s, r) => s + (r.g.kind === 'Tax credit' ? 0 : r.requested), 0)
  const programs = [...new Set(rows.map((r) => r.g.id))].map((id) => grantSource.get(id)!).sort((a, b) => a.shortName.localeCompare(b.shortName))
  const change = signalId ? lawChangeBySignal[signalId] : undefined
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const cur = Math.min(page, Math.max(0, pages - 1))
  const td = 'px-3 py-3 align-top first:pl-5 last:pr-5'

  return (
    <div className="flex flex-col gap-5">
      {accountId && <AccountGrants accountId={accountId} />}
      {change && (
        <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px]">
          <span className="min-w-0">
            <span className="text-ink-2">Applications for </span>
            <span className="font-medium text-ink">{change.signal.headline}</span>
            <span className="text-muted"> · {change.label}</span>
          </span>
          <button type="button" className="text-[13px] text-ink underline underline-offset-4" onClick={() => upd({ signal: null })}>
            Show all applications
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TextInput label="Account" value={q} onChange={(v) => upd({ gq: v })} placeholder="Search accounts" />
        <Select label="Program" value={program} onChange={(v) => upd({ program: v })} options={[{ value: 'All', label: 'All programs' }, ...programs.map((g) => ({ value: g.id, label: g.shortName }))]} />
        <Select label="Status" value={status} onChange={(v) => upd({ gstatus: v })} options={[{ value: 'All', label: 'Any status' }, { value: 'Draft', label: 'Draft' }, { value: 'Reviewed', label: 'Reviewed' }]} />
        <Select label="Sales rep" value={rep} onChange={(v) => upd({ rep: v })} options={['All', ...TEAM]} />
      </div>

      <Card
        pad={false}
        title={`${num(live.length)} ${live.length === 1 ? 'application' : 'applications'} · ${num(reviewed)} reviewed · ${money(requested)} requested${lapsed ? ` · ${num(lapsed)} no longer tied to a purchase` : ''}`}
      >
        <p className="border-b border-line px-5 pb-3 text-[13px] text-ink-2">
          Prepared only when a program can pay for at least half of what the customer is buying from us (a deal at Demo or Negotiation, or a renewal in the next 90 days), plus R&D tax credit notes for new sign-ups and expansions to take to their accountant. Tax credit estimates are not counted as requested. Each one waits here for a person to review, complete and file. Nothing is submitted from Herdbook. {grantSource.disclaimer}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead>
              <tr className="text-left text-[13px] text-muted">
                {['Account', 'Program', 'Funds', 'Requested', 'Deadline', 'Status', 'Sales rep', ''].map((h) => (
                  <th key={h} className={`px-3 py-3 font-normal first:pl-5 last:pr-5 ${h === 'Requested' ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(cur * PAGE, cur * PAGE + PAGE).map(({ app, g, a, lapse, requested: req, coverage: cov }) => {
                const changes = app.signalIds.map((id) => lawChangeBySignal[id]).filter(Boolean)
                const credit = g.kind === 'Tax credit' ? creditRange(app) : undefined
                return (
                  <tr key={app.id} className="border-t border-line hover:bg-accent-soft/60">
                    <td className={`${td} min-w-[220px]`}>
                      <Link to={`/accounts/${a.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{a.name}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Chip tone={a.status === 'Customer' ? 'lime' : 'neutral'}>{a.status}</Chip>
                        <GeoTag state={a.state} county={a.county} />
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="text-ink">{g.shortName}</span>
                      <div className="text-[12px] text-muted">{g.kind === 'Tax credit' ? 'Tax credit' : g.level}</div>
                    </td>
                    <td className={`${td} max-w-[240px] text-[13px] text-ink-2`}>
                      {app.kind === 'Tax credit' ? `Note for the accountant (${app.purchase.kind === 'Expansion' ? 'expansion' : 'new sign-up'})` : `${Math.round(cov * 100)}% of the ${app.purchase.kind === 'Renewal' ? 'renewal' : app.purchase.kind === 'Expansion' ? 'expansion' : 'new subscription'}`}
                      {lapse && <span className="block text-[12px] text-serious">{lapse}: no longer tied to a purchase</span>}
                      {changes[0] && <span className="block text-[12px] text-muted">{changes[0].label}{changes.length > 1 ? ` +${changes.length - 1}` : ''}</span>}
                    </td>
                    <td className={`${td} tabular text-right ${lapse ? 'text-muted' : 'text-ink'}`}>
                      {credit ? `${money(credit.low)}–${money(credit.high)}` : money(req)}
                      {credit && <div className="text-[12px] text-muted">Est. credit</div>}
                    </td>
                    <td className={`${td} text-[13px]`}>
                      <Deadline g={g} />
                    </td>
                    <td className={td}>
                      <StatusBadge tone={app.status === 'Reviewed' ? 'good' : 'warning'}>{app.status}</StatusBadge>
                    </td>
                    <td className={`${td} text-[13px] text-ink-2`}>{a.rep}</td>
                    <td className={`${td} text-right`}>
                      <Link to={`/grants/${app.id}`} className="inline-flex h-8 items-center rounded-full bg-accent-soft px-3.5 text-[13px] text-ink transition-colors hover:bg-accent-soft-2">
                        Review
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && (
          <div className="border-t border-line px-5 py-10 text-center text-[14px] text-muted">
            {rows.length ? 'No applications match these filters.' : 'No grant applications yet. One is pre-drafted when a program can pay for at least half of what a customer is buying from us.'}
          </div>
        )}
        <Pager page={cur} pages={pages} onPage={setPage} total={shown.length} size={PAGE} noun="applications" />
      </Card>
    </div>
  )
}
