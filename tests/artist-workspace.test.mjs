import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/artist-workspace/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,''));
const sharedSource=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/_shared/crm-identity.ts',import.meta.url),'utf8').replace(/export /g,''));
const focusSource=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/_shared/team-focus.ts',import.meta.url),'utf8').replace(/export /g,''));
const UUID='12345678-1234-4234-8234-123456789012';
function runtime({role='client',db={},authUser=null,scopes=[]}={}){
 const calls=[];let handler;let outbound=0;
 class Query{
  constructor(table){this.table=table;this.filters=[];this.operation='select';}
  select(fields){this.fields=fields;return this;}
  insert(value){this.operation='insert';this.value=value;return this;}
  update(value){this.operation='update';this.value=value;return this;}
  upsert(value){this.operation='upsert';this.value=value;return this;}
  delete(){this.operation='delete';return this;}
  eq(k,v){this.filters.push([k,v]);return this;}
  gte(k,v){this.filters.push([k,v]);return this;}
  or(v){this.filters.push(['or',v]);return this;}is(k,v){this.filters.push([k,v]);return this;}
  order(){return this;}limit(){return this;}single(){return this;}maybeSingle(){return this;}
  then(resolve,reject){calls.push(this);let value=db[this.table];if(typeof value==='function')value=value(this);return Promise.resolve(value||{data:[],error:null}).then(resolve,reject);}
 }
 const defaultUser=role?{id:UUID,email_confirmed_at:'2026-01-01',app_metadata:{crm_enabled:true,crm_role:role==='client'?'artist':role==='team'?'management':'social'}}:null;
 const verified=authUser?{email_confirmed_at:'2026-01-01',...authUser}:defaultUser;
 const assigned=verified?.app_metadata?.crm_role;
 const directory={role:assigned==='artist'?'artist':assigned==='management'?'management':'social_media',active:true,scopes};
 const sb={from:t=>t==='crm_user_roles'?{select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve(db.crm_user_roles||{data:[],error:null}).then(resolve,reject);},maybeSingle:async()=>({data:directory,error:null})}:new Query(t),rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:{},error:null};},auth:{getUser:async()=>({data:{user:verified},error:verified?null:{message:'invalid'}})}};
 const context=vm.createContext({crypto:globalThis.crypto,TextEncoder,createClient:()=>sb,Response,Request,URL,Date,Intl,JSON,Error,Number,String,Array,isNaN,fetch:async()=>{outbound++;return new Response(JSON.stringify({ok:true,contacts:[],gigs:[],invoices:[]}));},Deno:{env:{get:name=>({ADMIN_DASH_KEY:'test-team-only',CLIENT_DASH_KEY:'test-artist-only',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-only'})[name]},serve:fn=>handler=fn}});
 vm.runInContext(sharedSource+focusSource+source,context);
 return {calls,outbound:()=>outbound,request:async(body,headers={},url='https://example.supabase.co/functions/v1/artist-workspace')=>{const r=await handler(new Request(url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(role?{'authorization':'Bearer test-personal-token'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};}};
}
test('Unauthenticated private reads do not query tables',async()=>{const r=runtime({role:null});const out=await r.request({action:'dashboard'});assert.equal(out.status,401);assert.equal(r.calls.length,0);});
test('Public feed explicitly filters published confirmed gigs and never selects fees or contacts',async()=>{const r=runtime({role:null});const out=await r.request(null,{},'https://example.supabase.co/functions/v1/artist-workspace?view=public-gigs');assert.equal(out.status,200);const q=r.calls[0];assert.equal(q.table,'gigs');assert.deepEqual(q.filters.slice(0,2),[['is_public',true],['booking_status','confirmed']]);assert.ok(!/fee|contact|deposit/.test(q.fields));});
test('Team cannot use Warren-only content approvals',async()=>{const r=runtime({role:'team'});const out=await r.request({action:'review_content',id:UUID,approval:'approved',version:1});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Social access uses verified app metadata and denies financial actions',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'social'},user_metadata:{crm_role:'management'}}});const out=await r.request({action:'send_invoice_email'},{authorization:'Bearer test-jwt'});assert.equal(out.status,403);assert.equal(r.calls.length,0);});
test('User-editable metadata does not grant access',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{},user_metadata:{crm_enabled:true,crm_role:'management'}}});assert.equal((await r.request({action:'dashboard'},{authorization:'Bearer test-jwt'})).status,401);});
test('Social dashboard loads content only and makes no legacy CRM request',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'social'}}});const out=await r.request({action:'dashboard'},{authorization:'Bearer test-jwt'});assert.equal(out.body.ok,true);assert.equal(r.outbound(),0);assert.deepEqual(r.calls.map(q=>q.table),['artist_content','content_publications','artist_metrics','social_channels']);});
test('Publication URLs must belong to the selected platform',async()=>{const r=runtime({role:'team'});const out=await r.request({action:'save_publication',content_id:UUID,version:1,platform:'Instagram',status:'published',post_url:'https://instagram.com.evil.example/p/1',published_at:'2026-01-01T12:00:00Z'});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Publication without a timestamp is rejected before a write',async()=>{const r=runtime({role:'team'});const out=await r.request({action:'save_publication',content_id:UUID,version:1,platform:'Instagram',status:'published',post_url:'https://www.instagram.com/p/test'});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Management cannot approve content on behalf of Warren',async()=>{const r=runtime({role:'team'});assert.equal((await r.request({action:'review_content',id:UUID,approval:'approved',version:1})).body.ok,false);assert.equal(r.calls.length,0);});
test('Repeated invoice delivery claims never reach an email provider',async()=>{const r=runtime({role:'team',db:{invoices:{data:{id:UUID,status:'draft',recipient_email:'test@example.com'},error:null},invoice_delivery:{data:null,error:{code:'23505',message:'duplicate'}}}});const out=await r.request({action:'send_invoice_email',invoice_id:UUID,confirmed_recipient:'test@example.com'});assert.equal(out.body.ok,false);assert.equal(r.outbound(),0);});
test('Recipient mismatch prevents claiming or sending an invoice',async()=>{const r=runtime({role:'team',db:{invoices:{data:{id:UUID,status:'draft',recipient_email:'test@example.com'},error:null}}});const out=await r.request({action:'send_invoice_email',invoice_id:UUID,confirmed_recipient:'different@example.com'});assert.equal(out.body.ok,false);assert.ok(r.calls.every(q=>q.table==='invoices'));assert.equal(r.outbound(),0);});
test('Invalid monetary values are rejected, rather than coerced to zero',async()=>{const r=runtime();assert.equal((await r.request({action:'save_gig',id:UUID,date:'2026-09-11',venue_name:'Example',booking_status:'confirmed',is_public:false,fee:-10})).body.ok,false);assert.equal(r.calls.length,0);});
test('CSV import validates all rows before persistence',async()=>{const r=runtime({role:'team'});assert.equal((await r.request({action:'import_contacts',source:'test',rows:[{name:'Valid',email:'ok@example.com'},{name:'Invalid',email:'bad'}]})).body.ok,false);assert.equal(r.calls.length,0);});
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../artist-app.js',import.meta.url),'utf8'),ctx);const parse=ctx.window.WWArtistUtils.parseCSV;
test('Equipment saves use the workflow RPC with authenticated actor',async()=>{
 const r=runtime();const b={action:'save_rental',id:UUID,version:0,customer_name:'Test',offer_code:'club',status:'draft',deposit_cents:0,deposit_status:'open',payment_status:'open',starts_at:'2027-01-01T12:00:00Z',ends_at:'2027-01-02T12:00:00Z',rental_details:{logistics:'Abholung'}};
 assert.equal((await r.request(b)).body.ok,true);assert.equal(r.calls[0].rpc,'save_equipment_workflow');assert.equal(r.calls[0].args.actor,UUID);
 for(const change of [{ends_at:'invalid'},{status:'invented'},{deposit_cents:-1},{version:-1}]){const invalid=runtime();assert.equal((await invalid.request({...b,...change})).body.ok,false);assert.equal(invalid.calls.length,0);}
});
test('CSV parsing supports BOM, semicolons, quoted newlines and escaped quotes',()=>{const rows=parse('\uFEFFname;email;notes\r\n"Example, Booker";test@example.com;"Line 1\nLine ""2"""');assert.equal(rows.length,2);assert.equal(rows[1][0],'Example, Booker');assert.equal(rows[1][2],'Line 1\nLine "2"');});
test('CSV parsing refuses incomplete quoted data',()=>assert.throws(()=>parse('name,email\n"unfinished,test@example.com')));
function uiRuntime(){
 const elements=[];class Element{constructor(tag){this.tag=tag;this.style={};this.listeners={};this.hidden=false;this.innerHTML='';elements.push(this);}setAttribute(){}addEventListener(type,fn){this.listeners[type]=fn;}after(){}append(){}querySelector(){return null;}querySelectorAll(){return [];}showModal(){this.open=true;}close(){this.open=false;}}
 const old=new Element('main');old.id='wview';const body=new Element('body');
 const location={hash:'#today'};const context={Intl,Date,Number,String,Array,JSON,URL,Response,crypto:globalThis.crypto,setTimeout,clearTimeout,location,navigator:{onLine:true},window:{addEventListener(){},scrollTo(){}},document:{body,createElement:t=>new Element(t),querySelector:s=>elements.find(e=>'#'+e.id===s),getElementById:id=>elements.find(e=>e.id===id)}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../artist-app.js',import.meta.url),'utf8'),context);
 return {context,elements};
}
test('All five artist tabs render valid empty states without fabricated metrics',async()=>{
 const r=uiRuntime();const d={app_ready:true,role:'client',generated_at:'2026-09-11T10:00:00Z',contacts:[],gigs:[],board:[],invoices:[],content:[],publications:[],metrics:[],pipeline:[]};
 for(const tab of ['today','contacts','bookings','content','results']){r.context.location.hash='#'+tab;await r.context.window.renderArtistWorkspace(d);const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.ok(html.includes('<h1>'));assert.ok(!html.includes('undefined'));if(tab==='results')assert.ok(html.includes('Noch keine verifizierten Kennzahlen'));}
});
test('Today shows three personal actions and excludes team work from that list',async()=>{const r=uiRuntime();const board=Array.from({length:5},(_,n)=>({id:UUID+n,title:'Artist task '+n,owner:'warren',kind:'ask',status:'open'}));board.push({id:'team',title:'Management task',owner:'team',kind:'work',status:'open'});await r.context.window.renderArtistWorkspace({app_ready:true,role:'client',contacts:[],gigs:[],content:[],board});const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.equal((html.match(/data-app="task"/g)||[]).length,3);assert.ok(html.includes('Alle Aktionen anzeigen'));});
test('Untrusted content titles and captions are escaped',async()=>{const r=uiRuntime();r.context.location.hash='#content';await r.context.window.renderArtistWorkspace({app_ready:true,role:'client',content:[{id:UUID,title:'<img src=x onerror=alert(1)>',caption:'<script>alert(1)</script>',version:1,approval:'draft'}],publications:[]});const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));});


test('Anonymous shared-code headers no longer grant a personal workspace',async()=>{
 const r=runtime({role:null});const out=await r.request({action:'dashboard'},{'x-admin-key':'test-shared-code'});
 assert.equal(out.status,401);assert.equal(r.calls.length,0);
});
test('Team dashboard cannot request Warren view',async()=>{
 const r=runtime({role:'team'});const out=await r.request({action:'dashboard',view:'warren'});
 assert.equal(out.status,403);assert.equal(r.calls.length,0);assert.equal(r.outbound(),0);
});
test('Team receives only the team workspace',async()=>{
 const r=runtime({role:'team'});const out=await r.request({action:'dashboard'});
 assert.equal(out.body.view,'team');assert.equal(out.body.is_owner,false);assert.deepEqual(out.body.available_views,['team']);
});
test('Warren can access both workspaces',async()=>{
 for(const view of ['warren','team']){const r=runtime();const out=await r.request({action:'dashboard',view});
 assert.equal(out.body.ok,true);assert.equal(out.body.view,view);assert.equal(out.body.is_owner,true);assert.deepEqual(out.body.available_views,['warren','team']);}
});
test('Team cannot read a Warren contact through a direct API call',async()=>{
 const r=runtime({role:'team',db:{contacts:{data:{id:UUID,assigned_to:'warren'},error:null}}});
 const out=await r.request({action:'contact_history',id:UUID});assert.equal(out.body.ok,false);assert.equal(r.calls.length,1);
});
test('Team cannot modify Warren private board items',async()=>{
 const r=runtime({role:'team',db:{client_board:{data:{id:UUID,owner:'warren'},error:null}}});
 const out=await r.request({action:'legacy',payload:{action:'update',id:UUID,title:'blocked'}});assert.equal(out.body.ok,false);assert.equal(r.outbound(),0);
});
const viewSource=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/_shared/crm-views.ts',import.meta.url),'utf8').replace('export function','function'));
const viewContext=vm.createContext({Date,Set,Object});vm.runInContext(viewSource,viewContext);
test('Team payload removes personal records and derived counts',()=>{
 const data={contacts:[{id:'private',assigned_to:'warren'},{id:'shared',assigned_to:'team'}],pipeline:[{contact_id:'private',stage:'new'},{contact_id:'shared',stage:'new'}],board:[{id:'private',owner:'warren'},{id:'shared',owner:'team',warren_comment:'private'}],interactions:[{contact_id:'private'}],business:{iban:'private'},inner_circle:[{id:'private'}]};
 const out=viewContext.teamDashboard(data);assert.equal(out.contacts.length,1);assert.equal(out.pipeline.length,1);assert.equal(out.board.length,1);assert.equal(out.board[0].warren_comment,null);assert.equal(out.interactions.length,0);assert.equal(out.business,null);assert.equal(out.inner_circle.length,0);assert.equal(out.counts.contacts_total,1);assert.equal(out.counts.pipeline.new,1);
});

test('Management with server-assigned Warren scope can preview both workspaces without becoming artist',async()=>{const r=runtime({role:'team',scopes:['warren','team']});const out=await r.request({action:'dashboard',view:'warren'});assert.equal(out.body.ok,true);assert.equal(out.body.is_owner,false);assert.equal(out.body.read_only,true);assert.deepEqual(out.body.available_views,['warren','team']);});
test('Warren scope does not allow artist approvals or payment writes from preview',async()=>{for(const body of [{action:'review_content',id:UUID,approval:'approved'},{action:'legacy',payload:{action:'approve',id:UUID}},{action:'send_invoice_email',invoice_id:UUID},{action:'save_gig',id:UUID}]){const r=runtime({role:'team',scopes:['warren','team']});const out=await r.request({...body,view:'warren'});assert.equal(out.status,403);assert.match(out.body.error,/read-only/);assert.equal(r.calls.length,0);assert.equal(r.outbound(),0);}});
test('Management retains team workspace writes after opening Warren preview',async()=>{const r=runtime({role:'team',scopes:['warren','team']});const out=await r.request({action:'dashboard',view:'team'});assert.equal(out.body.ok,true);assert.equal(out.body.read_only,false);assert.equal(out.body.role,'team');});
test('User-editable scopes cannot unlock Warren workspace',async()=>{const r=runtime({role:'team',authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'management'},user_metadata:{scopes:['warren','team']}}});assert.equal((await r.request({action:'dashboard',view:'warren'})).status,403);});
test('Social role does not gain Warren preview even with a misplaced scope',async()=>{const r=runtime({role:'social',scopes:['warren','team']});assert.equal((await r.request({action:'dashboard',view:'warren'})).status,403);});
test('Warren preview renders read-only notice and hides creation controls',async()=>{const r=uiRuntime();r.context.location.hash='#bookings';await r.context.window.renderArtistWorkspace({app_ready:true,role:'client',view:'warren',read_only:true,is_owner:false,contacts:[],gigs:[],invoices:[],board:[]});const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.ok(html.includes('read-only'));assert.ok(!html.includes('data-app="new-gig"'));});

