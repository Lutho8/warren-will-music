import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL rental lifecycle, optimistic versions, stock and private evidence',async()=>{
 const db=new PGlite();
 try{
  // Only rental dependencies: the original, deployed rental SQL is executed unchanged.
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create table contacts(id uuid primary key);
   create table invoices(id uuid primary key,equipment_booking_id uuid);
   create table crm_audit(id bigint generated always as identity primary key,actor text,action text,entity_id text,details jsonb default '{}');`);
  const base=fs.readFileSync(new URL('../supabase/migrations/20260911064333_mobile_artist_workflows.sql',import.meta.url),'utf8');
  await db.exec(base.slice(base.indexOf('create table if not exists public.equipment_inventory'),base.indexOf('alter table public.invoices')));
  await db.exec(base.slice(base.indexOf('create or replace function public.save_equipment_booking'),base.indexOf('create or replace function public.save_artist_content')));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260912091825_mobile_equipment_handover.sql',import.meta.url),'utf8'));
  const call=async p=>(await db.query('select public.save_equipment_workflow($1::jsonb,$2) as rental',[JSON.stringify(p),'test:artist'])).rows[0].rental;
  const p={id:crypto.randomUUID(),version:0,customer_name:'Isolated test',offer_code:'club',status:'draft',starts_at:'2027-01-01T12:00:00Z',ends_at:'2027-01-02T12:00:00Z',payment_status:'open',deposit_cents:20000,deposit_status:'open',rental_details:{logistics:'Abholung',accessories:'Cases und Kabel'}};
  await assert.rejects(call({...p,status:'collected'}),/zuerst als Anfrage/);
  const draft=await call(p);assert.equal(draft.version,1);assert.equal(draft.total_cents,21500);
  await assert.rejects(call({...p,status:'reserved',version:1}),/Mietzahlung/);
  const reserve={...p,version:1,status:'reserved',payment_status:'paid',deposit_status:'received',rental_details:{...p.rental_details,agreement_confirmed:true}};
  await assert.rejects(call(reserve),/Bestand/);
  await db.exec('update equipment_inventory set quantity=2');
  const reserved=await call(reserve);assert.ok(reserved.rental_details.agreement_accepted_at);
  await assert.rejects(call(reserve),/inzwischen geändert/);
  const other={...p,id:crypto.randomUUID()};await call(other);
  await assert.rejects(call({...reserve,id:other.id}),/Bestand/);
  const evidence={serials:'CDJ-A, CDJ-B, V10-A',condition:'Vollständig geprüft',photos:['https://example.com/private/photo'],confirmed:true,at:'2000-01-01'};
  await assert.rejects(call({...reserve,version:2,status:'collected'}),/Seriennummern/);
  const collected=await call({...reserve,version:2,status:'collected',rental_details:{...reserve.rental_details,handover:evidence}});
  assert.notEqual(collected.rental_details.handover.at,'2000-01-01');assert.equal(collected.rental_details.handover.actor,'test:artist');
  await assert.rejects(call({...collected,version:3,status:'cancelled'}),/Ungültiger Übergang/);
  await assert.rejects(call({...collected,version:3,status:'returned',rental_details:{...collected.rental_details,return:{...evidence,photos:['http://example.com/photo']}}}),/HTTPS/);
  const returned=await call({...collected,version:3,status:'returned',rental_details:{...collected.rental_details,return:evidence}});
  await assert.rejects(call({...returned,deposit_status:'returned',rental_details:{...returned.rental_details,refund_confirmed:true,deduction_cents:1000}}),/Beleg und Grund/);
  const refunded=await call({...returned,deposit_status:'returned',rental_details:{...returned.rental_details,refund_confirmed:true,deduction_cents:1000,deduction_reason:'Reinigungsbeleg',handover:{serials:'tampered'}}});
  assert.equal(refunded.rental_details.refund_cents,19000);assert.equal(refunded.rental_details.handover.serials,evidence.serials);
  const acl=await db.query("select has_function_privilege('anon','public.save_equipment_workflow(jsonb,text)','execute') as anon,has_function_privilege('authenticated','public.save_equipment_workflow(jsonb,text)','execute') as authenticated");
  assert.equal(acl.rows[0].anon,false);assert.equal(acl.rows[0].authenticated,false);
 }finally{await db.close();}
});
