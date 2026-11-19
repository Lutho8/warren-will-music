import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../booking-acquisition.js',import.meta.url),'utf8'),id=randomUUID(),reference=randomUUID();
function app(){
 const events={},dialogEvents={},submit={disabled:true},preview={textContent:'',innerHTML:''},error={textContent:'',scrollIntoView(){}},file={files:[]},form={items:[],elements:{matched_gig_id:{value:reference},category:{value:'venue'}},querySelector:()=>submit};
 const dialog={open:false,innerHTML:'',addEventListener:(k,fn)=>dialogEvents[k]=fn,showModal(){this.open=true;},close(){this.open=false;},querySelector:s=>s==='form'?form:s==='[name=file]'?file:s==='[data-ba-preview]'?preview:error};
 const root={hidden:false,innerHTML:'',addEventListener:(k,fn)=>events[k]=fn,querySelector:()=>({innerHTML:'',textContent:''})},lead={opportunity_id:id,company:'Fictional venue',name:'Team',email:'booking@example.test',category:'venue',verification_status:'needs_review',fit_score:70,enrichment:{contact_source_url:'https://example.test/old'},version:1};
 const requests=[],data={actor:'owner',leads:[lead],campaigns:[],references:[],members:[],gigs:[],confirmed_bookings:0};
 class FormValues{constructor(f){this.items=f.items;}*[Symbol.iterator](){yield* this.items;}has(k){return this.items.some(([n])=>n===k);}getAll(k){return this.items.filter(([n])=>n===k).map(([,v])=>v);}}
 const context={window:{artistAuthHeaders:()=>({}),WWArtistUtils:{parseCSV:text=>text.trim().split('\n').map(row=>row.split(','))}},document:{getElementById:k=>k==='bookingAcquisition'?root:{hidden:false},createElement:()=>dialog,body:{append(){}}},navigator:{onLine:true},location:{hash:''},history:{replaceState(){}},fetch:async(_url,options)=>{const b=JSON.parse(options.body);requests.push(b);return {ok:true,json:async()=>({ok:true,...data,result:{created:1,skipped:0}})};},crypto:{randomUUID},Intl,Date,URL,FormData:FormValues};
 vm.createContext(context);vm.runInContext(source,context);return {window:context.window,root,events,dialog,dialogEvents,form,file,submit,preview,error,requests};
}
const action=ba=>({target:{closest:()=>({dataset:{ba}})}});
const csv=name=>'company,source_url,fit_reason,fit_score\n'+name+',https://example.test/contact,House programme,75';
test('Changed CSV selection invalidates both completed and still-running previews',async()=>{
 const x=app();await x.window.openBookingAcquisition();await x.events.click(action('import'));
 let finish;x.file.files=[{size:100,text:()=>new Promise(r=>finish=r)}];const pending=x.dialogEvents.click(action('preview'));
 x.dialogEvents.change({target:{name:'file',form:x.form}});finish(csv('Old file'));await pending;assert.equal(x.submit.disabled,true);assert.ok(!x.preview.innerHTML.includes('Old file'));
 x.file.files=[{size:100,text:async()=>csv('Current file')}];await x.dialogEvents.click(action('preview'));assert.equal(x.submit.disabled,false);assert.match(x.preview.innerHTML,/Current file/);
 x.dialogEvents.change({target:{name:'category',form:x.form}});assert.equal(x.submit.disabled,true);await x.dialogEvents.submit({preventDefault(){},target:x.form});assert.equal(x.requests.filter(r=>r.action==='import').length,0);assert.match(x.error.textContent,/Preview the CSV first/);
});
test('Saving a changed contact source updates enrichment evidence with the current URL',async()=>{
 const x=app();await x.window.openBookingAcquisition(id,'research');x.form.items=[['category','venue'],['matched_gig_id',reference],['fit_reason','House music programme'],['source_url','https://example.test/current'],['ri_contact_source_url','https://example.test/old'],['fit_score','70']];
 await x.dialogEvents.submit({preventDefault(){},target:x.form});const request=x.requests.find(r=>r.action==='enrichment_save');assert.equal(request.enrichment.contact_source_url,'https://example.test/current');
});
test('Campaign, owner, research and search filters intersect without changing the source leads',()=>{
 const u=app().window.WWBookingUtils,leads=[{opportunity_id:'a',owner_user_id:'me',category:'venue',company:'Bähn club',email:'buyer@example.test',phone:'+49 89 123456',city:'Munich',fit_score:80,enrichment:{booker_status:'confirmed'}},{opportunity_id:'b',owner_user_id:'other',category:'venue',company:'Other club',fit_score:90,enrichment:{booker_status:'confirmed',booker_contact_name:'Named booker'}}],campaigns=[{id:'campaign',targets:['a']}];
 assert.equal(u.selectLeads(leads,{campaign:'campaign',owner:'me',filter:'booker_needed',search:'  BAHN  '},campaigns).length,1);assert.equal(u.selectLeads(leads,{campaign:'campaign',owner:'other'},campaigns).length,0);assert.equal(u.matchesLead(leads[0],'buyer@example.test'),true);assert.equal(u.matchesLead(leads[0],'+4989123456'),true);assert.equal(leads[0].opportunity_id,'a');assert.equal(u.namedBooker(leads[0]),false);assert.equal(u.namedBooker(leads[1]),true);
});
test('Rejected, uninterested, opted-out and already-booked leads leave the due queue',()=>{
 const u=app().window.WWBookingUtils,base={follow_up_date:'2020-01-01',verification_status:'verified'};assert.equal(u.due(base),true);
 for(const change of [{verification_status:'rejected'},{pipeline_stage:'Not interested'},{pipeline_stage:'Do not contact'},{confirmed_gigs:1},{suppressed:true}])assert.equal(u.due({...base,...change}),false);
 assert.equal(u.readiness({...base,pipeline_stage:'Not interested'}).label,'Outreach paused');assert.equal(u.readiness({...base,pipeline_stage:'Replied'}).label,'Reply received');
});
