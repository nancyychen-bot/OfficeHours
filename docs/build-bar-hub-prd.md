# Notion Build Bar Hub — Product Overview (PRD)

## What it is

An automated **booking-and-operations system** for Notion Build Bar events. Think of it like
a **Genius Bar**: it matches customers with experts — Notion employees ("Notinos") and
community ambassadors — through a booking system that lives inside Notion. Guests register on
Luma; experts claim 1:1s from Notion cards; the system handles everything in between — syncing
records, sending every email, managing calendars, and posting to Slack — with no manual work
per booking.

## The problem

We plan to run **dozens of these events touching tens of thousands of people.** At that scale
there are only bad options without a system: we **can't run it manually**, and we **can't run
it with Notion Custom Agents — we tried, and it did not work.** It needed to be a real,
automated system.

A hard requirement shaped the design: **the customer experience had to stay inside Luma.** We
deliberately did **not** want to build or send people to an external website. Registering for a
Build Bar should feel as simple as **RSVPing and answering a few short questions** — nothing
more. So Luma is the interface customers use; all the machinery is invisible behind it.

Running Build Bar meant stitching together three tools that don't talk to each other:

- **Luma** is the **customer-facing interface** (RSVP + a few questions) and owns registration,
  capacity, and approvals.
- **Notion** is where the team actually works — and the booking has to live in **two
  separate workspaces at once**:
  - **Notion Prod** — where **external community ambassadors** book and manage their 1:1s.
  - **Notion Dev** — where **internal Notion employees ("Notinos")** book and manage theirs.
  These are different audiences with different access, so the same booking must exist and stay
  correct in **both** — and out of the box, prod and dev **can't sync with each other at all.**
- Guests and experts need **timely, correct emails** (confirmations, calendar invites,
  reminders, cancellations) and coordination in **Slack**.

Doing this by hand doesn't scale: someone would have to watch Luma, copy registrations
into Notion, keep two Notion workspaces matching, email each guest and expert, create and
cancel calendar invites, and chase experts in Slack — for every single booking, across
multiple cities and events at once. It's error-prone (double-bookings, missed or duplicate
emails) and a constant time sink.

## How we solved it

A single **hub** in the middle — a real database that becomes the source of truth — with
every other system syncing to it as a spoke:

```
        Luma  ──►  ┌──────────┐  ──►  Notion prod
   (register/       │   HUB    │  ──►  Notion dev
    cancel/         │ (database│  ──►  Email (confirmations, invites, reminders)
    approve)  ◄──   │  + logic)│  ──►  Slack (DMs, recruit posts)
                    └──────────┘
```

When anything happens on one side, the hub updates its record and pushes the change out to
the others — in real time, exactly once, and consistently.

## What it does (features)

- **Synced booking database across Notion prod + dev** — one shared source of truth so both
  workspaces always match.
- **Bookable through Notion, tied to Luma** — an expert claims a 1:1 from a Notion card and
  it reserves the slot back in Luma.
- **Fully automated emails** — confirmations, calendar invites, prep + day-before reminders,
  check-in, no-show, waitlist/decline, cancellations, and feedback requests, each sent
  automatically at the right moment.
- **Real calendar invites that auto-cancel** — every 1:1 sends a calendar invite; a
  cancellation removes it from the expert's calendar.
- **No double-booking** — only one expert can claim a slot; the next is told it's taken.
- **No duplicate emails** — every email goes out exactly once, even if something retries.
- **Scheduled automation** — reminders, no-show detection, day-of agendas, replacement
  recruiting, and nightly backups all run on a timer.
- **Works in any timezone** — events in the US, Europe, and Asia each send their reminders at
  the right **local** time (e.g. the morning before), not a single global clock. The system
  refuses to create an event whose timezone is unknown, so nothing gets scheduled wrong.
- **Slack bot** — DMs experts when they claim, posts open slots to each city's channel, and
  nudges experts to grab a replacement when a guest cancels.
- **Admin hub** — add an event by pasting a Luma link, edit any email template, and browse a
  log of every email ever sent.

## The guest journey, end to end

Here's the full experience of one guest — what they see, and what happens behind the scenes.

**1. They find the event.** A guest discovers a Notion Build Bar on **Luma** — our only
customer-facing surface. No external website, no account to make.

**2. They RSVP.** They register on Luma and answer a few short questions: their company and
role, the email they use for Notion, their Notion plan, experience level, why they're coming
(1:1 help / coworking / just checking it out), what they'd like help building, and a preferred
time slot.

