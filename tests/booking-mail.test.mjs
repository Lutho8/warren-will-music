import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import {htmlToText} from 'html-to-text';

const ACTOR=randomUUID(),LEAD=randomUUID(),FILE=randomUUID();
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/booking-mail/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/^async function libraries\(\).*$/m,'async function libraries(){return fixtures;}'));
function mailbox(options={}){
 const lead={opportunity_id:LEAD,email:'booker@example.test',version:4,verification_status:'verified',enrichment:{email_permission:'invited',permission_note:'Published invitation for artist applications'},...options.lead};
 const records=[],media=[{id:FILE,kind:'file',status:'ready',filename:'press-kit.pdf',storage_path:'test/press-kit.pdf',mime_type:'application/pdf',size_bytes:12,...options.file}],wire=[],uploads=[],opens=[],calls=[];
 let handler,listCalls=0;
 function query(table){let operation='select',values,filters=[],one=false;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},order(){return q;},limit(){return q;},maybeSingle(){one=true;return q;},single(){one=true;return q;},insert(p){operation='insert';values=p;return q;},update(p){operation='update';values=p;return q;},then(resolve,reject){try{
   const rows=table==='booking_media'?media:records,matched=rows.filter(r=>filters.every(f=>f(r)));let data,error=null;
   if(operation==='insert'){if(rows.some(r=>r.id===values.id))error={code:'23505'};else {rows.push({...values});data=values;}}
   else if(operation==='update'){matched.forEach(r=>Object.assign(r,values));data=matched;}
   else data=one?(matched[0]||null):matched;
   return Promise.resolve({data,error}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;
 }
 const sb={from:query,rpc:async(name,args)=>{
  calls.push({name,args});if(name==='booking_enrichment_list'){listCalls++;if(options.changeBeforeSend&&listCalls===2)lead.version++;return {data:{leads:[lead]},error:null};}
  if(options.finishFailure)return {data:null,error:{message:'Test persistence failure'}};
  const p=args.p;if(p.direction==='outbound'){Object.assign(records.find(r=>r.id===p.id),{state:'sent',sent_copy_saved:p.sent_copy_saved,message_id:p.message_id});lead.version++;return {data:{id:p.id},error:null};}
  if(records.some(r=>r.mailbox_key===p.mailbox_key))return {data:{duplicate:true},error:null};records.push({...p,state:'received'});return {data:{id:p.id},error:null};
 },storage:{from:()=>({download:async()=>({data:new Blob(['PDF contents']),error:null}),upload:async(path,content)=>{uploads.push({path,content});return {data:{},error:null};},remove:async()=>({data:{},error:null})})}};
 class FakeImap{
  async connect(){if(options.imapFailure)throw Error('mock IMAP unavailable');}
  async mailboxOpen(folder,settings){opens.push({folder,settings});return {uidValidity:9};}
  async list(){return [{specialUse:'\\Sent',path:'Sent'}];}
  async append(folder,content,flags){calls.push({append:{folder,content,flags}});}
  async logout(){}
  async search(){return options.incoming?.map((_,i)=>i+1)||[];}
  async fetchOne(id,fields){const item=options.incoming[id-1];return fields.source?{source:item.raw}:item.meta;}
 }
 const fixtures={simpleParser,htmlToText,ImapFlow:FakeImap,nodemailer:{createTransport:config=>{
  if(config.streamTransport)return nodemailer.createTransport(config);
  assert.equal(config.host,'smtp.ionos.de');assert.equal(config.port,465);assert.equal(config.secure,true);
  return {verify:async()=>{if(options.smtpFailure)throw Error('Mock SMTP refused');},close(){},sendMail:async payload=>{wire.push(payload);if(options.smtpFailure)throw Error('Mock uncertain SMTP');return {accepted:options.rejectRecipient?[]:[lead.email]};}};
 }}};
 const ctx={Request,Response,URL,Blob,Buffer,Date,Intl,Set,Number,String,JSON,Error,crypto:{randomUUID},fixtures,createClient:()=>sb,crmIdentity:async()=>({actor:ACTOR,role:'team'}),Deno:{serve:f=>handler=f,env:{get:k=>k==='BOOKING_MAILBOX_PASSWORD'?'test-placeholder-never-a-live-password':''}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const send={action:'send',id:randomUUID(),opportunity_id:LEAD,version:4,to:lead.email,subject:'Music for your venue',body:'Hello, here is our reviewed booking pitch.',reviewed:true,attachment_ids:[FILE]};
 return {lead,records,wire,uploads,opens,calls,ctx,send,request:async body=>{const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}

test('SMTP MIME round-trip preserves text and attachments; retry with old lead version never resends',async()=>{
 const m=mailbox();const result=await m.request(m.send);assert.equal(result.body.ok,true);assert.equal(result.body.message.sent_copy_saved,true);assert.equal(m.wire.length,1);
 const parsed=await simpleParser(m.wire[0].raw);assert.equal(parsed.from.value[0].address,'booking@warrenwilliam.de');assert.equal(parsed.to.value[0].address,m.lead.email);assert.equal(parsed.subject,m.send.subject);assert.equal(parsed.text.trim(),m.send.body);assert.equal(parsed.attachments[0].filename,'press-kit.pdf');assert.equal(parsed.attachments[0].content.toString(),'PDF contents');assert.equal(m.records[0].state,'sent');
 assert.equal((await m.request(m.send)).body.existing,true);assert.equal(m.wire.length,1);
 assert.equal((await m.request({...m.send,to:'another@example.test'})).body.ok,false);assert.equal(m.wire.length,1);
});
test('Recipient review, permission, attachment ownership and size are checked before SMTP',async()=>{
 for(const options of [{lead:{suppressed:true}},{lead:{enrichment:{email_permission:'unknown'}}},{file:{opportunity_id:randomUUID()}},{file:{size_bytes:11*1048576}}]){const m=mailbox(options);assert.equal((await m.request(m.send)).body.ok,false);assert.equal(m.wire.length,0);}
 const m=mailbox();for(const patch of [{reviewed:false},{subject:'Injected\r\nBcc: other@example.test'},{attachment_ids:Array(6).fill(FILE)},{body:'a'.repeat(6001)}])assert.equal((await m.request({...m.send,...patch})).body.ok,false);assert.equal(m.wire.length,0);
});
test('Concurrent prospect change prevents dispatch and uncertain SMTP results cannot auto-retry',async()=>{
 const changed=mailbox({changeBeforeSend:true});assert.equal((await changed.request(changed.send)).status,409);assert.equal(changed.wire.length,0);assert.equal(changed.records[0].state,'failed');
 for(const options of [{smtpFailure:true},{finishFailure:true}]){const m=mailbox(options);assert.equal((await m.request(m.send)).status,409);assert.equal(m.records[0].state,'uncertain');assert.equal((await m.request(m.send)).body.existing,true);assert.equal(m.wire.length,1);}
});
test('Sent-copy failure remains distinguishable from SMTP failure; connection errors are actionable',async()=>{
 const m=mailbox({imapFailure:true});const r=await m.request(m.send);assert.equal(r.body.ok,true);assert.equal(r.body.message.sent_copy_saved,false);assert.equal(m.records[0].state,'sent');
 assert.equal((await m.request({action:'verify'})).status,409);const good=mailbox();assert.equal((await good.request({action:'verify'})).body.imap_verified,true);assert.equal(good.opens[0].folder,'INBOX');assert.equal(good.opens[0].settings.readOnly,true);
});
test('Inbox imports HTML-only replies and attachments as plain text, leaves mailbox unchanged and deduplicates',async()=>{
 const raw=(await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail({from:'booker@example.test',to:'booking@warrenwilliam.de',subject:'Re: Artist booking',html:'<p>Thank you. <strong>Can you play Friday?</strong></p><script>alert(1)</script>',attachments:[{filename:'offer.pdf',content:Buffer.from('PDF offer'),contentType:'application/pdf'}]})).message;
 const incoming=[{raw,meta:{size:raw.length,internalDate:new Date('2026-11-17T09:00:00Z'),envelope:{from:[{address:'booker@example.test'}]}}},{meta:{size:20,envelope:{from:[{address:'unrelated@example.test'}]}}},{meta:{size:20}}];
 const m=mailbox({incoming});let r=await m.request({action:'sync'});assert.equal(r.body.ok,true);assert.equal(r.body.imported,1);assert.match(m.records[0].body_text,/Can you play Friday/);assert.ok(!m.records[0].body_text.includes('<strong>'));assert.equal(m.records[0].attachment_ids.length,1);assert.equal(m.uploads.length,1);assert.equal((await m.request({action:'sync'})).body.imported,0);assert.equal(m.records.length,1);assert.equal(m.uploads.length,1);assert.ok(m.opens.every(o=>o.settings.readOnly));
});
test('Follow-up scheduling uses the Berlin calendar across midnight and weekends',()=>{
 const m=mailbox();assert.equal(m.ctx.businessDays(new Date('2026-11-19T23:30:00Z')),'2026-11-25');assert.equal(m.ctx.businessDays(new Date('2026-11-20T08:00:00Z')),'2026-11-25');
});
