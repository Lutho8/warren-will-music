import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../artist-auth.js',import.meta.url),'utf8');
function runtime(expired=false){
 const values=new Map([['ww-personal-session',JSON.stringify({access_token:'old-personal-token',refresh_token:'old-refresh-token',expires_at:expired?1:4102444800})]]);
 let resolve;const pending=new Promise(r=>resolve=r);
 const context={localStorage:{removeItem(){}},window:{},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},document:{addEventListener(){}},fetch:()=>pending,Date,JSON,KEY:'test-shared-code'};
 vm.createContext(context);vm.runInContext(source,context);
 return {window:context.window,values,respond:resolve};
}
test('Late personal authentication failure cannot restore a cleared session',async()=>{
 const r=runtime();const pending=r.window.artistLoadData();r.window.clearArtistSession();
 r.respond(new Response(JSON.stringify({ok:false}),{status:401}));
 assert.equal(await pending,null);assert.equal(r.window.hasArtistSession(),false);
 assert.equal(Object.keys(r.window.artistAuthHeaders()).length,0);
});
test('Late token refresh cannot restore a cleared personal session',async()=>{
 const r=runtime(true);const pending=r.window.artistLoadData();r.window.clearArtistSession();
 r.respond(new Response(JSON.stringify({access_token:'late-token',expires_at:4102444800})));
 assert.equal(await pending,null);assert.equal(r.window.hasArtistSession(),false);
 assert.equal(r.values.has('ww-personal-session'),false);
});
function liveRuntime(fetch,seed={access_token:'old-token',refresh_token:'refresh-token',expires_at:1}){
 const values=new Map(seed?[['ww-personal-session',JSON.stringify(seed)]]:[]);
 const context={localStorage:{removeItem(){}},window:{},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetch,Date,JSON};
 vm.createContext(context);vm.runInContext(source,context);return {window:context.window,values};
}
const api='https://tqwaepvdsvyyfgtlurkm.supabase.co/functions/v1/team-board';
const fresh=()=>new Response(JSON.stringify({access_token:'renewed-token',refresh_token:'renewed-refresh',expires_in:3600}));
test('Concurrent CRM saves share one token refresh and keep the request bodies',async()=>{
 let resolve,refreshes=0;const calls=[],renewal=new Promise(r=>resolve=r);
 const r=liveRuntime(async(url,options)=>{if(url.includes('grant_type=refresh_token')){refreshes++;return renewal;}calls.push({url,options});return new Response(JSON.stringify({ok:true}));});
 const first=r.window.artistFetch(api,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer stale'},body:'first draft'});
 const second=r.window.artistFetch(api,{method:'POST',body:'second draft'});
 assert.equal(refreshes,1);assert.equal(calls.length,0);resolve(fresh());await Promise.all([first,second]);
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.options.body),['first draft','second draft']);
 assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer renewed-token'));
 assert.equal(calls[0].options.headers['Content-Type'],'application/json');
 assert.ok(JSON.parse(r.values.get('ww-personal-session')).expires_at>Date.now()/1000+3500);
});
test('A temporary refresh failure keeps the session and allows a later save retry',async()=>{
 let renewals=0,saves=0;const r=liveRuntime(async url=>url.includes('grant_type=refresh_token')?(++renewals===1?new Response('{}',{status:503}):fresh()):(++saves,new Response('{}')));
 await assert.rejects(r.window.artistFetch(api),/check your connection and retry/);
 assert.equal(r.window.hasArtistSession(),true);assert.equal(saves,0);
 await r.window.artistFetch(api);assert.equal(renewals,2);assert.equal(saves,1);
});
test('Signing out during renewal prevents a queued CRM mutation',async()=>{
 let resolve,saves=0;const renewal=new Promise(r=>resolve=r),r=liveRuntime(async url=>url.includes('grant_type=refresh_token')?renewal:(saves++,new Response('{}')));
 const save=r.window.artistFetch(api,{method:'POST',body:'private draft'});r.window.clearArtistSession();resolve(fresh());
 await assert.rejects(save,/Sign in again/);assert.equal(saves,0);assert.equal(r.window.hasArtistSession(),false);
});
test('The authenticated request helper refuses external destinations',async()=>{
 let calls=0;const r=liveRuntime(async()=>{calls++;return fresh();});
 await assert.rejects(r.window.artistFetch('https://example.test/functions/v1/team-board'),/Invalid CRM request/);assert.equal(calls,0);
});
