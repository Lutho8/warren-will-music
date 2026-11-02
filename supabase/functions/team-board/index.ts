import { createClient } from 'jsr:@supabase/supabase-js@2.57.4';
import { crmIdentity } from '../_shared/crm-identity.ts';
const cors={'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
const reply=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json'}});
const ok=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
const uuid=(s:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));
const text=(s:unknown,n:number)=>String(s??'').trim().slice(0,n);
const fields='id,title,details,status,priority,due_date,assignee_id,reviewer_id,creator_id,blocked_reason,task_version,created_at,done_at';
const shared=(q:any)=>q.eq('kind','work').or('owner.in.(team,lutho),owner.is.null').is('archived_at',null);
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({ok:false,error:'Method not allowed'},405);
 const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
 const identity=await crmIdentity(req,sb);if(!identity)return reply({ok:false,error:'Please sign in again.'},401);
 const b=await req.json();const actor=identity.actor;
 if(b.action==='list'){
 const directory=ok(await sb.from('crm_user_roles').select('user_id,role,display_name').eq('active',true));
 const members=await Promise.all(directory.filter((m:any)=>['artist','management','social_media','videographer_photographer'].includes(m.role)).map(async(m:any)=>{
 const u=ok(await sb.auth.admin.getUserById(m.user_id))?.user;
 if(!u?.email_confirmed_at||u.app_metadata?.crm_enabled!==true)return null;
 return {id:m.user_id,name:text(m.display_name||u.email?.split('@')[0]||'Team member',100)};
 }));
 const tasks=ok(await shared(sb.from('client_board').select(fields)).order('created_at',{ascending:false}).limit(1000));
 return reply({ok:true,actor,members:members.filter(Boolean),tasks,email_configured:!!(Deno.env.get('RESEND_API_KEY')&&Deno.env.get('RESEND_FROM')),limit:1000});
 }
 if(!uuid(b.id))return reply({ok:false,error:'Valid task ID required.'},400);
 if(b.action==='save'){
 const p=b.task;
 if(!p||!text(p.title,200)||String(p.title).length>200||!Number.isInteger(p.task_version)||p.task_version<0||!['open','in_progress','review','done'].includes(p.status)||!['normal','high','low'].includes(p.priority))throw new Error('Check the task title and status.');
 for(const key of ['assignee_id','reviewer_id'])if(p[key]!==null&&!uuid(p[key]))throw new Error('Choose a team member.');
 if(p.due_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.due_date)||!Number.isFinite(Date.parse(p.due_date))||new Date(p.due_date).toISOString().slice(0,10)!==p.due_date))throw new Error('Choose a valid deadline.');
 const task=ok(await sb.rpc('save_team_task',{actor,p:{...p,id:b.id,title:text(p.title,200),details:text(p.details,1000)||null,blocked_reason:text(p.blocked_reason,500)||null,due_date:p.due_date||null}}));
 // A failed email never undoes a saved task. Atomic claims prevent duplicate sends.
 let warning='';
 try{
 const notifications=ok(await sb.from('team_task_notifications').select('id,recipient_id,event').eq('board_id',b.id).eq('task_version',task.task_version).eq('state','pending'));
 for(const n of notifications){
 const claim=ok(await sb.from('team_task_notifications').update({state:'sending'}).eq('id',n.id).eq('state','pending').select('id').maybeSingle());if(!claim)continue;
 const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM');
 const recipient=ok(await sb.auth.admin.getUserById(n.recipient_id))?.user;
 if(!key||!from||!recipient?.email_confirmed_at||recipient.app_metadata?.crm_enabled!==true){ok(await sb.from('team_task_notifications').update({state:'unavailable'}).eq('id',n.id));warning='Task saved. Email notification is not configured for this recipient.';continue;}
 const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`team-task-${n.id}`},body:JSON.stringify({from,to:[recipient.email],subject:`${n.event==='review'?'Review requested':'Task assigned'}: ${task.title}`,text:`${task.title}\n${task.due_date?'Due: '+task.due_date+'\n':''}\nOpen task: https://www.warrenwill.net/admin.html#team-task/${task.id}`}),signal:AbortSignal.timeout(10000)});
 ok(await sb.from('team_task_notifications').update({state:result.ok?'sent':'failed'}).eq('id',n.id));if(!result.ok)warning='Task saved, but the email could not be delivered.';
 }
 }catch{warning='Task saved, but email delivery could not be confirmed.';}
 return reply({ok:true,task,warning});
 }
 const task=ok(await shared(sb.from('client_board').select('id')).eq('id',b.id).single());if(!task)throw new Error('Task not found.');
 if(b.action==='comments'){
 const comments=ok(await sb.from('board_comments').select('id,body,author,author_id,created_at').eq('board_id',b.id).order('created_at',{ascending:false}).limit(100));return reply({ok:true,comments:comments.reverse()});
 }
 if(b.action==='comment'){
 const body=text(b.body,1000);if(!body)throw new Error('Write a comment first.');
 ok(await sb.from('board_comments').insert({board_id:b.id,author:identity.owner?'warren':'lutho',author_id:actor,body}));return reply({ok:true});
 }
 return reply({ok:false,error:'Unknown action.'},400);
 }catch(e){return reply({ok:false,error:e instanceof Error?e.message:'Could not save. Please retry.'},400);}
});
