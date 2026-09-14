begin;

-- Role directory for the personal CRM workspaces. Authorization remains in
-- verified app_metadata and the Edge Functions; this table is the auditable
-- source of role assignments and scopes.
create table if not exists public.crm_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null check (role in ('management','artist','social_media','videographer_photographer')),
  scopes text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Required pipeline state and the operational fields needed for responsible,
-- reviewable outreach. Existing opportunity stages remain untouched.
alter table public.opportunities add column if not exists pipeline_stage text not null default 'Not contacted';
alter table public.opportunities add column if not exists source text;
alter table public.opportunities add column if not exists contact_method text;
alter table public.opportunities add column if not exists segment text;
alter table public.opportunities add column if not exists region text;
alter table public.opportunities add column if not exists assigned_to text;
alter table public.opportunities add column if not exists next_step text;
alter table public.opportunities add column if not exists follow_up_date date;
alter table public.opportunities add column if not exists do_not_contact boolean not null default false;
alter table public.opportunities add constraint opportunities_pipeline_stage_check check (pipeline_stage in ('Not contacted','Contacted','Follow-up due','Replied','Qualified','Not interested','Do not contact'));
create index if not exists opportunities_pipeline_stage_idx on public.opportunities(pipeline_stage, region, follow_up_date);

create table if not exists public.artist_pitch_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  target_audience text not null default '',
  pitch_draft text not null default '',
  owner_user_id uuid references auth.users(id),
  approval_status text not null default 'draft' check (approval_status in ('draft','waiting','approved','changes')),
  send_status text not null default 'not_sent' check (send_status in ('not_sent','queued','sent','failed','cancelled')),
  follow_up_date date,
  response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artist_pitch_targets (
  campaign_id uuid not null references public.artist_pitch_campaigns(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  primary key (campaign_id, opportunity_id)
);

create table if not exists public.board_work_logs (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.client_board(id) on delete cascade,
  author text not null check (length(trim(author)) between 1 and 120),
  entry text not null check (length(trim(entry)) between 1 and 2000),
  evidence_url text,
  created_at timestamptz not null default now()
);

alter table public.crm_user_roles enable row level security;
alter table public.artist_pitch_campaigns enable row level security;
alter table public.artist_pitch_targets enable row level security;
alter table public.board_work_logs enable row level security;
revoke all on public.crm_user_roles, public.artist_pitch_campaigns, public.artist_pitch_targets, public.board_work_logs from anon, authenticated;
grant all on public.crm_user_roles, public.artist_pitch_campaigns, public.artist_pitch_targets, public.board_work_logs to service_role;

commit;
