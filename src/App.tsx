import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BadgeDollarSign, FileSignature, KanbanSquare, LayoutDashboard, Map as MapIcon, Menu, Newspaper, Search, Send, Users, X } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import HeatMap from './pages/HeatMap'
import Accounts from './pages/Accounts'
import AccountDetail from './pages/AccountDetail'
import Pipeline from './pages/Pipeline'
import Signals from './pages/Signals'
import OutreachPage from './pages/Outreach'
import Pricing from './pages/Pricing'
import Contracts from './pages/Contracts'
import LucasWorkspace from './pages/LucasWorkspace'
import GrantDraft from './pages/GrantDraft'
import { CURRENT_USER, useCrm } from './store'
import { Toaster } from './components/Toaster'
import { initials } from './lib/format'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/map', label: 'Heat map', icon: MapIcon },
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/pipeline', label: 'Pipeline Review', icon: KanbanSquare },
  { to: '/signals', label: 'Signals and newsletter', icon: Newspaper },
  { to: '/outreach', label: 'Automated outreach', icon: Send },
  { to: '/pricing', label: 'Pricing', icon: BadgeDollarSign },
  { to: '/contracts', label: 'Lucas the Hog', icon: FileSignature },
]

/** Old Opportunities links (bookmarks, ?view=board) land on Pipeline Review with their query intact. */
function LegacyPipelineRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/pipeline${search}`} replace />
}

function GlobalSearch() {
  const accounts = useCrm((s) => s.accounts)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    return accounts.filter((a) => `${a.name} ${a.county} ${a.state} ${a.contacts.map((c) => c.name).join(' ')}`.toLowerCase().includes(s)).slice(0, 8)
  }, [q, accounts])
  useEffect(() => {
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3.5 top-2.5 text-muted" />
      <input
        id="global-search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search accounts, contacts or counties"
        aria-label="Search accounts"
        className="h-9 w-full rounded-full bg-accent-soft pl-10 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-muted hover:bg-accent-soft-2 focus:bg-surface focus:ring-1 focus:ring-line-strong"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-2 w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)]">
          {results.map((a) => (
            <li key={a.id}>
              <button
                className="flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-left text-[14px] hover:bg-accent-soft"
                onClick={() => {
                  nav(`/accounts/${a.id}`)
                  setOpen(false)
                  setQ('')
                }}
              >
                <span className="truncate text-ink">{a.name}</span>
                <span className="shrink-0 text-[12px] text-muted">
                  {a.segment}, {a.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function App() {
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setMenu(false)
    document.getElementById('main')?.scrollTo(0, 0)
  }, [loc.pathname])
  // New regional rule changes get their grant applications pre-drafted once (never submitted).
  useEffect(() => {
    useCrm.getState().runGrantTrigger()
    // Sent price notices take effect on the subscription at their issue date.
    useCrm.getState().applyDuePriceChanges()
  }, [])

  return (
    <div className="flex h-full bg-page">
      <aside
        className={`rail fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-rail text-rail-ink transition-transform lg:static lg:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-6 pb-8 pt-7">
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-rail-ink">
            <span className="h-2.5 w-2.5 rounded-full bg-lime" />
          </span>
          <div className="leading-none">
            <div className="text-[20px] tracking-[-0.03em]">Herdbook</div>
            <div className="mt-1 text-[12px] text-rail-muted">ThiboLiSoft for hog, cattle and field crops</div>
          </div>
          <button className="ml-auto rounded-full p-1 text-rail-muted hover:text-rail-ink lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3 rounded-full px-4 text-[14px] transition-colors ${isActive ? 'bg-lime text-on-lime' : 'text-rail-muted hover:bg-white/10 hover:text-rail-ink'}`
              }
            >
              <n.icon size={16} strokeWidth={1.8} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-6 mb-6 mt-4 border-t border-rail-line pt-4 text-[12px] leading-relaxed text-rail-muted">
          Demo data. Accounts, contacts, signals and contracts are synthetic, and outreach is simulated.
        </div>
      </aside>
      {menu && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenu(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-page/80 px-4 backdrop-blur-md sm:px-8">
          <button className="rounded-full p-1.5 text-ink hover:bg-accent-soft lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[14px] text-ink-2 sm:inline">{CURRENT_USER}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[12px] font-medium text-on-accent">{initials(CURRENT_USER)}</span>
          </div>
        </header>
        <Toaster />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-8 sm:px-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/map" element={<HeatMap />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/accounts/:id" element={<AccountDetail />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/opportunities" element={<LegacyPipelineRedirect />} />
              <Route path="/signals" element={<Signals />} />
              <Route path="/outreach" element={<OutreachPage />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/contracts/:id" element={<LucasWorkspace />} />
              <Route path="/grants/:id" element={<GrantDraft />} />
              {/* Old links (for example the removed /weather tab) land on the dashboard. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
