-- Public business research, per-prospect drafts and actual outreach history.
begin;
alter table public.booking_lead_research add column enrichment jsonb not null default '{}'::jsonb check(jsonb_typeof(enrichment)='object');
alter table public.opportunities alter column last_touch drop not null;

create function public.booking_research_defaults() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 update contacts set preferred_channel=null where id=(select contact_id from opportunities where id=new.opportunity_id) and assigned_to='team';
 update opportunities set last_touch=null where id=new.opportunity_id;
 return new;
end $$;
revoke all on function public.booking_research_defaults() from public,anon,authenticated;
create trigger booking_research_defaults after insert on public.booking_lead_research for each row execute function public.booking_research_defaults();
update public.opportunities o set last_touch=null where exists(select 1 from public.booking_lead_research r where r.opportunity_id=o.id) and not exists(select 1 from public.interactions i where i.contact_id=o.contact_id);
update public.contacts c set preferred_channel=null where c.assigned_to='team' and c.phone_whatsapp is null and exists(select 1 from public.opportunities o join public.booking_lead_research r on r.opportunity_id=o.id where o.contact_id=c.id) and not exists(select 1 from public.interactions i where i.contact_id=c.id);

create function public.booking_enrichment_list(actor uuid,period_start date,period_end date) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; expanded jsonb;
begin
 result:=booking_acquisition_list(actor,period_start,period_end);
 select coalesce(jsonb_agg(l||jsonb_build_object('phone',c.phone_whatsapp,'preferred_channel',c.preferred_channel,'last_touch',(select max(i.created_at) from interactions i where i.contact_id=c.id and i.channel<>'dashboard'),
 'campaign_count',(select count(*) from artist_pitch_targets t where t.opportunity_id=o.id),
 'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') from (select i.id,i.channel,i.direction,i.summary,i.created_at from interactions i where i.contact_id=c.id order by i.created_at desc limit 30) h)) order by (l->>'fit_score')::int desc),'[]') into expanded
 from jsonb_array_elements(result->'leads') l join opportunities o on o.id=(l->>'opportunity_id')::uuid join contacts c on c.id=o.contact_id;
 return jsonb_set(result,'{leads}',expanded);
end $$;

