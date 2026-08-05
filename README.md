# Notion Build Bar Hub

Cross-workspace booking sync hub for **Notion Build Bar** — turns a Luma RSVP +
slot request into a bookable record mirrored across two separate Notion workspaces
(Notion Dev + external Ambassador), with Luma check-in status flowing back.

See the PRD (`~/Downloads/notion-office-hours-prd.md`) for the full spec.

## Architecture

```
        Luma (per city)  ──webhooks──▶  Hub (this app)  ──PATCH──▶  Notion Dev DB
        RSVP + check-in                 Next.js + Supabase           Ambassador DB
                                        = single source of truth  ◀──webhooks──
```

- **Source of truth:** Supabase Postgres (project ref `jldgxdaemtdqcfrdzeby`). NOT a
  third Notion DB — see PRD §7.2.
- **Sync topology:** hub-and-spoke. Neither Notion workspace talks to the other; the
  hub is the only thing that reasons about "what changed and where does it go."
- **Cross-boundary rule:** the native Notion `Booked by` PEOPLE property stays local to
  each workspace (user ids don't port). Only the text mirror `Booked by (name)` +
  `Booked by type` cross the boundary.
- **Loop prevention:** the hub stamps `bookings.last_synced_hash` on every write; echo
  webhooks are recognized and dropped (`lib/sync/hash.ts`).
- **Arbiter:** the hub decides contended slot claims — first claim wins via a guarded
  conditional UPDATE (`lib/db/bookings.ts` → `claimBooking`).

## Layout

```
app/
  api/health/route.ts                     health check
  api/webhooks/luma/route.ts              Luma → hub (verify sig → upsert → check-in → push)
  api/webhooks/notion/[workspace]/route.ts Notion → hub (verify → echo-guard → claim → push)
  page.tsx                                placeholder (main hub UI in design)
lib/
  env.ts                                  lazy-validated env access
  supabase/{admin,types}.ts               service-role client + generated types
  db/{events,slots,bookings}.ts           data access + booking state machine (arbiter)
  sync/{types,hash,log}.ts                canonical types, loop prevention, audit log
  notion/{client,schema,mappers,push}.ts  per-workspace client, DB template, mappers, outbound push
  luma/{types,verify,parse}.ts            webhook types, HMAC verify, payload normalizer
scripts/create-notion-databases.ts        one-time: create Bookings DB per workspace (npm run setup:notion)
supabase/migrations/                      source-of-truth schema
docs/                                     DATA_MODEL.md + research/ (Luma, Notion API)
tests/                                    unit tests (hash, slot match, mappers, luma verify/parse)
```

## Development

```bash
cp .env.example .env.local     # fill in secrets (see checklist below)
npm install
npm run dev                    # http://localhost:3000
npm run typecheck
npm test
npm run gen:types              # regenerate lib/supabase/types.ts from the live DB
```

## Status (2026-07-29)

**Done:** schema applied & hardened · Next.js + Supabase scaffold · data-access layer +
arbiter · loop-prevention hashing · sync audit log · Notion DB template + mappers + outbound
push · Luma HMAC verify + payload normalizer · **both webhook handlers wired end-to-end** ·
create-Notion-databases runner · **28 passing tests** · clean build.

**Pending external input (see PRD §13):** Luma Plus + API key · two Notion integration
tokens · Ambassador workspace · Vercel deploy target.

**Pending / needs live validation:** end-to-end test against real Luma + Notion (handlers are
built but only unit-tested — the Notion inbound leg assumes the automation POSTs
`{ page_id, secret }`); lock the Luma question set then pin answer mapping to `question_id`s
(currently label-heuristic in `lib/luma/parse.ts`); the main hub admin UI (in design).

## Open decision (see docs/research/notion-api.md)
Notion change-detection: no-code "Send webhook" automation (PRD's assumption, currently
targeted) vs. developer "connection webhooks" (more robust for sync). Start with the former.
