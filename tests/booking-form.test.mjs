import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const CRM_URL'),html.indexOf('/* ── NEWSLETTER'));
function runtime(response){
  const elements={}; let submit;
  for(const id of ['bookForm','bookFeedback','bookFeedbackText','bookEmailFallback','bookOk','bkName','bkMail','bkType','bkDate','bkCity','bkMsg','bkWebsite']){
    elements[id]={value:'',style:{},hidden:true,focus(){this.focused=true;}};
  }
  Object.assign(elements.bkName,{value:'Test Booker'});
  elements.bkMail.value='booker@example.com'; elements.bkType.value='Club night'; elements.bkMsg.value='A & B\nA second line';
  const button={disabled:false,textContent:'Send Booking Inquiry →'};
  Object.assign(elements.bookForm,{reportValidity:()=>true,querySelector:()=>button,addEventListener:(_,handler)=>submit=handler});
  vm.runInNewContext(source,{document:{getElementById:id=>elements[id]},fetch:response,AbortSignal,encodeURIComponent,Error});
  return {elements,button,submit:()=>submit({target:elements.bookForm,preventDefault(){}})};
}

test('Success requires confirmed provider acceptance',async()=>{
  const r=runtime(async()=>Response.json({ok:true,saved:true,notification:{status:'accepted'}}));
  await r.submit(); assert.equal(r.elements.bookForm.style.display,'none');
  assert.equal(r.elements.bookOk.style.display,'block'); assert.equal(r.elements.bookOk.focused,true);
});
test('Saved inquiry with failed email keeps details and an explicit draft link',async()=>{
  for(const status of ['unavailable','failed']){
    const r=runtime(async()=>Response.json({ok:true,saved:true,notification:{status}})); await r.submit();
    assert.notEqual(r.elements.bookForm.style.display,'none'); assert.equal(r.elements.bookFeedback.hidden,false);
    assert.ok(r.elements.bookFeedbackText.textContent.includes('saved'));
    const link=new URL(r.elements.bookEmailFallback.href);
    assert.equal(link.pathname,'booking@warrenwilliam.de');
    assert.ok(link.searchParams.get('body').includes('A & B\nA second line'));
    assert.equal(r.button.disabled,true); // Avoid duplicate CRM entries.
  }
});
test('HTTP errors, application failures and network failures allow retry without false success',async()=>{
  for(const response of [async()=>Response.json({ok:false},{status:500}),async()=>Response.json({ok:false}),async()=>{throw new Error('offline');}]){
    const r=runtime(response); await r.submit();
    assert.equal(r.button.disabled,false); assert.equal(r.elements.bookFeedback.hidden,false);
    assert.notEqual(r.elements.bookOk.style.display,'block'); assert.equal(r.elements.bkName.value,'Test Booker');
  }
});
test('Legacy CRM-only success is labelled saved, with no claim of email delivery',async()=>{
  const r=runtime(async()=>Response.json({ok:true,kind:'booking'})); await r.submit();
  assert.equal(r.elements.bookFeedback.hidden,false);
  assert.ok(r.elements.bookFeedbackText.textContent.includes('saved'));
  assert.equal(r.button.disabled,true);
  assert.notEqual(r.elements.bookOk.style.display,'block');
});
