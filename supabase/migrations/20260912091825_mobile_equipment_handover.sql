begin;
alter table public.equipment_bookings add column if not exists rental_details jsonb not null default '{}';

-- Keep the existing reservation locks, price calculation and invoice guards.
-- The wrapper adds timestamped workflow evidence without changing existing records.
create or replace function public.save_equipment_workflow(p jsonb,actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 old public.equipment_bookings; result jsonb; details jsonb; incoming jsonb;
 st text:=p->>'status'; step text; record jsonb; deduction integer; photo text;
begin
 perform 1 from public.equipment_inventory order by code for update;
 select * into old from public.equipment_bookings where id=(p->>'id')::uuid for update;
 if old.id is null and (st is distinct from 'draft' or (p->>'version')::int is distinct from 0) then
  raise exception 'Neue Vermietung zuerst als Anfrage speichern.';
 end if;
 if old.id is not null and old.version is distinct from (p->>'version')::int then
  raise exception 'Buchung wurde inzwischen geändert. Bitte neu laden.';
 end if;
 incoming:=coalesce(p->'rental_details','{}');
 if jsonb_typeof(incoming) is distinct from 'object' then raise exception 'Mietdetails prüfen.';end if;
 details:=coalesce(old.rental_details,'{}')||jsonb_build_object('logistics',left(coalesce(incoming->>'logistics',''),500),'accessories',left(coalesce(incoming->>'accessories',''),500));
 if st='reserved' then
  if coalesce(trim(details->>'logistics'),'')='' or coalesce(trim(details->>'accessories'),'')='' then raise exception 'Logistik und Zubehör angeben.';end if;
  if p->>'payment_status' is distinct from 'paid' or ((p->>'deposit_cents')::int>0 and p->>'deposit_status' is distinct from 'received') then raise exception 'Mietzahlung und vereinbarte Kaution müssen eingegangen sein.';end if;
  if old.status is distinct from 'reserved' or old.rental_details->>'agreement_accepted_at' is null then
   if incoming->>'agreement_confirmed' is distinct from 'true' then raise exception 'Annahme des Mietangebots bestätigen.';end if;
   details:=details||jsonb_build_object('agreement_accepted_at',now(),'agreement_recorded_by',actor);
  end if;
 end if;
 if st='collected' and old.status='reserved' then step:='handover';end if;
 if st='returned' and old.status='collected' then step:='return';end if;
 if step is not null then
  record:=incoming->step;
  if record->>'confirmed' is distinct from 'true' or coalesce(trim(record->>'serials'),'')='' or coalesce(trim(record->>'condition'),'')='' then raise exception 'Seriennummern, Zustand und gemeinsame Prüfung bestätigen.';end if;
  if length(record->>'serials')>1500 or length(record->>'condition')>2000 then raise exception 'Zustandsprotokoll zu lang.';end if;
  if jsonb_typeof(record->'photos') is distinct from 'array' then raise exception 'Fotolinks fehlen.';end if;
  if jsonb_array_length(record->'photos') not between 1 and 12 then raise exception '1 bis 12 Fotolinks eintragen.';end if;
  for photo in select jsonb_array_elements_text(record->'photos') loop
   if photo !~ '^https://[^/[:space:]@]+(/[^[:space:]]*)?$' or length(photo)>2000 then raise exception 'Gültigen HTTPS-Fotolink eintragen.';end if;
  end loop;
  details:=details||jsonb_build_object(step,jsonb_build_object('at',now(),'actor',actor,'serials',record->>'serials','condition',record->>'condition','photos',record->'photos'));
 end if;
 if old.deposit_status='returned' and (p->>'deposit_status' is distinct from 'returned' or (p->>'deposit_cents')::int is distinct from old.deposit_cents) then raise exception 'Abgerechnete Kaution kann nicht nachträglich geändert werden.';end if;
 if p->>'deposit_status'='returned' and old.deposit_status is distinct from 'returned' then
  if st is distinct from 'returned' or old.deposit_status is distinct from 'received' or incoming->>'refund_confirmed' is distinct from 'true' then raise exception 'Erhaltene Kaution erst nach Rücknahme und bestätigter Rückzahlung abrechnen.';end if;
  deduction:=coalesce((incoming->>'deduction_cents')::integer,0);
  if deduction<0 or deduction>(p->>'deposit_cents')::integer then raise exception 'Ungültiger Kautionsabzug.';end if;
  if deduction>0 and coalesce(trim(incoming->>'deduction_reason'),'')='' then raise exception 'Kautionsabzug mit Beleg und Grund dokumentieren.';end if;
  details:=details||jsonb_build_object('deduction_cents',deduction,'deduction_reason',left(incoming->>'deduction_reason',1500),'refund_cents',(p->>'deposit_cents')::integer-deduction,'refunded_at',now(),'refund_recorded_by',actor);
 end if;
 result:=public.save_equipment_booking(p,actor);
 update public.equipment_bookings set rental_details=details where id=(p->>'id')::uuid;
 insert into public.crm_audit(actor,action,entity_id,details) values(actor,'equipment_workflow',p->>'id',jsonb_build_object('from',old.status,'to',st,'rental_details',details));
 return result||jsonb_build_object('rental_details',details);
end $$;
revoke all on function public.save_equipment_workflow(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_equipment_workflow(jsonb,text) to service_role;
commit;
