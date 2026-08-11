# Warren Will Booking CRM — Enhancement Proposal

**Prepared for:** Lutho (Expatrio) · **Date:** 11 Aug 2026
**Scope:** Turn the working admin dashboard into a fuller CRM with (1) tasks + clear ownership, (2) a client overview for promoters/venues/bookers, and (3) a timeline.

> **Status:** Round 1 (Timeline / Tasks-by-owner / Clients) shipped and live. Board table confirmed as `client_board`; `owner` column + `crm-update` change deployed to production.
> **Round 2 (this update):** mobile-first polish, colour-coded structure, and a fix to the contact-add flow — see §6.

---

## 1. What you already have (and it's good)

The current `admin.html` is a genuinely strong single-file app talking to three Supabase Edge Functions (`crm-dashboard` for reads, `crm-update` for writes, `invoice-pdf`). It already ships:

- A **Client Board** (tasks) with three kinds — *approval / ask / work* — plus priority, due dates, comment threads, archive, and a Warren-facing vs. Ops-facing split.
- A **bookings pipeline** with proper stages (new → contacted → replied → negotiating → confirmed → played → rebook → lost), a **follow-up queue**, and a **lifecycle funnel**.
- **Contacts** (WhatsApp + inner circle), **venues**, **gigs**, GoBD/§14-compliant **invoices**, a **recent-activity** feed, and business/tax settings.
- A clean, distinctive design system (Bebas/Space Grotesk/Space Mono, ivory/gold palette) and a zero-build, zero-dependency deploy on Vercel.

So this is not a rebuild. The three requested features slot into the existing data and design. Two of the three can be delivered as **pure frontend** from data `crm-dashboard` already returns; only full task ownership needs a small backend change.

---

## 2. The three enhancements

### A. Tasks — who is responsible

**Gap today:** board items have `kind`, `priority`, `due_date`, `status`, and comments, but no explicit **owner**. Responsibility is only implied (`ask` ≈ Warren, `work` ≈ team).

**What's added:**
- An **Owner** field on every task (Warren / Lutho / Team / Unassigned), shown as a coloured badge on each card.
- A new **"Tasks · who's responsible"** section that groups all open work into **swimlanes by owner**, each with its own open + overdue counts — so at a glance you see what's on *your* plate vs. Warren's vs. the team's.
- Owner selectors added to both the **new-task** form and the inline **edit** form.

**Sensible default:** where a task has no stored owner yet, the UI derives one from `kind` (`ask`/`approval` → Warren, `work` → Team) so the swimlanes are populated from day one, before anyone re-tags anything.

**Backend:** persisting an edited owner needs one column and a couple of lines in `crm-update` (see §3). Until that ships, the owner control still renders and the derived defaults still group correctly — it just won't save a manual re-assignment.

### B. Client overview — promoters, venues & bookers

**Gap today:** contact data is real but scattered across *WhatsApp contacts*, *inner circle*, and the *pipeline*. There's no single "who are our clients and where does each relationship stand" view.

**What's added:** a **Clients** directory that merges each promoter/venue/booker contact with their pipeline opportunity, showing per client:

- Name, role, preferred channel, city/venue.
- **Current deal stage** (from their latest opportunity) as a coloured stage chip.
- **Pipeline value** (sum of open fee quotes), **last touch**, and **next follow-up** — with overdue follow-ups flagged red.
- One-tap **WhatsApp / Email** actions (reusing the existing `contactActs` helper).
- **Filter chips** by role and by stage, plus a live **search** box.

This is built entirely client-side from `contacts` + `pipeline` (+ `venues`) that the dashboard already returns — no backend change.

### C. Timeline

**Gap today:** there's a *recent activity* list and *latest movement*, but no single chronological view that ties gigs, tasks, invoices and contact touches together.

**What's added:** a **Timeline** section split into **Upcoming** and **History**, merging into one time-ordered stream:

- Gigs (with venue + fee), invoices (number + status), completed/created tasks, and logged interactions.
- Upcoming markers: next gigs, due tasks, and scheduled follow-ups.
- Colour-coded dots by event type and **filter chips** (all / gigs / tasks / invoices / contacts).

Also pure frontend from existing data.

---

