begin;
alter table public.contacts add column if not exists follow_up_date date;
alter table public.contacts add column if not exists next_action text;
alter table public.contacts add column if not exists tags text[] not null default '{}';
alter table public.contacts add column if not exists assigned_to text not null default 'warren' check(assigned_to in ('warren','team'));
alter table public.gigs add column if not exists is_public boolean not null default false;
alter table public.gigs add column if not exists booking_status text not null default 'confirmed' check(booking_status in ('draft','confirmed','cancelled'));
-- Only dates already explicitly published by the owner are carried over.
update public.gigs g set is_public=true from public.venues v where g.venue_id=v.id and ((g.date in ('2026-09-11','2026-09-16','2026-09-24') and v.name='Moro Mou') or (g.date='2026-09-18' and v.name='Gaswerk') or (g.date='2026-09-23' and v.name='Herzog'));
create table if not exists public.equipment_inventory (code text primary key,name text not null,quantity integer check(quantity>=0),updated_at timestamptz not null default now());
insert into public.equipment_inventory(code,name) values ('bose','Bose L1 Pro8'),('cdj3000','Pioneer CDJ-3000'),('cdj2000','Pioneer CDJ-2000NXS2'),('v10','Pioneer DJM-V10'),('rx2','Pioneer XDJ-RX2'),('rmx','Pioneer RMX-1000'),('dt770','Beyerdynamic DT 770 Pro'),('hd25','Sennheiser HD 25') on conflict do nothing;
create table if not exists public.equipment_offers(code text primary key,name text not null,price_cents integer not null check(price_cents>0),components jsonb not null);
insert into public.equipment_offers values
('bose','Bose L1 Pro8',12500,'{"bose":1}'),('bose_pair','2× Bose L1 Pro8',22000,'{"bose":2}'),
('cdj3000','Pioneer CDJ-3000',8500,'{"cdj3000":1}'),('cdj2000','Pioneer CDJ-2000NXS2',6500,'{"cdj2000":1}'),('v10','Pioneer DJM-V10',7500,'{"v10":1}'),('rx2','Pioneer XDJ-RX2',6500,'{"rx2":1}'),('rmx','Pioneer RMX-1000',4000,'{"rmx":1}'),('dt770','Beyerdynamic DT 770 Pro',2000,'{"dt770":1}'),('hd25','Sennheiser HD 25',1500,'{"hd25":1}'),
('club','Club-Setup',21500,'{"cdj3000":2,"v10":1}'),('club_plus','Club-Setup Plus',24500,'{"cdj3000":2,"v10":1,"rmx":1}'),('event','Full Event Setup',39500,'{"cdj3000":2,"v10":1,"bose":2}'),('event_plus','Full Event Setup Plus',42000,'{"cdj3000":2,"v10":1,"bose":2,"rmx":1}'),('compact_hd','Kompakt-Setup mit HD 25',7000,'{"rx2":1,"hd25":1}'),('compact_dt','Kompakt-Setup mit DT 770 Pro',7500,'{"rx2":1,"dt770":1}') on conflict(code) do update set price_cents=excluded.price_cents,components=excluded.components,name=excluded.name;
create table if not exists public.equipment_bookings (
 id uuid primary key default gen_random_uuid(),contact_id uuid references public.contacts(id),customer_name text not null check(length(customer_name)>0),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),status text not null check(status in ('draft','reserved','collected','returned','cancelled')),
 offer_code text not null references public.equipment_offers(code),components jsonb not null,total_cents integer not null check(total_cents>=0),
 deposit_cents integer not null default 0 check(deposit_cents>=0),deposit_status text not null default 'open' check(deposit_status in ('open','received','returned')),
 payment_status text not null default 'open' check(payment_status in ('open','partial','paid')),notes text,version integer not null default 1,updated_at timestamptz not null default now(),created_at timestamptz not null default now());
