# Custom Agents vs. This Build — the Feature Delta

**TL;DR:** A Notion Custom Agent (or a couple of "workers" wiring Luma to prod/dev) is
great at *reasoning over content inside Notion with a human in the loop*. It cannot be a
*booking system*. The delta below is feature-by-feature: the left column is what an agent
approach can actually deliver today; the right is what this build ships. Several of these
aren't "harder in an agent" — they're **not possible in an agent today**, including two I
tested directly.

## Feature delta

| Capability | Custom Agents / workers | This build |
|---|---|---|
| **Synced booking database across Notion prod + dev** | Not possible today. Prod and dev can't stay in sync; this is a problem the dev team is actively trying to solve and doesn't have a solution for yet. | ✅ One source of truth every workspace syncs to — a real booking DB shared across prod and dev. |
| **Actually bookable through Notion, tied to Luma** | No real-time "click Claim → reserve the slot → write it back to Luma." | ✅ An expert claims a 1:1 from a Notion card; the hub reserves it and pushes the status back to Luma. |
| **Fully automated booking emails (confirmations, calendar invites, cancellations, reminders)** | Not possible — **I tried.** An agent can't own the full email lifecycle or fire it reliably off each state change. | ✅ Dozens of templated emails fire automatically on the right event: confirmations, prep + day-before reminders, check-in, no-show, waitlist/decline, cancellations, feedback. |
| **Calendar invites that add *and auto-cancel* on the attendee's calendar** | Can't generate or send real `.ics` invites, let alone cancel them later. | ✅ Each 1:1 sends a real calendar invite; a cancellation removes it from the expert's calendar automatically. |
| **No double-booking** | Two experts claiming the same slot can both "succeed." | ✅ Atomic first-one-wins claim; the loser is told it's taken. |
| **No duplicate / no missing emails** | An agent re-run re-sends; a 45-person blast becomes 45 duplicates. | ✅ Every send is deduped so it goes exactly once, even across retries. |
| **Scheduled sends & background jobs** | No way to run "every 5 min / every day, over all events." | ✅ Timed jobs: no-show detection, T-3 & T-1 reminders, day-before, day-of agenda, recruit reminders, nightly backups. |
| **Slack bot (claim DMs, recruit posts, replace-booking nudges, buttons)** | Not available — needs a real Slack app + integration code. | ✅ Coded Slack bot: DMs the expert on claim, posts open slots to the city channel, nudges them to grab a replacement on a cancel. |
| **Real-time reaction to Luma (register / cancel)** | Nothing is listening; best case is periodic polling. | ✅ Verified webhooks react the instant a guest registers or cancels. |
| **Two-way sync that doesn't loop** | Two workers echo each other's writes forever. | ✅ Echo detection so an update never bounces back and re-fires. |
| **Admin hub** | — | ✅ Add-event, editable email templates, a sent-email log, Slack/backup settings. |

## Why the gap exists (one line)

An agent is *invoked, best-effort, inside one workspace, non-deterministic.* A booking
system has to be *always-on, transactional, exactly-once, and deterministic* — a real
service with a database, webhooks, and scheduled jobs. Those are different categories of
thing.

## Where a Custom Agent *is* the right tool

Judgment that lives inside a record — like scoring how well a guest fits Notion's goals —
is a genuine fit, and we built that piece as a Custom Agent. The booking system around it
had to be coded.
