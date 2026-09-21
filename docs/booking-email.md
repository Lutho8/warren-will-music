# Website booking notifications

Deployed on 21 September 2026: `booking-inquiry` is active in the production
Supabase project. Automatic notifications remain disabled until `RESEND_API_KEY`
and `RESEND_FROM` are configured; the health endpoint reports this state without
exposing either secret.

The public `booking-inquiry` Edge Function saves enquiries in the CRM and then
sends a plain-text notification to **booking@warrenwilliam.de**. The recipient is
fixed on the server; the visitor's address is used only as Reply-To.

Set these Edge Function secrets in the existing Supabase project:

- `RESEND_API_KEY`: the existing email provider's API key with sending permission.
- `RESEND_FROM`: a sender on a domain verified in that Resend account.

These are the same secrets used by `crm-update` for invoice emails. Keep secrets
out of the repository and website. Receiving the notification in IONOS does not
require an IONOS password in the website.

Deploy `supabase/functions/booking-inquiry/index.ts` with `notification.ts`.
The endpoint already allowed public submissions; keep `verify_jwt = false`.

The response distinguishes CRM storage from email-provider acceptance. The form
shows success only when `notification.status` is `accepted`. If delivery is
unconfigured or fails, it keeps the visitor's details and provides an explicit
email draft link. The visitor must send that draft. Provider acceptance alone
does not prove inbox placement; confirm receipt in IONOS, including spam, after
configuration or sender changes.

Run `node --test tests/booking-notification.test.mjs` for isolated delivery tests.
