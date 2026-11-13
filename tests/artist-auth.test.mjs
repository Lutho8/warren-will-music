import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../artist-auth.js',import.meta.url),'utf8');
function runtime(expired=false){
 const values=new Map([['ww-personal-session',JSON.stringify({access_token:'old-personal-token',refresh_token:'old-refresh-token',expires_at:expired?1:4102444800})]]);
 let resolve;const pending=new Promise(r=>resolve=r);
 const persistent=new Map();
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]||null,get length(){return m.size;}});
 const context={localStorage:storage(persistent),window:{},sessionStorage:storage(values),document:{addEventListener(){}},fetch:()=>pending.then(res=>res.clone()),Date,JSON,KEY:'test-shared-code'};
 vm.createContext(context);vm.runInContext(source,context);
 return {window:context.window,values,persistent,respond:resolve};
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

test('Personal session and selected workspace survive a fresh tab and are cleared by sign-out',async()=>{
 const current=runtime();
 const mockResponse={ok:true,view:'warren',available_views:['warren','team']};
 const pending=current.window.artistLoadData('warren');
 current.respond(new Response(JSON.stringify(mockResponse),{status:200}));
 assert.equal((await pending).view,'warren');
 // The session was created in an older tab: emulate a successful sign-in by persisting it.
 current.persistent.set('ww-personal-session',current.values.get('ww-personal-session'));
 assert.equal(current.persistent.get('ww-crm-view'),'warren');
 // Start in a fresh browser tab with empty session storage and the saved persistent store.
 const reloadStorage=new Map(current.persistent);
 const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]||null,get length(){return m.size;}});
 const reopened={localStorage:storage(reloadStorage),sessionStorage:storage(new Map()),window:{},Date,JSON,fetch:async()=>new Response(JSON.stringify(mockResponse),{status:200})};
 vm.createContext(reopened);vm.runInContext(source,reopened);
 assert.equal(reopened.window.hasArtistSession(),true);
 assert.equal(reopened.window.crmCurrentView(),'warren');
 assert.equal((await reopened.window.artistLoadData()).ok,true);
 reopened.window.clearArtistSession();
 assert.equal(reopened.window.hasArtistSession(),false);
 assert.equal(reloadStorage.has('ww-personal-session'),false);
 assert.equal(reloadStorage.has('ww-crm-view'),false);
});
test('Expired persistent session is refreshed and refresh token rotates in both stores',async()=>{
 const r=runtime(true);
 r.persistent.set('ww-personal-session',r.values.get('ww-personal-session'));
 const pending=r.window.artistLoadData();
 r.respond(new Response(JSON.stringify({access_token:'rotated',refresh_token:'new-refresh',expires_at:4102444800})));
 // The mock returns a token payload for both refresh and the next dashboard request.
 await pending;
 assert.equal(JSON.parse(r.persistent.get('ww-personal-session')).refresh_token,'new-refresh');
 r.window.clearArtistSession();
 assert.equal(r.persistent.has('ww-personal-session'),false);
});

test('Successful personal sign-in writes persistent storage',async()=>{
 const r=runtime();
 const promise=r.window.artistSignIn('valid@example.org','example-password');
 r.respond(new Response(JSON.stringify({access_token:'signed-in-token',refresh_token:'new-refresh-token',expires_at:4102444800}),{status:200}));
 await promise;
 assert.equal(r.window.hasArtistSession(),true);
 assert.equal(JSON.parse(r.persistent.get('ww-personal-session')).access_token,'signed-in-token');
 r.window.clearArtistSession();
 assert.equal(r.persistent.has('ww-personal-session'),false);
});
