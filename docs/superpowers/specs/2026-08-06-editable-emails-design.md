# Editable, Reviewable Email Copy — Design Spec

**Date:** 2026-08-06
**Status:** Approved → implement

## Goal

Let a non-engineer (partner) rewrite email copy in the hub, save it as a **draft**,
have the admin review the **draft→live diff** remotely, and **publish per email**
behind a passphrase. Published copy drives real sends.

## Decisions (from brainstorming)

- Access: **single shared login** for editing; **publish guarded by a passphrase**.
- Tracking: **draft vs live** only (no long history / rollback beyond discard).
- Publish: **per email**.
- Live wiring: **published copy actually sends** (fallback to built-in defaults).

## Templating model

Copy moves from hardcoded `templates.ts` logic into a **registry of flat,
editable templates** keyed by `TemplateKey`. Branch logic stays in code (it picks
the key); the words are data.

- **`lib/email/registry.ts`** — `TEMPLATE_REGISTRY: Record<TemplateKey, { label,
  description, subject, body }>`. `subject`/`body` are text with `{{placeholders}}`;
  `body` supports the existing inline markdown (`**bold**`, `*italic*`, `[t](url)`).
  These are the built-in **defaults** (seeded from current copy verbatim).
- **Keys** (~24) — one per `(kind, role)`, with variants for the branchy guest
  emails: `checked_in__guest__matched|unmatched|nohelp`, `checked_in__helper`,
  `arrived_after_no_show__guest__matched|nohelp`, `arrived_after_no_show__helper`,
  plus the single-path ones (`prep_reminder__guest`, `assigned__guest|helper`,
  `no_show__helper`, `expert_unavailable__guest|helper`, `double_booked__helper`,
  `waitlisted__guest|helper`, `declined__guest|helper`, `cancelled__guest|helper`,
  `event_cancelled__guest|helper`, `feedback_request__guest`).
- **Placeholders** — scalar: `{{firstName}}` (role-aware), `{{guestName}}`,
  `{{expertName}}`, `{{slotName}}`, `{{eventDate}}`, `{{location}}`,
  `{{feedbackLink}}`, `{{trialLink}}`, `{{calendarLink}}`, `{{supportEmail}}`.
  Composite blocks kept as single tokens the code expands: `{{guestDetails}}`
  (the internal details dump for helper emails) and `{{sessionDetails}}` (the
  guest-facing session summary). Unknown tokens are left untouched.
- **`lib/email/render.ts`** — `substitute(text, vars)`; `renderTemplate(content,
  vars)` → `{ subject, html, text }` (substitute then `wrapRich`).
- **`templateKeyFor(kind, role, f)`** encodes the branch selection.
- **`renderComms(kind, role, f, overrides?)`** — resolve key → `overrides.get(key)
  ?? registry default` → build vars → `renderTemplate`. `overrides` optional; the
  gallery/tests pass none (defaults). Returns null if no key applies.

## Storage

Migration `0023_email_overrides.sql`:
```sql
create table email_overrides (
  key text primary key,
  draft_subject text, draft_body text, draft_note text, draft_updated_at timestamptz,
  live_subject text, live_body text, live_updated_at timestamptz
);
```
`lib/db/email-overrides.ts`: `listOverrides()`, `getLiveOverrideMap()` (key →
`{subject, body}` where live present), `saveDraft(key, subject, body, note)`,
`publishDraft(key)` (copy draft→live), `discardDraft(key)`.

## Live wiring

`sendBookingComms` calls `getLiveOverrideMap()` once and passes it to
`renderComms`. Each override supplies subject/body; anything missing falls back to
the registry default. So real sends use published copy, safely.

## UI (`/emails`)

Per email: **Edit** (Subject + Body textareas, token legend, live preview via
`renderTemplate` on the client using sample data), **Save draft** (writes draft),
**Pending** badge + **draft→live diff** when a draft differs from live, **Publish**
(prompts passphrase), **Discard draft**. Uses the built-in default as the baseline
when no live override exists yet.

## API (self-verify session; under /api/hub, not middleware-gated)

- `POST /api/hub/email-draft` — save draft. Requires a valid session cookie.
- `POST /api/hub/email-publish` — draft→live. Requires session cookie **and**
  `HUB_PUBLISH_SECRET` (sent in the request); 401 otherwise.
- `POST /api/hub/email-discard` — clear draft. Requires session cookie.
All verify the session via `isValidSession(cookie, HUB_SESSION_SECRET)`.

## Safety & testing

- Live render falls back to registry defaults on any missing field; body always
  passes through `wrapRich` so structure can't break.
- Copy ported **verbatim** as defaults (no wording change on ship).
- Tests: `substitute` (tokens incl. unknown left intact), `templateKeyFor` branch
  selection, `renderComms` default vs override, composite-token expansion.
- Existing comms tests keep passing (renderComms signature stays back-compatible —
  `overrides` optional).

## Setup

Add `HUB_PUBLISH_SECRET` to Vercel (Production) + `.env.local`. Empty ⇒ publish
disabled (fail closed).
