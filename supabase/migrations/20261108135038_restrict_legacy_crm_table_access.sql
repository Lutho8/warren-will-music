-- Already applied to WarrenWill Music production on 2026-11-08.
-- Direct browser Data API access bypassed workspace isolation for these six legacy tables.
-- CRM APIs use the authenticated Edge Functions and service_role; no customer data is modified.
DROP POLICY IF EXISTS auth_full_contacts ON public.contacts;
DROP POLICY IF EXISTS auth_full_opps ON public.opportunities;
DROP POLICY IF EXISTS auth_full_interactions ON public.interactions;
DROP POLICY IF EXISTS auth_full_gigs ON public.gigs;
DROP POLICY IF EXISTS auth_full_seqs ON public.sequences;
DROP POLICY IF EXISTS auth_full_venues ON public.venues;
REVOKE ALL PRIVILEGES ON TABLE
  public.contacts, public.opportunities, public.interactions,
  public.gigs, public.sequences, public.venues
FROM anon, authenticated;
