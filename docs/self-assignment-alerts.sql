-- Enable assignment emails when creator and assignee are the same person.
-- Existing task edits do not generate repeat assignment events.
begin;
create or replace function public.save_team_task(p jsonb, actor uuid)
returns public.client_board language plpgsql security invoker set search_path=public as $$
declare t public.client_board; old_assignee uuid; old_status text; recipient uuid;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('artist','management','social_media','videographer_photographer')) then raise exception 'Active team account required'; end if;
 if p->>'assignee_id' is not null and not exists(select 1 from crm_user_roles where user_id=(p->>'assignee_id')::uuid and active and role in ('artist','management','social_media','videographer_photographer')) then raise exception 'Choose an active assignee'; end if;
 if p->>'reviewer_id' is not null and not exists(select 1 from crm_user_roles where user_id=(p->>'reviewer_id')::uuid and active and role in ('artist','management','social_media','videographer_photographer')) then raise exception 'Choose an active reviewer'; end if;
 if coalesce(p->>'title','')='' or length(p->>'title')>200 or coalesce(p->>'status','') not in ('open','in_progress','review','done') or coalesce(p->>'priority','') not in ('normal','high','low') then raise exception 'Invalid task fields'; end if;
 select * into t from client_board where id=(p->>'id')::uuid for update;
 if found then
  if t.kind<>'work' or t.archived_at is not null or not (coalesce(t.owner,'team') in ('team','lutho')) then raise exception 'Not a shared team task'; end if;
  if t.task_version<>(p->>'task_version')::integer or p->>'task_version' is null then raise exception 'Task changed. Refresh and try again.'; end if;
  old_assignee:=t.assignee_id; old_status:=t.status;
  update client_board set title=p->>'title',details=p->>'details',assignee_id=(p->>'assignee_id')::uuid,reviewer_id=(p->>'reviewer_id')::uuid,due_date=(p->>'due_date')::date,priority=p->>'priority',status=p->>'status',blocked_reason=p->>'blocked_reason',task_version=task_version+1,updated_at=now(),done_at=case when p->>'status'='done' then coalesce(done_at,now()) else null end where id=t.id returning * into t;
 else
  if coalesce((p->>'task_version')::integer,-1)<>0 then raise exception 'Task no longer exists. Refresh.'; end if;
  insert into client_board(id,kind,owner,title,details,status,priority,due_date,assignee_id,reviewer_id,creator_id,created_by,blocked_reason)
  values((p->>'id')::uuid,'work','team',p->>'title',p->>'details',p->>'status',p->>'priority',(p->>'due_date')::date,(p->>'assignee_id')::uuid,(p->>'reviewer_id')::uuid,actor,'team',p->>'blocked_reason') returning * into t;
 end if;
 if t.assignee_id is not null and t.assignee_id is distinct from old_assignee then
 insert into team_task_notifications(board_id,recipient_id,event,task_version) values(t.id,t.assignee_id,'assigned',t.task_version) on conflict do nothing; end if;
 recipient:=coalesce(t.reviewer_id,t.creator_id);
 if t.status='review' and old_status is distinct from 'review' and recipient is not null and recipient<>actor then
 insert into team_task_notifications(board_id,recipient_id,event,task_version) values(t.id,recipient,'review',t.task_version) on conflict do nothing; end if;
 insert into crm_audit(actor,action,entity_id,details) values(actor::text,'save_team_task',t.id::text,jsonb_build_object('status',t.status,'task_version',t.task_version));
 return t;
end $$;
revoke all on function public.save_team_task(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_team_task(jsonb,uuid) to service_role;
commit;
