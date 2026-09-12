import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/artist-workspace/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,''));
const UUID='12345678-1234-4234-8234-123456789012';
function runtime({role='client',db={},authUser=null}={}){
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
  order(){return this;}limit(){return this;}single(){return this;}
  then(resolve,reject){calls.push(this);let value=db[this.table];if(typeof value==='function')value=value(this);return Promise.resolve(value||{data:[],error:null}).then(resolve,reject);}
 }
 const sb={from:t=>new Query(t),rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:{},error:null};},auth:{getUser:async()=>({data:{user:authUser},error:authUser?null:{message:'invalid'}})}};
 const context=vm.createContext({createClient:()=>sb,Response,Request,URL,Date,Intl,JSON,Error,Number,String,Array,isNaN,fetch:async()=>{outbound++;return new Response(JSON.stringify({ok:true,contacts:[],gigs:[],invoices:[]}));},Deno:{env:{get:name=>({ADMIN_DASH_KEY:'test-team-only',CLIENT_DASH_KEY:'test-artist-only',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-only'})[name]},serve:fn=>handler=fn}});
 vm.runInContext(source,context);
 return {calls,outbound:()=>outbound,request:async(body,headers={},url='https://example.supabase.co/functions/v1/artist-workspace')=>{const r=await handler(new Request(url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(role?{'x-admin-key':role==='team'?'test-team-only':'test-artist-only'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};}};
}
test('Unauthenticated private reads do not query tables',async()=>{const r=runtime({role:null});const out=await r.request({action:'dashboard'});assert.equal(out.status,401);assert.equal(r.calls.length,0);});
test('Public feed explicitly filters published confirmed gigs and never selects fees or contacts',async()=>{const r=runtime({role:null});const out=await r.request(null,{},'https://example.supabase.co/functions/v1/artist-workspace?view=public-gigs');assert.equal(out.status,200);const q=r.calls[0];assert.equal(q.table,'gigs');assert.deepEqual(q.filters.slice(0,2),[['is_public',true],['booking_status','confirmed']]);assert.ok(!/fee|contact|deposit/.test(q.fields));});
test('Artist cannot import contacts, manage stock or send invoices',async()=>{for(const action of ['import_contacts','save_inventory','send_invoice_email']){const r=runtime();const out=await r.request({action});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);assert.equal(r.outbound(),0);}});
test('Social access uses verified app metadata and denies financial actions',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'social'},user_metadata:{crm_role:'management'}}});const out=await r.request({action:'send_invoice_email'},{authorization:'Bearer test-jwt'});assert.equal(out.status,403);assert.equal(r.calls.length,0);});
test('User-editable metadata does not grant access',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{},user_metadata:{crm_enabled:true,crm_role:'management'}}});assert.equal((await r.request({action:'dashboard'},{authorization:'Bearer test-jwt'})).status,401);});
test('Social dashboard loads content only and makes no legacy CRM request',async()=>{const r=runtime({role:null,authUser:{id:UUID,app_metadata:{crm_enabled:true,crm_role:'social'}}});const out=await r.request({action:'dashboard'},{authorization:'Bearer test-jwt'});assert.equal(out.body.ok,true);assert.equal(r.outbound(),0);assert.deepEqual(r.calls.map(q=>q.table),['artist_content','content_publications','artist_metrics','social_channels']);});
test('Publication URLs must belong to the selected platform',async()=>{const r=runtime({role:'team'});const out=await r.request({action:'save_publication',content_id:UUID,version:1,platform:'Instagram',status:'published',post_url:'https://instagram.com.evil.example/p/1',published_at:'2026-01-01T12:00:00Z'});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Publication without a timestamp is rejected before a write',async()=>{const r=runtime({role:'team'});const out=await r.request({action:'save_publication',content_id:UUID,version:1,platform:'Instagram',status:'published',post_url:'https://www.instagram.com/p/test'});assert.equal(out.body.ok,false);assert.equal(r.calls.length,0);});
test('Management cannot approve content on behalf of Warren',async()=>{const r=runtime({role:'team'});assert.equal((await r.request({action:'review_content',id:UUID,approval:'approved',version:1})).body.ok,false);assert.equal(r.calls.length,0);});
test('Repeated invoice delivery claims never reach an email provider',async()=>{const r=runtime({role:'team',db:{invoices:{data:{id:UUID,status:'draft',recipient_email:'test@example.com'},error:null},invoice_delivery:{data:null,error:{code:'23505',message:'duplicate'}}}});const out=await r.request({action:'send_invoice_email',invoice_id:UUID,confirmed_recipient:'test@example.com'});assert.equal(out.body.ok,false);assert.equal(r.outbound(),0);});
test('Recipient mismatch prevents claiming or sending an invoice',async()=>{const r=runtime({role:'team',db:{invoices:{data:{id:UUID,status:'draft',recipient_email:'test@example.com'},error:null}}});const out=await r.request({action:'send_invoice_email',invoice_id:UUID,confirmed_recipient:'different@example.com'});assert.equal(out.body.ok,false);assert.equal(r.calls.length,1);assert.equal(r.outbound(),0);});
test('Invalid monetary values are rejected, rather than coerced to zero',async()=>{const r=runtime();assert.equal((await r.request({action:'save_gig',id:UUID,date:'2026-09-11',venue_name:'Example',booking_status:'confirmed',is_public:false,fee:-10})).body.ok,false);assert.equal(r.calls.length,0);});
test('CSV import validates all rows before persistence',async()=>{const r=runtime({role:'team'});assert.equal((await r.request({action:'import_contacts',source:'test',rows:[{name:'Valid',email:'ok@example.com'},{name:'Invalid',email:'bad'}]})).body.ok,false);assert.equal(r.calls.length,0);});
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../artist-app.js',import.meta.url),'utf8'),ctx);const parse=ctx.window.WWArtistUtils.parseCSV;
test('Equipment saves use the workflow RPC with authenticated actor',async()=>{
 const r=runtime();const b={action:'save_rental',id:UUID,version:0,customer_name:'Test',offer_code:'club',status:'draft',deposit_cents:0,deposit_status:'open',payment_status:'open',starts_at:'2027-01-01T12:00:00Z',ends_at:'2027-01-02T12:00:00Z',rental_details:{logistics:'Abholung'}};
 assert.equal((await r.request(b)).body.ok,true);assert.equal(r.calls[0].rpc,'save_equipment_workflow');assert.equal(r.calls[0].args.actor,'legacy:warren');
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
