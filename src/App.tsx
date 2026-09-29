import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BadgeDollarSign, CloudSun, FileSignature, Flame, LayoutDashboard, Map as MapIcon, Menu, Newspaper, PiggyBank, Search, Send, Users, X } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import HeatMap from './pages/HeatMap'
import Accounts from './pages/Accounts'
import AccountDetail from './pages/AccountDetail'
import Opportunities from './pages/Opportunities'
import Signals from './pages/Signals'
import OutreachPage from './pages/Outreach'
import Pricing from './pages/Pricing'
import Contracts from './pages/Contracts'
import LucasWorkspace from './pages/LucasWorkspace'
import Weather from './pages/Weather'
import { CURRENT_USER, useCrm } from './store'
import { initials } from './lib/format'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/map', label: 'Heat Map', icon: MapIcon },
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/opportunities', label: 'Opportunities', icon: Flame },
  { to: '/signals', label: 'Signals & Newsletter', icon: Newspaper },
  { to: '/outreach', label: 'Automated Outreach', icon: Send },
  { to: '/pricing', label: 'Pricing', icon: BadgeDollarSign },
  { to: '/contracts', label: 'Contracts · Lucas', icon: FileSignature },
  { to: '/weather', label: 'Weather & Health', icon: CloudSun },
]

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
      <Search size={16} className="pointer-events-none absolute left-2.5 top-2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search accounts, contacts, counties…"
        className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-sm text-ink outline-none focus:border-accent"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {results.map((a) => (
            <li key={a.id}>
              <button
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  nav(`/accounts/${a.id}`)
                  setOpen(false)
                  setQ('')
                }}
              >
                <span className="truncate text-ink">{a.name}</span>
                <span className="shrink-0 text-xs text-muted">{a.segment} · {a.state}</span>
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

  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <PiggyBank size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-ink">Herdbook CRM</div>
            <div className="text-[11px] leading-tight text-muted">ThiboLiSoft · Hog & Cattle</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
            >
              <n.icon size={16} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-[11px] leading-snug text-muted">
          Demo data: accounts, contacts, signals and contracts are synthetic. State inventories are indicative. Outreach is simulated; no email is sent.
        </div>
      </aside>
      {menu && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMenu(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <button className="lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-ink-2 sm:inline">{CURRENT_USER}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials(CURRENT_USER)}</span>
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/map" element={<HeatMap />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/accounts/:id" element={<AccountDetail />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/signals" element={<Signals />} />
              <Route path="/outreach" element={<OutreachPage />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/contracts/:id" element={<LucasWorkspace />} />
              <Route path="/weather" element={<Weather />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
