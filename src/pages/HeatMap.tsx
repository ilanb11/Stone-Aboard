import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { useBook, signalsByAccount } from '../lib/useData'
import { STATES, STATE_LIST } from '../data/geo'
import { OPERATION_LABEL, OPERATION_OPTIONS, OPERATION_TYPES, isOpenStage, type Account, type Opportunity, type Species } from '../types'
import { currentDeal } from '../lib/pipeline'
import { FarmMap, farmMix, FARM_ZOOM_START, type FarmPoint } from '../components/FarmMap'
import { Card, Chip, PageHeader, Pill, Select, Tabs, TextLink } from '../components/ui'
import { money, num, relDays, shortDate, sizeLabel } from '../lib/format'
import { mrr } from '../lib/pricing'
import { loadCountyAtlas, placeFarm, type County, type CountyAtlas } from '../lib/placement'
import { combined, computePenetration, marketUnits, type Penetration, type Split } from '../lib/penetration'

type Filter = 'All' | Species
type View = 'heat' | 'penetration'
type HeatBy = 'farms' | 'size' | 'arr' | 'pipeline' | 'signals'
type Vend = 'vended' | 'unvended'

const HEAT_BY: { value: HeatBy; label: string }[] = [
  { value: 'farms', label: 'Farm density (every tracked farm)' },
  { value: 'size', label: 'Operation size (head or acres)' },
  { value: 'arr', label: 'Customer ARR' },
  { value: 'pipeline', label: 'Open pipeline value' },
  { value: 'signals', label: 'Change signals (last 30 days)' },
]
// Written out in full: Tailwind only emits theme variables it finds literally in source.
const GREEN = ['var(--color-heat-1)', 'var(--color-heat-2)', 'var(--color-heat-3)', 'var(--color-heat-4)', 'var(--color-heat-5)']
const WARM = ['var(--color-warm-1)', 'var(--color-warm-2)', 'var(--color-warm-3)', 'var(--color-warm-4)', 'var(--color-warm-5)']
// Map markers: hog = lime, cattle = white, field crops = ink with a light ring.
const MARKER: Record<Species, { color: string; ring: string }> = {
  Hog: { color: 'var(--color-cat-2)', ring: 'var(--color-marker-ring)' },
  Cattle: { color: 'var(--color-cat-3)', ring: 'var(--color-marker-ring)' },
  Grain: { color: 'var(--color-cat-1)', ring: 'var(--color-surface)' },
}
const DAY = 86400000
const nameLink = 'text-ink underline-offset-4 hover:underline'
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(v > 0 && v < 0.001 ? 2 : digits)}%`

/** sqrt-scaled 0..1 weight against the 95th percentile, so one giant farm can't wash out the rest. */
function normalizer(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] || 1
  return (v: number) => (v > 0 ? Math.min(1, Math.max(0.08, Math.sqrt(v) / Math.sqrt(p95))) : 0)
}

/** Five quantile bins over the non-zero values. */
function binner(values: number[], ramp: string[]) {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  const q = (p: number) => nz[Math.floor(p * (nz.length - 1))] ?? 0
  const breaks = [q(0.2), q(0.4), q(0.6), q(0.8)]
  return {
    fill: (v: number) => (v > 0 ? ramp[breaks.filter((b) => v > b).length] : undefined),
    // Legend ends: 5th and 95th percentile, so one tiny state can't stretch the range.
    min: q(0.05),
    max: q(0.95),
  }
}

export default function HeatMap() {
  const book = useBook()
  const [filter, setFilter] = useState<Filter>('All')
  const [view, setView] = useState<View>('heat')
  const [heatBy, setHeatBy] = useState<HeatBy>('farms')
  const [vend, setVend] = useState<Vend>('vended')
  const [selState, setSelState] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ code: string | null; n: number }>({ code: null, n: 0 })
  const [farm, setFarm] = useState<string | null>(null)
  const [atlas, setAtlas] = useState<CountyAtlas | null>(null)
  const [mode, setMode] = useState<'heat' | 'blend' | 'farms'>('heat')

  useEffect(() => {
    let live = true
    loadCountyAtlas()
      .then((a) => live && setAtlas(a))
      .catch(() => undefined) // stay on state-level positions if the atlas can't load
    return () => {
      live = false
    }
  }, [])

  const inFilter = useCallback((sp: Species) => filter === 'All' || sp === filter, [filter])
  const filtered = useMemo(() => book.accounts.filter((a) => inFilter(a.species)), [book, inFilter])
  const oppsByAccount = useMemo(() => {
    const m: Record<string, Opportunity[]> = {}
    for (const o of book.opportunities) (m[o.accountId] ??= []).push(o)
    return m
  }, [book])
  const openValue = useCallback((id: string) => (oppsByAccount[id] ?? []).filter((o) => isOpenStage(o.stage)).reduce((s, o) => s + o.arr, 0), [oppsByAccount])
  const pen: Penetration = useMemo(() => computePenetration(filtered), [filtered])

  // Which farms feed the heat and markers, and how much each counts.
  const points: FarmPoint[] = useMemo(() => {
    const since = Date.now() - 30 * DAY
    let rows: { a: Account; v: number }[]
    if (view === 'penetration') {
      rows = filtered.filter((a) => (vend === 'vended' ? a.status === 'Customer' : a.status !== 'Customer')).map((a) => ({ a, v: marketUnits(a) }))
    } else {
      rows = filtered.map((a) => {
        switch (heatBy) {
          case 'farms': return { a, v: 1 }
          case 'size': return { a, v: marketUnits(a) }
          case 'arr': return { a, v: a.status === 'Customer' ? mrr(a) * 12 : 0 }
          case 'pipeline': return { a, v: openValue(a.id) }
          case 'signals': return { a, v: (signalsByAccount[a.id] ?? []).filter((s) => new Date(s.date).getTime() > since).length }
        }
      })
    }
    rows = rows.filter((r) => r.v > 0)
    // Size-based weights are normalized per operation type: head and acres aren't comparable.
    const perType = view === 'penetration' || heatBy === 'size'
    const norms = Object.fromEntries(OPERATION_TYPES.map((sp) => [sp, normalizer(rows.filter((r) => !perType || r.a.species === sp).map((r) => r.v))]))
    const sizeNorms = Object.fromEntries(OPERATION_TYPES.map((sp) => [sp, normalizer(filtered.filter((a) => a.species === sp).map(marketUnits))]))
    return rows.map(({ a, v }) => {
      const [lon, lat] = atlas ? placeFarm(a, atlas) : [a.lon, a.lat]
      return { id: a.id, lon, lat, w: heatBy === 'farms' && view === 'heat' ? 0.6 : norms[a.species](v), size: sizeNorms[a.species](marketUnits(a)), ...MARKER[a.species] }
    })
  }, [filtered, view, vend, heatBy, openValue, atlas])

  // State and county shading (penetration view only; the heat view keeps a neutral base).
  const ramp = view === 'penetration' && vend === 'unvended' ? WARM : GREEN
  const stateValue = useMemo(() => {
    if (view !== 'penetration') return null
    const out: Record<string, number> = {}
    for (const s of STATE_LIST) {
      if (vend === 'vended') out[s.code] = combined(pen.state[s.code], filter).vendedPct
      else {
        // Unvended: the state's share of the U.S. market we don't serve yet (prospects + whitespace).
        const kinds = filter === 'All' ? OPERATION_TYPES : [filter]
        const shares = kinds.map((sp) => {
          const nat = pen.national[sp]
          const r = pen.state[s.code][sp]
          return nat.market - nat.vended > 0 ? (r.market - r.vended) / (nat.market - nat.vended) : 0
        })
        out[s.code] = shares.reduce((x, y) => x + y, 0) / shares.length
      }
    }
    return out
  }, [view, vend, pen, filter])
  const stateBins = useMemo(() => (stateValue ? binner(Object.values(stateValue), ramp) : null), [stateValue, ramp])
  // Land is a neutral grey so the heat reads on it; states with no value in the penetration view stay grey.
  const countiesReady = !!(selState && atlas)
  const stateFill = useCallback(
    (code: string) => {
      // The selected state goes neutral so its county shading reads on its own.
      if (!stateValue || !stateBins || (code === selState && countiesReady)) return 'var(--color-seq-1)'
      return stateBins.fill(stateValue[code]) ?? 'var(--color-seq-1)'
    },
    [stateValue, stateBins, selState, countiesReady],
  )

  const counties: County[] | undefined = selState && atlas ? atlas.byState.get(STATES[selState].fips) : undefined
  const countyShare = useCallback(
    (c: County) => {
      const r = selState ? pen.county[`${selState}|${c.name}`] : undefined
      if (!r || r.vended + r.unvended === 0) return undefined
      const share = r.vended / (r.vended + r.unvended)
      return vend === 'vended' ? share : 1 - share
    },
    [pen, selState, vend],
  )
  const countyFill = useCallback(
    (c: County) => {
      if (view !== 'penetration') return undefined
      const v = countyShare(c)
      if (v === undefined) return undefined
      return ramp[Math.min(4, Math.floor(v * 5))]
    },
    [view, countyShare, ramp],
  )

  const selectState = (code: string | null) => {
    setSelState(code)
    setFarm(null)
    setFocus((f) => ({ code, n: f.n + 1 }))
  }
  const onZoom = useCallback((k: number) => {
    const m = farmMix(k)
    setMode(m >= 1 ? 'farms' : m <= 0 ? 'heat' : 'blend')
  }, [])

  const legendLabel =
    view === 'heat' ? HEAT_BY.find((h) => h.value === heatBy)!.label : vend === 'vended' ? 'Penetration: share of the state market we serve' : 'Unvended market: share of the U.S. market we don’t serve yet'

  return (
    <div>
      <PageHeader title="Heat map" subtitle="Where the herds and crop acres are, where we already sell, and where the opportunity is. Zoom in to go from heat to individual farms, and select a farm to see everything we have on it." />

      <Tabs
        value={view}
        onChange={(v) => setView(v)}
        tabs={[
          { value: 'heat', label: 'Heat map' },
          { value: 'penetration', label: 'Market penetration' },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="self-start" pad={false}>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 pt-5">
            <Control label="Operation">
              {OPERATION_OPTIONS.map((o) => (
                <Pill key={o.value} active={filter === o.value} onClick={() => setFilter(o.value)}>
                  {o.value === 'All' ? 'All' : o.label}
                </Pill>
              ))}
            </Control>
            {view === 'heat' ? (
              <Select label="Heat shows" value={heatBy} onChange={setHeatBy} options={HEAT_BY} className="w-full sm:w-auto" />
            ) : (
              <Control label="Show">
                <Pill active={vend === 'vended'} onClick={() => setVend('vended')} title="Current customers">
                  Vended
                </Pill>
                <Pill active={vend === 'unvended'} onClick={() => setVend('unvended')} title="Prospects and whitespace">
                  Unvended
                </Pill>
              </Control>
            )}
          </div>

          <div className="px-3 pb-3 pt-4 sm:px-5">
            <FarmMap
              points={points}
              heatRamp={ramp}
              heatOpacity={view === 'penetration' ? 0.6 : 1}
              stateFill={stateFill}
              counties={counties}
              countyFill={countyFill}
              selectedState={selState}
              focus={focus}
              onStateClick={(code) => selectState(code)}
              selectedFarm={farm}
              onFarmClick={(id) => {
                setFarm(id)
                setSelState(book.byId[id].state)
              }}
              onZoom={onZoom}
              stateTooltip={(code) => <StateTip code={code} view={view} vend={vend} filter={filter} pen={pen} value={stateValue?.[code]} />}
              countyTooltip={(fips) => {
                const c = counties?.find((x) => x.fips === fips)
                const r = c && selState ? pen.county[`${selState}|${c.name}`] : undefined
                return c ? (
                  <div>
                    <div className="font-medium">{c.name} County</div>
                    {r ? (
                      <>
                        <div className="text-ink-2">
                          {r.vendedCount} vended, {r.unvendedCount} unvended farms
                        </div>
                        <div className="text-muted">{pct(r.vended / (r.vended + r.unvended), 0)} of tracked size is vended</div>
                      </>
                    ) : (
                      <div className="text-muted">No tracked farms</div>
                    )}
                  </div>
                ) : null
              }}
              farmTooltip={(id) => {
                const a = book.byId[id]
                return (
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-ink-2">
                      {OPERATION_LABEL[a.species]}, {sizeLabel(a)}
                    </div>
                    <div className="text-muted">
                      {a.status}, {a.county} Co., {a.state}
                    </div>
                  </div>
                )
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 px-1 text-[12px] text-ink-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-ink">{legendLabel}</span>
                {view === 'heat' ? (
                  <span className="inline-flex items-center gap-2">
                    <span>Low</span>
                    <span className="h-2.5 w-28 rounded-full" style={{ background: `linear-gradient(to right, ${GREEN.join(', ')})` }} aria-hidden />
                    <span>High</span>
                  </span>
                ) : (
                  stateBins && (
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular">{pct(stateBins.min)}</span>
                      <span className="flex overflow-hidden rounded-full" aria-hidden>
                        {ramp.map((c) => (
                          <span key={c} className="h-2.5 w-6" style={{ background: c }} />
                        ))}
                      </span>
                      <span className="tabular">{pct(stateBins.max)}+</span>
                    </span>
                  )
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {(filter === 'All' ? OPERATION_TYPES : [filter]).map((sp) => (
                  <span key={sp} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-ink" style={{ background: MARKER[sp].color }} aria-hidden />
                    {OPERATION_LABEL[sp]}
                  </span>
                ))}
                <span className="text-muted">{mode === 'farms' ? 'Showing individual farms. Zoom out for the heat view.' : `Zoom in past ${FARM_ZOOM_START}x or select a state to see farms.`}</span>
              </div>
            </div>
            <p className="mt-2 px-1 text-[12px] text-muted">
              {num(points.length)} farms on the map. Scroll or pinch to zoom and drag to pan. With the map focused, use + and − to zoom, the arrow keys to pan and 0 to reset.{view === 'penetration' ? ' Select a state to shade its counties by the share of tracked farm size that is ' + vend + '.' : ''}
            </p>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          {farm ? (
            <FarmPanel a={book.byId[farm]} opps={oppsByAccount[farm] ?? []} openValue={openValue(farm)} onBack={() => setFarm(null)} />
          ) : selState ? (
            <StatePanel code={selState} filter={filter} pen={pen} book={book} inFilter={inFilter} onBack={() => selectState(null)} onFarm={setFarm} />
          ) : (
            <NationalPanel filter={filter} pen={pen} filtered={filtered} />
          )}
        </div>
      </div>
    </div>
  )
}

/** A labelled group of map controls, so pills line up with the select. */
function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={label}>
      <span className="text-[13px] text-ink-2" aria-hidden>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function StateTip({ code, view, vend, filter, pen, value }: { code: string; view: View; vend: Vend; filter: Filter; pen: Penetration; value?: number }) {
  const s = combined(pen.state[code], filter)
  return (
    <div>
      <div className="font-medium">{STATES[code].name}</div>
      {view === 'penetration' ? (
        <>
          <div className="text-ink-2">
            {vend === 'vended' ? `Penetration ${pct(s.vendedPct, 2)}` : `Unvended ${pct(1 - s.vendedPct)} of the state market`}
          </div>
          <div className="text-muted">
            {vend === 'vended' ? `Prospects ${pct(s.prospectPct)}, whitespace ${pct(s.whitespacePct)}` : `${pct(value ?? 0)} of the U.S. unvended market`}
          </div>
        </>
      ) : (
        <div className="text-ink-2">Select to zoom in and see its farms</div>
      )}
    </div>
  )
}

/** Vended / prospects / whitespace as one stacked bar, with the numbers spelled out. */
function PenBar({ label, s }: { label: string; s: Split }) {
  const seg = (v: number) => `${Math.max(v > 0 ? 0.6 : 0, v * 100)}%`
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-ink">{label}</span>
        <span className="tabular text-ink">{pct(s.vendedPct, 2)} vended</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-accent-soft-2" role="img" aria-label={`${label}: ${pct(s.vendedPct, 2)} vended, ${pct(s.prospectPct)} prospects, ${pct(s.whitespacePct)} whitespace`}>
        <span style={{ width: seg(s.vendedPct), background: 'var(--color-heat-4)' }} />
        <span style={{ width: seg(s.prospectPct), background: 'var(--color-warm-3)' }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted">
        <span>Prospects {pct(s.prospectPct)}</span>
        <span>Whitespace {pct(s.whitespacePct)}</span>
      </div>
    </div>
  )
}

function PenKey() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-heat-4)' }} aria-hidden />Vended (customers)</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-warm-3)' }} aria-hidden />Prospects</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent-soft-2" aria-hidden />Whitespace (not in the CRM)</span>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="figure truncate text-[28px] text-ink">{value}</div>
      <div className="mt-1 text-[12px] text-muted">{label}</div>
    </div>
  )
}

const millions = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)}M`

