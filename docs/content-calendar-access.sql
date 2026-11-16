-- Repair calendar reads without granting access to auth.users.
-- Ownership is an organisational label; all active team roles retain access.
begin;
create table if not exists public.content_calendar_settings (
 id boolean primary key default true check(id),
 owner_user_id uuid references public.crm_user_roles(user_id),
 updated_at timestamptz not null default now()
);
insert into public.content_calendar_settings(id) values(true) on conflict(id) do nothing;
alter table public.content_calendar_settings enable row level security;
revoke all on public.content_calendar_settings from anon,authenticated;
grant all on public.content_calendar_settings to service_role;

create or replace function public.calendar_list(actor uuid, range_start timestamptz, range_end timestamptz) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('artist','management','social_media','videographer_photographer')) then raise exception 'Active team account required.'; end if;
 if range_end<=range_start or range_end-range_start>interval '62 days' then raise exception 'Choose a calendar range of up to 62 days.'; end if;
 select jsonb_build_object(
  'actor',actor,'role',(select role from crm_user_roles where user_id=actor),
  'owner',(select jsonb_build_object('id',r.user_id,'name',r.display_name) from content_calendar_settings s join crm_user_roles r on r.user_id=s.owner_user_id where s.id and r.active),
  'campaigns',coalesce((select jsonb_agg(c order by c.updated_at desc) from content_campaigns c where c.status<>'archived'),'[]'),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',r.user_id,'name',r.display_name,'role',r.role) order by r.display_name) from crm_user_roles r where r.active and r.role in ('artist','management','social_media','videographer_photographer')),'[]'),
  'entries',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('task',to_jsonb(t)-'warren_comment'-'price','review',to_jsonb(r),'publications',coalesce((select jsonb_agg(x order by x.platform) from content_publications x where x.content_id=c.id and (x.version=c.version or (x.published_at>=range_start and x.published_at<range_end))),'[]')) order by c.updated_at desc)
   from artist_content c join client_board t on t.id=c.production_task_id join content_revisions r on r.content_id=c.id and r.version=c.version
   where c.owner='team' and c.campaign_id is not null and t.kind='work' and coalesce(t.owner,'team') in ('team','lutho') and
   ((t.archived_at is null and (exists(select 1 from content_publications x where x.content_id=c.id and x.status not in ('published','cancelled')) or c.approval in ('waiting','changes'))) or exists(select 1 from content_publications x where x.content_id=c.id and coalesce(x.published_at,x.scheduled_at)>=range_start and coalesce(x.published_at,x.scheduled_at)<range_end))),'[]'),
  'publishing',jsonb_build_object('connected',false,'provider','Metricool','message','Social accounts have not been verified for this CRM. Plan and review content now; connect accounts before enabling automatic publishing.')
 ) into result;
 return result;
end $$;

revoke all on function public.calendar_list(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.calendar_list(uuid,timestamptz,timestamptz) to service_role;
commit;
