import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../artist-auth.js',import.meta.url),'utf8');
function runtime(expired=false){
 const values=new Map([['ww-personal-session',JSON.stringify({access_token:'old-personal-token',refresh_token:'old-refresh-token',expires_at:expired?1:4102444800})]]);
 let resolve;const pending=new Promise(r=>resolve=r);
 const context={window:{},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},document:{addEventListener(){}},fetch:()=>pending,Date,JSON,KEY:'test-shared-code'};
 vm.createContext(context);vm.runInContext(source,context);
 return {window:context.window,values,respond:resolve};
}
test('Late personal authentication failure cannot clear a newer shared-code login',async()=>{
 const r=runtime();const pending=r.window.artistLoadData();r.window.clearArtistSession();
 r.respond(new Response(JSON.stringify({ok:false}),{status:401}));
 assert.equal(await pending,null);assert.equal(r.window.hasArtistSession(),false);
 assert.equal(r.window.artistAuthHeaders()['x-admin-key'],'test-shared-code');
});
test('Late token refresh cannot restore a cleared personal session',async()=>{
 const r=runtime(true);const pending=r.window.artistLoadData();r.window.clearArtistSession();
 r.respond(new Response(JSON.stringify({access_token:'late-token',expires_at:4102444800})));
 assert.equal(await pending,null);assert.equal(r.window.hasArtistSession(),false);
 assert.equal(r.values.has('ww-personal-session'),false);
});
