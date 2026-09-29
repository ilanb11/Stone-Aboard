import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import 'd3-transition'
import type { FeatureCollection, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import usTopo from 'us-atlas/states-10m.json'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { STATE_BY_FIPS } from '../data/geo'
import type { County } from '../lib/placement'

// Zoomable U.S. farm map.
// Layers, bottom to top: SVG states and counties (vector, under the zoom transform),
// a canvas heat layer (density blobs colorized through a gradient and clipped to land),
// and a canvas marker layer. Heat fades into individual farm markers between
// FARM_ZOOM_START and FARM_ZOOM_FULL.

export const MAP_W = 975
export const MAP_H = 610
export const FARM_ZOOM_START = 2.4
export const FARM_ZOOM_FULL = 3.6
const MAX_ZOOM = 40
/** Heat is a blur, so it renders at half resolution and the browser upscales it smoothly. */
const HEAT_RES = 0.5

export const projection = geoAlbersUsa().scale(1300).translate([MAP_W / 2, MAP_H / 2])
const path = geoPath(projection)
const topo = usTopo as unknown as Topology
const statesFC = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry>
const STATES_GEO = statesFC.features
  .map((f) => {
    const st = STATE_BY_FIPS[String(f.id).padStart(2, '0')]
    const d = path(f)
    return st && d ? { code: st.code, d, bounds: path.bounds(f) } : null
  })
  .filter((x): x is { code: string; d: string; bounds: [[number, number], [number, number]] } => !!x)
const BORDERS = path(mesh(topo, topo.objects.states as GeometryCollection, (a, b) => a !== b)) ?? ''

let landPath: Path2D | null = null
function land(): Path2D {
  if (!landPath) {
    landPath = new Path2D()
    for (const s of STATES_GEO) landPath.addPath(new Path2D(s.d))
  }
  return landPath
}

export interface FarmPoint {
  id: string
  lon: number
  lat: number
  /** Heat weight, 0..1. */
  w: number
  /** Marker size, 0..1. */
  size: number
  /** Fill and ring as CSS colors or var(--token). */
  color: string
  ring: string
}

type RGBA = [number, number, number, number]
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d', { willReadFrequently: true }) : null
function cssColor(v: string): RGBA {
  let c = v
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim())
  if (m) c = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#000'
  if (!probe) return [0, 0, 0, 255]
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = c
  probe.fillRect(0, 0, 1, 1)
  const d = probe.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}
