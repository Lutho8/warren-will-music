# Booking acquisition auto-review — 18 November 2026

The booking preparation release is deployed. Real mailbox delivery and social-channel authorization remain afternoon acceptance tasks, explicitly deferred by the user.

## Corrections shipped

- Saved drafts retain selected private attachments across closing and reopening. Prospect edits preserve those selections. Unavailable, archived or other-lead attachments cannot be saved or sent.
- Leaving the workspace invalidates late tool responses and clears rendered drafts and conversations. Clearing the personal session also hides workspace data.
- Existing contact verification is preselected when reviewing a checked contact. Editing its business email or contact evidence clears the checkbox. The contact source field stays synchronized.
- Call and email logging offer channel-appropriate outcomes; the API and database reject mismatches.
- CSV preview preserves Graphed decision-maker, routing, research-date, personalized-message and phone-script fields.
- SMTP retry checks the existing dispatch record before rejecting an old prospect version. A completed or uncertain dispatch is never automatically sent a second time.
- HTML-only replies, including multipart messages with attachments, are converted to escaped plain text. Missing IMAP envelope metadata is skipped safely.
- Failed IMAP Sent copies are visibly distinguished from SMTP acceptance. Follow-up dates use the Berlin calendar and skip weekends.
- The reporting-month input now uses dark text on its light background.

## Automated verification

97 non-browser regression checks pass. Coverage includes authenticated actor identity, team/private workspace isolation, calendar approvals and Berlin daylight-saving handling, database role restrictions, duplicate imports, optimistic version locks, suppression, communication idempotency, confirmed-booking attribution and cancellation, attachment references, tool lifecycle cancellation and saved draft attachments.

Mailbox tests use the actual pinned MIME generation, parsing and HTML-to-text libraries with simulated SMTP/IMAP transports. They cover successful message/attachment round trips, blocked send conditions, concurrent prospect changes, uncertain transport outcomes, duplicate retries, Sent-copy failure, HTML-only replies, inbox UID deduplication and read-only mailbox access. These tests send no external messages.

## Production browser checks

| Flow | Observed result |
| --- | --- |
| Team board → calendar | Calendar opens with Anmol as owner and team sharing; no users-table permission error |
| Team board → acquisition → board | Navigation works; personal session survives reload |
| Review existing prospect | Fields load and save; typed contact-source change clears verification |
| Phone activity form | Phone outcomes are shown; no artificial communication was logged |
| Media links and uploads | YouTube link creation and private PDF upload/download/edit verified |
| Recoverable removal | Temporary file archived, restored and archived again |
| Saved attachment | Selection remained checked after save, close and reopen; removed afterward |
| CSV preview/import | Existing Bahnwärter Thiel skipped: zero created, one duplicate skipped |
| Email-ready filter | Exactly one currently invited artist-application draft shown |
| Inbox without credential | Pending setup stated; Verify, Refresh and Send remain unavailable |

Final data acceptance: 11 shared Munich prospects, 11 campaign targets, six active media links, one recoverably archived temporary file, no selected test attachments, zero live mailbox messages. Research edits and draft saves do not count as contact or booked gigs. Existing private contacts remain private.

## Afternoon acceptance still required

1. Add the IONOS mailbox credential securely to server secrets for booking@warrenwilliam.de.
2. Verify SMTP and IMAP, then send one reviewed test message to an address controlled by the team and reply to it. Confirm real delivery, Reply-To, attachments, inbox import and duplicate protection before lead outreach.
3. Reconnect the Metricool connector to the booking account, authorize the social networks and test the intended publishing route before enabling automatic publishing.

Existing project security advisories about legacy function search paths and leaked-password protection remain outside this booking release. The booking/media/mail tables intentionally deny direct browser database access; authenticated server handlers enforce access instead.

This review establishes the tested behavior above; it does not assert that all possible production bugs or live-provider delivery failures have been eliminated.
