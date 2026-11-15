import { createClient } from 'jsr:@supabase/supabase-js@2.57.4';
import { crmIdentity } from '../_shared/crm-identity.ts';

const cors={'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v));
const https=(v:unknown)=>{try{return new URL(String(v)).protocol==='https:';}catch{return false;}};
const date=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(v))&&Number.isFinite(Date.parse(String(v)))&&new Date(String(v)).toISOString().slice(0,10)===v;
const instant=(v:unknown)=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const platforms=['Instagram','TikTok','YouTube','Facebook','Threads','LinkedIn'];
const checked=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
export async function handleCalendar(req:Request,sb:any){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({ok:false,error:'Method not allowed.'},405);
 try{
  const identity=await crmIdentity(req,sb);
  if(!identity)return reply({ok:false,error:'Please sign in again.'},401);
  const b=await req.json();
  if(b.view==='warren'&&!identity.canViewWarren)return reply({ok:false,error:'Warren’s workspace is private.'},403);
  if(b.action==='list'){
   if(!instant(b.range_start)||!instant(b.range_end))throw new Error('Choose a valid date range.');
   return reply({ok:true,...checked(await sb.rpc('calendar_list',{actor:identity.actor,range_start:b.range_start,range_end:b.range_end}))});
  }
  if(!['campaign_save','campaign_template','content_save','submit_brand','brand_review','artist_review','publication_save'].includes(b.action))throw new Error('Unknown calendar action.');
  const p={...b};delete p.actor;delete p.role;delete p.owner;
  if(['campaign_save','campaign_template','content_save'].includes(b.action)){
   if(!uuid(b.id)||!Number.isInteger(b.version)||b.version<0)throw new Error('A valid record and version are required.');
  }else if(!uuid(b.content_id)||!Number.isInteger(b.version)||b.version<1)throw new Error('A valid content version is required.');
  if(['campaign_save','campaign_template'].includes(b.action)){
   if(typeof b.name!=='string'||!b.name.trim()||b.name.length>200)throw new Error('Enter a campaign name.');
   if(b.event_date&&!date(b.event_date))throw new Error('Enter a valid confirmed performance date.');
   if(b.planning_month&&(!date(b.planning_month)||!b.planning_month.endsWith('-01')))throw new Error('Choose a planning month.');
  }
  if(b.action==='content_save'){
   if(!uuid(b.campaign_id)||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||String(b.caption||'').length>5000)throw new Error('Check the campaign, title and caption.');
   if(b.preview_url&&!https(b.preview_url))throw new Error('Use an HTTPS asset link.');
   if(b.due_date&&!date(b.due_date))throw new Error('Choose a valid production deadline.');
   if(!Array.isArray(b.target_platforms)||!b.target_platforms.length||b.target_platforms.some((p:unknown)=>!platforms.includes(String(p))))throw new Error('Choose supported channels.');
   for(const k of ['assignee_id','publisher_id','brand_reviewer_id'])if(b[k]&&!uuid(b[k]))throw new Error('Choose a team member.');
   if(b.channel_overrides&&(typeof b.channel_overrides!=='object'||Array.isArray(b.channel_overrides)))throw new Error('Check channel captions.');
   for(const [platform,variant] of Object.entries(b.channel_overrides||{})){
    if(!b.target_platforms.includes(platform)||typeof variant!=='object'||variant===null||Array.isArray(variant))throw new Error('Check channel variants.');
    const v=variant as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['caption','title','cover_url'].includes(k))||String(v.caption||'').length>5000||String(v.title||'').length>200||(v.cover_url&&!https(v.cover_url)))throw new Error('Check the channel caption, title or cover link.');
   }
  }
  if(['brand_review','artist_review'].includes(b.action)&&!['approved','changes'].includes(b.decision))throw new Error('Choose approve or request changes.');
  if(b.action==='publication_save'){
   if(!uuid(b.id)||!Number.isInteger(b.lock_version)||b.lock_version<1)throw new Error('Reload the publication before saving.');
   if(b.scheduled_at&&!instant(b.scheduled_at))throw new Error('Choose a valid publication time with timezone.');
   if(b.published_at&&!instant(b.published_at))throw new Error('Choose a valid actual publication time.');
   if(b.post_url&&!https(b.post_url))throw new Error('Use an HTTPS live post link.');
  }
  return reply({ok:true,result:checked(await sb.rpc('calendar_save',{p,actor:identity.actor}))});
 }catch(e){const message=e instanceof Error?e.message:'Could not save the calendar.';return reply({ok:false,error:message},/changed|Refresh/.test(message)?409:400);}
}
Deno.serve(req=>handleCalendar(req,createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})));
