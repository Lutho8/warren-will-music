-- Additive campaign calendar. All access goes through the verified Edge service.
begin;
create table public.content_calendar_settings (
 id boolean primary key default true check(id),
 owner_user_id uuid references public.crm_user_roles(user_id),
 updated_at timestamptz not null default now()
);
insert into public.content_calendar_settings(id) values(true);
alter table public.content_calendar_settings enable row level security;
revoke all on public.content_calendar_settings from anon,authenticated;
grant all on public.content_calendar_settings to service_role;
create table public.content_campaigns (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 200),
 brief text not null default '', goal text not null default '', event_date date, planning_month date,
 status text not null default 'draft' check(status in ('draft','active','completed','archived')),
 owner_user_id uuid references auth.users(id), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.content_campaigns enable row level security;
revoke all on public.content_campaigns from anon,authenticated;
grant all on public.content_campaigns to service_role;
alter table public.artist_content
 add column campaign_id uuid references public.content_campaigns(id),
 add column production_task_id uuid references public.client_board(id),
 add column format text not null default 'video',
 add column target_platforms text[] not null default '{}',
 add column channel_overrides jsonb not null default '{}',
 add column asset_version_ref text;
alter table public.content_revisions
 add column format text, add column target_platforms text[], add column channel_overrides jsonb,
 add column asset_version_ref text, add column brand_reviewer_id uuid references auth.users(id),
 add column brand_approval text not null default 'draft' check(brand_approval in ('draft','waiting','approved','changes')),
 add column brand_reviewed_by uuid references auth.users(id), add column brand_reviewed_at timestamptz,
 add column brand_review_note text, add column artist_reviewed_at timestamptz;
alter table public.content_publications drop constraint content_publications_status_check;
alter table public.content_publications
 add constraint content_publications_status_check check(status in ('draft','planned','scheduled','published','failed','cancelled')),
 add column publisher_id uuid references auth.users(id), add column lock_version integer not null default 1,
 add column timezone text not null default 'Europe/Berlin', add column scheduler_ref text,
 add column schedule_confirmed_by uuid references auth.users(id), add column schedule_confirmed_at timestamptz;
alter table public.client_board
 add column campaign_id uuid references public.content_campaigns(id),
 add column content_id uuid references public.artist_content(id),
 add column publication_id uuid references public.content_publications(id),
 add column task_type text not null default 'general' check(task_type in ('general','brief','production','brand_review','artist_review','publish'));
create unique index calendar_one_publish_task on public.client_board(publication_id) where task_type='publish' and archived_at is null;
create unique index calendar_one_review_task on public.client_board(content_id,task_type) where task_type in ('brand_review','artist_review') and archived_at is null;
create index calendar_tasks_campaign on public.client_board(campaign_id) where archived_at is null;
create index calendar_publication_time on public.content_publications(scheduled_at);
create index calendar_content_campaign on public.artist_content(campaign_id);

create function public.calendar_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_table_name='artist_content' then
  if (old.campaign_id is not null or new.campaign_id is not null) and current_setting('ww.calendar_write',true) is distinct from 'on' then raise exception 'Edit campaign content in Content calendar.'; end if;
 elsif tg_table_name='content_publications' then
  if exists(select 1 from artist_content c where c.id=new.content_id and c.campaign_id is not null) and current_setting('ww.calendar_write',true) is distinct from 'on' then raise exception 'Update this publication in Content calendar.'; end if;
 elsif tg_table_name='client_board' then
  if new.content_id is not null then
   if new.kind<>'work' or coalesce(new.owner,'team') not in ('team','lutho') then raise exception 'Campaign work must stay in Team view.'; end if;
   if current_setting('ww.calendar_write',true) is distinct from 'on' then
    if old.content_id is distinct from new.content_id or old.publication_id is distinct from new.publication_id or old.task_type is distinct from new.task_type or old.campaign_id is distinct from new.campaign_id then raise exception 'Change campaign links in Content calendar.'; end if;
    if new.task_type in ('brand_review','artist_review','publish') and new.status is distinct from old.status then raise exception 'Use the review or publication action in Content calendar.'; end if;
    if new.task_type in ('brand_review','artist_review','publish') and (new.assignee_id is distinct from old.assignee_id or new.reviewer_id is distinct from old.reviewer_id) then raise exception 'Change review and publishing assignments in Content calendar.'; end if;
    if new.archived_at is not null and old.archived_at is null and exists(select 1 from content_publications x where x.content_id=new.content_id and x.status not in ('published','cancelled')) then raise exception 'Resolve pending publications before archiving campaign work.'; end if;
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger calendar_content_guard before update on public.artist_content for each row execute function public.calendar_guard();
create trigger calendar_publication_guard before insert or update on public.content_publications for each row execute function public.calendar_guard();
create trigger calendar_task_guard before update on public.client_board for each row execute function public.calendar_guard();

