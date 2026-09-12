import test from 'node:test';
import assert from 'node:assert/strict';
import '../equipment-workflow.js';
const {quote,payload,photoLinks}=globalThis.WWEquipment;
const rental={id:'12345678-1234-4234-8234-123456789012',version:2,status:'draft',deposit_status:'open'};
const values={customer_name:'Test',offer_code:'club',starts_at:'2026-09-20T12:00:00Z',ends_at:'2026-09-21T12:00:00Z',deposit:'200',deposit_status:'received',payment_status:'paid',status:'reserved',logistics:'Abholung München',accessories:'3 Cases',agreement_confirmed:'on'};
test('Prices use begun 24-hour periods, including a DST boundary',()=>{
 assert.deepEqual(quote({price_cents:21500},values.starts_at,values.ends_at),{days:1,total_cents:21500});
 assert.equal(quote({price_cents:21500},values.starts_at,'2026-09-21T12:00:01Z').total_cents,43000);
 assert.equal(quote({price_cents:100},'2026-10-24T12:00:00+02:00','2026-10-25T12:00:00+01:00').days,2);
 assert.equal(quote({price_cents:100},values.starts_at,values.starts_at),null);
});
test('Reservation requires agreement, payments, logistics and accessories',()=>{
 for(const change of [{agreement_confirmed:''},{payment_status:'open'},{deposit_status:'open'},{logistics:''},{accessories:''}])assert.throws(()=>payload({...values,...change},rental));
 const out=payload(values,rental);assert.equal(out.deposit_cents,20000);assert.equal(out.version,2);assert.equal(out.rental_details.agreement_confirmed,true);
});
test('Workflow does not skip collection or invent a record timestamp',()=>{
 assert.throws(()=>payload({...values,status:'returned'},rental));
 const out=payload({...values,status:'collected',serials:'CDJ-1, CDJ-2, V10-1',condition:'Vollständig und funktionsfähig',photos:'https://example.com/protected-photo',condition_confirmed:'on'},{...rental,status:'reserved'});
 assert.equal(out.rental_details.handover.serials,'CDJ-1, CDJ-2, V10-1');assert.equal(out.rental_details.handover.at,undefined);
});
test('Photo evidence accepts only HTTPS without embedded credentials',()=>{
 for(const url of ['','javascript:alert(1)','http://example.com/image','https://user:secret@example.com/photo'])assert.throws(()=>photoLinks(url));
 assert.deepEqual(photoLinks('https://example.com/1\nhttps://example.com/2'),['https://example.com/1','https://example.com/2']);
});
test('Refund requires actual confirmation and explained bounded deductions',()=>{
 const r={...rental,status:'returned',deposit_status:'received'};
 const v={...values,status:'returned',deposit_status:'returned',refund_confirmed:'on',deduction:'25',deduction_reason:'Reinigung: Beleg 123'};
 assert.equal(payload(v,r).rental_details.deduction_cents,2500);
 for(const change of [{refund_confirmed:''},{deduction:'201'},{deduction_reason:''},{deduction:'NaN'}])assert.throws(()=>payload({...v,...change},r));
});
