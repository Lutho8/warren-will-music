# Booking media, outreach and mailbox

Gig acquisition is the shared booking workspace. It shows programme and contact evidence separately, editable public business contacts, email/phone outreach basis, per-venue drafts and actual communication history. Research edits do not create an interaction. New shared prospects have no assumed WhatsApp preference or last contact.

`booking-enrichment.sql` and `booking-media-mail.sql` are applied in production. Protected functions validate the confirmed CRM identity and server-owned booking role. Database functions use invoker privileges, explicit search paths and service-role-only execution. New tables have RLS enabled and no direct anon/authenticated grants. The `booking-media` bucket is private with no direct storage policies; all access goes through the identity-checked backend.

## Media

The media library supports adding and editing YouTube / SoundCloud URLs; uploading documents, images, audio and video up to 25 MB; editing metadata; and recoverable deletion/restoration. A file can be reusable or scoped to a shared prospect. Download links expire after 60 seconds. Larger videos should use a media link.

The composer inserts chosen media links into editable text and selects uploaded files as real email attachments (at most five / 10 MB total). Saving a draft or uploading a file never sends email or marks a lead contacted. Archived files stay recoverable.

## IONOS mailbox

The domain's MX records identify IONOS. The mailbox is fixed to `booking@warrenwilliam.de`: TLS SMTP `smtp.ionos.de:465` and IMAP `imap.ionos.de:993`. No domain MX change is needed. Set only `BOOKING_MAILBOX_PASSWORD` in Supabase Edge Function secrets using the mailbox's existing password; never put it in browser storage, task comments or code. Credentials are not returned by the API. This connection step is an afternoon CRM task and reminder.

With the credential present, use Booking inbox → Verify mailbox, then perform a real send/receive acceptance test. Until that test succeeds, production SMTP/IMAP delivery remains unverified. No booking outreach has been dispatched as part of setup.

The single-recipient send path rechecks lead version, suppression, verified email and recorded outreach basis. It locks a unique dispatch ID, compiles plain-text MIME, includes only approved stored file IDs, sends through IONOS, and attempts a Sent-folder copy. SMTP acceptance is not a guarantee of inbox delivery. An uncertain delivery is not retried automatically; inspect Sent before making a new send decision. Replies use Message-ID / In-Reply-To when available.

Refresh inbox imports only exact known shared-lead senders from the last 30 days, up to 20 new messages per refresh. It uses read-only INBOX access, preserves provider messages and read flags, stores plain text, and deduplicates by mailbox UID/UIDVALIDITY. It is manual refresh, not an unattended background listener. Incoming replies stop the pending follow-up date; the owner sets the next action. Private artist contacts and unrelated mailbox conversations are not imported.

Dependencies are pinned: nodemailer 10.6.0, imapflow 2.12.1, mailparser 3.14.5 and html-to-text 10.0.1. Real provider authentication and delivery are deferred until the credential task is completed. Automated tests cover identity, source validation, private-data isolation, imports, optimistic versions, activity idempotency, opt-outs, media provider validation, fail-closed storage/mail access and missing-credential handling. Simulated SMTP/IMAP tests use the real MIME generator and parser to exercise successful sending, attachments, duplicate retries with stale lead versions, uncertain transport results, Sent-copy failures, HTML-only multipart replies, inbox deduplication and read-only mailbox access. These are not live delivery tests.

Drafts preserve their selected attachment IDs. Saving validates that each selected file is active and reusable or belongs to that prospect. Archived files must be removed from the draft selection before saving or sending. Editing a prospect preserves its saved attachments; changing the business email or contact evidence clears the contact-review checkbox. Closing or leaving the workspace invalidates pending tool responses and clears rendered draft and conversation data.
