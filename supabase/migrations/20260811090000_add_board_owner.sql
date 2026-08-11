-- ─────────────────────────────────────────────────────────────
-- Add an explicit "owner" (responsible person) to board tasks.
-- Additive + idempotent: safe to run on production, no data loss.
--
-- Deploy first (before the new admin.html goes live) so task
-- create/edit that now sends `owner` has a column to land in.
-- ─────────────────────────────────────────────────────────────

-- Board table confirmed as `public.client_board` (verified 11 Aug 2026).

alter table public.client_board
  add column if not exists owner text;

comment on column public.client_board.owner is
  'Responsible person for this task: warren | lutho | team | null';

-- Optional guard: only allow the known values (kept permissive with NULL).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_board_owner_chk'
  ) then
    alter table public.client_board
      add constraint client_board_owner_chk
      check (owner is null or owner in ('warren','lutho','team'));
  end if;
end $$;

-- Optional: seed sensible defaults for existing rows so the
-- "Tasks · who's responsible" swimlanes are populated immediately.
update public.client_board set owner = 'warren'
  where owner is null and kind in ('ask','approval');
update public.client_board set owner = 'team'
  where owner is null and kind = 'work';
