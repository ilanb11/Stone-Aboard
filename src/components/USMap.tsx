import { useMemo, useRef, useState, type ReactNode } from 'react'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import usTopo from 'us-atlas/states-10m.json'
import { STATE_BY_FIPS } from '../data/geo'

const W = 975
const H = 610
const projection = geoAlbersUsa().scale(1300).translate([W / 2, H / 2])
const path = geoPath(projection)
const topo = usTopo as unknown as Topology
const statesFC = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry>
const STATE_PATHS = statesFC.features
  .map((f) => {
    const st = STATE_BY_FIPS[String(f.id).padStart(2, '0')]
    return st ? { code: st.code, d: path(f) ?? '' } : null
  })
  .filter((x): x is { code: string; d: string } => !!x && !!x.d)
const BORDERS = path(mesh(topo, topo.objects.states as GeometryCollection, (a, b) => a !== b)) ?? ''

export interface MapPoint {
  id: string
  lon: number
  lat: number
  color: string
  r: number
}

export function project(lon: number, lat: number): [number, number] | null {
  return projection([lon, lat])
}

export function USMap({
  fill,
  onStateClick,
  stateTooltip,
  selected,
  points,
  pointTooltip,
  onPointClick,
  dimStates,
}: {
  fill: (code: string) => string
  onStateClick?: (code: string) => void
  stateTooltip?: (code: string) => ReactNode
  selected?: string | null
  points?: MapPoint[]
  pointTooltip?: (id: string) => ReactNode
  onPointClick?: (id: string) => void
  dimStates?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null)
  const projected = useMemo(
    () =>
      (points ?? [])
        .map((p) => {
          const xy = projection([p.lon, p.lat])
          return xy ? { ...p, x: xy[0], y: xy[1] } : null
        })
        .filter((p): p is MapPoint & { x: number; y: number } => !!p),
    [points],
  )

  const move = (e: React.MouseEvent, content: ReactNode) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content })
  }

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Map of the United States">
        <g>
          {STATE_PATHS.map((s) => (
            <path
              key={s.code}
              d={s.d}
              fill={fill(s.code)}
              opacity={dimStates ? 0.55 : 1}
              stroke={selected === s.code ? 'var(--color-ink)' : 'none'}
              strokeWidth={selected === s.code ? 2 : 0}
              className={onStateClick ? 'cursor-pointer' : ''}
              onClick={() => onStateClick?.(s.code)}
              onMouseMove={(e) => stateTooltip && move(e, stateTooltip(s.code))}
            />
          ))}
        </g>
        <path d={BORDERS} fill="none" stroke="var(--color-surface)" strokeWidth={1} pointerEvents="none" />
        {selected && (
          <path d={STATE_PATHS.find((s) => s.code === selected)?.d} fill="none" stroke="var(--color-ink)" strokeWidth={2} pointerEvents="none" />
        )}
        {projected.length > 0 && (
          <g>
            {projected.map((p) => (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={p.color}
                stroke="var(--color-surface)"
                strokeWidth={1}
                className="cursor-pointer"
                onClick={() => onPointClick?.(p.id)}
                onMouseMove={(e) => {
                  e.stopPropagation()
                  if (pointTooltip) move(e, pointTooltip(p.id))
                }}
              />
            ))}
          </g>
        )}
      </svg>
      {tip && tip.content && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink shadow-lg"
          style={{ left: Math.min(tip.x + 14, (ref.current?.clientWidth ?? 0) - 220), top: tip.y + 14 }}
        >
          {tip.content}
        </div>
      )}
    </div>
  )
}
