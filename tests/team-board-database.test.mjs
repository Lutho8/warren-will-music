import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('Team tasks preserve shared records, enforce versions, queue deduplicated alerts, and exclude private work',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create table crm_user_roles(user_id uuid primary key references auth.users(id),role text,active boolean);
 create table client_board(id uuid primary key default gen_random_uuid(),kind text,owner text,title text,details text,status text default 'open',priority text,due_date date,created_by text,created_at timestamptz default now(),updated_at timestamptz default now(),done_at timestamptz,archived_at timestamptz);
 create table board_comments(id uuid primary key default gen_random_uuid(),board_id uuid references client_board(id),author text,body text,created_at timestamptz default now());
 create table crm_audit(actor text,action text,entity_id text,details jsonb);
 insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 insert into crm_user_roles select id,'social_media',true from auth.users;`);
 await db.exec(fs.readFileSync(new URL('../docs/team-board-schema.sql',import.meta.url),'utf8'));
 const actor='11111111-1111-4111-8111-111111111111', assignee='22222222-2222-4222-8222-222222222222';
 const p={id:crypto.randomUUID(),title:'Prepare footage',details:'Clear outcome',status:'open',priority:'normal',task_version:0,assignee_id:assignee,reviewer_id:assignee,due_date:null};
 const save=async(p,a=actor)=>(await db.query('select to_jsonb(public.save_team_task($1::jsonb,$2::uuid)) as task',[JSON.stringify(p),a])).rows[0].task;
 const first=await save(p);assert.equal(first.owner,'team');assert.equal(first.creator_id,actor);assert.equal(first.task_version,1);
 assert.equal((await db.query('select * from team_task_notifications')).rows.length,1);
 await assert.rejects(save(p),/Task changed/);
 const second=await save({...p,task_version:1,status:'in_progress'});assert.equal(second.task_version,2);
 assert.equal((await db.query('select * from team_task_notifications')).rows.length,1);
 const review=await save({...p,task_version:2,status:'review'});assert.equal(review.status,'review');
 assert.equal((await db.query("select * from team_task_notifications where event='review'")).rows.length,1);
 const done=await save({...p,task_version:3,status:'done'});assert.ok(done.done_at);
 const reopened=await save({...p,task_version:4,status:'open'});assert.equal(reopened.done_at,null);
 await db.query("update client_board set title='Legacy edit' where id=$1",[p.id]);
 await assert.rejects(save({...p,task_version:5}),/Task changed/);
 await db.exec(`insert into client_board(id,kind,owner,title,status) values('33333333-3333-4333-8333-333333333333','work','warren','Private','open')`);
 await assert.rejects(save({...p,id:'33333333-3333-4333-8333-333333333333',task_version:1}),/Not a shared team task/);
 // Self-assignment is an assignment event, but editing the same task is not.
 const self={...p,id:crypto.randomUUID(),assignee_id:actor,reviewer_id:null};
 await save(self);
 let selfAlerts=await db.query('select * from team_task_notifications where board_id=$1',[self.id]);
 assert.equal(selfAlerts.rows.length,1);assert.equal(selfAlerts.rows[0].recipient_id,actor);assert.equal(selfAlerts.rows[0].event,'assigned');
 await save({...self,task_version:1,title:'Edited self task'});
 selfAlerts=await db.query('select * from team_task_notifications where board_id=$1',[self.id]);assert.equal(selfAlerts.rows.length,1);
 await save({...self,task_version:2,assignee_id:null});
 await save({...self,task_version:3});
 selfAlerts=await db.query('select * from team_task_notifications where board_id=$1',[self.id]);assert.equal(selfAlerts.rows.length,2);
 await db.query('update crm_user_roles set active=false where user_id=$1',[assignee]);
 await assert.rejects(save({...p,task_version:6}),/active assignee/);
 await assert.rejects(save({...p,task_version:6,assignee_id:null,reviewer_id:null},assignee),/Active team account/);
 const acl=(await db.query("select has_function_privilege('anon','save_team_task(jsonb,uuid)','execute') as anon,has_function_privilege('authenticated','save_team_task(jsonb,uuid)','execute') as authenticated,relrowsecurity from pg_class where relname='team_task_notifications'")).rows[0];
 assert.equal(acl.anon,false);assert.equal(acl.authenticated,false);assert.equal(acl.relrowsecurity,true);
 }finally{await db.close();}
});
