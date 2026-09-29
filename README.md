# Herdbook CRM: ThiboLiSoft for hog, cattle and field crops

Hackathon CRM for selling ThiboLiSoft software and services to hog, cattle and field-crop (grain) operations.

```bash
npm install
npm run dev        # http://localhost:5173
```

To enable **Lucas the Hog** (Claude-powered contract agent) and AI outreach rewrites, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and restart. Without a key, everything still works: Lucas falls back to the rule-based negotiation playbook.

## What's in it

| Page | What it does |
|---|---|
| Dashboard | ARR, open pipeline, recent wins, price-normalization upside, top-ranked opportunities, pipeline by stage |
| Heat map | State choropleth for hogs, cattle or field crops: market size (head or crop acres), prospects, customers, ARR, penetration, pipeline, signals |
| Accounts / detail | Org structure (contacts, parent, integrator, packer or grain marketing), change history, subscriptions, pricing, contract, activity |
| Pipeline Review | Six-stage drag-and-drop board and a filterable table (rep, operation, region, deal size, close date); summary of totals by stage, weighted pipeline (win probability = the home-page score), win rate and this week's movement; stale and past-due flags. Moving a deal to Negotiation triggers Lucas the Hog drafts, same as Accounts |
| Signals and newsletter | Feed of ownership, leadership, expansion, integrator, animal and crop health, regulatory and financial changes, tagged and filterable by region, state and county. Weather impact: significant heat waves, drought, floods, blizzards and early frost at customer and prospect locations (Open-Meteo, one point per county). Regional rule changes carry matching grant programs (eligibility, deadline, amount) and pre-drafted grant applications for review, never submitted. Weekly "Hog, Herd & Field Brief" grouped by region |
| Automated outreach | Playbook-driven drafts triggered by signals; approve/skip/AI-rewrite; per-playbook auto-send (simulated, no email is sent) |
| Pricing | Each customer vs. its normal discount band, checked against its contract's price clause (CPI escalator, annual cap, fixed term, lock, renewal notice window, MFN exposure) |
| Lucas the Hog | Contracts and redline review against the MSA playbook (accept/counter/reject + ready-to-paste language), concession plan, reply email, chat, export counter-redline, mark signed |

## Grants

`src/lib/grants/` is the grant directory. Pages and drafts only talk to the `GrantSource` interface (`types.ts`); today it is backed by a seeded catalog (`seeded.ts`: real program names, simplified and non-current amounts, deadlines and eligibility). To connect a live source (Grants.gov, NRCS, state agriculture departments), implement `GrantSource` and swap `grantSource` in `index.ts`. Regional rule changes map to what they ask of an operation (`regulatoryChange`), which picks the programs and the affected accounts; `src/lib/grantDrafts.ts` builds the application from CRM data. New rule changes (last 7 days) are pre-drafted once on app start; nothing is ever submitted.

## Pipeline stages

One shared constant, `OPP_STAGES` in `src/types.ts`: **Prospect → Demo → Negotiation → Closed Won → Closed Lost → On Ice**. Prospect, Demo and Negotiation are the open pipeline (`OPEN_OPP_STAGES`); On Ice is parked, neither open nor closed. Browser data saved under the old stage names (Identified, Qualified, Proposal) is migrated on load (`src/store.ts`).

## Architecture

- `src/data/`: seeded synthetic data (`generate.ts`: hog and cattle pass, stage-spread pass and field-crops pass, each on its own random stream), state inventories and crop acres (`geo.ts`), product catalog, MSA clauses + negotiation playbook (`contracts.ts`)
- `src/lib/`: pricing engine, opportunity ranking, outreach playbooks, Lucas client, and the Open-Meteo weather integration (`weather.ts`, not shown on any page right now; kept for the newsletter)
- `server/lucas.ts`: Vite dev-server middleware for `/api/lucas/review` (structured output), `/api/lucas/chat` (streaming) and `/api/ai/outreach`, using `claude-opus-5-5` with server-side refusal fallback
- `src/store.ts`: Zustand store persisted to localStorage (swap for a real backend or Salesforce sync)

All accounts, contacts, signals and contracts are synthetic. State inventories and crop acres are indicative (roughly USDA NASS scale).
