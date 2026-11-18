import {createClient} from 'jsr:@supabase/supabase-js@2.57.4';
import {crmIdentity} from '../_shared/crm-identity.ts';
import {Buffer} from 'node:buffer';
const MAILBOX='booking@warrenwilliam.de';
const cors={'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const ok=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
const uid=(s:unknown)=>/^[0-9a-f-]{36}$/i.test(String(s));
const email=(s:unknown)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
function businessDays(now=new Date()){const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(now);const d=new Date(day+'T12:00:00Z');let n=3;while(n){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)n--;}return d.toISOString().slice(0,10);}
async function libraries(){const [{default:nodemailer},{ImapFlow},{simpleParser},{htmlToText}]=await Promise.all([import('npm:nodemailer@10.6.0'),import('npm:imapflow@2.12.1'),import('npm:mailparser@3.14.5'),import('npm:html-to-text@10.0.1')]);return {nodemailer,ImapFlow,simpleParser,htmlToText};}
function imap(ImapFlow:any,password:string){return new ImapFlow({host:'imap.ionos.de',port:993,secure:true,auth:{user:MAILBOX,pass:password},logger:false,socketTimeout:25000,connectionTimeout:15000,tls:{minVersion:'TLSv1.2'}});}
function smtp(nodemailer:any,password:string){return nodemailer.createTransport({host:'smtp.ionos.de',port:465,secure:true,auth:{user:MAILBOX,pass:password},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:25000,tls:{minVersion:'TLSv1.2'}});}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({ok:false,error:'Method not allowed.'},405);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const identity=await crmIdentity(req,sb);if(!identity)return reply({ok:false,error:'Please sign in again.'},401);if(!['team','client'].includes(identity.role))return reply({ok:false,error:'Booking management access required.'},403);
  const b=await req.json(),password=Deno.env.get('BOOKING_MAILBOX_PASSWORD')||'';
  async function leads(){return ok(await sb.rpc('booking_enrichment_list',{actor:identity.actor,period_start:new Date().toISOString().slice(0,7)+'-01',period_end:new Date(new Date().getUTCFullYear()+1,0,1).toISOString().slice(0,10)})).leads;}
  if(b.action==='status')return reply({ok:true,mailbox:MAILBOX,provider:'IONOS',configured:!!password,sending:!!password,receiving:!!password,receiving_mode:'Refresh inbox to sync matching shared-lead messages from the last 30 days.',missing:password?[]:['BOOKING_MAILBOX_PASSWORD']});
  if(b.action==='messages'){if(!uid(b.opportunity_id))throw Error('Choose a shared prospect.');if(!(await leads()).some((l:any)=>l.opportunity_id===b.opportunity_id))throw Error('Shared prospect required.');return reply({ok:true,messages:ok(await sb.from('booking_mail_messages').select('id,direction,sender,recipient,subject,body_text,state,message_id,reply_to_message_id,attachment_ids,created_at,sent_copy_saved,error_code').eq('opportunity_id',b.opportunity_id).order('created_at',{ascending:false}).limit(100))});}
  if(!password)return reply({ok:false,error:'Mailbox connection pending. Add BOOKING_MAILBOX_PASSWORD in Supabase Edge Function secrets for booking@warrenwilliam.de. Passwords are never entered in task comments.'},409);
  const {nodemailer,ImapFlow,simpleParser,htmlToText}=await libraries();
  if(b.action==='verify'){
   const client=imap(ImapFlow,password),transport=smtp(nodemailer,password);try{await transport.verify();await client.connect();await client.mailboxOpen('INBOX',{readOnly:true});return reply({ok:true,smtp_verified:true,imap_verified:true,mailbox:MAILBOX});}catch{return reply({ok:false,error:'IONOS sign-in or connection failed. Verify the mailbox password and IMAP/SMTP access.'},409);}finally{transport.close();await client.logout().catch(()=>{});}
  }
  if(b.action==='send'){
   if(!uid(b.id)||!uid(b.opportunity_id)||!email(b.to)||!String(b.subject||'').trim()||String(b.subject).length>250||/[\r\n]/.test(b.subject)||!String(b.body||'').trim()||String(b.body).length>6000||b.reviewed!==true||!Array.isArray(b.attachment_ids)||b.attachment_ids.length>5||b.attachment_ids.some((id:unknown)=>!uid(id)))throw Error('Review the recipient, subject, text and selected attachments.');
   const lead=(await leads()).find((l:any)=>l.opportunity_id===b.opportunity_id);if(!lead)throw Error('Shared prospect required.');
   const existing=ok(await sb.from('booking_mail_messages').select('id,state,opportunity_id,recipient').eq('id',b.id).maybeSingle());if(existing){if(existing.opportunity_id!==lead.opportunity_id||existing.recipient!==b.to)throw Error('Email identifier already belongs to another conversation.');return reply({ok:true,existing:true,message:existing});}
   if(lead.suppressed||lead.verification_status!=='verified'||lead.email!==b.to||lead.version!==b.version||!['invited','consent','existing_relationship'].includes(lead.enrichment?.email_permission)||!lead.enrichment?.permission_note)throw Error('Refresh this lead and confirm the business email and outreach basis before sending.');
   const attachments=[];let total=0;
   for(const id of [...new Set(b.attachment_ids)]){const a=ok(await sb.from('booking_media').select('*').eq('id',id).eq('status','ready').eq('kind','file').single());if(a.opportunity_id&&a.opportunity_id!==lead.opportunity_id)throw Error('Attachment belongs to another lead.');total+=a.size_bytes;if(total>10*1024*1024)throw Error('Keep email attachments under 10 MB in total; use YouTube or SoundCloud links for large media.');const file=ok(await sb.storage.from('booking-media').download(a.storage_path));attachments.push({filename:a.filename,content:Buffer.from(await file.arrayBuffer()),contentType:a.mime_type});}
   let replyMessage:string|undefined;if(b.reply_to_id){const parent=ok(await sb.from('booking_mail_messages').select('message_id').eq('id',b.reply_to_id).eq('opportunity_id',lead.opportunity_id).single());replyMessage=/^<[^<>\r\n ]+>$/.test(parent.message_id||'')?parent.message_id:undefined;}
   const generator=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'}),compiled=await generator.sendMail({from:`Warren Will Booking <${MAILBOX}>`,replyTo:MAILBOX,to:lead.email,subject:b.subject,text:b.body,inReplyTo:replyMessage,references:replyMessage,attachments,disableFileAccess:true,disableUrlAccess:true,messageId:`<ww-${b.id}@warrenwilliam.de>`});
   const claim=await sb.from('booking_mail_messages').insert({id:b.id,opportunity_id:lead.opportunity_id,direction:'outbound',sender:MAILBOX,recipient:lead.email,subject:b.subject,body_text:b.body,state:'sending',attachment_ids:b.attachment_ids,created_by:identity.actor});if(claim.error){if(claim.error.code==='23505')return reply({ok:true,existing:true,message:{id:b.id,state:'sending'}});throw Error('Could not reserve the email. Nothing was sent.');}
   const transport=smtp(nodemailer,password);let accepted=false,savedCopy=false;
   try{
    const fresh=(await leads()).find((l:any)=>l.opportunity_id===lead.opportunity_id);if(!fresh||fresh.suppressed||fresh.email!==b.to||fresh.version!==b.version)throw Error('lead_changed');
    const sent=await transport.sendMail({envelope:{from:MAILBOX,to:[lead.email]},raw:compiled.message});accepted=sent.accepted?.some((x:any)=>String(x).toLowerCase()===lead.email.toLowerCase())===true;if(!accepted)throw Error('smtp_not_accepted');
    const client=imap(ImapFlow,password);try{await client.connect();const boxes=await client.list(),folder=boxes.find((x:any)=>x.specialUse==='\\Sent');if(folder){await client.append(folder.path,compiled.message,['\\Seen']);savedCopy=true;}}catch{}finally{await client.logout().catch(()=>{});}
    ok(await sb.rpc('booking_mail_finish',{actor:identity.actor,p:{id:b.id,opportunity_id:lead.opportunity_id,direction:'outbound',subject:b.subject,message_id:compiled.messageId,created_at:new Date().toISOString(),follow_up_date:businessDays(),sent_copy_saved:savedCopy}}));
    return reply({ok:true,message:{id:b.id,state:'sent',smtp_accepted:true,sent_copy_saved:savedCopy}});
   }catch(e){const beforeSend=e instanceof Error&&e.message==='lead_changed';await sb.from('booking_mail_messages').update({state:beforeSend?'failed':'uncertain',error_code:beforeSend?'lead_changed':accepted?'sent_logging_incomplete':'smtp_result_uncertain'}).eq('id',b.id).eq('state','sending');return reply({ok:false,error:beforeSend?'Lead changed. Nothing was sent. Refresh before reviewing again.':'The delivery result needs checking in IONOS Sent before retrying. This email will not be sent again automatically.'},409);}finally{transport.close();}
  }
  if(b.action==='sync'){
   const known=(await leads()).filter((l:any)=>l.email),client=imap(ImapFlow,password);let imported=0;const since=new Date(Date.now()-30*86400000);
   try{
    await client.connect();const box=await client.mailboxOpen('INBOX',{readOnly:true});
    for(const lead of known.slice(0,50)){
     const ids=await client.search({since,from:lead.email},{uid:true});for(const id of (ids||[]).slice(-10).reverse()){
      if(imported>=20)break;const key=`INBOX:${box.uidValidity}:${id}`;if(ok(await sb.from('booking_mail_messages').select('id').eq('mailbox_key',key).maybeSingle()))continue;
      const meta=await client.fetchOne(id,{uid:true,envelope:true,size:true,internalDate:true},{uid:true});if(!meta||!meta.envelope?.from?.some((a:any)=>a.address?.toLowerCase()===lead.email.toLowerCase()))continue;
      const mid=crypto.randomUUID(),attachmentIds:string[]=[];let parsed:any={subject:meta.envelope.subject,text:'Message exceeds CRM import size. Open it in the IONOS mailbox.',messageId:meta.envelope.messageId};
      if(meta.size<=12*1024*1024){const full=await client.fetchOne(id,{source:true},{uid:true});if(full&&full.source)parsed=await simpleParser(full.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true});}
      let bytes=0;for(const a of (parsed.attachments||[]).slice(0,5)){bytes+=a.size;if(bytes>10*1024*1024)break;if(!['application/pdf','image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','audio/mp4','video/mp4'].includes(a.contentType))continue;const aid=crypto.randomUUID(),filename=String(a.filename||'attachment').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180),path=`${aid}/${filename}`;const upload=await sb.storage.from('booking-media').upload(path,a.content,{contentType:a.contentType,upsert:false});if(upload.error)continue;const saved=await sb.from('booking_media').insert({id:aid,title:filename,kind:'file',provider:'file',storage_path:path,filename,mime_type:a.contentType,size_bytes:a.size,opportunity_id:lead.opportunity_id,created_by:identity.actor});if(saved.error){await sb.storage.from('booking-media').remove([path]);continue;}attachmentIds.push(aid);}
      const stamp=meta.internalDate&&new Date(meta.internalDate).getTime()<=Date.now()?new Date(meta.internalDate).toISOString():new Date().toISOString();
      const result=ok(await sb.rpc('booking_mail_finish',{actor:identity.actor,p:{id:mid,opportunity_id:lead.opportunity_id,direction:'inbound',subject:String(parsed.subject||'(No subject)'),body_text:String(parsed.text||(typeof parsed.html==='string'?htmlToText(parsed.html.slice(0,500000),{wordwrap:false,limits:{maxDepth:100}}):'')||'[No readable text; open in IONOS webmail.]').slice(0,30000),message_id:parsed.messageId||null,reply_to_message_id:parsed.inReplyTo||null,mailbox_key:key,attachment_ids:attachmentIds,created_at:stamp}}));if(!result.duplicate)imported++;
     }
    }
    return reply({ok:true,imported,scope:'Known shared booking leads only; last 30 days; mailbox messages left unread and undeleted.'});
   }catch{return reply({ok:false,error:'Mailbox sync could not finish. Check the IONOS connection, then refresh. Previously imported emails are kept.'},409);}finally{await client.logout().catch(()=>{});}
  }
  throw Error('Unknown mailbox action.');
 }catch(e){return reply({ok:false,error:e instanceof Error?e.message:'Could not complete the mailbox action.'},400);}
});
