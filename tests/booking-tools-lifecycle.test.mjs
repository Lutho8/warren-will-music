import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const code=fs.readFileSync(new URL('../booking-tools.js',import.meta.url),'utf8');
function ui(fetch,experience){const listeners={},dialog={open:false,innerHTML:'',shows:0,addEventListener:(event,fn)=>listeners[event]=fn,showModal(){this.open=true;this.shows++;},close(){this.open=false;},querySelector:()=>({textContent:''})};const ctx={window:{artistAuthHeaders:()=>({}),WWExperience:experience},document:{createElement:()=>dialog,body:{append(){}}},fetch,crypto:{randomUUID},console};vm.createContext(ctx);vm.runInContext(code,ctx);return {dialog,listeners,tools:ctx.window.WWBookingTools};}
const response=body=>({ok:true,json:async()=>({ok:true,...body})});
test('Leaving the workspace cancels late tool responses and does not reopen private dialogs',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);let first=true;
 const app=ui(async(_url,options)=>{if(first){first=false;return pending;}return response(JSON.parse(options.body).action==='list'?{assets:[]}:{configured:false});});
 const opening=app.tools.media({leads:[]});app.tools.hide();resolve(response({assets:[]}));await assert.rejects(opening,/Workspace changed/);assert.equal(app.dialog.open,false);assert.equal(app.dialog.shows,0);assert.equal(app.dialog.innerHTML,'');
 await app.tools.media({leads:[]});assert.equal(app.dialog.open,true);assert.equal(app.dialog.shows,1);app.tools.hide();assert.equal(app.dialog.innerHTML,'');
});
test('Unsaved outreach blocks closing and Save-and-continue persists the current text',async()=>{
 let choose='stay',checks=0,saved;const lead={opportunity_id:randomUUID(),company:'Fictional venue',enrichment:{email_subject:'Old subject',email_draft:'Old draft'}};
 const experience={formValue:()=>'',leave:async options=>{assert.equal(options.dirty,true);checks++;if(choose==='save'){await options.save();return true;}return false;}};
 const app=ui(async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('booking-acquisition')){saved=body;lead.enrichment=body.enrichment;return response({});}return response(body.action==='list'?{assets:[]}:{configured:false});},experience);
 await app.tools.compose(lead,{leads:[lead],refresh:async()=>lead});const original=app.dialog.querySelector;app.dialog.querySelector=selector=>selector==='[data-form=compose]'?{elements:{subject:{value:'New subject'},body:{value:'New current draft'}},querySelectorAll:()=>[]}:original(selector);
 assert.equal(app.tools.hasUnsaved(),true);await app.listeners.click({target:{closest:()=>({dataset:{bt:'close'}})}});assert.equal(app.dialog.open,true);assert.equal(checks,1);choose='save';await app.listeners.click({target:{closest:()=>({dataset:{bt:'close'}})}});assert.equal(saved.enrichment.email_draft,'New current draft');assert.equal(app.dialog.open,false);
});
test('Draft attachment selections survive save, close and reopening',async()=>{
 const attachment=randomUUID(),lead={opportunity_id:randomUUID(),company:'Fictional venue',email:'booker@example.test',verification_status:'verified',version:4,enrichment:{email_subject:'Subject',email_draft:'Draft text',draft_attachment_ids:[attachment]}};
 let saved;const app=ui(async(url,options)=>{const b=JSON.parse(options.body);if(url.endsWith('booking-acquisition')){saved=b;lead.enrichment=b.enrichment;return response({});}return response(b.action==='list'?{assets:[{id:attachment,title:'Press kit',kind:'file',status:'ready',size_bytes:12}]}:{configured:false});});
 const context={leads:[lead],refresh:async()=>lead};await app.tools.compose(lead,context);assert.match(app.dialog.innerHTML,new RegExp(`value="${attachment}" checked`));
 const original=app.dialog.querySelector;app.dialog.querySelector=selector=>selector==='[data-form=compose]'?{elements:{subject:{value:'Updated subject'},body:{value:'Updated draft'}},querySelectorAll:()=>[{value:attachment}]}:original(selector);
 await app.listeners.click({target:{closest:()=>({dataset:{bt:'save_draft'}})}});assert.equal(saved.enrichment.email_draft,'Updated draft');assert.equal(saved.enrichment.draft_attachment_ids[0],attachment);app.tools.hide();await app.tools.compose(lead,context);assert.match(app.dialog.innerHTML,new RegExp(`value="${attachment}" checked`));assert.match(app.dialog.innerHTML,/Updated draft/);
});
