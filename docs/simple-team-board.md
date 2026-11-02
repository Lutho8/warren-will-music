# Simple CRM team board

Implementation based on repository commit b39b5e2. GitHub write access is now available. Production deployment remains pending access to the Warren Will Supabase project and live verification.

## Team experience

Team view opens on To do / In progress / In review / Done. Create a task with a title; optionally assign a real active CRM account and deadline. My work includes assigned work and reviews awaiting the signed-in member. Open a card for details, comments, optional reviewer, priority and blocker. Status can be changed directly from the card using a keyboard-accessible select. On phones the columns stack. Booking/contact operations remain in an expandable section; social/video members see the task board without those operations.

Uses the existing client_board and board_comments records. Shared work (team/lutho or unowned work) is shown; Warren's private work, asks and approvals are excluded by the server. No Notion, duplicate task database, fabricated tasks, sprint setup, or external team accounts. Existing tasks start unassigned until assigned to a verified CRM member. Names come from the server-owned role directory, not guessed identity mappings. The existing videographer_photographer role maps to the restricted social role, so Ameer can sign in without management/financial access.

## Deploy in this order

1. On Supabase project tqwaepvdsvyyfgtlurkm, apply docs/team-board-schema.sql in the SQL editor. The additive transaction preserves existing tasks and comments. Promote this SQL into your migration history under your normal deployment procedure.
2. Deploy the updated artist-workspace function (its shared crm-identity dependency includes the video role mapping) and the new team-board function with the checked-in configuration. The team-board gateway JWT check is off because the function itself verifies the bearer token with getUser, confirmed email, crm_enabled and active server-owned roles.
3. Verify active CRM accounts/display names for the team. No accounts are invited or created by this change. No arbitrary email recipients can be entered on a task.
4. For email, use existing server-only RESEND_API_KEY and RESEND_FROM settings. Alerts are limited to a new assignee and a review recipient (explicit reviewer, otherwise creator), excluding self-notifications. Each event is committed alongside the task, atomically claimed, and sent with an idempotency key. A provider error does not roll back task completion. Failed, unavailable or uncertain deliveries are shown to the saver and recorded for operator inspection, without automatic retries or duplicate email loops. Configure email before production acceptance.
5. Publish admin.html, team-board.js and team-board.css through the existing website deployment. Do not publish through a separate Sites project or change the domain.
6. Verify on the deployed site using two real test accounts: create and assign, refresh in the other account, move to In progress, comment, request review, verify assignment/review emails, mark Done, reopen. Check a social/video account cannot access Warren's personal work, contacts or invoices. Test a stale edit from a second browser tab; it must be rejected without overwriting.

## Verification completed locally

- 35 focused tests passed: authentication, existing artist workspace privacy, team API validation, server-controlled author identity, actual PostgreSQL task writes, optimistic locking (including legacy updates), done/reopen, notification deduplication and restricted function/table privileges.
- Full suite: 49 non-browser tests passed; the existing equipment browser test could not launch because its Playwright browser executable is absent. It was not downloaded or replaced.
- Cloud-browser UI smoke test, with clearly marked fictional local fixtures and no real emails: create, assign and save task, then move it to Done; board counters and columns update correctly.
- Live persistence and actual email delivery remain unverified until authorized project access is available.

## Deliberate first-version limits

No drag-and-drop, sprints, recurring tasks, dashboards, in-app bell or configurable notification rules. Use links in task details/comments for deliverables; file uploads and mention parsing are not implemented. Board loads up to the newest 1,000 shared tasks and labels the limit when reached. Comments show the newest 100. Refresh is explicit; stale writes are rejected. Unavailable or failed email alerts require operator follow-up rather than an automated retry worker.