function NationalPanel({ filter, pen, filtered }: { filter: Filter; pen: Penetration; filtered: Account[] }) {
  const customers = filtered.filter((a) => a.status === 'Customer')
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="display text-[32px] text-ink">United States</h2>
      <div className="mt-1.5 text-[13px] text-muted">Select a state or zoom in to see its farms.</div>
      <div className="mt-5 grid grid-cols-3 gap-x-4 gap-y-5">
        <Figure label="Tracked farms" value={num(filtered.length)} />
        <Figure label="Customers" value={num(customers.length)} />
        <Figure label="ARR" value={money(customers.reduce((s, a) => s + mrr(a) * 12, 0))} />
      </div>
      <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5">
        <div className="text-[14px] text-ink">Market penetration</div>
        {(filter === 'All' ? OPERATION_TYPES : [filter]).map((sp) => (
          <PenBar key={sp} label={OPERATION_LABEL[sp]} s={pen.national[sp]} />
        ))}
        <PenKey />
        <p className="text-[12px] leading-relaxed text-muted">Share of U.S. hog and cattle head and crop acres, by indicative USDA-scale inventories. Prospects are farms we track but don't serve; whitespace is market with no account in the CRM.</p>
      </div>
    </section>
  )
}

function StatePanel({ code, filter, pen, book, inFilter, onBack, onFarm }: { code: string; filter: Filter; pen: Penetration; book: ReturnType<typeof useBook>; inFilter: (sp: Species) => boolean; onBack: () => void; onFarm: (id: string) => void }) {
  const st = STATES[code]
  const accts = book.accounts.filter((a) => a.state === code && inFilter(a.species))
  const customers = accts.filter((a) => a.status === 'Customer')
  const pipeline = book.opportunities.filter((o) => isOpenStage(o.stage) && accts.some((a) => a.id === o.accountId)).reduce((s, o) => s + o.arr, 0)
  const counties = Object.values(pen.county)
    .filter((c) => c.state === code)
    .sort((a, b) => b.vended + b.unvended - (a.vended + a.unvended))
  const top = book.ranked.filter((r) => r.account.state === code && inFilter(r.account.species)).slice(0, 4)
  return (
    <>
      <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> United States
        </button>
        <h2 className="display text-[32px] text-ink">{st.name}</h2>
        <div className="mt-1.5 text-[13px] text-muted">{st.region}</div>
        <div className="mt-5 grid grid-cols-3 gap-x-4 gap-y-5">
          <Figure label="Hogs (head)" value={millions(st.hogs)} />
          <Figure label="Cattle (head)" value={millions(st.cattle)} />
          <Figure label="Crop acres" value={millions(st.crops)} />
          <Figure label="Customers" value={customers.length} />
          <Figure label="ARR" value={money(customers.reduce((s, a) => s + mrr(a) * 12, 0))} />
          <Figure label="Pipeline" value={money(pipeline)} />
        </div>
        <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5">
          <div className="text-[14px] text-ink">Market penetration</div>
          {(filter === 'All' ? OPERATION_TYPES : [filter]).map((sp) => (
            <PenBar key={sp} label={OPERATION_LABEL[sp]} s={pen.state[code][sp]} />
          ))}
          <PenKey />
        </div>
        <Link to={`/accounts?state=${code}`} className="mt-5 inline-block">
          <TextLink>View {accts.length} {accts.length === 1 ? 'account' : 'accounts'} in {st.name}</TextLink>
        </Link>
      </section>

      <Card title="Penetration by county" pad={false}>
        {counties.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-5 py-2 font-normal">County</th>
                <th className="px-2 py-2 text-right font-normal">Vended</th>
                <th className="px-2 py-2 text-right font-normal">Unvended</th>
                <th className="w-28 px-5 py-2 font-normal">Vended share</th>
              </tr>
            </thead>
            <tbody>
              {counties.map((c) => {
                const share = c.vended / (c.vended + c.unvended || 1)
                return (
                  <tr key={c.county} className="border-t border-line">
                    <td className="px-5 py-2 text-ink">{c.county}</td>
                    <td className="tabular px-2 py-2 text-right text-ink">{c.vendedCount}</td>
                    <td className="tabular px-2 py-2 text-right text-ink">{c.unvendedCount}</td>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-full rounded-full bg-accent-soft-2">
                          <div className="h-1.5 rounded-full" style={{ width: `${share * 100}%`, background: 'var(--color-heat-4)' }} />
                        </div>
                        <span className="tabular w-9 shrink-0 text-right text-ink-2">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-5 pb-4 pt-2 text-[14px] text-muted">No tracked farms in {st.name} for this operation type.</div>
        )}
        <p className="px-5 pb-4 pt-2 text-[12px] text-muted">Vended share is the part of tracked farm size (head or acres) that belongs to customers.</p>
      </Card>

      <Card title="Top opportunities" pad={false}>
        <ul className="divide-y divide-line">
          {top.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <button type="button" onClick={() => onFarm(r.account.id)} className={`block truncate text-left text-[14px] ${nameLink}`}>
                  {r.account.name}
                </button>
                <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted">
                  <span>{r.type}</span>
                  <span className="max-w-full truncate">{r.reasons[0] ?? r.account.segment}</span>
                </div>
              </div>
              <span className="tabular shrink-0 text-[14px] text-ink">{money(r.arr)}</span>
            </li>
          ))}
          {!top.length && <li className="px-5 pb-3 pt-2 text-[14px] text-muted">No open opportunities in {st.name}.</li>}
        </ul>
      </Card>
    </>
  )
}

function FarmFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-ink">{children}</dd>
    </div>
  )
}

