-- Save a real shared booking and its campaign attribution in one transaction.
create function public.booking_record_confirmed(p jsonb,actor uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare o opportunities;r booking_lead_research;v_id uuid;g gigs;existing booking_campaign_attribution;gid uuid:=(p->>'id')::uuid;performance date:=(p->>'date')::date;confirmed date:=(p->>'confirmed_on')::date;amount numeric:=nullif(p->>'fee','')::numeric;
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.';end if;
 select x.* into r from booking_lead_research x where x.opportunity_id=(p->>'opportunity_id')::uuid for update;
 select x.* into o from opportunities x join contacts c on c.id=x.contact_id where x.id=r.opportunity_id and c.assigned_to='team' for update of x;
 if o.id is null then raise exception 'Shared prospect required.';end if;
 select * into existing from booking_campaign_attribution where gig_id=gid;
 if found then
  select * into g from gigs where id=gid;
  if existing.opportunity_id=o.id and existing.campaign_id=(p->>'campaign_id')::uuid and g.date=performance and existing.confirmed_on=confirmed and existing.confirmation_reference=trim(p->>'confirmation_reference') and g.fee is not distinct from amount then return jsonb_build_object('id',gid,'already_recorded',true);end if;
  raise exception 'Booking identifier is already used. Reopen the booking form.';
 end if;
 if r.version is distinct from (p->>'version')::int then raise exception 'Lead changed. Refresh before recording the booking.';end if;
 if p->>'confirmed' is distinct from 'true' or performance is null or confirmed is null or confirmed>(now() at time zone 'Europe/Berlin')::date or confirmed>performance then raise exception 'Record the actual agreed performance and confirmation dates.';end if;
 if length(trim(coalesce(p->>'venue_name',''))) not between 1 and 200 or length(trim(coalesce(p->>'city',''))) not between 1 and 120 or length(trim(coalesce(p->>'confirmation_reference',''))) not between 3 and 500 or length(coalesce(p->>'set_length',''))>120 or amount<0 or amount>1000000 then raise exception 'Check the venue, agreement evidence, fee and set length.';end if;
 if coalesce(o.do_not_contact,false) or exists(select 1 from contacts where id=o.contact_id and opt_out_at is not null) or o.pipeline_stage in ('Do not contact','Not interested') then raise exception 'This prospect is suppressed.';end if;
 if not exists(select 1 from artist_pitch_targets where opportunity_id=o.id and campaign_id=(p->>'campaign_id')::uuid) then raise exception 'Choose a campaign that includes this lead.';end if;
 if exists(select 1 from gigs where opportunity_id=o.id and date=performance and booking_status<>'cancelled') then raise exception 'A gig for this lead and date already exists. Link the existing confirmed gig instead.';end if;
 select id into v_id from venues where lower(trim(name))=lower(trim(p->>'venue_name')) and lower(trim(coalesce(city,'')))=lower(trim(p->>'city')) limit 1;
 if v_id is null then insert into venues(name,city,type,status,source) values(trim(p->>'venue_name'),trim(p->>'city'),'event_series','active','booking-acquisition') returning id into v_id;end if;
 insert into gigs(id,venue_id,opportunity_id,date,fee,set_length,booking_status,is_public) values(gid,v_id,o.id,performance,amount,nullif(trim(p->>'set_length'),''),'confirmed',false);
 insert into booking_campaign_attribution(gig_id,campaign_id,opportunity_id,confirmed_on,confirmation_reference,recorded_by) values(gid,(p->>'campaign_id')::uuid,o.id,confirmed,trim(p->>'confirmation_reference'),actor);
 update opportunities set pipeline_stage='Qualified',follow_up_date=null,next_step='Prepare the confirmed gig and coordinate the team.',updated_at=now() where id=o.id;
 update booking_lead_research set version=version+1,updated_at=now() where opportunity_id=o.id;
 insert into crm_audit(actor,action,entity_id,details) values(actor::text,'booking_confirmed_recorded',gid::text,jsonb_build_object('opportunity_id',o.id,'campaign_id',p->>'campaign_id'));
 return jsonb_build_object('id',gid);
end $$;
revoke all on function public.booking_record_confirmed(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.booking_record_confirmed(jsonb,uuid) to service_role;
