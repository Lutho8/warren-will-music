begin;
create table public.booking_media(
 id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title)) between 1 and 180),
 kind text not null check(kind in ('link','file')),provider text not null check(provider in ('youtube','soundcloud','file')),
 url text,storage_path text unique,filename text,mime_type text,size_bytes bigint not null default 0 check(size_bytes between 0 and 26214400),
 opportunity_id uuid references public.opportunities(id),status text not null default 'ready' check(status in ('pending','ready','archived')),
 description text not null default '',version integer not null default 1,created_by uuid not null references public.crm_user_roles(user_id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz,
 check((kind='link' and provider in ('youtube','soundcloud') and url like 'https://%' and storage_path is null) or(kind='file' and provider='file' and storage_path is not null and url is null))
);
create table public.booking_mail_messages(
 id uuid primary key,opportunity_id uuid references public.opportunities(id),direction text not null check(direction in ('inbound','outbound')),
 sender text not null,recipient text not null,subject text not null,body_text text not null,
 state text not null check(state in ('sending','sent','received','uncertain','failed')),message_id text,reply_to_message_id text,
 mailbox_key text unique,attachment_ids uuid[] not null default '{}',created_by uuid references public.crm_user_roles(user_id),
 created_at timestamptz not null default now(),error_code text,sent_copy_saved boolean not null default false
);
create index booking_media_opportunity on public.booking_media(opportunity_id,status);
create index booking_mail_opportunity on public.booking_mail_messages(opportunity_id,created_at desc);
alter table public.booking_media enable row level security;
alter table public.booking_mail_messages enable row level security;
revoke all on public.booking_media,public.booking_mail_messages from public,anon,authenticated;
grant all on public.booking_media,public.booking_mail_messages to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('booking-media','booking-media',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','video/mp4','video/webm','video/quicktime','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation']) on conflict(id) do nothing;
create function public.booking_mail_finish(p jsonb,actor uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare o opportunities;c contacts;iid uuid:=(p->>'id')::uuid;stamp timestamptz:=(p->>'created_at')::timestamptz;incoming boolean:=p->>'direction'='inbound';
begin
 if not exists(select 1 from crm_user_roles where user_id=actor and active and role in ('management','artist')) then raise exception 'Booking management access required.';end if;
 select x.* into o from opportunities x join contacts y on y.id=x.contact_id where x.id=(p->>'opportunity_id')::uuid and y.assigned_to='team' for update of x;if o.id is null then raise exception 'Shared prospect required.';end if;
 select * into c from contacts where id=o.contact_id;
 if incoming then
  insert into booking_mail_messages(id,opportunity_id,direction,sender,recipient,subject,body_text,state,message_id,reply_to_message_id,mailbox_key,attachment_ids,created_by,created_at)
   values(iid,o.id,'inbound',c.email,'booking@warrenwilliam.de',left(p->>'subject',300),left(p->>'body_text',30000),'received',p->>'message_id',p->>'reply_to_message_id',p->>'mailbox_key',array(select jsonb_array_elements_text(coalesce(p->'attachment_ids','[]'))::uuid),actor,stamp) on conflict(mailbox_key) do nothing;
  if not found then return jsonb_build_object('duplicate',true);end if;
 else
  update booking_mail_messages set state='sent',message_id=p->>'message_id',sent_copy_saved=coalesce((p->>'sent_copy_saved')::boolean,false),error_code=null where id=iid and opportunity_id=o.id and state='sending';
  if not found then raise exception 'Outgoing email claim missing.';end if;
 end if;
 insert into interactions(id,contact_id,channel,direction,summary,logged_by,created_at) values(iid,c.id,'email',case when incoming then 'inbound'::direction else 'outbound'::direction end,case when incoming then '[reply received] ' else '[email sent] ' end||left(p->>'subject',250),'agent',stamp) on conflict(id) do nothing;
 update opportunities set last_touch=(select max(i.created_at) from interactions i where i.contact_id=c.id and i.channel<>'dashboard'),pipeline_stage=case when do_not_contact or c.opt_out_at is not null or pipeline_stage in ('Do not contact','Not interested','Qualified') then pipeline_stage when incoming then 'Replied' else 'Contacted' end,follow_up_date=case when incoming then null else nullif(p->>'follow_up_date','')::date end,updated_at=now() where id=o.id;
 update booking_lead_research set version=version+1,updated_at=now() where opportunity_id=o.id;
 insert into crm_audit(actor,action,entity_id,details)values(actor::text,case when incoming then 'booking_email_received' else 'booking_email_sent' end,iid::text,jsonb_build_object('opportunity_id',o.id));
 return jsonb_build_object('id',iid);
end $$;
revoke all on function public.booking_mail_finish(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.booking_mail_finish(jsonb,uuid) to service_role;
commit;