const rgbaStr = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${a / 255})`

/** 256-step lookup from accumulated density (alpha) to a heat color. */
function buildLut(ramp: string[]): Uint8ClampedArray {
  const cols = ramp.map(cssColor)
  // position, color index, opacity
  const stops: [number, number, number][] = [
    [0, 0, 0],
    [0.1, 0, 0.5],
    [0.3, 1, 0.72],
    [0.55, 2, 0.84],
    [0.8, 3, 0.92],
    [1, 4, 0.96],
  ]
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let j = 0
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++
    const [p0, c0, a0] = stops[j]
    const [p1, c1, a1] = stops[j + 1]
    const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0)
    const A = cols[c0], B = cols[c1]
    lut[i * 4] = A[0] + (B[0] - A[0]) * f
    lut[i * 4 + 1] = A[1] + (B[1] - A[1]) * f
    lut[i * 4 + 2] = A[2] + (B[2] - A[2]) * f
    lut[i * 4 + 3] = 255 * (a0 + (a1 - a0) * f)
  }
  return lut
}

const blobs = new Map<number, HTMLCanvasElement>()
function blob(r: number): HTMLCanvasElement {
  const key = Math.round(r)
  let c = blobs.get(key)
  if (!c) {
    c = document.createElement('canvas')
    c.width = c.height = key * 2
    // CPU-backed like the density canvas: drawing a GPU canvas into a CPU one forces a
    // readback per draw (measured ~18x slower for 1,140 farms).
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const g = ctx.createRadialGradient(key, key, 0, key, key, key)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, key * 2, key * 2)
    blobs.set(key, c)
  }
  return c
}

let density: HTMLCanvasElement | null = null
/** Off-screen scratch canvas for density accumulation and colorizing. */
function densityCanvas(w: number, h: number): HTMLCanvasElement {
  density ??= document.createElement('canvas')
  if (density.width !== w || density.height !== h) {
    density.width = w
    density.height = h
  }
  return density
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const farmMix = (k: number) => clamp((k - FARM_ZOOM_START) / (FARM_ZOOM_FULL - FARM_ZOOM_START), 0, 1)

/** Static vector base: memoized so zoom frames never re-render it. */
const BaseLayer = memo(function BaseLayer({ fills, counties, countyFills, selected }: { fills: Record<string, string>; counties: { fips: string; d: string }[]; countyFills: Record<string, string>; selected: string | null }) {
  const sel = selected ? STATES_GEO.find((s) => s.code === selected) : null
  return (
    <>
      {STATES_GEO.map((s) => (
        <path key={s.code} d={s.d} data-code={s.code} fill={fills[s.code] ?? 'var(--color-seq-1)'} className="cursor-pointer" />
      ))}
      {counties.map((c) => (
        <path key={c.fips} d={c.d} data-code={selected ?? undefined} data-county={c.fips} fill={countyFills[c.fips] ?? 'none'} stroke="var(--color-surface)" strokeOpacity={0.7} strokeWidth={0.6} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
      ))}
      <path d={BORDERS} fill="none" stroke="var(--color-surface)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {sel && <path d={sel.d} fill="none" stroke="var(--color-ink)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    </>
  )
})

export interface FarmMapProps {
  points: FarmPoint[]
  /** Five heat colors, low to high (CSS colors or var(--token)). */
  heatRamp: string[]
  /** 0..1 multiplier on the heat layer. */
  heatOpacity?: number
  stateFill: (code: string) => string | undefined
  counties?: County[]
  countyFill?: (c: County) => string | undefined
  selectedState?: string | null
  /** Changing `n` re-zooms even if the code is unchanged. */
  focus?: { code: string | null; n: number }
  onStateClick?: (code: string) => void
  selectedFarm?: string | null
  onFarmClick?: (id: string) => void
  stateTooltip?: (code: string) => ReactNode
  farmTooltip?: (id: string) => ReactNode
  countyTooltip?: (fips: string) => ReactNode
  onZoom?: (k: number) => void
}

export function FarmMap({ points, heatRamp, heatOpacity = 1, stateFill, counties, countyFill, selectedState = null, focus, onStateClick, selectedFarm = null, onFarmClick, stateTooltip, farmTooltip, countyTooltip, onZoom }: FarmMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const heatRef = useRef<HTMLCanvasElement>(null)
  const markRef = useRef<HTMLCanvasElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const tRef = useRef<ZoomTransform>(zoomIdentity)
  const frame = useRef(0)
  const hoverRef = useRef<string | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [theme, setTheme] = useState(0)
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null)

  // Project once per point set.
  const projected = useMemo(
    () =>
      points
        .map((p) => {
          const xy = projection([p.lon, p.lat])
          return xy ? { ...p, x: xy[0], y: xy[1] } : null
        })
        .filter((p): p is FarmPoint & { x: number; y: number } => !!p),
    [points],
  )

  // Theme-dependent colors resolved for canvas drawing.
  const colors = useMemo(() => {
    const cache = new Map<string, string>()
    const res = (v: string) => cache.get(v) ?? (cache.set(v, rgbaStr(cssColor(v))), cache.get(v)!)
    return { lut: buildLut(heatRamp), res, ink: rgbaStr(cssColor('var(--color-ink)')), surface: rgbaStr(cssColor('var(--color-surface)')) }
  }, [heatRamp.join(), theme])

  const fills = useMemo(() => Object.fromEntries(STATES_GEO.map((s) => [s.code, stateFill(s.code) ?? 'var(--color-seq-1)'])), [stateFill])
  const countyPaths = useMemo(() => (counties ?? []).map((c) => ({ fips: c.fips, d: path(c.feature) ?? '' })), [counties])
  const countyFills = useMemo(() => Object.fromEntries((counties ?? []).flatMap((c) => {
    const f = countyFill?.(c)
    return f ? [[c.fips, f]] : []
  })), [counties, countyFill])

  const draw = useCallback(() => {
    frame.current = 0
    const heat = heatRef.current
    const mark = markRef.current
    const wrap = wrapRef.current
    if (!heat || !mark || !wrap || !size.w) return
    const started = performance.now()
    const t = tRef.current
    const s = size.w / MAP_W
    const mix = farmMix(t.k)

    // Heat layer, drawn at HEAT_RES of CSS pixels. Density is accumulated and colorized
    // on an off-screen canvas: reading pixels back from an on-screen canvas forces a
    // compositor sync that costs far more than the whole draw.
    const hs = s * HEAT_RES
    const hctx = heat.getContext('2d')!
    hctx.setTransform(1, 0, 0, 1, 0, 0)
    hctx.globalCompositeOperation = 'source-over'
    hctx.clearRect(0, 0, heat.width, heat.height)
    const heatAlpha = (1 - mix) * heatOpacity
    if (heatAlpha > 0 && projected.length) {
      const dens = densityCanvas(heat.width, heat.height)
      const dctx = dens.getContext('2d', { willReadFrequently: true })!
      dctx.clearRect(0, 0, dens.width, dens.height)
      // Kernel radius grows gently with zoom so the surface stays continuous but sharpens.
      const R = Math.max(12, 22 * s * Math.sqrt(t.k)) * HEAT_RES
      const b = blob(R)
      for (const p of projected) {
        const x = (p.x * t.k + t.x) * hs
        const y = (p.y * t.k + t.y) * hs
        if (x < -R || y < -R || x > dens.width + R || y > dens.height + R) continue
        dctx.globalAlpha = clamp(p.w, 0.05, 1) * 0.42
        dctx.drawImage(b, x - R, y - R)
      }
      dctx.globalAlpha = 1
      const img = dctx.getImageData(0, 0, dens.width, dens.height)
      const d = img.data
      const lut = colors.lut
      for (let i = 3; i < d.length; i += 4) {
        const a = d[i]
        if (!a) continue
        const j = a * 4
        d[i - 3] = lut[j]
        d[i - 2] = lut[j + 1]
        d[i - 1] = lut[j + 2]
        d[i] = lut[j + 3] * heatAlpha
      }
      dctx.putImageData(img, 0, 0)
      hctx.drawImage(dens, 0, 0)
      // Keep the heat on land.
      hctx.globalCompositeOperation = 'destination-in'
      hctx.setTransform(hs * t.k, 0, 0, hs * t.k, hs * t.x, hs * t.y)
      hctx.fill(land())
      hctx.globalCompositeOperation = 'source-over'
      hctx.setTransform(1, 0, 0, 1, 0, 0)
    }

    // Marker layer (device-pixel sharp).
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const mctx = mark.getContext('2d')!
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    mctx.clearRect(0, 0, size.w, size.h)
    const drawFarm = (p: (typeof projected)[number], alpha: number, emphasis: 0 | 1 | 2) => {
      const x = (p.x * t.k + t.x) * s
      const y = (p.y * t.k + t.y) * s
      if (x < -10 || y < -10 || x > size.w + 10 || y > size.h + 10) return
      const r = 3 + p.size * 4 + (emphasis ? 1.5 : 0)
      mctx.globalAlpha = alpha
      mctx.beginPath()
      mctx.arc(x, y, r, 0, Math.PI * 2)
      mctx.fillStyle = colors.res(p.color)
      mctx.fill()
      mctx.lineWidth = emphasis === 2 ? 2.5 : 1.25
      mctx.strokeStyle = emphasis === 2 ? colors.ink : colors.res(p.ring)
      mctx.stroke()
      if (emphasis === 2) {
        mctx.beginPath()
        mctx.arc(x, y, r + 3, 0, Math.PI * 2)
        mctx.lineWidth = 2
        mctx.strokeStyle = colors.surface
        mctx.stroke()
      }
    }
    if (mix > 0) for (const p of projected) if (p.id !== selectedFarm && p.id !== hoverRef.current) drawFarm(p, mix, 0)
    const hov = hoverRef.current && projected.find((p) => p.id === hoverRef.current)
    if (hov && mix > 0) drawFarm(hov, 1, 1)
    const sel = selectedFarm && projected.find((p) => p.id === selectedFarm)
    if (sel) drawFarm(sel, 1, 2)
    mctx.globalAlpha = 1

    wrap.dataset.renderMs = (performance.now() - started).toFixed(1)
    wrap.dataset.zoom = t.k.toFixed(2)
    wrap.dataset.mode = mix >= 1 ? 'farms' : mix <= 0 ? 'heat' : 'blend'
  }, [size, projected, colors, heatOpacity, selectedFarm])

  // One draw per frame. A hidden page gets no animation frames, so fall back to a
  // timer there (background thumbnails and restored tabs still get a drawn map).
  const schedule = useCallback(() => {
    if (frame.current) return
    frame.current = document.hidden ? window.setTimeout(draw, 16) : requestAnimationFrame(() => draw())
  }, [draw])
  const drawRef = useRef(schedule)
  drawRef.current = schedule
  useEffect(() => schedule(), [schedule])

  // Size canvases to the wrapper.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      setSize((s) => (s.w === w ? s : { w, h: Math.round((w * MAP_H) / MAP_W) }))
    }
    // Measure now (observers only fire on a rendered frame), then track resizes.
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (heatRef.current) {
      heatRef.current.width = Math.max(1, Math.round(size.w * HEAT_RES))
      heatRef.current.height = Math.max(1, Math.round(size.h * HEAT_RES))
    }
    if (markRef.current) {
      markRef.current.width = Math.round(size.w * dpr)
      markRef.current.height = Math.round(size.h * dpr)
    }
  }, [size])

  // Re-resolve colors when the theme changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const bump = () => setTheme((n) => n + 1)
    mq.addEventListener('change', bump)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', bump)
      mo.disconnect()
    }
  }, [])

  // Zoom behavior (viewBox units, so the transform applies directly to the SVG group).
  const onZoomRef = useRef(onZoom)
  onZoomRef.current = onZoom
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [MAP_W, MAP_H],
      ])
      .on('zoom', (e: { transform: ZoomTransform }) => {
        tRef.current = e.transform
        gRef.current?.setAttribute('transform', e.transform.toString())
        drawRef.current()
        onZoomRef.current?.(e.transform.k)
      })
    select(svg).call(z)
    zoomRef.current = z
    return () => {
      select(svg).on('.zoom', null)
    }
  }, [])

  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animate = (ms: number) => (reduced ? 0 : ms)
  const zoomBy = (f: number) => svgRef.current && zoomRef.current && select(svgRef.current).transition().duration(animate(250)).call(zoomRef.current.scaleBy, f)
  const reset = () => svgRef.current && zoomRef.current && select(svgRef.current).transition().duration(animate(500)).call(zoomRef.current.transform, zoomIdentity)

  // Zoom to a state when asked.
  useEffect(() => {
    if (!focus || !svgRef.current || !zoomRef.current) return
    const st = focus.code ? STATES_GEO.find((s) => s.code === focus.code) : null
    if (!st) {
      if (focus.n) reset()
      return
    }
    const [[x0, y0], [x1, y1]] = st.bounds
    const k = clamp(0.82 / Math.max((x1 - x0) / MAP_W, (y1 - y0) / MAP_H), 1, MAX_ZOOM)
    const next = zoomIdentity.translate(MAP_W / 2 - (k * (x0 + x1)) / 2, MAP_H / 2 - (k * (y0 + y1)) / 2).scale(k)
    select(svgRef.current).transition().duration(animate(650)).call(zoomRef.current.transform, next)
  }, [focus?.code, focus?.n])

  // Hit-testing in CSS pixels.
  const farmAt = (clientX: number, clientY: number): string | null => {
    const wrap = wrapRef.current
    if (!wrap || farmMix(tRef.current.k) < 0.35) return null
    const rect = wrap.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const t = tRef.current
    const s = size.w / MAP_W
    let best: string | null = null
    let bestD = Infinity
    for (const p of projected) {
      const dx = (p.x * t.k + t.x) * s - mx
      const dy = (p.y * t.k + t.y) * s - my
      const d = dx * dx + dy * dy
      const r = 3 + p.size * 4 + 4
      if (d < r * r && d < bestD) {
        best = p.id
        bestD = d
      }
    }
    return best
  }

  const onMove = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const farm = farmAt(e.clientX, e.clientY)
    if (farm !== hoverRef.current) {
      hoverRef.current = farm
      schedule()
    }
    const code = (e.target as Element).getAttribute?.('data-code')
    const fips = (e.target as Element).getAttribute?.('data-county')
    const content = farm ? farmTooltip?.(farm) : fips && countyTooltip ? countyTooltip(fips) : code ? stateTooltip?.(code) : null
    setTip(content ? { x: e.clientX - rect.left, y: e.clientY - rect.top, content } : null)
    if (svgRef.current) svgRef.current.style.cursor = farm ? 'pointer' : ''
  }
  const onKey = (e: React.KeyboardEvent) => {
    const svg = svgRef.current
    const z = zoomRef.current
    if (!svg || !z) return
    const step = 60 / tRef.current.k
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (e.key === '+' || e.key === '=') zoomBy(1.6)
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.6)
    else if (e.key === '0') reset()
    else if (pan[e.key]) select(svg).call(z.translateBy, ...pan[e.key])
    else return
    e.preventDefault()
  }
  const onClick = (e: React.MouseEvent) => {
    const farm = farmAt(e.clientX, e.clientY)
    if (farm) return onFarmClick?.(farm)
    const code = (e.target as Element).getAttribute?.('data-code')
    if (code) onStateClick?.(code)
  }

  const btn = 'flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)] transition-colors hover:bg-surface-2'
  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }} onPointerLeave={() => { hoverRef.current = null; setTip(null); schedule() }}>
      <svg ref={svgRef} viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="absolute inset-0 h-full w-full touch-none rounded-[14px]" role="application" tabIndex={0} aria-label="Map of U.S. farms. Scroll or pinch to zoom and drag to pan. Keyboard: plus and minus zoom, arrow keys pan, 0 resets." onPointerMove={onMove} onClick={onClick} onKeyDown={onKey}>
        <g ref={gRef}>
          <BaseLayer fills={fills} counties={countyPaths} countyFills={countyFills} selected={selectedState} />
        </g>
      </svg>
      <canvas ref={heatRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      <canvas ref={markRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      <div className="absolute right-2 top-2 flex flex-col gap-1.5">
        <button type="button" className={btn} onClick={() => zoomBy(1.6)} aria-label="Zoom in" title="Zoom in">
          <Plus size={15} />
        </button>
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" title="Zoom out">
          <Minus size={15} />
        </button>
        <button type="button" className={btn} onClick={reset} aria-label="Show the whole country" title="Show the whole country">
          <RotateCcw size={14} />
        </button>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-[14px] bg-accent px-3.5 py-2.5 text-[13px] leading-snug text-on-accent [&_.text-ink-2]:text-on-accent/75 [&_.text-muted]:text-on-accent/60"
          style={{ left: Math.min(tip.x + 14, size.w - 230), top: Math.min(tip.y + 14, size.h - 80) }}
        >
          {tip.content}
        </div>
      )}
    </div>
  )
}
