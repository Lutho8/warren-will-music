import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const code=fs.readFileSync(new URL('../booking-tools.js',import.meta.url),'utf8');
function ui(fetch,experience){const listeners={},dialog={open:false,innerHTML:'',shows:0,addEventListener:(event,fn)=>listeners[event]=fn,showModal(){this.open=true;this.shows++;},close(){this.open=false;},querySelector:()=>({textContent:''})};const ctx={window:{artistAuthHeaders:()=>({}),WWExperience:experience},document:{createElement:()=>dialog,body:{append(){}}},fetch,URL,crypto:{randomUUID},console};vm.createContext(ctx);vm.runInContext(code,ctx);return {dialog,listeners,tools:ctx.window.WWBookingTools};}
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
test('Typing while a draft save is in flight keeps newer text marked unsaved',async()=>{
 let finish,saved;const saving=new Promise(r=>finish=r),lead={opportunity_id:randomUUID(),company:'Fictional club',version:2,enrichment:{email_subject:'Subject',email_draft:'Original'}};
 const app=ui(async(url,options)=>{const b=JSON.parse(options.body);if(url.endsWith('booking-acquisition')){saved=b;await saving;lead.enrichment=b.enrichment;return response({});}return response(b.action==='list'?{assets:[]}:{configured:false});});
 await app.tools.compose(lead,{leads:[lead],refresh:async()=>lead});
 const form={elements:{subject:{value:'Subject'},body:{value:'First edit'}},querySelectorAll:()=>[]};
 app.dialog.querySelector=s=>s==='[data-form=compose]'?form:s==='.bt-message'?{textContent:''}:null;
 const pending=app.listeners.click({target:{closest:()=>({dataset:{bt:'save_draft'}})}});
 form.elements.body.value='A newer edit during the request';app.listeners.input({target:{name:'body'}});finish();await pending;
 assert.equal(saved.enrichment.email_draft,'First edit');assert.equal(app.tools.hasUnsaved(),true);assert.match(app.dialog.innerHTML,/A newer edit during the request/);assert.match(app.dialog.innerHTML,/Unsaved changes/);
});
test('A connected mailbox cannot enable Send without a valid lead email',async()=>{
 const lead={opportunity_id:randomUUID(),company:'Phone-only club',verification_status:'verified',enrichment:{email_permission:'invited',permission_note:'Documented submission invitation',email_subject:'Subject',email_draft:'Draft'}};
 const app=ui(async(_url,options)=>response(JSON.parse(options.body).action==='list'?{assets:[]}:{configured:true}));await app.tools.compose(lead,{leads:[lead]});assert.match(app.dialog.innerHTML,/data-bt="send"[^>]*disabled/);
});
test('The media library remains available when the mailbox service is unavailable',async()=>{const calls=[];const app=ui(async(url)=>{calls.push(url);if(url.endsWith('booking-mail'))throw Error('Mailbox unavailable');return response({assets:[]});});await app.tools.media({leads:[]});assert.equal(app.dialog.open,true);assert.match(app.dialog.innerHTML,/Booking media/);assert.equal(calls.length,1);});
test('YouTube Shorts, live video, short links and playlists have usable preview URLs',()=>{const player=ui(async()=>response({})).tools.utils.playerURL;for(const url of ['https://www.youtube.com/shorts/abcdefghijk','https://www.youtube.com/live/abcdefghijk','https://youtu.be/abcdefghijk?t=20','https://www.youtube.com/watch?v=abcdefghijk'])assert.equal(player({provider:'youtube',url}),'https://www.youtube-nocookie.com/embed/abcdefghijk');assert.match(player({provider:'youtube',url:'https://www.youtube.com/playlist?list=PLtest'}),/videoseries\?list=PLtest/);assert.equal(player({provider:'youtube',url:'https://www.youtube.com/@artist'}),'');});
