import {createClient} from 'jsr:@supabase/supabase-js@2.57.4';
import {crmIdentity} from '../_shared/crm-identity.ts';
const cors={'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const ok=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
const uid=(s:unknown)=>/^[0-9a-f-]{36}$/i.test(String(s));
const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','video/mp4','video/webm','video/quicktime','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
function mediaURL(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('Use a valid HTTPS media link.');const h=u.hostname.toLowerCase().replace(/^www\./,'');if(['youtube.com','youtu.be','m.youtube.com','music.youtube.com'].includes(h))return {url:u.href,provider:'youtube'};if(['soundcloud.com','m.soundcloud.com','on.soundcloud.com'].includes(h))return {url:u.href,provider:'soundcloud'};throw Error('Use a YouTube or SoundCloud link.');}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({ok:false,error:'Method not allowed.'},405);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const identity=await crmIdentity(req,sb);if(!identity)return reply({ok:false,error:'Please sign in again.'},401);if(!['team','client'].includes(identity.role))return reply({ok:false,error:'Booking management access required.'},403);
  async function shared(id:string){if(!uid(id))throw Error('Choose a shared prospect.');const o=ok(await sb.from('opportunities').select('id,contacts!inner(assigned_to)').eq('id',id).single());if(o.contacts.assigned_to!=='team')throw Error('Shared prospect required.');}
  const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
  if(multipart){
   if(Number(req.headers.get('content-length')||0)>27*1024*1024)throw Error('Upload files up to 25 MB.');
   const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>25*1024*1024||!allowed.has(file.type))throw Error('Use a supported document, image, audio or video file up to 25 MB.');
   const opportunity=String(form.get('opportunity_id')||'');if(opportunity)await shared(opportunity);
   const title=String(form.get('title')||file.name).trim().slice(0,180);if(!title)throw Error('Add a title.');
   const id=crypto.randomUUID(),filename=file.name.replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180),path=`${id}/${filename}`;
   ok(await sb.storage.from('booking-media').upload(path,file,{contentType:file.type,upsert:false}));
   const record={id,title,kind:'file',provider:'file',storage_path:path,filename,mime_type:file.type,size_bytes:file.size,opportunity_id:opportunity||null,created_by:identity.actor,status:'ready'};
   const inserted=await sb.from('booking_media').insert(record).select('*').single();if(inserted.error){await sb.storage.from('booking-media').remove([path]);throw Error('Could not save the file record. Try again.');}
   return reply({ok:true,asset:inserted.data});
  }
  const b=await req.json();
  if(b.action==='list'){return reply({ok:true,assets:ok(await sb.from('booking_media').select('*').order('created_at',{ascending:false}).limit(500))});}
  if(b.action==='link_save'){
   const m=mediaURL(String(b.url||'')),title=String(b.title||'').trim();if(!title||title.length>180||String(b.description||'').length>1000)throw Error('Add a title and a short description.');if(b.opportunity_id)await shared(b.opportunity_id);
   const values={...m,title,kind:'link',description:b.description||'',opportunity_id:b.opportunity_id||null,updated_at:new Date().toISOString()};
   if(!b.id){return reply({ok:true,asset:ok(await sb.from('booking_media').insert({...values,created_by:identity.actor}).select('*').single())});}
   const saved=ok(await sb.from('booking_media').update({...values,version:b.version+1}).eq('id',b.id).eq('version',b.version).eq('kind','link').is('archived_at',null).select('*').maybeSingle());if(!saved)throw Error('Media changed. Refresh before editing.');return reply({ok:true,asset:saved});
  }
  const asset=ok(await sb.from('booking_media').select('*').eq('id',b.id).single());
  if(b.action==='download'){
   if(asset.kind!=='file'||asset.status!=='ready')throw Error('File is unavailable.');return reply({ok:true,url:ok(await sb.storage.from('booking-media').createSignedUrl(asset.storage_path,60,{download:asset.filename})).signedUrl});
  }
  if(!Number.isInteger(b.version)||asset.version!==b.version)throw Error('Media changed. Refresh before editing.');
  if(b.action==='file_edit'){
   const title=String(b.title||'').trim();if(asset.kind!=='file'||!title||title.length>180||String(b.description||'').length>1000)throw Error('Check file title and description.');ok(await sb.from('booking_media').update({title,description:b.description||'',version:asset.version+1,updated_at:new Date().toISOString()}).eq('id',asset.id).eq('version',asset.version).select('id').single());return reply({ok:true});
  }
  if(b.action==='archive'||b.action==='restore'){
   ok(await sb.from('booking_media').update({status:b.action==='archive'?'archived':'ready',archived_at:b.action==='archive'?new Date().toISOString():null,version:asset.version+1,updated_at:new Date().toISOString()}).eq('id',asset.id).eq('version',asset.version).select('id').single());return reply({ok:true});
  }
  throw Error('Unknown media action.');
 }catch(e){return reply({ok:false,error:e instanceof Error?e.message:'Could not save media.'},400);}
});