test('Scoped management cannot impersonate Warren by using team view for an approval',async()=>{const r=runtime({role:'team',scopes:['warren','team']});const out=await r.request({action:'review_content',view:'team',id:UUID,approval:'approved',version:1});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Scoped management private contact history is restricted to the read-only preview',async()=>{const db={contacts:{data:{id:UUID,assigned_to:'warren'},error:null}};const team=runtime({role:'team',scopes:['warren','team'],db});assert.equal((await team.request({action:'contact_history',view:'team',id:UUID})).body.ok,false);const preview=runtime({role:'team',scopes:['warren','team'],db});assert.equal((await preview.request({action:'contact_history',view:'warren',id:UUID})).body.ok,true);assert.equal(preview.calls[0].table,'interactions');});

test('Admin scope enables editing both layouts without impersonating the artist',async()=>{const r=runtime({role:'team',scopes:['admin','warren','team']});const out=await r.request({action:'dashboard',view:'warren'});assert.equal(out.body.ok,true);assert.equal(out.body.is_admin,true);assert.equal(out.body.can_manage_all,true);assert.equal(out.body.is_owner,false);assert.equal(out.body.read_only,false);assert.equal(out.body.role,'team');});
test('Admin can update a private board item and archive it through either layout',async()=>{for(const action of ['update','archive_item','unarchive_item','create']){const r=runtime({role:'team',scopes:['admin','warren','team']});const out=await r.request({action:'legacy',view:'warren',payload:{action,id:UUID,kind:'ask',owner:'warren',title:'Admin change'}});assert.equal(out.body.ok,true);assert.equal(r.outbound(),1);}});
test('A forged admin scope in user metadata cannot unlock admin access',async()=>{const r=runtime({role:'team',authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'management'},user_metadata:{scopes:['admin','warren','team']}}});const out=await r.request({action:'dashboard',view:'team'});assert.equal(out.body.is_admin,false);});
test('Social role with admin scope does not become an administrator',async()=>{const r=runtime({role:'social',scopes:['admin','warren','team']});assert.equal((await r.request({action:'dashboard',view:'warren'})).status,403);});
test('Admin receives task management controls in Warren dashboard',async()=>{const r=uiRuntime();await r.context.window.renderArtistWorkspace({app_ready:true,role:'team',view:'warren',read_only:false,is_admin:true,contacts:[],gigs:[],invoices:[],content:[],board:[{id:UUID,owner:'warren',title:'Review task',kind:'ask',status:'open'}]});const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.ok(html.includes('data-app="board-new"'));assert.ok(html.includes('data-app="board-edit"'));assert.ok(html.includes('data-app="board-archive"'));});

test('Team focus cards escape member names and task titles and link to the original task',async()=>{const r=uiRuntime();await r.context.window.renderArtistWorkspace({app_ready:true,role:'client',view:'warren',contacts:[],gigs:[],content:[],board:[],team_focus:{members:[{id:UUID,name:'<img src=x>',tasks:[{id:UUID,title:'<script>bad</script>',status:'review',due_date:'2026-11-05'}]}],unassigned_count:0}});const html=r.elements.find(e=>e.id==='artistApp').innerHTML;assert.ok(html.includes('Team · top 3 per member'));assert.ok(html.includes('data-app="team-task"'));assert.ok(html.includes('data-id="'+UUID+'"'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));});
