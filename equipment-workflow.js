/* Shared, side-effect-free rental form rules. All binding checks also run in SQL. */
(() => {
 'use strict';
 const transitions={draft:['draft','reserved','cancelled'],reserved:['reserved','collected','cancelled','draft'],collected:['collected','returned'],returned:['returned'],cancelled:['cancelled','draft']};
 const labels={draft:'Anfrage / Entwurf',reserved:'Reserviert',collected:'Abgeholt',returned:'Zurückgegeben',cancelled:'Storniert'};
 function quote(offer,start,end){
  const duration=Date.parse(end)-Date.parse(start);
  if(!offer||!Number.isFinite(duration)||duration<=0||duration>365*86400000)return null;
  const days=Math.ceil(duration/86400000);return {days,total_cents:days*offer.price_cents};
 }
 function euros(value){const n=Number(value);if(value===''||!Number.isFinite(n)||n<0||!Number.isSafeInteger(Math.round(n*100)))throw new Error('Gültigen Geldbetrag eingeben.');return Math.round(n*100);}
 function photoLinks(value){const links=String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!links.length||links.length>12||links.some(s=>{try{const u=new URL(s);return u.protocol!=='https:'||!!u.username||!!u.password||s.length>2000;}catch{return true;}}))throw new Error('1 bis 12 HTTPS-Fotolinks eintragen, je Link eine Zeile.');return links;}
 function payload(values,rental){
  const b={...values},details={...(rental.rental_details||{})};
  if(!(transitions[rental.status]||transitions.draft).includes(b.status))throw new Error('Diesen Statuswechsel bitte über den nächsten Mietschritt ausführen.');
  if(!quote({price_cents:1},b.starts_at,b.ends_at))throw new Error('Rückgabe muss nach der Abholung liegen; maximal 365 Tage.');
  b.deposit_cents=euros(b.deposit);b.version=rental.version;b.id=rental.id;
  b.starts_at=new Date(b.starts_at).toISOString();b.ends_at=new Date(b.ends_at).toISOString();
  details.logistics=String(b.logistics||'').trim();details.accessories=String(b.accessories||'').trim();
  if(b.status==='reserved'&&rental.status!=='reserved'){
   if(!b.agreement_confirmed)throw new Error('Annahme des Mietangebots bestätigen.');
   if(b.payment_status!=='paid'||(b.deposit_cents>0&&b.deposit_status!=='received'))throw new Error('Vor Reservierung Mietzahlung und vereinbarte Kaution bestätigen.');
   if(!details.logistics||!details.accessories)throw new Error('Logistik und Zubehör angeben, gegebenenfalls „Kein Zubehör“.');
   details.agreement_confirmed=true;
  }
  const step=b.status==='collected'&&rental.status==='reserved'?'handover':b.status==='returned'&&rental.status==='collected'?'return':null;
  if(step){
   if(!String(b.serials||'').trim()||!String(b.condition||'').trim()||!b.condition_confirmed)throw new Error('Seriennummern, Zustand und gemeinsame Prüfung bestätigen.');
   details[step]={serials:String(b.serials).trim(),condition:String(b.condition).trim(),photos:photoLinks(b.photos),confirmed:true};
  }
  if(b.deposit_status==='returned'&&rental.deposit_status!=='returned'){
   if(b.status!=='returned'||!b.refund_confirmed)throw new Error('Rücknahme und tatsächlich ausgeführte Kautionsrückzahlung bestätigen.');
   details.deduction_cents=euros(b.deduction||'0');details.deduction_reason=String(b.deduction_reason||'').trim();
   if(details.deduction_cents>b.deposit_cents)throw new Error('Abzug darf die Kaution nicht überschreiten.');
   if(details.deduction_cents&&!details.deduction_reason)throw new Error('Kautionsabzug mit Beleg und Grund dokumentieren.');
   details.refund_confirmed=true;
  }
  return {action:'save_rental',id:b.id,version:b.version,customer_name:b.customer_name,contact_id:b.contact_id,offer_code:b.offer_code,starts_at:b.starts_at,ends_at:b.ends_at,status:b.status,deposit_cents:b.deposit_cents,deposit_status:b.deposit_status,payment_status:b.payment_status,notes:b.notes,rental_details:details};
 }
 globalThis.WWEquipment={transitions,labels,quote,payload,photoLinks};
})();
