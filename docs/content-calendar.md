# Campaign content calendar

Team view includes **Content calendar**, also available at `admin.html#content-calendar`.
It uses existing `client_board`, `artist_content`, version snapshots and publication records.
No task board or personal workspace is replaced.

The calendar owner is Anmol, with shared access for every active team member.
Ownership identifies the coordinator and does not limit calendar access.
The runtime reads the server-owned team directory, never the protected Auth users table.

## Daily workflow

- Open My week, Today or Month. Filter by campaign, your work, approvals, readiness,
  missing assets or published content. Preferences store only the view/filter selection.
- Create a campaign. The performance template prepares announcement, reminder and recap
  drafts and related production, review and channel publishing tasks. It creates no dates.
- Open the post editor, choose production owner/publisher/brand reviewer, link a delivered
  asset version, and write master or channel-specific captions and a YouTube title.
- Complete production through its original task or the draft editor. Request brand review,
  then Warren reviews the same content version. Only the named management reviewer can
  make the brand decision; only an artist account can make the artist decision.
- Set each channel's publication time independently. A planned target is not an external
  schedule. Scheduled requires external confirmation; Published requires a platform URL
  and a real nonfuture timestamp. Only publication evidence completes the Publish task.
- Drag an existing planned slot to another date, with Undo. An undated slot requires an
  explicit time in its editor. External schedule changes require a reconciliation note.
- Use the existing production task comments for detailed/timestamped discussion; review
  feedback is saved against the specific content version.

## Social account setup

**Automatic publishing remains disabled.** The Account setup panel links to Metricool and
explains how Warren can add Instagram, TikTok and YouTube. A ChatGPT connection is distinct
from this website's backend credentials. Confirm the account IDs, professional Instagram
eligibility, API-enabled Metricool plan and an approved test post before adding automated
dispatch. This release does not purchase a plan, store social tokens, call publishing APIs
or post content. SoundCloud audio releases remain a separate workflow.
Use `booking@warrenwilliam.de` for the Warren Will Metricool account. Signup and reconnecting
the ChatGPT integration must be completed under that account before it is considered connected.

## Deployment

1. Apply `docs/content-calendar-schema.sql` as the additive `campaign_content_calendar`
   migration. Existing tasks and content remain unchanged.
2. Deploy `content-calendar` and the updated `team-board` functions with their checked-in
   `crm-identity.ts` dependency. Their own authentication verifies the bearer token,
   confirmed email, CRM enablement and active server-owned role.
3. Publish `admin.html`, `team-board.js`, `content-calendar.js` and `content-calendar.css`
   through the existing Warren Will Git/Vercel project. Do not create a replacement site.

For an installation that already applied the initial calendar migration, apply
`docs/content-calendar-access.sql` to repair calendar reads and add the shared owner setting.
Set its singleton `owner_user_id` to Anmol's verified active directory ID; no role or scope
changes are required. Fresh installs include the same table and function in the base schema.

New functions/tables are service-only with RLS enabled. Private tasks cannot become
calendar work. Generic task or legacy content actions cannot bypass calendar approval
and publication rules. Atomic RPCs reject stale task/content/publication versions.
Published content is immutable in the normal editor; duplicate it for another post.
Resolve an external schedule before editing its content, so the old version cannot be
silently replaced while it remains queued elsewhere.

## Validation

Run `node --test tests/content-calendar.test.mjs` plus the existing non-browser suite.
The calendar tests execute real PostgreSQL semantics in PGlite, including staged role
checks, stale writes, publication evidence, rollback-safe state transitions and denied
public privileges. Date tests cover Berlin summer/winter time and ambiguous/missing hours.
Database workflow tests execute as `service_role` without SELECT on `auth.users`, matching
the hosted Edge function permissions, and verify shared access across all four fixture members.
`tests/calendar-browser-fixture.html` is a clearly marked fictional UI fixture that blocks
real API calls. Live recipient email and social publishing are not simulated by these tests.
