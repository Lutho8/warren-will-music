(() => {
 'use strict';
 const BASE='https://tqwaepvdsvyyfgtlurkm.supabase.co',API=BASE+'/functions/v1/freelancer-invoices';
 const PUBLIC_KEY='sb_publishable_qMkHF94cXQxAgoOBsONR3A_acb9DL7q',STORE='ww-personal-session';
 const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={submitted:'Needs review',approved:'Approved for payment',paid:'Paid',rejected:'Correction requested'};
 const money=n=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(Number(n)/100);
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
 const date=s=>s?new Date(s.length===10?s+'T12:00:00Z':s).toLocaleDateString('en-GB',{timeZone:'Europe/Berlin'}):'';
 const amount=s=>{if(!/^\d{1,7}([.,]\d{1,2})?$/.test(String(s)))throw new Error('Enter a valid total with at most two decimal places.');const [whole,decimal='']=String(s).replace(',','.').split('.');const n=Number(whole)*100+Number(decimal.padEnd(2,'0'));if(n<1||n>100000000)throw new Error('Check the invoice total.');return n;};
 const csvCell=s=>{let value=String(s??'');if(/^[\s]*[=+\-@]/.test(value)||/^[\t\r\n]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};
 const visible=(invoices,filter,query,profiles)=>invoices.filter(i=>(filter==='all'||(filter==='unpaid'?['submitted','approved'].includes(i.status):i.status===filter))&&[i.invoice_number,i.description,profiles.find(p=>p.id===i.freelancer_id)?.display_name].some(s=>String(s||'').toLowerCase().includes(query.toLowerCase())));
 window.WWInvoiceUtils={amount,csvCell,visible};
 let data,session,sharedKey='',saveAction=null,busy=false,timer;
 try{session=JSON.parse(sessionStorage.getItem(STORE)||'null');if(localStorage.getItem('wwAdminRole')==='team')sharedKey=localStorage.getItem('wwAdminKey')||'';}catch{session=null;}
 async function authHeaders(){
  if(session?.access_token){
   if(Date.now()>(session.expires_at||0)*1000-60000){const r=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!r.ok){session=null;sessionStorage.removeItem(STORE);throw new Error('Your session has expired. Please sign in again.');}session=await r.json();sessionStorage.setItem(STORE,JSON.stringify(session));}
   return {Authorization:'Bearer '+session.access_token};
  }
  return {'x-admin-key':sharedKey};
 }
 async function api(body){if(!navigator.onLine)throw new Error('You are offline. Reconnect before saving.');const multipart=body instanceof FormData;const r=await fetch(API,{method:'POST',headers:{...await authHeaders(),...(multipart?{}:{'Content-Type':'application/json'})},body:multipart?body:JSON.stringify(body),cache:'no-store'});const out=await r.json().catch(()=>({ok:false,error:'The invoice service did not respond. Refresh to check your records.'}));if(!r.ok||!out.ok){if(r.status===401){session=null;sessionStorage.removeItem(STORE);sharedKey='';showLogin();}throw new Error(out.error||'Request failed.');}return out;}
 function toast(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('notice').hidden=true,5000);}
 function showLogin(){$('login').hidden=false;$('workspace').hidden=true;$('sessionActions').hidden=true;data=null;$('invoiceList').innerHTML='';$('profileList').innerHTML='';}
 async function load(){const fresh=await api({action:'dashboard'});data=fresh;$('login').hidden=true;$('workspace').hidden=false;$('sessionActions').hidden=false;$('loginError').textContent='';$('loadError').textContent='';$('accessLabel').textContent=data.role==='team'?'Management':data.profile.display_name;render();}
 const current=()=>visible(data.invoices,$('statusFilter').value,$('search').value,data.profiles);
 function render(){
  const team=data.role==='team';$('heading').textContent=team?'Freelancer invoices':'Your invoices';$('intro').textContent=team?'Review invoices, prepare transfers and record completed payments.':'Upload your PDF and bank details. Follow the status of each invoice.';
  for(const id of ['addFreelancer','export','freelancers'])$(id).hidden=!team;
  $('newInvoice').disabled=team&&!data.profiles.some(p=>p.active);$('limitNotice').hidden=!data.limited;
  const total=statuses=>data.invoices.filter(i=>statuses.includes(i.status)).reduce((sum,i)=>sum+Number(i.amount_cents),0);
  const overdue=data.invoices.filter(i=>['submitted','approved'].includes(i.status)&&i.due_date<today()).reduce((sum,i)=>sum+Number(i.amount_cents),0);
  $('totals').innerHTML=[['Needs review',total(['submitted'])],['Ready for payment',total(['approved'])],['Overdue',overdue],['Paid',total(['paid'])]].map(([name,n])=>`<div class="total"><span>${E(name)}</span><strong>${money(n)}</strong></div>`).join('');
  renderList();$('updated').textContent='Updated '+date(data.generated_at)+' · EUR invoice totals';
  if(team)$('profileList').innerHTML=data.profiles.length?data.profiles.map(p=>`<div class="profile"><div><strong>${E(p.display_name)}</strong><span>${E(p.email)} · ${p.active?'Active':'Access disabled'}</span></div><button type="button" data-action="profile" data-id="${E(p.id)}">${p.active?'Disable access':'Enable access'}</button></div>`).join(''):'<p class="empty">Add a freelancer to start collecting invoices.</p>';
 }
 function renderList(){
  const team=data.role==='team',list=current();
  $('invoiceList').innerHTML=list.length?list.map(i=>{
   const person=data.profiles.find(p=>p.id===i.freelancer_id),late=['submitted','approved'].includes(i.status)&&i.due_date<today();
   return `<article class="invoice"><div class="invoice-title"><div><h2>${E(i.invoice_number)} · ${E(person?.display_name||'Freelancer')}</h2><p><span class="badge ${E(i.status)}">${E(labels[i.status]||i.status)}</span></p></div><span class="amount">${money(i.amount_cents)}</span></div><p>${E(i.description)}</p><p class="metadata">Issued ${date(i.issue_date)} · <span class="${late?'overdue':''}">${late?'Overdue · ':''}Due ${date(i.due_date)}</span></p><div class="bank"><span>Payee: ${E(i.payee_name)}</span><code>${E(i.iban)}</code><button type="button" data-action="copy" data-id="${E(i.id)}">Copy IBAN</button></div>${i.review_note?`<p>${E(i.review_note)}</p>`:''}${i.status==='paid'?`<p class="metadata">Paid ${date(i.paid_at)} · Bank reference: ${E(i.payment_reference)}</p>`:''}${i.replaces_id?'<p class="metadata">Corrected submission. The previous invoice is retained.</p>':''}<div class="actions"><button type="button" data-action="pdf" data-id="${E(i.id)}">Download PDF</button><button type="button" data-action="history" data-id="${E(i.id)}">History</button>${team&&i.status==='submitted'?`<button type="button" data-action="approved" data-id="${E(i.id)}">Approve</button>`:''}${team&&i.status==='approved'?`<button type="button" class="primary" data-action="paid" data-id="${E(i.id)}">Record payment</button>`:''}${team&&['submitted','approved'].includes(i.status)?`<button type="button" data-action="rejected" data-id="${E(i.id)}">Request correction</button>`:''}${i.status==='rejected'?`<button type="button" data-action="correct" data-id="${E(i.id)}">Upload corrected invoice</button>`:''}</div></article>`;
  }).join(''):'<p class="empty">No invoices in this view.</p>';
 }
 function open(title,fields,action,saveLabel='Save'){
  if(busy)return;$('recordForm').reset();$('dialogTitle').textContent=title;$('formFields').innerHTML=fields;$('formError').textContent='';$('saveRecord').textContent=saveLabel;$('saveRecord').hidden=!action;$('saveRecord').disabled=false;saveAction=action;$('formDialog').showModal();
 }
 const field=(name,label,type='text',value='',extra='')=>`<label>${E(label)}<input name="${E(name)}" type="${type}" value="${E(value)}" ${extra} required></label>`;
 function upload(previous){
  const id=crypto.randomUUID(),team=data.role==='team';
  const choice=team?`<label>Freelancer<select name="freelancer_id" required><option value="">Choose a freelancer</option>${data.profiles.filter(p=>p.active).map(p=>`<option value="${E(p.id)}" ${previous?.freelancer_id===p.id?'selected':''}>${E(p.display_name)}</option>`).join('')}</select></label>`:'';
  open(previous?'Upload corrected invoice':'Upload invoice',choice+field('invoice_number','Invoice number','text',previous?.invoice_number||'','maxlength="120"')+`<label>Work / service description<textarea name="description" maxlength="1000" required>${E(previous?.description||'')}</textarea></label>`+'<div class="field-grid">'+field('amount','Invoice total · EUR','text',previous?String(previous.amount_cents/100):'','inputmode="decimal" placeholder="350.00"')+field('issue_date','Invoice date','date',previous?.issue_date||today())+field('due_date','Payment due','date',previous?.due_date||today())+'</div>'+field('payee_name','Bank account holder','text',previous?.payee_name||'','maxlength="200"')+field('iban','IBAN','text',previous?.iban||'','maxlength="42" autocomplete="off" spellcheck="false"')+'<label>Invoice PDF<input name="pdf" type="file" accept="application/pdf,.pdf" required><small>Maximum 5 MB. Bank details must match the invoice.</small></label>',async f=>{
   const pdf=f.get('pdf');if(!pdf||pdf.size>5242880||pdf.size===0)throw new Error('Choose a PDF of at most 5 MB.');
   const form=new FormData();form.set('metadata',JSON.stringify({action:'upload_invoice',id,freelancer_id:f.get('freelancer_id'),invoice_number:f.get('invoice_number'),description:f.get('description'),amount_cents:amount(f.get('amount')),issue_date:f.get('issue_date'),due_date:f.get('due_date'),payee_name:f.get('payee_name'),iban:f.get('iban')}));form.set('pdf',pdf);await api(form);
  },'Submit invoice');
 }
 function review(inv,status){
  const summary=`<div class="confirmation"><strong>${E(inv.invoice_number)} · ${money(inv.amount_cents)}</strong>${E(inv.payee_name)}<br><code>${E(inv.iban)}</code></div><br>`;
  let fields=summary;if(status==='paid')fields+='<p>This records a transfer you have already completed in your bank.</p>'+field('paid_at','Actual payment date','date',today(),`max="${today()}"`)+field('payment_reference','Bank transaction reference','text','','maxlength="200"');
  else if(status==='approved')fields+='<p>Check the PDF, work delivered, invoice total and bank account before approving.</p>';
  fields+=`<label>${status==='rejected'?'Correction needed':'Review note (optional)'}<textarea name="note" maxlength="2000" ${status==='rejected'?'required':''}></textarea></label>`;
  open(labels[status],fields,f=>api({action:'review_invoice',id:inv.id,version:inv.version,status,note:f.get('note'),paid_at:f.get('paid_at'),payment_reference:f.get('payment_reference')}),status==='paid'?'Confirm recorded payment':status==='approved'?'Approve invoice':'Request correction');
 }
 async function click(e){
  const btn=e.target.closest('[data-action]');if(!btn||busy||!data)return;const action=btn.dataset.action,id=btn.dataset.id,inv=data.invoices.find(i=>i.id===id);
  if(['approved','rejected','paid'].includes(action)){review(inv,action);return;}if(action==='correct'){upload(inv);return;}
  btn.disabled=true;
  // Open while still in the click event, then fill it after authenticated lookup.
  const popup=action==='pdf'?window.open('about:blank','_blank'):null;if(popup)popup.opener=null;
  try{
   if(action==='copy'){await navigator.clipboard.writeText(inv.iban);toast('IBAN copied.');}
   if(action==='pdf'){const out=await api({action:'invoice_pdf',id});const url=new URL(out.url);if(url.protocol!=='https:'||url.hostname!=='tqwaepvdsvyyfgtlurkm.supabase.co')throw new Error('The download link could not be verified.');if(!popup)throw new Error('Allow a new browser tab to download the invoice.');popup.location.replace(url.href);}
   if(action==='history'){const out=await api({action:'invoice_history',id});open('Invoice history',out.events.map(event=>`<p><strong>${E(labels[event.to_status]||event.to_status)}</strong> · ${date(event.created_at)}${event.note?'<br>'+E(event.note):''}</p>`).join(''),null);}
   if(action==='profile'){const person=data.profiles.find(p=>p.id===id);open(person.active?'Disable freelancer access':'Enable freelancer access',`<p>${E(person.display_name)} · ${E(person.email)}</p><p>${person.active?'This person will no longer be able to view or upload invoices. Existing records are retained.':'This email will be able to access its own invoices after personal sign-in.'}</p>`,()=>api({action:'profile_active',id,active:!person.active}));}
  }catch(error){if(popup)popup.close();toast(error.message);}finally{btn.disabled=false;}
 }
 async function login(e,personal){e.preventDefault();const form=e.target,btn=form.querySelector('button');btn.disabled=true;$('loginError').textContent='';try{const f=new FormData(form);if(personal){const r=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});form.elements.password.value='';if(!r.ok)throw new Error('Sign-in failed. Check your credentials and account verification.');session=await r.json();sessionStorage.setItem(STORE,JSON.stringify(session));sharedKey='';}else{sharedKey=String(f.get('passphrase')).trim();form.elements.passphrase.value='';session=null;sessionStorage.removeItem(STORE);}await load();}catch(error){$('loginError').textContent=error.message;}finally{btn.disabled=false;}}
 // Unit-test helpers can be loaded without initializing a document.
 if(typeof document==='undefined')return;
 $('personalLogin').addEventListener('submit',e=>login(e,true));$('managementLogin').addEventListener('submit',e=>login(e,false));
 $('refresh').addEventListener('click',async()=>{try{await load();}catch(e){$('loadError').textContent=e.message;}});
 $('logout').addEventListener('click',async()=>{try{if(session)await fetch(BASE+'/auth/v1/logout',{method:'POST',headers:{apikey:PUBLIC_KEY,...await authHeaders()}});}finally{session=null;sharedKey='';sessionStorage.removeItem(STORE);localStorage.removeItem('wwAdminKey');localStorage.removeItem('wwAdminRole');$('recordForm').reset();$('formFields').innerHTML='';if($('formDialog').open)$('formDialog').close();showLogin();}});
 $('search').addEventListener('input',()=>data&&renderList());$('statusFilter').addEventListener('change',()=>data&&renderList());$('invoiceList').addEventListener('click',click);$('profileList').addEventListener('click',click);
 $('newInvoice').addEventListener('click',()=>upload());$('addFreelancer').addEventListener('click',()=>open('Add freelancer',field('display_name','Name','text','','maxlength="120"')+field('email','Personal sign-in email','email','','maxlength="254"')+'<p class="hint">Use the email of an existing, verified personal account.</p>',f=>api({action:'save_profile',display_name:f.get('display_name'),email:f.get('email')})));
 const close=()=>{if(busy)return;$('formDialog').close();$('recordForm').reset();$('formFields').innerHTML='';saveAction=null;};$('closeDialog').addEventListener('click',close);$('cancelDialog').addEventListener('click',close);$('formDialog').addEventListener('cancel',e=>{e.preventDefault();close();});
 $('recordForm').addEventListener('submit',async e=>{e.preventDefault();if(busy||!saveAction)return;busy=true;for(const id of ['saveRecord','closeDialog','cancelDialog'])$(id).disabled=true;$('formError').textContent='';let saved=false;try{await saveAction(new FormData(e.target));saved=true;toast('Saved.');}catch(error){$('formError').textContent=error.message;}finally{busy=false;for(const id of ['saveRecord','closeDialog','cancelDialog'])$(id).disabled=false;}if(saved){close();try{await load();}catch(error){$('loadError').textContent='Saved, but refresh failed. '+error.message;}}});
 $('export').addEventListener('click',()=>{if(data?.role!=='team')return;const rows=[['Freelancer','Invoice number','Total EUR','Due date','Status','Account holder','IBAN','Payment date','Bank reference'],...current().map(i=>[data.profiles.find(p=>p.id===i.freelancer_id)?.display_name,i.invoice_number,(i.amount_cents/100).toFixed(2),i.due_date,labels[i.status],i.payee_name,i.iban,i.paid_at,i.payment_reference])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='freelancer-invoices-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 if(session?.access_token||sharedKey)load().catch(error=>{$('loginError').textContent=error.message;});
})();
