-- Shared prospect research and reviewable booking campaigns. No message dispatch.
begin;
create table public.booking_lead_research(
 opportunity_id uuid primary key references public.opportunities(id),
 category text not null check(category in ('promoter','booker','venue','restaurant')),
 matched_gig_id uuid not null references public.gigs(id),
 fit_reason text not null check(length(trim(fit_reason)) between 1 and 1000),
 fit_score integer not null default 0 check(fit_score between 0 and 100),
 source_url text not null check(source_url ~ '^https://'),
 verification_status text not null default 'needs_review' check(verification_status in ('needs_review','verified','rejected')),
 owner_user_id uuid references public.crm_user_roles(user_id),
 verified_at timestamptz, version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table public.booking_campaign_attribution(
 gig_id uuid primary key references public.gigs(id),
 campaign_id uuid not null references public.artist_pitch_campaigns(id),
 opportunity_id uuid not null references public.opportunities(id),
 confirmed_on date not null, confirmation_reference text not null check(length(trim(confirmation_reference)) between 3 and 500),
 recorded_by uuid not null references public.crm_user_roles(user_id), recorded_at timestamptz not null default now()
);
alter table public.artist_pitch_campaigns add column subject text not null default '',
 add column press_kit_url text, add column music_url text, add column research_brief text not null default '',
 add column version integer not null default 1;
alter table public.booking_lead_research enable row level security;
alter table public.booking_campaign_attribution enable row level security;
revoke all on public.booking_lead_research,public.booking_campaign_attribution from public,anon,authenticated;
grant all on public.booking_lead_research,public.booking_campaign_attribution to service_role;

create function public.booking_acquisition_list(actor uuid,period_start date,period_end date) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.'; end if;
 if period_start is null or period_end is null or period_end<=period_start or period_end-period_start>366 then raise exception 'Choose a reporting period of up to one year.'; end if;
 select jsonb_build_object(
  'actor',actor,
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name)),'[]') from crm_user_roles where active and role in ('management','artist')),
  'references',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'date',g.date,'venue',v.name,'city',v.city) order by g.date desc),'[]') from gigs g join venues v on v.id=g.venue_id where g.date<=(now() at time zone 'Europe/Berlin')::date and g.booking_status='confirmed' and g.is_public),
  'leads',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('name',c.name,'email',c.email,'company',v.name,'city',v.city,'website',v.website,'pipeline_stage',o.pipeline_stage,'follow_up_date',o.follow_up_date,'next_step',o.next_step,'suppressed',coalesce(o.do_not_contact,false) or c.opt_out_at is not null or o.pipeline_stage in ('Do not contact','Not interested')) order by r.fit_score desc,r.updated_at desc),'[]') from booking_lead_research r join opportunities o on o.id=r.opportunity_id join contacts c on c.id=o.contact_id left join venues v on v.id=o.venue_id where c.assigned_to='team'),
  'campaigns',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('targets',(select coalesce(jsonb_agg(t.opportunity_id),'[]') from artist_pitch_targets t where t.campaign_id=p.id),'confirmed_bookings',(select count(*) from booking_campaign_attribution a join gigs g on g.id=a.gig_id where a.campaign_id=p.id and g.booking_status='confirmed' and a.confirmed_on>=period_start and a.confirmed_on<period_end)) order by p.created_at desc),'[]') from artist_pitch_campaigns p where p.research_brief<>''),
  'gigs',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'date',g.date,'venue',v.name,'attributed',exists(select 1 from booking_campaign_attribution a where a.gig_id=g.id)) order by g.date desc),'[]') from gigs g left join venues v on v.id=g.venue_id where g.booking_status='confirmed' and (g.is_public or exists(select 1 from opportunities o join contacts c on c.id=o.contact_id where o.id=g.opportunity_id and c.assigned_to='team'))),
  'confirmed_bookings',(select count(*) from booking_campaign_attribution a join gigs g on g.id=a.gig_id where g.booking_status='confirmed' and a.confirmed_on>=period_start and a.confirmed_on<period_end),
  'sending_enabled',false
 ) into result;
 return result;