create index if not exists equipment_overlap on public.equipment_bookings(starts_at,ends_at) where status in ('reserved','collected');
alter table public.invoices add column if not exists equipment_booking_id uuid references public.equipment_bookings(id);
create table if not exists public.artist_content(id uuid primary key default gen_random_uuid(),title text not null,caption text not null default '',preview_url text,owner text not null default 'team',version integer not null default 1,approval text not null default 'draft' check(approval in ('draft','waiting','approved','changes')),review_note text,updated_at timestamptz not null default now(),created_at timestamptz not null default now());
create table if not exists public.content_revisions(content_id uuid not null references public.artist_content(id),version integer not null,title text not null,caption text not null,preview_url text,approval text not null,review_note text,reviewed_by text,created_at timestamptz not null default now(),primary key(content_id,version));
create table if not exists public.content_publications(id uuid primary key default gen_random_uuid(),content_id uuid not null,version integer not null,platform text not null check(platform in ('Instagram','TikTok','YouTube','Facebook','Threads','LinkedIn')),status text not null check(status in ('planned','published','failed')),scheduled_at timestamptz,published_at timestamptz,post_url text,note text,verification text not null default 'manual' check(verification in ('manual','api')),updated_at timestamptz not null default now(),foreign key(content_id,version) references public.content_revisions(content_id,version),unique(content_id,version,platform),check(status<>'published' or (post_url is not null and published_at is not null)));
create table if not exists public.artist_metrics(id uuid primary key default gen_random_uuid(),platform text not null,metric text not null,value numeric not null check(value>=0),period_start date not null,period_end date not null check(period_end>=period_start),source_url text not null,note text,recorded_at timestamptz not null default now(),unique(platform,metric,period_start,period_end));
create table if not exists public.crm_audit(id bigint generated always as identity primary key,actor text not null,action text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists public.contact_imports(id uuid primary key default gen_random_uuid(),source text not null,created_count integer not null,skipped_count integer not null,created_at timestamptz not null default now());
create table if not exists public.invoice_delivery(invoice_id uuid primary key references public.invoices(id),state text not null check(state in ('sending','sent','unknown')),recipient text not null,started_at timestamptz not null default now(),provider_id text,dispatch_token uuid not null default gen_random_uuid(),dispatch_started_at timestamptz);
-- All app writes pass through the authenticated Edge Function; no direct public table access.
do $$ declare t text; begin foreach t in array array['equipment_inventory','equipment_offers','equipment_bookings','artist_content','content_revisions','content_publications','artist_metrics','crm_audit','contact_imports','invoice_delivery'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create or replace function public.save_equipment_booking(p jsonb,actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare item record; offer public.equipment_offers; old public.equipment_bookings; result public.equipment_bookings; rid uuid; s timestamptz;e timestamptz;st text;days integer;used integer;begin
 rid:=(p->>'id')::uuid; s:=(p->>'starts_at')::timestamptz;e:=(p->>'ends_at')::timestamptz;st:=p->>'status';
 if e<=s or e-s>interval '365 days' then raise exception 'Ende muss nach Beginn liegen; maximal 365 Tage.';end if;
 -- Stable row lock order serializes reservations, inventory changes and cancellations.
 perform 1 from public.equipment_inventory order by code for update;
 select * into old from public.equipment_bookings where id=rid for update;
 if found and old.version is distinct from (p->>'version')::int then raise exception 'Buchung wurde inzwischen geändert. Bitte neu laden.';end if;
 if old.id is not null and not (
 (old.status='draft' and st in ('draft','reserved','cancelled')) or
 (old.status='reserved' and st in ('draft','reserved','collected','cancelled')) or
 (old.status='collected' and st in ('collected','returned')) or
 (old.status='returned' and st='returned') or
 (old.status='cancelled' and st in ('cancelled','draft'))) then raise exception 'Ungültiger Übergang. Ausgegebenes Equipment zuerst zurücknehmen.';end if;
 if old.status in ('collected','returned') and (old.offer_code is distinct from p->>'offer_code' or old.starts_at is distinct from s) then raise exception 'Ausgegebenes Equipment und Abholbeginn können nicht nachträglich ersetzt werden.';end if;
 select * into strict offer from public.equipment_offers where code=p->>'offer_code';
 if st in ('reserved','collected') then
 for item in select i.code,i.quantity,(c.value)::int as needed from jsonb_each_text(offer.components)c join public.equipment_inventory i on i.code=c.key loop
 if item.quantity is null then raise exception 'Bestand für % muss zuerst bestätigt werden.',item.code;end if;
 select coalesce(sum((b.components->>item.code)::int),0) into used from public.equipment_bookings b where b.status in ('reserved','collected') and b.id<>rid and b.starts_at<e and b.ends_at>s;
 if used+item.needed>item.quantity then raise exception 'Nicht genügend verfügbarer Bestand: %',item.code;end if;end loop;end if;
 days:=greatest(1,ceil(extract(epoch from(e-s))/86400)::integer);
 if old.id is not null and old.total_cents<>days*offer.price_cents and exists(select 1 from public.invoices where equipment_booking_id=rid) then raise exception 'Mietpreisänderung betrifft eine vorhandene Rechnung. Zuerst durch das Management klären.';end if;
 insert into public.equipment_bookings(id,customer_name,contact_id,starts_at,ends_at,status,offer_code,components,total_cents,deposit_cents,deposit_status,payment_status,notes)
 values(rid,p->>'customer_name',nullif(p->>'contact_id','')::uuid,s,e,st,offer.code,offer.components,days*offer.price_cents,coalesce((p->>'deposit_cents')::integer,0),coalesce(p->>'deposit_status','open'),coalesce(p->>'payment_status','open'),p->>'notes')
 on conflict(id) do update set customer_name=excluded.customer_name,contact_id=excluded.contact_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,offer_code=excluded.offer_code,components=excluded.components,total_cents=excluded.total_cents,deposit_cents=excluded.deposit_cents,deposit_status=excluded.deposit_status,payment_status=excluded.payment_status,notes=excluded.notes,version=public.equipment_bookings.version+1,updated_at=now() returning * into result;
 insert into public.crm_audit(actor,action,entity_id) values(actor,'save_equipment_booking',rid::text);return to_jsonb(result);end $$;
create or replace function public.save_artist_content(p jsonb,actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.artist_content; result public.artist_content;rid uuid;begin
 rid:=(p->>'id')::uuid;perform pg_advisory_xact_lock(hashtext(rid::text));select * into old from public.artist_content where id=rid for update;
 if found and old.version is distinct from (p->>'version')::int then raise exception 'Inhalt wurde inzwischen geändert. Bitte neu laden.';end if;
 if p->>'operation'='review' then
 if old.id is null or old.approval<>'waiting' then raise exception 'Diese Version wartet nicht auf Freigabe.';end if;
 if p->>'approval' not in ('approved','changes') then raise exception 'Ungültige Freigabe';end if;
 update public.artist_content set approval=p->>'approval',review_note=p->>'review_note',updated_at=now() where id=rid returning * into result;
 update public.content_revisions set approval=result.approval,review_note=result.review_note,reviewed_by=actor where content_id=rid and version=result.version;
 else
 insert into public.artist_content(id,title,caption,preview_url,approval) values(rid,p->>'title',coalesce(p->>'caption',''),nullif(p->>'preview_url',''),coalesce(p->>'approval','draft'))
 on conflict(id) do update set title=excluded.title,caption=excluded.caption,preview_url=excluded.preview_url,approval=excluded.approval,version=public.artist_content.version+1,review_note=null,updated_at=now() returning * into result;
 insert into public.content_revisions(content_id,version,title,caption,preview_url,approval) values(rid,result.version,result.title,result.caption,result.preview_url,result.approval);end if;
 insert into public.crm_audit(actor,action,entity_id,details) values(actor,'content_'||coalesce(p->>'operation','edit'),rid::text,jsonb_build_object('version',result.version));return to_jsonb(result);end $$;
create or replace function public.save_publication(p jsonb,actor text) returns void language plpgsql security invoker set search_path='' as $$
declare current public.artist_content;begin
 select * into strict current from public.artist_content where id=(p->>'content_id')::uuid for update;
 if current.version<>(p->>'version')::int then raise exception 'Bitte aktuelle Inhaltsversion laden.';end if;
 if p->>'status'='published' and current.approval<>'approved' then raise exception 'Diese Version muss zuerst freigegeben werden.';end if;
 insert into public.content_publications(content_id,version,platform,status,scheduled_at,published_at,post_url,note) values(current.id,current.version,p->>'platform',p->>'status',nullif(p->>'scheduled_at','')::timestamptz,nullif(p->>'published_at','')::timestamptz,nullif(p->>'post_url',''),p->>'note') on conflict(content_id,version,platform) do update set status=excluded.status,scheduled_at=excluded.scheduled_at,published_at=excluded.published_at,post_url=excluded.post_url,note=excluded.note,updated_at=now();
 insert into public.crm_audit(actor,action,entity_id,details) values(actor,'publication',current.id::text,jsonb_build_object('platform',p->>'platform','version',current.version));end $$;
create or replace function public.import_artist_contacts(rows jsonb,source_name text,basis text,actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;em text;ph text;n integer:=0;k integer:=0;begin
 if jsonb_array_length(rows)>50 or basis not in ('impressum_published','consent','legitimate_interest','contract','existing_relationship') then raise exception 'Maximal 50 Zeilen; Datenherkunft und Rechtsgrundlage prüfen.';end if;
 perform pg_advisory_xact_lock(7823445);
 for r in select value from jsonb_array_elements(rows) loop
 em:=nullif(lower(trim(r->>'email')),'');ph:=nullif(regexp_replace(coalesce(r->>'phone_whatsapp',''),'[^0-9]','','g'),'');
 if coalesce(trim(r->>'name'),'')='' or (em is null and ph is null) then raise exception 'Jede Zeile braucht Name und E-Mail oder Telefonnummer.';end if;
 if exists(select 1 from public.contacts c where (em is not null and lower(trim(c.email))=em) or(ph is not null and regexp_replace(c.phone_whatsapp,'[^0-9]','','g')=ph)) then k:=k+1;continue;end if;
 insert into public.contacts(name,email,phone_whatsapp,role,source,lawful_basis,notes,assigned_to) values(left(r->>'name',120),em,r->>'phone_whatsapp','other',left(source_name,200),basis::public.lawful_basis,left(r->>'notes',500),'team');n:=n+1;end loop;
 insert into public.contact_imports(source,created_count,skipped_count) values(source_name,n,k);
 insert into public.crm_audit(actor,action,details) values(actor,'contact_import',jsonb_build_object('created',n,'skipped',k));return jsonb_build_object('created',n,'skipped',k);end $$;
revoke all on function public.save_equipment_booking(jsonb,text),public.save_artist_content(jsonb,text),public.save_publication(jsonb,text),public.import_artist_contacts(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.save_equipment_booking(jsonb,text),public.save_artist_content(jsonb,text),public.save_publication(jsonb,text),public.import_artist_contacts(jsonb,text,text,text) to service_role;
create or replace function public.set_equipment_quantity(item_code text,new_quantity integer,actor text) returns void language plpgsql security invoker set search_path='' as $$
declare peak integer;begin
 perform 1 from public.equipment_inventory order by code for update;
 if not exists(select 1 from public.equipment_inventory where code=item_code) then raise exception 'Gerät nicht gefunden.';end if;
 if new_quantity<0 or new_quantity>1000 then raise exception 'Ungültige Stückzahl';end if;
 select coalesce(max(used),0) into peak from(select sum((b.components->>item_code)::integer) as used from public.equipment_bookings a join public.equipment_bookings b on b.starts_at<=a.starts_at and b.ends_at>a.starts_at where a.status in ('reserved','collected') and b.status in ('reserved','collected') and a.ends_at>now() group by a.starts_at) q;
 if new_quantity<peak then raise exception 'Bestand kann nicht unter bestehende Reservierungen (%) reduziert werden.',peak;end if;
 update public.equipment_inventory set quantity=new_quantity,updated_at=now() where code=item_code;
 insert into public.crm_audit(actor,action,entity_id,details) values(actor,'inventory',item_code,jsonb_build_object('quantity',new_quantity));end $$;
create or replace function public.save_artist_gig(p jsonb,actor text) returns void language plpgsql security invoker set search_path='' as $$
declare gid uuid;vid uuid;vname text;vcity text;begin
 gid:=(p->>'id')::uuid;perform 1 from public.gigs where id=gid for update;if not found then raise exception 'Auftritt nicht gefunden.';end if;
 vname:=left(trim(p->>'venue_name'),120);vcity:=left(trim(p->>'city'),80);if coalesce(vname,'')='' then raise exception 'Venue erforderlich.';end if;
 select id into vid from public.venues where lower(name)=lower(vname) and lower(coalesce(city,''))=lower(coalesce(vcity,'')) limit 1;
 if vid is null then insert into public.venues(name,city,type,status,source) values(vname,vcity,'club','researching','artist-dashboard') returning id into vid;end if;
 update public.gigs set venue_id=vid,date=(p->>'date')::date,fee=nullif(p->>'fee','')::numeric,set_length=left(p->>'set_length',40),deposit_received=(p->>'deposit_received')::boolean,booking_status=p->>'booking_status',is_public=(p->>'is_public')::boolean,updated_at=now() where id=gid;
 insert into public.crm_audit(actor,action,entity_id) values(actor,'save_gig',gid::text);end $$;
create or replace function public.create_rental_invoice(p jsonb,actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.equipment_bookings;i public.invoices;tax text;v integer;num text;begin
 select * into strict r from public.equipment_bookings where id=(p->>'id')::uuid for update;
 if r.status='cancelled' then raise exception 'Stornierte Vermietung kann nicht fakturiert werden.';end if;
 select * into i from public.invoices where equipment_booking_id=r.id and doc_type='invoice' and storno_of is null order by created_at limit 1;
 if found then return to_jsonb(i);end if;
 select default_vat_scheme into tax from public.business_settings where id=true;
 -- Published rental prices carry the owner's no-separate-VAT wording. Require this configured scheme.
 if tax is distinct from 'kleinunternehmer' then raise exception 'Steuerregel für die Mietpreisliste muss zuerst geprüft werden.';end if;
 select public.next_invoice_number() into num;
 insert into public.invoices(invoice_number,doc_type,equipment_booking_id,contact_id,status,vat_scheme,net_cents,vat_cents,gross_cents,issue_date,service_date,due_date,recipient_name,recipient_address,recipient_email,notes)
 values(num,'invoice',r.id,r.contact_id,'draft',tax,r.total_cents,0,r.total_cents,current_date,(r.starts_at at time zone 'Europe/Berlin')::date,current_date+14,p->>'recipient_name',p->>'recipient_address',p->>'recipient_email','Equipment-Miete · Kaution separat') returning * into i;
 insert into public.crm_audit(actor,action,entity_id) values(actor,'create_rental_invoice',i.id::text);return to_jsonb(i);end $$;
revoke all on function public.set_equipment_quantity(text,integer,text),public.save_artist_gig(jsonb,text),public.create_rental_invoice(jsonb,text) from public,anon,authenticated;
grant execute on function public.set_equipment_quantity(text,integer,text),public.save_artist_gig(jsonb,text),public.create_rental_invoice(jsonb,text) to service_role;

commit;