## 3. Backend: the one change worth making (Supabase)

To make task ownership editable and persistent, add an `owner` column and let `crm-update` write it.

**Migration (SQL):**

```sql
-- board items get an explicit owner
alter table client_board
  add column if not exists owner text;             -- 'warren' | 'lutho' | 'team' | null

comment on column client_board.owner is 'Responsible person for this task';
```

**`crm-update` Edge Function — accept `owner` on create/update:**

```ts
// inside the create/update branch, alongside title/details/priority/due_date:
const ALLOWED_OWNERS = new Set(['warren', 'lutho', 'team']);
const owner = ALLOWED_OWNERS.has(body.owner) ? body.owner : null;

// create:
await supabase.from('client_board').insert({ /* …existing… */, owner });

// update (only overwrite when provided):
const patch = { /* …existing fields… */ };
if ('owner' in body) patch.owner = ALLOWED_OWNERS.has(body.owner) ? body.owner : null;
await supabase.from('client_board').update(patch).eq('id', id);
```

`crm-dashboard` already returns full board rows, so once the column exists the owner flows to the UI automatically. No change needed there.

> Note: the frontend sends `owner` in the create/update payload today. Hand-rolled update functions that whitelist columns simply ignore the extra field until the column and the two lines above are in place — so shipping the frontend first is safe.

---

## 4. Further ideas (not built this round, worth queuing)

- **Deposit / contract status on the pipeline** — surface `deposit_received` as a stage gate so "confirmed but unpaid" is impossible to miss.
- **Reminders / SLA on follow-ups** — a daily Supabase scheduled function that bumps overdue follow-ups into the board as `ask`s.
- **Client detail drawer** — click a client to see full history (their gigs, invoices, interactions) in one panel.
- **Revenue over time** chart — monthly earned vs. secured, from gigs + invoices.
- **Audit/ownership on interactions** — who logged each touch, for a shared team.
- **Role-based access** — the app already distinguishes `team` vs `client`; a third `read-only` role would let you share the dashboard with Warren's manager without write access.

---

## 5. Delivery & deploy

The three sections and the owner controls are implemented in `admin.html`. Because a push to `main` **auto-deploys to production on Vercel**, the safe path is a **feature branch → preview deploy → review → merge**, rather than pushing straight to `main`. Exact git steps and the branch are provided alongside this doc.

---

## 6. Round 2 — mobile, colour-coding & contact-add flow

### Critical bug fixed: the "Add to CRM" CTA that died after one add
`act()` (the shared write helper) disabled the button and set its label to `…` while saving, but **never restored it on success** — only on error. For the static form buttons (Add to CRM, Add to my gigs, Add to Warren's board, Save business settings) that aren't re-rendered, this left the button permanently stuck at `…`/disabled after the first successful add, so the user had to reload / re-login to add another contact.

Fix: `act()` now caches the original label (`data-label`) and restores the button (enabled + original text) on success, guarded by `isConnected` so rebuilt board-card buttons are left alone. This unsticks **every** add CTA at once. Verified with an automated test doing three consecutive contact adds — the button stays live each time.

### Swift contact adding
After a successful add the form clears, the confirmation names the contact just added ("✓ <name> added — ready for the next one"), and the cursor jumps back to **Name** so the next contact can be typed immediately. **Enter** in any contact field now submits, for fast keyboard entry.

### Mobile-first (Warren views on his phone)
A `max-width:600px` layer: header no longer clips (REFRESH / LOG OUT fit), single-column swimlanes and stacked client rows, larger thumb-friendly tap targets (buttons/chips/inputs), tighter padding, and **zero horizontal overflow** at 390px (verified).

### Colour-coded structure
A coloured tab before every section header, and left-accent bars on Warren's cards by nature — **gold** for approvals & gigs, **green** for work-in-progress, **red** for overdue asks — plus the existing owner colours (Warren = green, Lutho = gold, Team = ink) and stage colours (won = green, lost = red, active = gold). The contact-add card is gold-bordered so it stands out.

### Still open (needs a small backend action)
Inline **editing** of existing contacts requires an `update_contact` action in `crm-update` (like the `owner` change), which needs a browser/CLI deploy. Adding is fully handled; editing is the next step.