end $$;

create function public.booking_acquisition_save(p jsonb,actor uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r booking_lead_research; o opportunities; c contacts; v venues; camp artist_pitch_campaigns; g gigs;
 rid uuid; cid uuid; vid uuid; oid uuid; tid uuid; ids uuid[]; row jsonb; created integer:=0; skipped integer:=0; st text; n integer;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.'; end if;
 if p->>'action'='import' then
  if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows') not between 1 and 50 then raise exception 'Import between 1 and 50 reviewed rows.'; end if;
  for row in select value from jsonb_array_elements(p->'rows') loop
   if (nullif(trim(row->>'email'),'') is not null and exists(select 1 from contacts where lower(trim(email))=lower(trim(row->>'email')))) or exists(select 1 from booking_lead_research br join opportunities bo on bo.id=br.opportunity_id join venues bv on bv.id=bo.venue_id where lower(trim(bv.name))=lower(trim(row->>'company')) and lower(trim(coalesce(bv.city,'')))=lower(trim(coalesce(row->>'city','')))) then skipped:=skipped+1;continue;end if;
   perform booking_acquisition_save(row||jsonb_build_object('action','lead_save','version',0),actor);
   created:=created+1;
  end loop;
  return jsonb_build_object('created',created,'skipped',skipped);
 elsif p->>'action'='lead_save' then
  if p->>'category' not in ('promoter','booker','venue','restaurant') or coalesce(trim(p->>'fit_reason'),'')='' or length(p->>'fit_reason')>1000 or (p->>'fit_score')::int not between 0 and 100 then raise exception 'Choose a segment and explain the fit.'; end if;
  if coalesce(p->>'source_url','') !~ '^https://' or (nullif(p->>'website','') is not null and p->>'website' !~ '^https://') then raise exception 'Add HTTPS research sources.'; end if;
  if not exists(select 1 from gigs where id=(p->>'matched_gig_id')::uuid and is_public and booking_status='confirmed' and date<=(now() at time zone 'Europe/Berlin')::date) then raise exception 'Choose a public past booking as the reference.'; end if;
  if nullif(p->>'owner_user_id','') is not null and not exists(select 1 from crm_user_roles where user_id=(p->>'owner_user_id')::uuid and active and role in ('management','artist')) then raise exception 'Choose an active booking owner.'; end if;
  oid:=nullif(p->>'opportunity_id','')::uuid;
  select * into r from booking_lead_research where opportunity_id=oid for update;
  if found then
   if r.version is distinct from (p->>'version')::int then raise exception 'Lead changed. Refresh before saving.'; end if;
   select x.* into o from opportunities x join contacts y on y.id=x.contact_id where x.id=oid and y.assigned_to='team' for update of x;
   if not found then raise exception 'Shared prospect required.'; end if;
   select * into c from contacts where id=o.contact_id for update;
   if coalesce(o.do_not_contact,false) or c.opt_out_at is not null or o.pipeline_stage in ('Do not contact','Not interested') then raise exception 'Suppressed prospects cannot be changed here.'; end if;
  else
   if coalesce((p->>'version')::int,-1)<>0 or oid is not null then raise exception 'Lead no longer exists.'; end if;
   if coalesce(trim(p->>'company'),'')='' or length(p->>'company')>200 or coalesce(trim(p->>'name'),'')='' then raise exception 'Company and contact label required.'; end if;
   if nullif(p->>'email','') is not null and (p->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or exists(select 1 from contacts where lower(trim(email))=lower(trim(p->>'email')))) then raise exception 'Check the email or review the existing contact.'; end if;
   perform pg_advisory_xact_lock(hashtext(lower(trim(p->>'company'))||'|'||lower(trim(coalesce(p->>'city','')))));
   if exists(select 1 from booking_lead_research br join opportunities bo on bo.id=br.opportunity_id join venues bv on bv.id=bo.venue_id where lower(trim(bv.name))=lower(trim(p->>'company')) and lower(trim(coalesce(bv.city,'')))=lower(trim(coalesce(p->>'city','')))) then raise exception 'This company already has a prospect record.'; end if;
   select id into vid from venues where lower(trim(name))=lower(trim(p->>'company')) and lower(trim(coalesce(city,'')))=lower(trim(coalesce(p->>'city',''))) limit 1;
   if vid is null then insert into venues(name,city,type,website,status,source) values(trim(p->>'company'),nullif(trim(p->>'city'),''),'event_series',nullif(p->>'website',''),'researching','booking-acquisition') returning id into vid; end if;
   insert into contacts(name,venue_id,email,role,source,assigned_to) values(left(trim(p->>'name'),120),vid,nullif(trim(p->>'email'),''),case p->>'category' when 'promoter' then 'promoter'::contact_role when 'booker' then 'booker'::contact_role else 'club_manager'::contact_role end,left(coalesce(p->>'research_provider','Manual research'),100),'team') returning id into cid;
   insert into opportunities(contact_id,venue_id,type,stage,pipeline_stage,source,segment,region,assigned_to) values(cid,vid,'club','new','Not contacted',left(coalesce(p->>'research_provider','Manual research'),100),p->>'category',p->>'city','team') returning id into oid;
   insert into booking_lead_research(opportunity_id,category,matched_gig_id,fit_reason,fit_score,source_url) values(oid,p->>'category',(p->>'matched_gig_id')::uuid,p->>'fit_reason',(p->>'fit_score')::int,p->>'source_url') returning * into r;
   select * into o from opportunities where id=oid;select * into c from contacts where id=cid;
  end if;
  st:=coalesce(p->>'verification_status','needs_review');
  if nullif(p->>'email','') is not null and (p->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or exists(select 1 from contacts where id<>c.id and lower(trim(email))=lower(trim(p->>'email')))) then raise exception 'Check the email or review the existing contact.'; end if;
  update contacts set email=nullif(trim(p->>'email'),''),updated_at=now() where id=c.id returning * into c;
  if st not in ('needs_review','verified','rejected') then raise exception 'Invalid verification status.'; end if;
  if st='verified' and (nullif(c.email,'') is null or p->>'contact_checked' is distinct from 'true') then raise exception 'Verify the business booking contact before marking it verified.'; end if;
  if coalesce(p->>'pipeline_stage','Not contacted') not in ('Not contacted','Contacted','Follow-up due','Replied','Qualified','Not interested','Do not contact') then raise exception 'Invalid prospect stage.'; end if;
  update booking_lead_research set category=p->>'category',matched_gig_id=(p->>'matched_gig_id')::uuid,fit_reason=left(p->>'fit_reason',1000),fit_score=(p->>'fit_score')::int,source_url=p->>'source_url',owner_user_id=nullif(p->>'owner_user_id','')::uuid,verification_status=st,verified_at=case when st='verified' then now() else null end,version=r.version+1,updated_at=now() where opportunity_id=oid;
  update opportunities set pipeline_stage=coalesce(p->>'pipeline_stage','Not contacted'),do_not_contact=coalesce(p->>'pipeline_stage','Not contacted')='Do not contact',follow_up_date=nullif(p->>'follow_up_date','')::date,next_step=left(p->>'next_step',500),segment=p->>'category',updated_at=now() where id=oid;
  rid:=oid;
 elsif p->>'action'='campaign_save' then
  if coalesce(trim(p->>'name'),'')='' or length(p->>'name')>200 or length(coalesce(p->>'pitch_draft',''))>10000 or coalesce(trim(p->>'research_brief'),'')='' then raise exception 'Campaign name and research brief required.'; end if;
  if (nullif(p->>'press_kit_url','') is not null and p->>'press_kit_url' !~ '^https://') or (nullif(p->>'music_url','') is not null and p->>'music_url' !~ '^https://') then raise exception 'Use HTTPS media links.'; end if;
  rid:=(p->>'id')::uuid;
  select * into camp from artist_pitch_campaigns where id=rid for update;
  if found then
   if camp.version is distinct from (p->>'version')::int or camp.send_status<>'not_sent' then raise exception 'Campaign changed or already dispatched. Refresh before editing.'; end if;
  elsif coalesce((p->>'version')::int,-1)<>0 then raise exception 'Campaign no longer exists.';
  else insert into artist_pitch_campaigns(id,name,owner_user_id) values(rid,p->>'name',actor) returning * into camp;
  end if;
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p->'targets','[]'));
  if cardinality(ids)>100 then raise exception 'Choose up to 100 prospects.'; end if;
  if exists(select 1 from unnest(ids) target_id where not exists(select 1 from booking_lead_research br join opportunities bo on bo.id=br.opportunity_id join contacts bc on bc.id=bo.contact_id where br.opportunity_id=target_id and bc.assigned_to='team' and bc.opt_out_at is null and not coalesce(bo.do_not_contact,false) and bo.pipeline_stage not in ('Do not contact','Not interested') and br.verification_status<>'rejected')) then raise exception 'Choose active shared prospects only.'; end if;
  update artist_pitch_campaigns set name=p->>'name',subject=left(coalesce(p->>'subject',''),300),target_audience=left(coalesce(p->>'target_audience',''),1000),pitch_draft=coalesce(p->>'pitch_draft',''),press_kit_url=nullif(p->>'press_kit_url',''),music_url=nullif(p->>'music_url',''),research_brief=left(p->>'research_brief',8000),follow_up_date=nullif(p->>'follow_up_date','')::date,approval_status='draft',send_status='not_sent',version=camp.version+1,updated_at=now() where id=rid;
  delete from artist_pitch_targets where campaign_id=rid;
  insert into artist_pitch_targets(campaign_id,opportunity_id) select rid,id from (select distinct unnest(ids) as id) x;
 elsif p->>'action'='attribute_booking' then
  select * into g from gigs where id=(p->>'gig_id')::uuid for update;
  if g.id is null or g.booking_status<>'confirmed' then raise exception 'An existing confirmed gig is required.'; end if;
  oid:=(p->>'opportunity_id')::uuid;rid:=(p->>'campaign_id')::uuid;
  if g.opportunity_id is not null and g.opportunity_id<>oid then raise exception 'This gig is linked to a different opportunity.'; end if;
  if not exists(select 1 from artist_pitch_targets t join booking_lead_research br on br.opportunity_id=t.opportunity_id join opportunities bo on bo.id=t.opportunity_id join contacts bc on bc.id=bo.contact_id where t.campaign_id=rid and t.opportunity_id=oid and bc.assigned_to='team' and bc.opt_out_at is null and not coalesce(bo.do_not_contact,false)) then raise exception 'Choose a shared campaign prospect.'; end if;
  if nullif(p->>'confirmed_on','') is null or (p->>'confirmed_on')::date>(now() at time zone 'Europe/Berlin')::date or (p->>'confirmed_on')::date>g.date or length(trim(coalesce(p->>'confirmation_reference','')))<3 then raise exception 'Actual confirmation date and booking evidence required.'; end if;
  insert into booking_campaign_attribution(gig_id,campaign_id,opportunity_id,confirmed_on,confirmation_reference,recorded_by) values(g.id,rid,oid,(p->>'confirmed_on')::date,left(p->>'confirmation_reference',500),actor);
  update gigs set opportunity_id=oid,updated_at=now() where id=g.id;
 else raise exception 'Unknown acquisition action.';
 end if;
 insert into crm_audit(actor,action,entity_id,details) values(actor::text,'booking_'||(p->>'action'),rid::text,'{}');
 return jsonb_build_object('id',rid);
end $$;
revoke all on function public.booking_acquisition_list(uuid,date,date),public.booking_acquisition_save(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.booking_acquisition_list(uuid,date,date),public.booking_acquisition_save(jsonb,uuid) to service_role;
commit;
