# "Filtered" Triage Flag — Design

**Date:** 2026-08-10
**Status:** Approved (pending spec review)

## Goal

Give the organizer a way to exclude obviously-bad candidates from the Notion bookings databases that experts browse — **without** sending a Luma decline (which would email the guest) and without deleting anything. Keeps the "book off of" databases uncluttered while the guest stays silently "pending" on Luma, fully reversible.

## Decision summary (from brainstorming)

- **Separate property, not a Luma Status value.** `Luma Status` keeps meaning "what Luma thinks" (pending/approved/waitlist/declined); `Filtered` is an independent triage flag.
- **Controlled in Notion** (a checkbox on the card), **synced** to Supabase, and **propagated to both** workspace cards so ticking it once hides the person everywhere.
- **Hidden via a Notion view filter** the organizer sets up per workspace (`Filtered is not checked`).
- **Block claiming** a filtered booking as a safety net.
- **Hub untouched** — no hub control or badge (control lives in Notion).

## Data model

- **Supabase:** new column `bookings.filtered boolean not null default false` (migration `0040`). Regenerate/patch `lib/supabase/types.ts`.
- **Notion:** new **checkbox** property `Filtered` on both bookings data sources (Dev + Ambassador).
- **Sync:** `filtered` becomes a **synced field** — added to `SyncedFields`, the loop-prevention hash, and the Notion property mappers, exactly like `luma_status` today.

## Flow

1. Organizer ticks **Filtered** on a card in either workspace.
2. The existing Notion webhook synced-field path (`pagePropertiesToSyncedFields` → apply → re-push) reads the checkbox, writes `filtered=true` to Supabase, and pushes to the **other** workspace's card.
3. Both cards now show `Filtered = true`; the organizer's per-workspace view filter (`Filtered is not checked`) hides them from the experts' browse view in both workspaces.
4. Unticking reverses it (`filtered=false`) → both cards reappear.
5. The hourly reconcile (`reconcileCards`) round-trips `filtered` like other synced fields, keeping both cards consistent.

## Safety gates

- **Claiming:** `claimBooking` refuses when `filtered = true` (added alongside the existing `status = 'unassigned'` guard), so a hidden card that someone navigates to directly still can't be claimed. The claim webhook path surfaces this like the existing "already claimed" rejection (no crash; the chip reverts).
- **Comms:** add `&& !b.filtered` to `isEligibleForPrep` (`lib/events/prep.ts`) and `isApprovedUnmatched` (`lib/events/rematch.ts`). These already require `luma_status === 'approved'`; the extra guard makes filtering bulletproof even if a filtered guest is somehow also approved.

## Luma isolation

`filtered` is never written back to Luma. The Luma writeback (`updateGuestStatus`) only fires for actual `luma_status` transitions and only emails on `approved`. Setting/clearing `filtered` touches only Supabase + Notion. **No guest email is ever sent as a result of filtering.**

## Notion schema specifics

- `lib/notion/schema.ts`: add `PROP.filtered = "Filtered"`; add a `checkbox` property to `buildBookingsProperties`.
- `lib/notion/mappers.ts`: read the checkbox inbound (`pagePropertiesToSyncedFields`) and write it outbound (`syncedFieldsToUpdateProperties`) as `{ checkbox: boolean }`.
- `lib/sync/types.ts`: add `filtered: boolean` to `SyncedFields`; include it in the hash (`lib/sync/hash.ts`).
- Partial-update semantics: pushes already use `pages.update` (partial), so adding this property doesn't disturb others.

## Adding the property to existing DBs

A one-time script `scripts/add-filtered-property.ts` adds the `Filtered` checkbox to both bookings data sources via `dataSources.update` (properties live on the data source in Notion API v2025-09-03 — same pattern as the expert-feedback config script). Idempotent: `add column if not exists`-style (Notion `dataSources.update` with an existing property name is a no-op/merge).

## Rollout (organizer, manual)

1. Run the script to add the `Filtered` checkbox to both bookings DBs.
2. In **each** workspace's experts' browse view, add a filter: **`Filtered` is not checked**.
   (Nothing else — env, deploy handled normally.)

## Testing

- Unit: mapper round-trips `filtered` (checkbox ↔ boolean, incl. missing property → false); hash changes when `filtered` changes; `isEligibleForPrep` / `isApprovedUnmatched` exclude filtered rows; `claimBooking` guard rejects filtered (test the pure guard / SQL predicate at the unit level used elsewhere).
- Follow existing TDD patterns; keep the suite green.

## Non-goals / YAGNI

- No hub UI control or badge (control is Notion-only).
- No new Luma Status enum value.
- No auto-removal/archiving of Notion cards (view filter hides them; card is preserved).
- No bulk-filter action, no "reason" field, no auto-filtering rules — manual per-card only.