> *Behind the scenes:* the moment they submit, the hub creates a booking and mirrors it into
> **both** Notion workspaces — **Prod** (where ambassadors work) and **Dev** (where Notinos
> work) — so the team sees it instantly wherever they operate.

**3. Their application is analyzed.** A **Notion Custom Agent** reads the new application,
judges how well the guest fits Notion's goals, and **cross-references Notion's sales pipeline**
to flag any sales opportunity (e.g. a founder whose company maps to an existing lead). It writes
a short analysis and a priority onto the guest's card.

**4. The team approves them.** A reviewer approves the guest in Notion; that approval is written
back to **Luma** automatically. (If they only wanted to cowork, or aren't a fit, they get the
right note instead — e.g. a "you're welcome to cowork, no 1:1" email.)

**5. A Notino or ambassador picks them up.** An expert opens the guest's card and clicks
**Claim** to take their 1:1.

> *Behind the scenes:* the hub reserves the slot (only one expert can win it), marks the guest
> **Assigned**, mirrors that to both workspaces, and writes it back to Luma.

**6. Everyone gets confirmed — with calendars.** The guest gets a **confirmation email with a
real calendar invite**. The expert gets their own confirmation email, a calendar invite, **and
a Slack DM** — their invite includes who they're meeting and the guest's challenge, so they can
prep.

**7. In the days before.** Approved guests get a **prep email** a few days out (Free-plan guests
are nudged to turn on Notion AI). The **day before**, everyone gets a short **"what to bring"
checklist**. If a guest asked for a 1:1 but somehow still has no expert the day before, they get
a heads-up; and anyone still un-triaged gets cleaned up automatically so no one is left in limbo.

> *If a guest cancels* (marks "Not Going" on Luma): the hub frees the slot, **removes the meeting
> from the expert's calendar**, emails the expert, and DMs them in Slack to grab a replacement —
> and posts the open slot to that city's Slack channel.

**8. Day of.** Each expert gets a **day-of agenda** of who they're meeting. When a guest checks
in, the hub records it and sends a check-in confirmation; if someone never shows, that's detected
too.

**9. After the event.** The guest receives a **feedback request**, and experts' feedback is
captured back into Notion — closing the loop and feeding what we improve next time.

From the guest's side it feels like: *RSVP → get confirmed → get reminded → show up → get asked
how it went.* Everything between those steps — the matching, syncing, emails, calendars, and
Slack — happens automatically.

## Why this had to be coded (not Notion Custom Agents)

**We tried to build this inside Notion agents first — it did not work.** Notion Custom Agents
are excellent at **reasoning over content inside Notion with a human in the loop** — which is
why we *did* use one for the piece that fits: scoring how well a guest matches Notion's goals.
But an agent **can't be a booking system**. Feature by feature:

| Capability | Custom Agents | This build |
|---|---|---|
| Synced booking DB across prod + dev | Not possible today — the dev team is still trying to solve this and has no solution yet | ✅ |
| Automated booking emails (confirmations, invites, cancellations) | Not possible — we tested it directly | ✅ |
| Calendar invites that add *and* auto-cancel | Can't send or cancel real invites | ✅ |
| No double-booking | Two people can grab the same slot | ✅ |
| No duplicate emails | Re-runs re-send — one blast becomes dozens | ✅ Sent exactly once |
| Scheduled reminders / background jobs | Can't run timed tasks across all events | ✅ |
| Slack bot (DMs, recruit posts, buttons) | Not available | ✅ |
| Real-time reaction to Luma register/cancel | Nothing is listening | ✅ |

**The core reason:** an agent runs only when it's invoked, inside one workspace, best-effort.
A booking system has to be **always-on, transactional, and exactly-once** — a real service
with a database, live webhooks, and scheduled jobs. Different category of tool.

## Where we *did* use a Notion Custom Agent

One part of this is genuinely agent-shaped, and we built it as a Notion Custom Agent:
**analyzing each guest application.** For every registrant, the agent reads their company,
role, and answers and judges how well they fit Notion's goals — and **cross-references Notion's
sales pipeline to flag a potential sales opportunity** (for example, a founder whose company
maps to an existing account or lead). It writes a short analysis and a priority onto the
guest's Notion card, so the team can spot high-value attendees at a glance while approving.

This is exactly what Custom Agents are great at — **reasoning over a record with a human in the
loop** — and it runs sparingly (once per application, when someone is reviewing), so its cost
stays small. The booking system *around* it had to be coded.

## What it costs — and what it saves

