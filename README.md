# Herdbook CRM: ThiboLiSoft for hog, cattle and field crops

Hackathon CRM for selling ThiboLiSoft software and services to hog, cattle and field-crop (grain) operations.

```bash
npm install
npm run dev        # http://localhost:5173
```

To enable **Lucas the Hog** (Claude-powered contract agent) and AI outreach rewrites, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and restart. Without a key, everything still works: Lucas falls back to the rule-based negotiation playbook.

Real email for demos (optional): set `RESEND_API_KEY` and `MAIL_TEST_TO` in `.env` (see `.env.example`) and tick **Send real email** on Automated outreach. Approved emails, and price changes with their invoice PDF, then go to that one test inbox only (`server/mail.ts`); set `MAIL_MAX_SENDS` to cap how many (counted in `.mail-log.json`). Automatic sends stay simulated. On Vercel the same rules run in `api/mail/[action].ts`: set `RESEND_API_KEY`, `MAIL_TEST_TO` and `MAIL_SEND_PASSCODE` (plus `MAIL_MAX_SENDS` to cap sends, which needs a Full access key so the function can count from Resend's history) in the project's environment variables, redeploy, and enter the passcode on the Real email card; without the passcode the public site never sends.

## What's in it

| Page | What it does |
|---|---|
| Dashboard | One screen: sales booked this month against an editable monthly target (with pace marker), then compact tiles that link to their page: pipeline, closed-won, price-normalization upside, outreach waiting, Lucas the Hog (drafts, negotiations and email changes to confirm), reconnects, deals needing attention, the next sales trip, organization changes, weather impact, grants and the newsletter; plus a pipeline-by-stage strip |
| Heat map | State choropleth for hogs, cattle or field crops: market size (head or crop acres), prospects, customers, ARR, penetration (customers vended as a share of tracked farms, by count and by size), pipeline, signals. Below it, the trip planner: enter where you're travelling and when, and the CRM proposes a day-by-day itinerary of customer meetings nearby, picked by win probability or reconnect timing, with a pre-drafted meeting request for each (drafts only) |
| Accounts / detail | Org structure (contacts, parent, integrator, packer or grain marketing), change history, subscriptions, pricing, contract, activity. Deal stage and customer status can be changed on each account as well as in the table. Every Closed Won account has a View signed contract (PDF) button |
| Pipeline Review | Six-stage drag-and-drop board, a filterable table (rep, operation, region, deal size, close date) and Reconnects: lost and on-ice deals worth reopening now, read from the rep's notes on the account (competitor renewals, seasons, budget cycles), with a pre-drafted reconnect email. Summary of totals by stage, weighted pipeline, win rate and this week's movement; stale and past-due flags; grants that would cover part of a deal. Moving a deal to Negotiation triggers Lucas the Hog drafts, same as Accounts |
| Signals and newsletter | Four tabs, Organization change, Weather impact, Regulatory change and Grant application, plus the weekly "Hog, Herd & Field Brief" grouped by region; compact, paged lists filterable by region, state and county. Weather impact: significant heat waves, drought, floods, blizzards and early frost at customer and prospect locations (Open-Meteo). Grants are tied to what the customer buys from us: a program that would cover at least half of a subscription gets a pre-drafted application, and new sign-ups get an R&D tax-credit note to take to their accountant. Nothing is ever submitted |
| Automated outreach | Playbook-driven drafts triggered by signals; approve/skip/AI-rewrite; per-playbook auto-send (simulated, no email is sent) |
| Pricing | Pricing rank: unit-economics targets per hog, per head of cattle and per acre or bushel (collapsible; segment factors calibrated from the book, mix-adjusted), an editable price list, and the customers up for renewal in the next 30, 60 or 90 days ranked by how soon notice is due, with the uplift at renewal (moves capped at about 25%). One click drafts a price-change email plus revised invoice into the approval queue. Band check: each customer vs. its normal discount band and what its contract allows (price clause, or an expiring term); Notify pushes the revised pricing email and invoice. Nothing sends without approval |
| Lucas the Hog | Contracts and redline review against the MSA playbook (accept/counter/reject + ready-to-paste language), concession plan, reply email, chat, export counter-redline, mark signed. Deal mail: connects the reps' mailboxes and turns contract email into CRM changes (see below) |

## Grants

`src/lib/grants/` is the grant directory. Pages and drafts only talk to the `GrantSource` interface (`types.ts`); today it is backed by a seeded catalog (`seeded.ts`: real program names, simplified and non-current amounts, deadlines and eligibility). To connect a live source (Grants.gov, NRCS, state agriculture departments), implement `GrantSource` and swap `grantSource` in `index.ts`. Regional rule changes map to what they ask of an operation (`regulatoryChange`), which picks the programs and the affected accounts; `src/lib/grantDrafts.ts` builds the application from CRM data. Drafting is tied to purchases: an application is pre-drafted only where one program would cover at least half of what the account is buying from us (a deal at Demo or Negotiation, or a renewal within 90 days), and large new sign-ups get an R&D tax-credit note (`irs-rd`) for their accountant. Each program is drafted once per account; nothing is ever submitted.

## Email tracking (Lucas the Hog, Deal mail tab)

Connect a rep's mailbox and Lucas reads contract negotiation email into the CRM: the proposed agreement going out, a customer's redlines (inline or in a markup), our counter, a customer agreeing to it, a verbal yes, the signed copy coming back (scanned, from a personal address, or a DocuSign completion), a customer sending their own paper, an amendment for an added site and renewal pushback. Each email is matched to its account and deal (contract reference, known contact or alternate address, thread, company domain), duplicates are dropped (Message-ID plus a content fingerprint, so a forward or a paste of the same email counts once), and the CRM changes it calls for are queued: new contacts, redlines, agreed terms, a stage move, the execution-copy email, marking the contract signed. Only safe changes apply on their own (logging the email on the account); signatures and stage moves always wait for a click, and a signature from an address we can't verify needs the rep to confirm they checked the file. Nothing is ever sent from a mailbox.

- `src/lib/mail/`: `pipeline.ts` (direction, matching, the offline rules, proposals), `text.ts` (quote splitting, inline answers, fingerprints, the payment, liability, signature and acceptance parsers), `slice.ts` (store slice: ingest, dedupe, apply), `demo.ts` (seeded mailboxes), `schema.ts` (the Claude prompt and JSON schema), `extract.ts` (builds the Claude request and verifies every quote in the answer before anything is proposed).
- `server/lucas.ts` adds `/api/lucas/mail/extract`. With a key, "Re-read with Claude" reads an email against the CRM context; without one, the playbook rules read it.
- Demo-grade: the connectors are seeded (production: Gmail API or Microsoft Graph with read-only scope and push subscriptions), attachments carry their text (production: PDF and DOCX parsing, OCR for scans), and mail lives in localStorage (production: a server-side store).

## Pipeline stages

One shared constant, `OPP_STAGES` in `src/types.ts`: **Prospect → Demo → Negotiation → Closed Won → Closed Lost → On Ice**. Prospect, Demo and Negotiation are the open pipeline (`OPEN_OPP_STAGES`); On Ice is parked, neither open nor closed. Browser data saved under the old stage names (Identified, Qualified, Proposal) is migrated on load (`src/store.ts`).

## Architecture

- `src/data/`: seeded synthetic data (`generate.ts`: hog and cattle pass, stage-spread pass and field-crops pass, each on its own random stream), state inventories and crop acres (`geo.ts`), product catalog, MSA clauses + negotiation playbook (`contracts.ts`)
- `src/lib/`: pricing engine, opportunity ranking, outreach playbooks, Lucas client, and the Open-Meteo weather integration (`weather.ts`, not shown on any page right now; kept for the newsletter)
- `server/lucas.ts`: Vite dev-server middleware for `/api/lucas/review` and `/api/lucas/mail/extract` (structured output), `/api/lucas/chat` (streaming) and `/api/ai/outreach`, using `claude-opus-5-5` with server-side refusal fallback
- `src/store.ts`: Zustand store persisted to localStorage (swap for a real backend or Salesforce sync)

All accounts, contacts, signals and contracts are synthetic. State inventories and crop acres are indicative (roughly USDA NASS scale).
