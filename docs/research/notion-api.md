# Notion API — Reference for the Sync Engine

Compiled from official Notion docs (developers.notion.com), July 2026. Sources at bottom.
This drives `lib/notion/*`. **Read the "Decisions this forces" section** — a few findings
change the PRD's assumptions.

## ⚠️ Biggest finding: databases ≠ data sources (API v2025-09-03+)

As of Notion API version **`2025-09-03`** (latest string: **`2026-03-11`**), a *database* is a
container holding one or more *data sources*. **The property schema and the rows live on the
data source, not the database.**

- **Create a database:** schema goes in `initial_data_source: { properties: {...} }` (not top-level).
- **Read/write rows:** against the **data source**. Query is `POST /v1/data_sources/{data_source_id}/query`.
- The property-schema JSON is otherwise identical to the old format.
- **Pin `Notion-Version`** on every request. Use SDK `@notionhq/client` **v5.x** (we pin ^5.23.3).

## Cross-workspace: everything is workspace-scoped (confirms PRD §6.3)

- **Tokens** are per-workspace. One internal integration = one workspace → **we need two tokens**.
- **User IDs don't port.** A `people` value can only reference members/guests of *that* workspace;
  a foreign user id → `validation_error` 400.
- **Relations & rollups** are intra-workspace only (`relation.database_id` must be shared with the
  same connection). Can't relate across workspaces.
- **Rollups are read-only** (computed by Notion).

➡️ This is exactly why the PRD's design is right: **don't sync Person fields**. Each workspace sets
its own native `people` property locally; only the plain-text `booked_by_display_name` +
`booked_by_type` cross the boundary. We never resolve users across workspaces.

## Creating the Bookings database (per workspace)

`POST /v1/databases`, parent **must be a page** (`{type:"page_id", page_id}`) the integration can access.
Exactly one `title` property required. Property schema snippets:

```json
{
  "Guest name":   { "title": {} },
  "Guest email":  { "rich_text": {} },
  "Challenge":    { "rich_text": {} },
  "Status":       { "select": { "options": [
      {"name":"Unassigned","color":"gray"},
      {"name":"Assigned","color":"blue"},
      {"name":"Checked In","color":"green"},
      {"name":"No-show","color":"red"} ] } },
  "Booked by":    { "people": {} },                        // NATIVE, per-workspace, not synced
  "Booked by (name)": { "rich_text": {} },                 // the text mirror that DOES cross
  "Booked by type":   { "select": { "options": [
      {"name":"Employee","color":"purple"},
      {"name":"Ambassador","color":"orange"} ] } },
  "Slot":         { "rich_text": {} },                     // slot time as text (relations don't cross)
  "Location":     { "select": { "options": [ /* cities */ ] } },
  "Luma guest id":{ "rich_text": {} }
}
```
- select/status option colors: `default,gray,brown,orange,yellow,green,blue,purple,pink,red`.
- **Option names must not contain commas.**
- `title`/`rich_text`/`date`/`people` take `{}` (no config).

## Updating a page (hub → Notion), `PATCH /v1/pages/{page_id}`

```json
{ "properties": {
  "Status": { "select": { "name": "Assigned" } },
  "Booked by (name)": { "rich_text": [ { "type":"text", "text": { "content":"Jane Doe" } } ] }
} }
```
- `rich_text.text.content` max **2000 chars**.
- Needs **Update content** capability.

## Change detection (hub ← Notion): two mechanisms — DECISION NEEDED

1. **No-code "Send webhook" automation action** (what PRD §7.3 assumed): configured in the DB
   UI, POST-only, **properties-only**, paid plan, can trigger **on property change**, max 5/automation,
   signed via `X-Notion-Signature`. Simple, no API to create it.
2. **Developer "connection webhooks"** (research recommendation for sync): subscribe to events
   (`page.properties_updated`, etc.) in connection settings; HMAC-SHA256 signature keyed on a
   one-time `verification_token`; SDK `verifyWebhookSignature()` (v5.23+). Public HTTPS only.
   More robust for sync, but event carries only IDs → you fetch the changed page via REST.

➡️ **Recommendation:** start with #1 (matches PRD, least setup, fires on the exact property change
we care about — Status). Revisit #2 if we hit its properties-only / per-DB limits.

## Ops constraints

- **Rate limit ≈3 req/s per connection** + a per-workspace limit. Honor `Retry-After`; handle 429 & 529.
- Pagination: cursor-based, `page_size` default/max **100**, loop on `has_more`/`next_cursor`.
- Retrieve-a-page truncates people to 25 (not relevant to us; we read our own writes by id).
- Capabilities to request per integration: **Read content, Insert content, Update content**
  (skip user-info — we don't resolve users across workspaces).
- Share the DB with the integration: DB → **•••** → **Connections** → add. Nothing works until shared.

## Sources
create-a-database · property-schema-object · create-a-data-source · upgrade-guide-2025-09-03 ·
page-property-values · patch-page · reference/webhooks · webhooks-events-delivery ·
help/webhook-actions · help/database-automations · reference/request-limits · capabilities
(all under developers.notion.com / notion.com/help)