- **~$1.5K one-time to build it (in tokens).** This was built conversationally end-to-end —
  designing, writing, testing, and deploying a full multi-system application (database, live
  webhooks, dozens of email templates, a Slack bot, scheduled jobs, and an admin site). That
  breadth of real, tested software is what the tokens paid for. It's a **one-time build cost**,
  not a subscription.

  *Why ~$1.5K:* tokens are what the AI reads and writes, and this wasn't one prompt — it was
  hundreds of exchanges. Every feature went through a full cycle: design it, plan it, write the
  code, **review the code, and test it** — and to do each step the AI has to re-read the relevant
  parts of a large, growing codebase for context every time. Multiply that by dozens of features
  and fixes, plus the normal back-and-forth of iterating until each one was correct, and the
  reading + writing adds up. In other words, the cost reflects that we built and verified real,
  production software — not a quick script — and it's spent once, not per event or per booking.
- **Avoided ~$5K in contractor fees.** A quote to set this up externally was ~$5K — before
  any ongoing changes. We built and now own it in-house, and every tweak since (new emails,
  new rules) has been a same-day change, not a new contractor cycle.
- **No ongoing per-use AI cost.** A Custom Agent charges every time it runs. This system runs
  on plain, deterministic code — claiming a slot or sending a reminder costs effectively
  nothing per action, no matter how many bookings. The AI was used to *build* it, not to *run*
  it. (The one genuinely AI task — guest fit-scoring — stays a Custom Agent, used sparingly.)
- **An agent-run version would be astronomically expensive at our scale.** If Custom Agents
  had to *operate* the system — reacting to every RSVP, sync, email, and reminder — you'd pay
  for an agent invocation on each one. Across **dozens of events with hundreds of RSVPs each**,
  that's tens of thousands of billed agent runs, recurring for every event forever. Deterministic
  code does the same work for effectively nothing per action.

Net: a one-time ~$1.5K build replaced a ~$5K contractor setup **and** avoids the recurring
per-run agent fees that would balloon as events and RSVPs grow.

## How it scales

- **Cost is flat per booking.** Because the day-to-day runs on deterministic code, not AI
  calls, 10 bookings or 10,000 cost the same per action. There's no usage meter that grows
  with volume.
- **Multi-event, multi-city, multi-region by design.** The hub already handles many events at
  once, routes each to the right city's Slack channel, keeps both Notion workspaces in sync, and
  now schedules every event in its **own timezone** — so expanding from US to Europe and Asia is
  just adding events, not re-architecting. Adding an event is pasting a Luma link.
- **New behavior is a config or a small change, not a rebuild.** Email copy is editable in the
  admin hub with no code; new email types or rules are small additions (several shipped in a
  single day).
- **Reliability holds under load.** Exactly-once emails, atomic claims, retries, nightly
  backups, and an audit log mean more volume doesn't mean more mistakes.

## Learnings

- **Match the tool to the shape of the problem.** Custom Agents shine at in-Notion reasoning;
  a real-time, cross-system booking flow needs a coded service. We used each where it fits.
- **The integration *is* the product.** The hard, valuable part isn't any one screen — it's
  keeping Luma, two Notion workspaces, email, and Slack correct and in sync, automatically.
- **Correctness guarantees matter most.** No double-bookings and no duplicate/missing emails
  are what make it trustworthy — and they're exactly what an agent approach can't promise.
- **Owning it in-house is faster and cheaper.** Building it ourselves turned "hire a contractor
  and wait" into same-day iteration, at a fraction of the cost.

### What was harder than expected

- **Building it this way isn't hands-off.** It still took careful specs, review, and testing at
  each step — not "type a prompt and ship." Small bugs surfaced along the way and had to be
  caught and fixed; the process handled them, but it takes discipline, and code shouldn't go out
  unreviewed.
- **Some setup is manual, and depends on others.** Per-city Slack channels, database updates,
  and Slack permission grants are done by hand. Example: enabling the "grab a replacement" Slack
  link needed a new permission on the Slack app, a reinstall, and — because Notion's workspace
  has ~10,000 channels — a fix to how we look channels up. It works now, but real-world platform
  integrations (Slack scopes, Enterprise Grid limits, Notion's own quirks) reliably take more
  poking than expected.
- **Going global surfaced hidden assumptions.** The scheduling logic quietly assumed US time.
  Expanding to Europe and Asia forced us to make every reminder fire in the event's own local
  time — a good reminder that "it works" for today's data can still hide a scaling cliff.
- **Cost tracked rework.** A meaningful share of the ~$1.5K went to iteration and course-
  correction. Tighter specs up front would bring that down next time.
- **It needs documentation to be maintainable.** The system spans several services, so it can't
  live in one person's head — docs like this one are part of making it sustainable.