create function public.booking_enrichment_save(p jsonb,actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; oid uuid; c contacts; e jsonb:=coalesce(p->'enrichment','{}'); field text;
begin
 if jsonb_typeof(e)<>'object' or length(e::text)>24000 then raise exception 'Check research fields.'; end if;
 if coalesce(e->>'email_type','unknown') not in ('booking','general','events','unknown') or coalesce(e->>'booker_status','unconfirmed') not in ('unconfirmed','named_not_confirmed','confirmed') or coalesce(e->>'email_permission','unknown') not in ('unknown','invited','consent','existing_relationship') or coalesce(e->>'phone_basis','unknown') not in ('unknown','consent','existing_relationship','specific_business_reason') then raise exception 'Check contact classification.'; end if;
 foreach field in array array['programming_url','phone_source_url','contact_source_url','permission_source_url'] loop
  if nullif(e->>field,'') is not null and e->>field !~ '^https://' then raise exception 'Research sources must use HTTPS.'; end if;
 end loop;
 if coalesce(e->>'email_permission','unknown')<>'unknown' and length(trim(coalesce(e->>'permission_note','')))<5 then raise exception 'Record the email permission evidence.'; end if;
 if coalesce(e->>'phone_basis','unknown')<>'unknown' and length(trim(coalesce(e->>'phone_basis_note','')))<5 then raise exception 'Record why this business call is appropriate.'; end if;
 if nullif(e->>'checked_on','') is not null and ((e->>'checked_on')::date>(now() at time zone 'Europe/Berlin')::date) then raise exception 'Research check cannot be in the future.'; end if;
 if length(coalesce(p->>'phone',''))>40 or (nullif(p->>'phone','') is not null and (p->>'phone' !~ '^\+?[0-9 ()/-]{6,40}$' or nullif(e->>'phone_source_url','') is null)) then raise exception 'Add a published business phone and its source.'; end if;
 if coalesce(p->>'preferred_channel','') not in ('','email','phone','whatsapp','ig_dm','in_person') then raise exception 'Choose a contact channel.'; end if;
 if coalesce(trim(p->>'name'),'')='' or length(p->>'name')>120 then raise exception 'Contact or team name required.'; end if;
 result:=booking_acquisition_save(p||jsonb_build_object('action','lead_save'),actor);
 oid:=(result->>'id')::uuid;
 select x.* into c from contacts x join opportunities o on o.contact_id=x.id where o.id=oid and x.assigned_to='team';
 update contacts set name=trim(p->>'name'),phone_whatsapp=nullif(trim(p->>'phone'),''),preferred_channel=nullif(p->>'preferred_channel','')::channel,updated_at=now() where id=c.id;
 update booking_lead_research set enrichment=e where opportunity_id=oid;
 return result;
end $$;

create function public.booking_enrichment_import(p jsonb,actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare row jsonb; created int:=0; skipped int:=0;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.'; end if;
 if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows') not between 1 and 50 then raise exception 'Import 1–50 reviewed rows.'; end if;
 for row in select value from jsonb_array_elements(p->'rows') loop
  if (nullif(trim(row->>'email'),'') is not null and exists(select 1 from contacts where lower(trim(email))=lower(trim(row->>'email')))) or exists(select 1 from booking_lead_research r join opportunities o on o.id=r.opportunity_id join venues v on v.id=o.venue_id where lower(trim(v.name))=lower(trim(row->>'company')) and lower(trim(coalesce(v.city,'')))=lower(trim(coalesce(row->>'city','')))) then skipped:=skipped+1;continue;end if;
  perform booking_enrichment_save(row||jsonb_build_object('version',0,'verification_status','needs_review','contact_checked',false),actor);created:=created+1;
 end loop;
 return jsonb_build_object('created',created,'skipped',skipped);
end $$;

create function public.booking_log_activity(p jsonb,actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare o opportunities; c contacts; r booking_lead_research; occurred timestamptz; next_stage text; who logged_by; iid uuid;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.'; end if;
 select x.* into r from booking_lead_research x where x.opportunity_id=(p->>'opportunity_id')::uuid for update;
 select x.* into o from opportunities x join contacts y on y.id=x.contact_id where x.id=r.opportunity_id and y.assigned_to='team' for update of x;
 if o.id is null then raise exception 'Shared prospect required.'; end if;
 select * into c from contacts where id=o.contact_id;
 iid:=(p->>'id')::uuid;
 if exists(select 1 from interactions where id=iid and contact_id=c.id) then return jsonb_build_object('id',iid,'already_logged',true); end if;
 if r.version is distinct from (p->>'version')::int then raise exception 'Prospect changed. Refresh before logging.'; end if;
 if c.opt_out_at is not null or coalesce(o.do_not_contact,false) or o.pipeline_stage in ('Do not contact','Not interested') then raise exception 'This prospect is suppressed.'; end if;
 if p->>'channel' not in ('email','phone','in_person') or p->>'outcome' not in ('sent','no_answer','connected','replied','qualified','not_interested','do_not_contact') or length(trim(coalesce(p->>'summary','')))<3 or length(p->>'summary')>1500 then raise exception 'Choose the actual channel and outcome and add a note.'; end if;
 occurred:=(p->>'occurred_at')::timestamp at time zone 'Europe/Berlin';
 if occurred is null or occurred>now()+interval '5 minutes' then raise exception 'Log only communication that already happened.'; end if;
 next_stage:=case p->>'outcome' when 'qualified' then 'Qualified' when 'replied' then 'Replied' when 'not_interested' then 'Not interested' when 'do_not_contact' then 'Do not contact' else 'Contacted' end;
 if p->>'outcome' in ('sent','no_answer','connected') and nullif(p->>'follow_up_date','') is null then raise exception 'Choose the next follow-up date.'; end if;
 if nullif(p->>'follow_up_date','') is not null and (p->>'follow_up_date')::date<(occurred at time zone 'Europe/Berlin')::date then raise exception 'Follow-up cannot predate the interaction.'; end if;
 select case when role='artist' then 'warren'::logged_by when display_name='Lutho Kote' then 'lutho'::logged_by else 'agent'::logged_by end into who from crm_user_roles where user_id=actor;
 insert into interactions(id,contact_id,channel,direction,summary,logged_by,created_at) values(iid,c.id,(p->>'channel')::channel,case when p->>'outcome'='replied' then 'inbound'::direction else 'outbound'::direction end,'['||(p->>'outcome')||'] '||trim(p->>'summary'),who,occurred);
 update opportunities set last_touch=(select max(i.created_at) from interactions i where i.contact_id=c.id and i.channel<>'dashboard'),pipeline_stage=next_stage,do_not_contact=next_stage='Do not contact',follow_up_date=case when next_stage in ('Do not contact','Not interested') then null else nullif(p->>'follow_up_date','')::date end,next_step=left(p->>'next_step',500),updated_at=now() where id=o.id;
 if next_stage='Do not contact' then update contacts set opt_out_at=now(),updated_at=now() where id=c.id; end if;
 update booking_lead_research set version=version+1,updated_at=now() where opportunity_id=o.id;
 insert into crm_audit(actor,action,entity_id,details) values(actor::text,'booking_activity_logged',iid::text,jsonb_build_object('opportunity_id',o.id,'channel',p->>'channel','outcome',p->>'outcome'));
 return jsonb_build_object('id',iid);
end $$;
revoke all on function public.booking_enrichment_list(uuid,date,date),public.booking_enrichment_save(jsonb,uuid),public.booking_enrichment_import(jsonb,uuid),public.booking_log_activity(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.booking_enrichment_list(uuid,date,date),public.booking_enrichment_save(jsonb,uuid),public.booking_enrichment_import(jsonb,uuid),public.booking_log_activity(jsonb,uuid) to service_role;
commit;