function FarmPanel({ a, opps, openValue, onBack }: { a: Account; opps: Opportunity[]; openValue: number; onBack: () => void }) {
  const deal = currentDeal(opps)
  const sigs = (signalsByAccount[a.id] ?? []).slice(0, 4)
  const decision = a.contacts.find((c) => ['Owner', 'GM', 'CFO'].includes(c.role)) ?? a.contacts[0]
  const arr = mrr(a) * 12
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-label={`${a.name} details`}>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Back to {STATES[a.state].name}
      </button>
      <h2 className="display text-[30px] text-ink">{a.name}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip tone={a.status === 'Customer' ? 'accent' : a.status === 'Churned' ? 'dim' : 'neutral'}>{a.status}</Chip>
        <Chip>{OPERATION_LABEL[a.species]}</Chip>
        <span className="text-[13px] text-ink-2">{a.segment}</span>
      </div>
      <div className="mt-1.5 text-[13px] text-muted">
        {a.county} County, {STATES[a.state].name}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-5">
        <FarmFact label={a.species === 'Grain' ? 'Size (acres)' : 'Size (head)'}>
          <span className="figure text-[26px]">{a.species === 'Grain' ? num(a.acres) : num(a.headCount)}</span>
        </FarmFact>
        <FarmFact label={a.status === 'Customer' ? 'ARR' : 'Open opportunity value'}>
          <span className="figure text-[26px]">{a.status === 'Customer' ? money(arr) : openValue ? money(openValue) : 'None'}</span>
        </FarmFact>
        <FarmFact label="Stage">{deal ? `${deal.stage} (${deal.type})` : 'No deal yet'}</FarmFact>
        {a.status === 'Customer' && openValue > 0 && <FarmFact label="Open opportunity value">{money(openValue)}</FarmFact>}
        <FarmFact label="Sales rep">{a.rep}</FarmFact>
        <FarmFact label="Last contact">
          {relDays(a.lastContact)} <span className="meta text-muted">{shortDate(a.lastContact)}</span>
        </FarmFact>
        <FarmFact label={a.species === 'Grain' ? 'Sites and bins' : 'Sites and barns'}>
          {a.sites} {a.sites === 1 ? 'site' : 'sites'}, {a.barns} {a.species === 'Grain' ? (a.barns === 1 ? 'bin' : 'bins') : a.barns === 1 ? 'barn' : 'barns'}
        </FarmFact>
        {a.species === 'Grain' ? <FarmFact label="Main crops">{(a.crops ?? []).join(', ')}</FarmFact> : <FarmFact label="Acres">{num(a.acres)}</FarmFact>}
        <FarmFact label="Employees">{a.employees}</FarmFact>
        <FarmFact label="Ownership">{a.parentCompany ? `${a.ownership}, ${a.parentCompany}` : a.ownership}</FarmFact>
        {decision && (
          <FarmFact label="Decision maker">
            {decision.name}
            <div className="text-[12px] text-muted">{decision.title}</div>
          </FarmFact>
        )}
        {a.integrator && <FarmFact label={a.species === 'Hog' ? 'Integrator' : a.species === 'Grain' ? 'Grain marketing' : 'Packer or co-op'}>{a.integrator}</FarmFact>}
      </dl>
      {deal?.reason && <p className="mt-3 text-[13px] text-ink-2">{deal.reason}</p>}

      <div className="mt-5 border-t border-line pt-5">
        <div className="text-[14px] text-ink">Recent signals</div>
        {sigs.length ? (
          <ul className="mt-3 flex flex-col gap-3">
            {sigs.map((s) => (
              <li key={s.id}>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <Chip>{s.type}</Chip>
                  <span className="meta text-muted">{shortDate(s.date)}</span>
                </div>
                <div className="mt-1 text-[13px] text-ink">{s.headline}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No recorded changes.</p>
        )}
      </div>

      <Link
        to={`/accounts/${a.id}`}
        className="mt-6 inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-[14px] font-medium text-on-accent transition hover:opacity-85"
      >
        Open account <ArrowUpRight size={14} aria-hidden />
      </Link>
    </section>
  )
}
