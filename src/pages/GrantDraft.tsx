import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, Landmark, RotateCcw, Trash2 } from 'lucide-react'
import type { GrantSectionId } from '../types'
import { useBook, lawChangeBySignal, lawChanges } from '../lib/useData'
import { useCrm } from '../store'
import { Button, Card, Chip, Empty, Notice, PageHeader, StatusBadge, inputClass } from '../components/ui'
import { GeoTag } from '../components/GeoFilter'
import { Deadline, GrantProgram } from '../components/GrantPrograms'
import { saveText, shortDate } from '../lib/format'
import { awardText, grantMatchesForAccount, grantSource } from '../lib/grants'
import { SECTION_ORDER, SECTION_TITLES, applicationBudget, generatedSections, grantApplicationId, missingItems, renderGrantApplication, unitWord, type GrantDraftContext } from '../lib/grantDrafts'

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const area = `${inputClass.replace('h-9', 'py-2.5')} w-full resize-y leading-relaxed`

/** Review screen for a pre-drafted grant application. People file it with the agency; Herdbook never submits. */
export default function GrantDraft() {
  const { id = '' } = useParams()
  const book = useBook()
  const nav = useNavigate()
  const app = useCrm((s) => s.grantApplications.find((g) => g.id === id))
  const apps = useCrm((s) => s.grantApplications)
  const setGrantSection = useCrm((s) => s.setGrantSection)
  const updateGrantApplication = useCrm((s) => s.updateGrantApplication)
  const setGrantStatus = useCrm((s) => s.setGrantStatus)
  const discard = useCrm((s) => s.discardGrantApplication)
  const addGrantApplication = useCrm((s) => s.addGrantApplication)
  const [note, setNote] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const g = app && grantSource.get(app.grantId)
  const a = app && book.byId[app.accountId]
  if (!app || !g || !a)
    return (
      <div>
        <PageHeader title="Grant application" />
        <Empty>
          This application isn't here any more. It may have been discarded.{' '}
          <Link to="/signals?tab=grants" className="text-ink underline underline-offset-4">
            Back to grant applications
          </Link>
        </Empty>
      </div>
    )

  const changes = app.signalIds.map((sid) => lawChangeBySignal[sid]).filter(Boolean)
  const ctx: GrantDraftContext = { app, grant: g, account: a, changes }
  const gen = generatedSections(ctx)
  const budget = applicationBudget(app, g)
  const reviewed = app.status === 'Reviewed'
  const others = grantMatchesForAccount(a, lawChanges).filter((m) => m.grant.id !== g.id)
  const copy = async () => {
    const r = await saveText(`${g.shortName} application - ${a.name}.txt`, renderGrantApplication(ctx, a.rep))
    setNote(r === 'failed' ? "Couldn't copy or download. Allow clipboard access and try again." : r === 'copied' ? 'Application copied to the clipboard.' : 'Application downloaded as a text file.')
  }
  const setUnits = (i: number, units: number) => updateGrantApplication(app.id, { practices: app.practices.map((p, j) => (j === i ? { ...p, units: Math.max(0, Math.round(units)) } : p)) })

  return (
    <div>
      <Link to="/signals?tab=grants" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Grant applications
      </Link>
      <PageHeader
        title={`${g.shortName} application`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to={`/accounts/${a.id}`} className="text-ink underline-offset-4 hover:underline">{a.name}</Link>
            <Chip tone={a.status === 'Customer' ? 'lime' : 'neutral'}>{a.status}</Chip>
            <GeoTag region={a.region} state={a.state} county={a.county} />
            <span className="text-muted">Pre-drafted {shortDate(app.createdAt)} for {a.rep}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={reviewed ? 'good' : 'warning'}>{reviewed ? `Reviewed ${shortDate(app.reviewedAt ?? '')}` : 'Draft, not submitted'}</StatusBadge>
            <Button onClick={copy}>
              <Copy size={14} /> Copy text
            </Button>
            {reviewed ? (
              <Button onClick={() => setGrantStatus(app.id, 'Draft')}>Back to draft</Button>
            ) : (
              <Button variant="primary" onClick={() => setGrantStatus(app.id, 'Reviewed')}>
                Mark reviewed
              </Button>
            )}
          </div>
        }
      />
      {note && <Notice>{note}</Notice>}
      <div className="mb-5 flex items-start gap-3 rounded-[14px] bg-accent-soft px-4 py-3 text-[14px] text-ink">
        <Landmark size={16} className="mt-0.5 shrink-0" aria-hidden />
        <p className="min-w-0 leading-relaxed">
          Herdbook drafted this from the CRM record and the rule change below. It has not been submitted and can't be: review it, fill in the items marked below, then file it with {g.applyVia.charAt(0).toLowerCase() + g.applyVia.slice(1)}. Marking it reviewed only records that it's ready to share with the customer.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {SECTION_ORDER.map((sid: GrantSectionId) => {
            const edited = app.edits?.[sid] !== undefined
            return (
              <Card
                key={sid}
                title={SECTION_TITLES[sid]}
                action={
                  edited ? (
                    <button type="button" className="inline-flex items-center gap-1.5 text-[13px] text-ink underline-offset-4 hover:underline" onClick={() => setGrantSection(app.id, sid, null)}>
                      <RotateCcw size={12} /> Reset to CRM data
                    </button>
                  ) : (
                    <span className="text-[12px] text-muted">From CRM data</span>
                  )
                }
              >
                {sid === 'project' && (
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-[13px]">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="pb-2 font-normal">Practice</th>
                          <th className="pb-2 text-right font-normal">Quantity</th>
                          <th className="pb-2 text-right font-normal">Unit cost</th>
                          <th className="pb-2 text-right font-normal">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {app.practices.map((p, i) => (
                          <tr key={p.name} className="border-t border-line">
                            <td className="py-2 pr-3 text-ink">
                              {p.name}
                              {p.code && <span className="text-muted"> · NRCS {p.code}</span>}
                            </td>
                            <td className="py-2 text-right">
                              <label className="inline-flex items-center justify-end gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  aria-label={`Quantity of ${p.name}`}
                                  value={p.units}
                                  onChange={(e) => setUnits(i, Number(e.target.value))}
                                  className={`${inputClass} h-8 w-20 text-right`}
                                />
                                <span className="w-24 text-left text-muted">{unitWord(p.unit, p.units)}</span>
                              </label>
                            </td>
                            <td className="tabular py-2 text-right text-ink-2">{usd(p.unitCost)}</td>
                            <td className="tabular py-2 text-right text-ink">{usd(p.units * p.unitCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <textarea
                  id={`grant-${sid}`}
                  aria-label={SECTION_TITLES[sid]}
                  rows={Math.min(14, Math.max(4, (app.edits?.[sid] ?? gen[sid]).split('\n').length + 2))}
                  className={area}
                  value={app.edits?.[sid] ?? gen[sid]}
                  onChange={(e) => setGrantSection(app.id, sid, e.target.value === gen[sid] ? null : e.target.value)}
                />
              </Card>
            )
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Request">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-[13px]">
              <div>
                <dt className="text-muted">Amount requested</dt>
                <dd className="figure mt-1 text-[30px] text-ink">{usd(budget.requested)}</dd>
                {budget.capped && <dd className="text-[12px] text-muted">Capped at the program maximum</dd>}
              </div>
              <div>
                <dt className="text-muted">Project cost</dt>
                <dd className="figure mt-1 text-[30px] text-ink">{usd(budget.projectCost)}</dd>
                <dd className="text-[12px] text-muted">{budget.costSharePct}% program share, {usd(budget.producerShare)} from the applicant</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Deadline</dt>
                <dd className="mt-1">
                  <Deadline g={g} />
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Program limit</dt>
                <dd className="mt-1 text-ink">{awardText(g)}</dd>
              </div>
            </dl>
          </Card>

          <GrantProgram g={g} account={a} />

          <Card title="Still needed before filing">
            <ul className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              {missingItems(ctx).map((m) => (
                <li key={m} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-2" aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
            <div className="mt-4 text-[13px] text-muted">Attachments</div>
            <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink-2">
              {g.attachments.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Card>

          <Card title={changes.length === 1 ? 'Rule change' : 'Rule changes'}>
            <ul className="flex flex-col gap-3">
              {changes.map((c) => (
                <li key={c.signal.id} className="text-[14px]">
                  <div className="text-ink">{c.signal.headline}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                    <span>{shortDate(c.signal.date)}</span>
                    <span>{c.label}</span>
                    <Link to={`/signals?type=Regulatory&state=${c.signal.state}`} className="text-ink underline-offset-4 hover:underline">
                      In the feed
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {others.length > 0 && (
            <Card title="Other programs this account qualifies for">
              <ul className="flex flex-col divide-y divide-line">
                {others.map((m) => {
                  const oid = grantApplicationId(m.grant.id, a.id)
                  const has = apps.some((x) => x.id === oid)
                  return (
                    <li key={m.grant.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                      <span className="min-w-0">
                        <span className="text-ink">{m.grant.shortName}</span>
                        <span className="block text-[12px] text-muted">{awardText(m.grant)}</span>
                      </span>
                      {has ? (
                        <Link to={`/grants/${oid}`} className="text-[13px] text-ink underline underline-offset-4">Open draft</Link>
                      ) : (
                        <Button size="sm" onClick={() => { const made = addGrantApplication(m.grant.id, a.id, m.changes.map((c) => c.signal.id)); if (made) nav(`/grants/${made}`) }}>
                          Draft this one too
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {confirmDiscard ? (
              <>
                <span className="text-[13px] text-ink-2">Discard this draft? Edits are lost.</span>
                <Button variant="danger" size="sm" onClick={() => { discard(app.id); nav('/signals?tab=grants') }}>Discard draft</Button>
                <Button size="sm" onClick={() => setConfirmDiscard(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)}>
                <Trash2 size={13} /> Discard draft
              </Button>
            )}
          </div>
          <p className="text-[12px] text-muted">{grantSource.disclaimer}</p>
        </div>
      </div>
    </div>
  )
}