create function public.calendar_save(p jsonb, actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 a crm_user_roles; c artist_content; t client_board; rev content_revisions; camp content_campaigns; pub content_publications;
 rid uuid; tid uuid; reviewer uuid; publisher uuid; artist uuid; platforms text[]; platform_name text; st text;
 result jsonb; next_version integer; n integer; target timestamptz; actual timestamptz; post text; pattern text;
begin
 select * into a from crm_user_roles where user_id=actor and active;
 if a.user_id is null or a.role not in ('artist','management','social_media','videographer_photographer') then raise exception 'Active team account required.'; end if;
 perform set_config('ww.calendar_write','on',true);
 if p->>'action' in ('campaign_save','campaign_template') then
  rid:=(p->>'id')::uuid;
  if length(trim(coalesce(p->>'name','')))=0 or length(p->>'name')>200 then raise exception 'Enter a campaign name.'; end if;
  select * into camp from content_campaigns where id=rid for update;
  if found then
   if camp.version is distinct from (p->>'version')::int then raise exception 'Campaign changed. Refresh before saving.'; end if;
   update content_campaigns set name=p->>'name',brief=left(coalesce(p->>'brief',''),3000),goal=left(coalesce(p->>'goal',''),500),event_date=nullif(p->>'event_date','')::date,planning_month=nullif(p->>'planning_month','')::date,status=coalesce(p->>'status','draft'),version=version+1,updated_at=now() where id=rid returning * into camp;
  else
   if coalesce((p->>'version')::int,-1)<>0 then raise exception 'Campaign no longer exists.'; end if;
   insert into content_campaigns(id,name,brief,goal,event_date,planning_month,owner_user_id) values(rid,p->>'name',left(coalesce(p->>'brief',''),3000),left(coalesce(p->>'goal',''),500),nullif(p->>'event_date','')::date,nullif(p->>'planning_month','')::date,actor) returning * into camp;
   if p->>'action'='campaign_template' then
    insert into client_board(kind,owner,title,details,status,priority,assignee_id,creator_id,created_by,campaign_id,task_type)
    values('work','team',camp.name||' · Campaign brief','Confirm the performance details, objective and asset plan. Dates stay open until confirmed.','open','normal',actor,actor,'team',rid,'brief');
    for n in 1..3 loop
     result:=calendar_save(jsonb_build_object('action','content_save','id',gen_random_uuid(),'version',0,'task_version',0,'campaign_id',rid,'title',case n when 1 then 'Announcement reel' when 2 then 'Story reminder' else 'Performance recap' end,'format',case n when 2 then 'story' else 'reel' end,'target_platforms',case n when 2 then jsonb_build_array('Instagram') else jsonb_build_array('Instagram','TikTok','YouTube') end,'assignee_id',actor,'publisher_id',actor,'production_status','open'),actor);
    end loop;
   end if;
  end if;
  insert into crm_audit(actor,action,entity_id,details) values(actor::text,'calendar_campaign',rid::text,jsonb_build_object('version',camp.version));
  return to_jsonb(camp);
 end if;
 if p->>'action'='content_save' then
  rid:=(p->>'id')::uuid;
  if coalesce(trim(p->>'title'),'')='' or length(p->>'title')>200 or length(coalesce(p->>'caption',''))>5000 then raise exception 'Check the title and caption.'; end if;
  if not exists(select 1 from content_campaigns where id=(p->>'campaign_id')::uuid and status<>'archived') then raise exception 'Choose an active campaign.'; end if;
  select array_agg(x) into platforms from (select distinct jsonb_array_elements_text(p->'target_platforms') as x) s;
  if platforms is null or cardinality(platforms)>6 or not platforms<@array['Instagram','TikTok','YouTube','Facebook','Threads','LinkedIn'] then raise exception 'Choose at least one supported channel.'; end if;
  reviewer:=nullif(p->>'brand_reviewer_id','')::uuid; publisher:=coalesce(nullif(p->>'publisher_id','')::uuid,actor);
  if reviewer is not null and not exists(select 1 from crm_user_roles where user_id=reviewer and active and role='management') then raise exception 'Choose an active brand reviewer.'; end if;
  if not exists(select 1 from crm_user_roles where user_id=publisher and active) or (nullif(p->>'assignee_id','') is not null and not exists(select 1 from crm_user_roles where user_id=(p->>'assignee_id')::uuid and active)) then raise exception 'Choose active team members.'; end if;
  select user_id into artist from crm_user_roles where role='artist' and active order by created_at limit 1;
  st:=coalesce(p->>'production_status','open');
  if st not in ('open','in_progress','review','done') then raise exception 'Invalid production status.'; end if;
  if coalesce(p->>'format','video') not in ('video','reel','story','photo','carousel') then raise exception 'Choose a content format.'; end if;
  if jsonb_typeof(coalesce(p->'channel_overrides','{}'))<>'object' or length(coalesce(p->'channel_overrides','{}')::text)>30000 then raise exception 'Check channel captions.'; end if;
  select * into c from artist_content where id=rid for update;
  if found then
   select * into t from client_board where id=c.production_task_id and kind='work' and coalesce(owner,'team') in ('team','lutho') and archived_at is null for update;
   if c.owner<>'team' or c.campaign_id is null or t.id is null then raise exception 'Shared campaign content required.'; end if;
   if c.version is distinct from (p->>'version')::int or t.task_version is distinct from (p->>'task_version')::int then raise exception 'Content or task changed. Refresh before saving.'; end if;
   if exists(select 1 from content_publications where content_id=rid and status in ('scheduled','published')) then raise exception 'Cancel the external schedule before editing, or duplicate published content.'; end if;
   next_version:=c.version+1;tid:=t.id;
   update artist_content set title=p->>'title',caption=coalesce(p->>'caption',''),preview_url=nullif(p->>'preview_url',''),asset_version_ref=nullif(p->>'asset_version_ref',''),campaign_id=(p->>'campaign_id')::uuid,format=coalesce(p->>'format','video'),target_platforms=platforms,channel_overrides=coalesce(p->'channel_overrides','{}'),version=next_version,approval='draft',review_note=null,updated_at=now() where id=rid returning * into c;
   update client_board set title=c.title||' · Production',campaign_id=c.campaign_id,assignee_id=nullif(p->>'assignee_id','')::uuid,details=left(coalesce(p->>'brief',''),1000),due_date=nullif(p->>'due_date','')::date,status=st,done_at=case when st='done' then now() else null end,updated_at=now() where id=tid;
  else
   if coalesce((p->>'version')::int,-1)<>0 then raise exception 'Content no longer exists.'; end if;
   next_version:=1;tid:=gen_random_uuid();
   insert into artist_content(id,title,caption,preview_url,asset_version_ref,campaign_id,format,target_platforms,channel_overrides) values(rid,p->>'title',coalesce(p->>'caption',''),nullif(p->>'preview_url',''),nullif(p->>'asset_version_ref',''),(p->>'campaign_id')::uuid,coalesce(p->>'format','video'),platforms,coalesce(p->'channel_overrides','{}')) returning * into c;
   insert into client_board(id,kind,owner,title,details,status,priority,due_date,assignee_id,creator_id,created_by,campaign_id,content_id,task_type,done_at) values(tid,'work','team',c.title||' · Production',left(coalesce(p->>'brief',''),1000),st,'normal',nullif(p->>'due_date','')::date,nullif(p->>'assignee_id','')::uuid,actor,'team',c.campaign_id,rid,'production',case when st='done' then now() else null end);
   update artist_content set production_task_id=tid where id=rid;
  end if;
  insert into content_revisions(content_id,version,title,caption,preview_url,approval,format,target_platforms,channel_overrides,asset_version_ref,brand_reviewer_id) values(rid,next_version,c.title,c.caption,c.preview_url,'draft',c.format,platforms,c.channel_overrides,c.asset_version_ref,reviewer);
  foreach st in array array['brand_review','artist_review'] loop
   update client_board set title=c.title||case st when 'brand_review' then ' · Brand review' else ' · Artist review' end,campaign_id=c.campaign_id,status='open',done_at=null,assignee_id=case st when 'brand_review' then reviewer else artist end,reviewer_id=case st when 'brand_review' then reviewer else artist end,updated_at=now() where content_id=rid and task_type=st and archived_at is null;
   if not found then insert into client_board(kind,owner,title,status,priority,assignee_id,reviewer_id,creator_id,created_by,campaign_id,content_id,task_type) values('work','team',c.title||case st when 'brand_review' then ' · Brand review' else ' · Artist review' end,'open','normal',case st when 'brand_review' then reviewer else artist end,case st when 'brand_review' then reviewer else artist end,actor,'team',c.campaign_id,rid,st); end if;
  end loop;
  update content_publications set status='cancelled',lock_version=lock_version+1,updated_at=now() where content_id=rid and not(platform=any(platforms)) and status not in ('published','cancelled');
  update client_board b set archived_at=now() from content_publications x where b.publication_id=x.id and x.content_id=rid and x.status='cancelled' and b.archived_at is null;
  foreach platform_name in array platforms loop
   select * into pub from content_publications where content_id=rid and platform=platform_name and status<>'cancelled' order by updated_at desc limit 1 for update;
   if found then update content_publications set version=next_version,publisher_id=publisher,lock_version=lock_version+1,updated_at=now() where id=pub.id returning * into pub;
   else insert into content_publications(content_id,version,platform,status,publisher_id) values(rid,next_version,platform_name,'draft',publisher) returning * into pub; end if;
   update client_board set title=c.title||' · Publish on '||platform_name,campaign_id=c.campaign_id,assignee_id=publisher,updated_at=now() where publication_id=pub.id and task_type='publish' and archived_at is null;
   if not found then insert into client_board(kind,owner,title,status,priority,assignee_id,creator_id,created_by,campaign_id,content_id,publication_id,task_type) values('work','team',c.title||' · Publish on '||platform_name,'open','normal',publisher,actor,'team',c.campaign_id,rid,pub.id,'publish'); end if;
  end loop;
  insert into crm_audit(actor,action,entity_id,details) values(actor::text,'calendar_content_save',rid::text,jsonb_build_object('version',next_version));
  return jsonb_build_object('id',rid,'version',next_version,'task_id',tid);
 end if;
 rid:=(p->>'content_id')::uuid;
 select * into c from artist_content where id=rid and owner='team' and campaign_id is not null for update;
 select * into t from client_board where id=c.production_task_id and kind='work' and coalesce(owner,'team') in ('team','lutho') and archived_at is null for update;
 if c.id is null or t.id is null then raise exception 'Shared campaign content required.'; end if;
 if c.version is distinct from (p->>'version')::int then raise exception 'Content changed. Refresh before continuing.'; end if;
 select * into rev from content_revisions where content_id=rid and version=c.version for update;
 if p->>'action'='submit_brand' then
  if t.status<>'done' or coalesce(c.preview_url,'')='' or coalesce(c.asset_version_ref,'')='' or rev.brand_reviewer_id is null then raise exception 'Finish production, add the asset/version and choose a brand reviewer first.'; end if;
  if rev.brand_approval='approved' and c.approval in ('waiting','approved') then raise exception 'This version has already passed brand review.'; end if;
  update content_revisions set brand_approval='waiting' where content_id=rid and version=c.version;
  update client_board set status='review',updated_at=now() where content_id=rid and task_type='brand_review' and archived_at is null;
 elsif p->>'action'='brand_review' then
  if a.role<>'management' or rev.brand_reviewer_id<>actor or rev.brand_approval<>'waiting' then raise exception 'Only the assigned brand reviewer can review this version.'; end if;
  if p->>'decision' not in ('approved','changes') then raise exception 'Choose approve or request changes.'; end if;
  if p->>'decision'='changes' and trim(coalesce(p->>'note',''))='' then raise exception 'Explain the requested changes.'; end if;
  update content_revisions set brand_approval=p->>'decision',brand_reviewed_by=actor,brand_reviewed_at=now(),brand_review_note=left(p->>'note',1000) where content_id=rid and version=c.version;
  update artist_content set approval=case p->>'decision' when 'approved' then 'waiting' else 'draft' end,updated_at=now() where id=rid;
  update client_board set status=case p->>'decision' when 'approved' then 'done' else 'open' end,done_at=case p->>'decision' when 'approved' then now() else null end,updated_at=now() where content_id=rid and task_type='brand_review' and archived_at is null;
  update client_board set status=case p->>'decision' when 'approved' then 'review' else 'open' end,updated_at=now() where content_id=rid and task_type='artist_review' and archived_at is null;
  if p->>'decision'='changes' then update client_board set status='in_progress',done_at=null where id=t.id; end if;
 elsif p->>'action'='artist_review' then
  if a.role<>'artist' or rev.brand_approval<>'approved' or c.approval<>'waiting' then raise exception 'Warren can review only after brand approval.'; end if;
  if p->>'decision' not in ('approved','changes') then raise exception 'Choose approve or request changes.'; end if;
  if p->>'decision'='changes' and trim(coalesce(p->>'note',''))='' then raise exception 'Explain the requested changes.'; end if;
  update artist_content set approval=p->>'decision',review_note=left(p->>'note',1000),updated_at=now() where id=rid;
  update content_revisions set approval=p->>'decision',review_note=left(p->>'note',1000),reviewed_by=actor::text,artist_reviewed_at=now() where content_id=rid and version=c.version;
  update client_board set status=case p->>'decision' when 'approved' then 'done' else 'open' end,done_at=case p->>'decision' when 'approved' then now() else null end,updated_at=now() where content_id=rid and task_type='artist_review' and archived_at is null;
  if p->>'decision'='changes' then update client_board set status='in_progress',done_at=null where id=t.id; end if;
 elsif p->>'action'='publication_save' then
  select * into pub from content_publications where id=(p->>'id')::uuid and content_id=rid for update;
  if pub.id is null or pub.version<>c.version or pub.lock_version is distinct from (p->>'lock_version')::int then raise exception 'Publication changed. Refresh before saving.'; end if;
  if pub.status='published' then raise exception 'Published posts are history. Duplicate the content for another post.'; end if;
  st:=p->>'status';target:=nullif(p->>'scheduled_at','')::timestamptz;actual:=nullif(p->>'published_at','')::timestamptz;post:=nullif(p->>'post_url','');
  if st not in ('draft','planned','scheduled','published','failed','cancelled') then raise exception 'Invalid publication status.'; end if;
  if st in ('planned','scheduled') and target is null then raise exception 'Choose a publication time.'; end if;
  if st in ('scheduled','published') and (c.approval<>'approved' or rev.brand_approval<>'approved' or t.status<>'done') then raise exception 'Finish production and both approvals first.'; end if;
  if st='scheduled' and trim(coalesce(p->>'scheduler_ref',''))='' then raise exception 'Add the external schedule confirmation.'; end if;
  if pub.status='scheduled' and st<>'published' and (st<>'scheduled' or target is distinct from pub.scheduled_at) and trim(coalesce(p->>'note',''))='' then raise exception 'Confirm the external cancellation or time change in the note.'; end if;
  if st='published' then
   pattern:=case pub.platform when 'Instagram' then 'instagram\.com' when 'TikTok' then 'tiktok\.com' when 'YouTube' then '(youtube\.com|youtu\.be)' when 'Facebook' then '(facebook\.com|fb\.watch)' when 'Threads' then '(threads\.net|threads\.com)' else 'linkedin\.com' end;
   if actual is null or actual>now() or post is null or post !~* ('^https://([a-z0-9-]+\.)*'||pattern||'(/|$)') then raise exception 'Add the correct live URL and actual publication time.'; end if;
  end if;
  update content_publications set status=st,scheduled_at=target,published_at=case when st='published' then actual else null end,post_url=case when st='published' then post else null end,note=left(p->>'note',500),scheduler_ref=nullif(p->>'scheduler_ref',''),schedule_confirmed_by=case when st='scheduled' then actor else schedule_confirmed_by end,schedule_confirmed_at=case when st='scheduled' then now() else schedule_confirmed_at end,lock_version=lock_version+1,updated_at=now() where id=pub.id;
  update client_board set status=case when st='published' then 'done' else 'open' end,done_at=case when st='published' then now() else null end,due_date=(target at time zone 'Europe/Berlin')::date,archived_at=case when st='cancelled' then now() else null end,updated_at=now() where publication_id=pub.id and task_type='publish';
 else raise exception 'Unknown calendar action.';
 end if;
 insert into crm_audit(actor,action,entity_id,details) values(actor::text,'calendar_'||(p->>'action'),rid::text,jsonb_build_object('version',c.version,'publication_id',p->>'id','status',st));
 return jsonb_build_object('id',rid,'version',c.version);
end $$;

create function public.calendar_list(actor uuid, range_start timestamptz, range_end timestamptz) returns jsonb language plpgsql security invoker set search_path=public as $$
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
revoke all on function public.calendar_guard(),public.calendar_save(jsonb,uuid),public.calendar_list(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.calendar_guard(),public.calendar_save(jsonb,uuid),public.calendar_list(uuid,timestamptz,timestamptz) to service_role;
commit;
