create table public.crm_shared_access (
  id text primary key check (id = 'warren_shared'),
  salt text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  iterations integer not null default 100000 check (iterations between 100000 and 1000000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.crm_shared_access enable row level security;
revoke all on public.crm_shared_access from public, anon, authenticated;
grant select on public.crm_shared_access to service_role;
comment on table public.crm_shared_access is 'Server-only verifier for the shared artist CRM access code; no plaintext credentials.';
