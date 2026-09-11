/* Optional personal Supabase sign-in. Existing access remains during migration. */
(() => {
 const BASE='https://tqwaepvdsvyyfgtlurkm.supabase.co';
 const PUBLIC_KEY='sb_publishable_qMkHF94cXQxAgoOBsONR3A_acb9DL7q';
 const STORE='ww-personal-session';
 let session;try{session=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{session=null;}
 window.hasArtistSession=()=>!!session?.access_token;
 window.artistAuthHeaders=()=>session?.access_token?{'Authorization':'Bearer '+session.access_token}:{'x-admin-key':KEY};
 window.clearArtistSession=()=>{session=null;sessionStorage.removeItem(STORE);Object.keys(sessionStorage).filter(k=>k.startsWith('ww-draft:')).forEach(k=>sessionStorage.removeItem(k));};
 window.artistLoadData=async()=>{
 if(!session)return null;
 if(Date.now()>session.expires_at*1000-60000){
 const r=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
 if(!r.ok){window.clearArtistSession();return {ok:false,error:'Sitzung abgelaufen',auth_expired:true};}
 session=await r.json();sessionStorage.setItem(STORE,JSON.stringify(session));}
 const r=await fetch(BASE+'/functions/v1/artist-workspace',{method:'POST',headers:{'Content-Type':'application/json',...window.artistAuthHeaders()},body:JSON.stringify({action:'dashboard'})});
 const d=await r.json();if(r.status===401){window.clearArtistSession();d.auth_expired=true;}return d;
 };
 window.artistSignOut=async()=>{try{if(session)await fetch(BASE+'/auth/v1/logout',{method:'POST',headers:{apikey:PUBLIC_KEY,...window.artistAuthHeaders()}});}finally{window.clearArtistSession();}};
 document.addEventListener('DOMContentLoaded',()=>{
 const gate=document.querySelector('.gate-card');if(!gate)return;
 const details=document.createElement('details');details.style='margin-top:20px;text-align:left';details.innerHTML='<summary style="cursor:pointer;font-size:14px;padding:12px 0">Persönlich mit E-Mail anmelden</summary><p style="font-size:12px;line-height:1.5">Für bereits eingerichtete persönliche Zugänge. Das Management muss dein Konto zuvor freischalten.</p><form id="personalLogin"><label style="display:block;margin-top:12px">E-Mail<input type="email" name="email" autocomplete="username" required></label><label style="display:block;margin-top:12px">Passwort<input type="password" name="password" autocomplete="current-password" required></label><button type="submit" style="margin-top:16px;min-height:44px">Persönlich anmelden</button><p role="alert" id="personalError" style="font-size:13px"></p></form>';
 gate.append(details);details.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('button');const err=details.querySelector('#personalError');btn.disabled=true;err.textContent='Anmeldung wird geprüft …';try{const data=new FormData(e.target);const r=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});e.target.elements.password.value='';if(!r.ok)throw new Error('Anmeldung fehlgeschlagen. Zugangsdaten und Freischaltung prüfen.');session=await r.json();sessionStorage.setItem(STORE,JSON.stringify(session));await load();err.textContent='';}catch(error){err.textContent=error.message;}finally{btn.disabled=false;}});
 });
})();
