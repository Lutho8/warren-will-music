import {createClient} from 'jsr:@supabase/supabase-js@2.57.4';
import {crmIdentity} from '../_shared/crm-identity.ts';
const cors={'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const uuid=(x:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x));
const https=(x:unknown)=>{try{const u=new URL(String(x));return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const ok=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
function lead(p:any,importing=false){
 const clean:any={action:'lead_save',opportunity_id:importing?null:p.opportunity_id||null,version:importing?0:p.version,category:p.category,matched_gig_id:p.matched_gig_id,company:p.company,name:p.name,city:p.city||'',website:p.website||'',email:p.email||'',fit_reason:p.fit_reason,fit_score:Number(p.fit_score),source_url:p.source_url,owner_user_id:p.owner_user_id||null,verification_status:importing?'needs_review':p.verification_status||'needs_review',contact_checked:!importing&&p.contact_checked===true,pipeline_stage:importing?'Not contacted':p.pipeline_stage||'Not contacted',follow_up_date:p.follow_up_date||null,next_step:p.next_step||'',research_provider:importing?'Graphed CSV - unverified':'Manual research'};
 if(!Number.isInteger(clean.version)||clean.version<0||!uuid(clean.matched_gig_id)||!['promoter','booker','venue','restaurant'].includes(clean.category)||!String(clean.fit_reason||'').trim()||String(clean.fit_reason).length>1000||!Number.isInteger(clean.fit_score)||clean.fit_score<0||clean.fit_score>100||!https(clean.source_url)||(clean.website&&!https(clean.website)))throw new Error('Check the reference gig, segment, fit and research URLs.');
 if(clean.opportunity_id&&!uuid(clean.opportunity_id)||clean.owner_user_id&&!uuid(clean.owner_user_id))throw new Error('Check the prospect and owner.');
 if(!clean.opportunity_id&&(!String(clean.company||'').trim()||!String(clean.name||'').trim()))throw new Error('Company and contact label required.');
 if(clean.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))throw new Error('Check the business email.');
 return clean;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({ok:false,error:'Method not allowed.'},405);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
 const identity=await crmIdentity(req,sb);
 if(!identity)return reply({ok:false,error:'Please sign in again.'},401);
 if(!['team','client'].includes(identity.role))return reply({ok:false,error:'Booking management access required.'},403);
 const b=await req.json();let p:any;
 if(b.action==='list')return reply({ok:true,...ok(await sb.rpc('booking_acquisition_list',{actor:identity.actor,period_start:b.period_start,period_end:b.period_end}))});
 if(b.action==='lead_save')p=lead(b);
 else if(b.action==='import'){
  if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>50)throw new Error('Import up to 50 reviewed rows.');
  p={action:'import',rows:b.rows.map((x:any)=>lead(x,true))};
 }else if(b.action==='campaign_save'){
  if(!uuid(b.id)||!Number.isInteger(b.version)||b.version<0||!String(b.name||'').trim()||String(b.name).length>200||!String(b.research_brief||'').trim()||String(b.research_brief).length>8000||String(b.pitch_draft||'').length>10000||!Array.isArray(b.targets)||b.targets.length>100||b.targets.some((x:unknown)=>!uuid(x))||(b.press_kit_url&&!https(b.press_kit_url))||(b.music_url&&!https(b.music_url)))throw new Error('Check campaign fields and media links.');
  p={action:b.action,id:b.id,version:b.version,name:b.name,subject:b.subject||'',target_audience:b.target_audience||'',pitch_draft:b.pitch_draft||'',research_brief:b.research_brief,press_kit_url:b.press_kit_url||null,music_url:b.music_url||null,follow_up_date:b.follow_up_date||null,targets:b.targets};
 }else if(b.action==='attribute_booking'){
  if(!uuid(b.gig_id)||!uuid(b.campaign_id)||!uuid(b.opportunity_id)||!/^\d{4}-\d{2}-\d{2}$/.test(b.confirmed_on)||String(b.confirmation_reference||'').trim().length<3)throw new Error('Choose a confirmed booking, campaign, prospect and evidence.');
  p={action:b.action,gig_id:b.gig_id,campaign_id:b.campaign_id,opportunity_id:b.opportunity_id,confirmed_on:b.confirmed_on,confirmation_reference:b.confirmation_reference};
 }else throw new Error('Unknown acquisition action.');
 return reply({ok:true,result:ok(await sb.rpc('booking_acquisition_save',{actor:identity.actor,p}))});
 }catch(e){return reply({ok:false,error:e instanceof Error?e.message:'Could not save.'},400);}
});
