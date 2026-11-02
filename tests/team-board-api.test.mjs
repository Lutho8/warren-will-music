import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/team-board/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,''));
const ID='11111111-1111-4111-8111-111111111111';
function runtime(identity={actor:ID,owner:false},db={},rpcResult){
 let handler;const calls=[];
 class Q{
 constructor(table){this.table=table;this.filters=[];}
 select(fields){this.fields=fields;return this;}eq(k,v){this.filters.push(['eq',k,v]);return this;}or(v){this.filters.push(['or',v]);return this;}is(k,v){this.filters.push(['is',k,v]);return this;}order(){return this;}limit(){return this;}single(){return this;}maybeSingle(){return this;}
 insert(value){this.value=value;return this;}update(value){this.value=value;return this;}
 then(resolve,reject){calls.push(this);return Promise.resolve(db[this.table]||{data:[],error:null}).then(resolve,reject);}
 }
 const sb={from:t=>new Q(t),rpc:async(name,args)=>{calls.push({name,args});return {data:rpcResult===undefined?{...args.p,task_version:1}:rpcResult,error:null};},auth:{admin:{getUserById:async()=>({data:{user:{email_confirmed_at:'2026',email:'test@example.com',app_metadata:{crm_enabled:true}}}})}}};
 const context={Request,Response,URL,Date,Number,String,Array,JSON,Error,AbortSignal,crmIdentity:async()=>identity,createClient:()=>sb,Deno:{serve:fn=>handler=fn,env:{get:()=>''}},fetch:()=>{throw new Error('No live email in tests');}};
 vm.createContext(context);vm.runInContext(source,context);
 return {calls,request:async body=>{const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
test('Team board requires verified personal authentication',async()=>{const r=runtime(null);assert.equal((await r.request({action:'list'})).status,401);assert.equal(r.calls.length,0);});
test('Team board reads only shared work and never private approvals, contacts or invoices',async()=>{const r=runtime();assert.equal((await r.request({action:'list'})).body.ok,true);const q=r.calls.find(c=>c.table==='client_board');assert.deepEqual(q.filters,[['eq','kind','work'],['or','owner.in.(team,lutho),owner.is.null'],['is','archived_at',null]]);assert.ok(r.calls.every(c=>['crm_user_roles','client_board'].includes(c.table)));});
test('Private task comments fail closed before reading comments',async()=>{const r=runtime(undefined,{client_board:{error:{message:'Not found'}}});assert.equal((await r.request({action:'comments',id:ID})).body.ok,false);assert.equal(r.calls.length,1);assert.equal(r.calls[0].table,'client_board');});
test('Invalid deadlines and unsupported statuses never write',async()=>{const task={title:'Task',task_version:0,status:'open',priority:'normal',assignee_id:null,reviewer_id:null};for(const change of [{due_date:'2026-02-30'},{status:'approved'},{task_version:-1},{assignee_id:'arbitrary-person'}]){const r=runtime();assert.equal((await r.request({action:'save',id:ID,task:{...task,...change}})).body.ok,false);assert.equal(r.calls.length,0);}});
test('Saving a team task uses authenticated actor and server-controlled ID',async()=>{const r=runtime();const out=await r.request({action:'save',id:ID,task:{id:'spoofed',title:'Test',task_version:0,status:'open',priority:'normal',assignee_id:null,reviewer_id:null}});assert.equal(out.body.ok,true);assert.equal(r.calls[0].args.actor,ID);assert.equal(r.calls[0].args.p.id,ID);});
test('Social member comments use verified author identity',async()=>{const r=runtime({actor:ID,owner:false},{client_board:{data:{id:ID},error:null}});assert.equal((await r.request({action:'comment',id:ID,body:'Ready for review'})).body.ok,true);const q=r.calls.find(c=>c.table==='board_comments');assert.equal(q.value.author_id,ID);});

test('Composite RPC array response is normalized to one saved task',async()=>{const r=runtime(undefined,{},[{id:ID,title:'Test',task_version:1}]);const out=await r.request({action:'save',id:ID,task:{title:'Test',task_version:0,status:'open',priority:'normal',assignee_id:null,reviewer_id:null}});assert.equal(out.body.ok,true);assert.equal(out.body.task.id,ID);assert.equal(Array.isArray(out.body.task),false);});

test('Team members cannot remove tasks without admin authorization',async()=>{const r=runtime();assert.equal((await r.request({action:'archive',id:ID,task_version:1})).status,403);assert.equal(r.calls.length,0);});
test('Admin task removal uses the current task version and writes an audit entry',async()=>{const r=runtime({actor:ID,owner:false,isAdmin:true},{client_board:{data:{id:ID},error:null}});const out=await r.request({action:'archive',id:ID,task_version:4});assert.equal(out.body.ok,true);const q=r.calls.find(c=>c.table==='client_board');assert.ok(q.filters.some(f=>f[1]==='task_version'&&f[2]===4));assert.ok(r.calls.some(c=>c.table==='crm_audit'));});
