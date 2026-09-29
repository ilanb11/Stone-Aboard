# Herdbook CRM: ThiboLiSoft Hog & Cattle

Hackathon CRM for selling ThiboLiSoft software and services to hog and cattle operations.

```bash
npm install
npm run dev        # http://localhost:5173
```

To enable **Lucas the Hog** (Claude-powered contract agent) and AI outreach rewrites, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and restart. Without a key, everything still works: Lucas falls back to the rule-based negotiation playbook.

## What's in it

| Page | What it does |
|---|---|
| Dashboard | ARR, pipeline, price-normalization upside, customers needing support, top-ranked opportunities |
| Heat Map | State choropleth: hog/cattle inventory, white space, customers, ARR, penetration, pipeline, signals, weather risk |
| Accounts / detail | Org structure (contacts, parent, integrator/packer), change history, subscriptions, pricing, contract, weather, activity |
| Opportunities | Ranked by fit × intent (org changes) × timing (competitor/contract renewals) × relationship, weighted by ARR; plus a drag-and-drop board |
| Signals & Newsletter | Feed of ownership, leadership, expansion, integrator, biosecurity, regulatory and financial changes; weekly "Hog & Herd Brief" |
| Automated Outreach | Playbook-driven drafts triggered by signals and weather; approve/skip/AI-rewrite; per-playbook auto-send (simulated, no email is sent) |
| Pricing | Each customer vs. its normal discount band, checked against its contract's price clause (CPI escalator, annual cap, fixed term, lock, renewal notice window, MFN exposure) |
| Contracts · Lucas | Redline review against the MSA playbook (accept/counter/reject + ready-to-paste language), concession plan, reply email, chat, export counter-redline, mark signed |
| Weather & Health | Live 7-day Open-Meteo forecast per state → THI heat stress, cold/blizzard, heavy rain (lagoons), dry pasture; combined with usage/tickets/payments/NPS |

## Architecture

- `src/data/`: seeded synthetic data (`generate.ts`), state inventories (`geo.ts`), product catalog, MSA clauses + negotiation playbook (`contracts.ts`)
- `src/lib/`: pricing engine, opportunity ranking and health scoring, weather risk, outreach playbooks, Lucas client
- `server/lucas.ts`: Vite dev-server middleware for `/api/lucas/review` (structured output), `/api/lucas/chat` (streaming) and `/api/ai/outreach`, using `claude-opus-5-5` with server-side refusal fallback
- `src/store.ts`: Zustand store persisted to localStorage (swap for a real backend or Salesforce sync)

All accounts, contacts, signals and contracts are synthetic. State inventories are indicative (roughly USDA NASS scale). Weather is live when Open-Meteo is reachable and falls back to a modeled forecast when it isn't.
