# Token Usage Breakdown (~$1.5K build)

**Honest caveat first:** this wasn't metered per-feature as we went, so these are **estimates**,
not audited line items. They're based on the actual work delivered and the process every feature
ran through — design → plan → write → **review → test** — and on where tokens actually go in an
agentic build (reading the codebase for context, generating code, reviewing it, and writing
tests). Percentages are proportional to relative size/complexity; dollar figures assume a ~$1.5K
total.

## Where tokens go (the mechanics)

Tokens are simply everything the AI **reads + writes**. In a build like this, three things drive
the total:

1. **Reading the codebase for context.** Before writing any feature, the AI re-reads the relevant
   existing files (the sync engine, the email templates, the DB helpers) so the new code fits. As
   the codebase grows, each step reads more.
2. **Writing the code** — the actual production code, plus the specs and plans that precede it.
3. **Reviewing and testing** — every feature got an independent code review (often two passes) and
   a test suite (300+ tests total). That's a large, deliberate share of the spend, and it's the
   reason the bugs that came up were caught before shipping.

## By activity (cross-cutting)

| Activity | Est. share | Est. $ |
|---|---|---|
| Writing production code | ~35% | ~$525 |
| Reading / exploring the codebase for context | ~20% | ~$300 |
| Code review (independent two-stage review per feature) | ~15% | ~$225 |
| Writing & running tests (300+ tests) | ~12% | ~$180 |
| Specs & implementation plans (design before each feature) | ~8% | ~$120 |
| Debugging & investigation | ~5% | ~$75 |
| Iteration / rework (fixing review findings, re-runs) | ~5% | ~$75 |

**Takeaway:** roughly **half** the spend (~55%) is code + context-reading; the other ~45% is the
quality layer — design docs, review, tests, and fixing what they caught. That ratio is *why* the
output is production software, not a throwaway script.

## By system / feature area

| Area | What it covers | Est. share | Est. $ |
|---|---|---|---|
| Core hub, database & sync engine | The shared booking DB, prod↔dev sync, loop prevention, the two status models | ~15% | ~$225 |
| Notion two-way integration | Mirroring to both workspaces, claim / unclaim / reassign arbitration, mappers | ~15% | ~$225 |
| Email & calendar system | Dozens of templates, the send engine, real `.ics` invites + cancels, exactly-once ledger | ~15% | ~$225 |
| Luma integration | Verified webhooks, parsing registrations, guest ingest, status write-back | ~10% | ~$150 |
| Admin hub / website | Settings, email editor, add-event, sent-email log, dashboard | ~10% | ~$150 |
| Slack bot | Claim DMs, per-city recruit posts, interactive buttons, channel resolution | ~8% | ~$120 |
| Scheduled jobs (crons) | No-show, reminders, prep, day-before, day-of agenda, recruit reminders, backups, reconcile | ~7% | ~$105 |
| This phase's incremental features | Day-before auto-decline, cowork notice, guest-cancel emails, replace-booking DM, channel-id auto-resolve, add-event Slack field, non-Free day-before, sent-email log | ~12% | ~$180 |
| Debugging & docs | The "auto-cancel" investigation, delivery checks, this PRD + design docs | ~8% | ~$120 |

## Why this is a good deal

- **It's one-time.** This ~$1.5K bought the whole system; it isn't paid again per event or per
  booking.
- **It replaced a ~$5K contractor quote** — and we own it, so changes are same-day, not a new
  contract.
- **It avoids per-run agent fees.** An agent operating this across dozens of events × hundreds of
  RSVPs would bill on every action, recurring forever; deterministic code runs for ~nothing.
- **A big slice went to quality, not just code.** ~45% of the spend was specs, review, and tests —
  which is what makes it safe to keep building on.
