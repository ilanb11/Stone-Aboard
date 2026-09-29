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
| Opportunities | Ranked by fit × intent (org changes) × timing (competitor/contract renewals) × relationship, weighted by ARR; plus a drag-and-drop board |
| Signals and newsletter | Feed of ownership, leadership, expansion, integrator, animal and crop health, regulatory and financial changes; weekly "Hog, Herd & Field Brief" |
| Automated outreach | Playbook-driven drafts triggered by signals; approve/skip/AI-rewrite; per-playbook auto-send (simulated, no email is sent) |
| Pricing | Each customer vs. its normal discount band, checked against its contract's price clause (CPI escalator, annual cap, fixed term, lock, renewal notice window, MFN exposure) |
| Lucas the Hog | Contracts and redline review against the MSA playbook (accept/counter/reject + ready-to-paste language), concession plan, reply email, chat, export counter-redline, mark signed |

## Pipeline stages

One shared constant, `OPP_STAGES` in `src/types.ts`: **Prospect → Demo → Negotiation → Closed Won → Closed Lost → On Ice**. Prospect, Demo and Negotiation are the open pipeline (`OPEN_OPP_STAGES`); On Ice is parked, neither open nor closed. Browser data saved under the old stage names (Identified, Qualified, Proposal) is migrated on load (`src/store.ts`).

## Architecture

- `src/data/`: seeded synthetic data (`generate.ts`: hog and cattle pass, stage-spread pass and field-crops pass, each on its own random stream), state inventories and crop acres (`geo.ts`), product catalog, MSA clauses + negotiation playbook (`contracts.ts`)
- `src/lib/`: pricing engine, opportunity ranking, outreach playbooks, Lucas client, and the Open-Meteo weather integration (`weather.ts`, not shown on any page right now; kept for the newsletter)
- `server/lucas.ts`: Vite dev-server middleware for `/api/lucas/review` (structured output), `/api/lucas/chat` (streaming) and `/api/ai/outreach`, using `claude-opus-5-5` with server-side refusal fallback
- `src/store.ts`: Zustand store persisted to localStorage (swap for a real backend or Salesforce sync)

All accounts, contacts, signals and contracts are synthetic. State inventories and crop acres are indicative (roughly USDA NASS scale).
