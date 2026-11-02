/* Personal CRM sign-in; server-owned roles determine workspace access. */
(() => {
 const BASE='https://tqwaepvdsvyyfgtlurkm.supabase.co';
 const PUBLIC_KEY='sb_publishable_qMkHF94cXQxAgoOBsONR3A_acb9DL7q';
 const STORE='ww-personal-session',VIEW='ww-crm-view';
 localStorage.removeItem('wwAdminKey');localStorage.removeItem('wwAdminRole');
 let session;try{session=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{session=null;}
 window.hasArtistSession=()=>!!session?.access_token;
 window.artistAuthHeaders=()=>session?.access_token?{'Authorization':'Bearer '+session.access_token}:{};
 window.crmCurrentView=()=>sessionStorage.getItem(VIEW)||'';
 window.clearArtistSession=()=>{session=null;sessionStorage.removeItem(STORE);sessionStorage.removeItem(VIEW);Object.keys(sessionStorage).filter(k=>k.startsWith('ww-draft:')).forEach(k=>sessionStorage.removeItem(k));};
 window.artistSignIn=async(email,password)=>{
  window.clearArtistSession();
  const r=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:String(email).trim().toLowerCase(),password})});
  if(!r.ok)throw new Error('Sign-in failed. Check your email and password.');
  session=await r.json();sessionStorage.setItem(STORE,JSON.stringify(session));
 };
 window.artistLoadData=async(view)=>{
  if(!session)return null;
  const activeSession=session;
  if(Date.now()>session.expires_at*1000-60000){
   const r=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
   if(session!==activeSession)return null;
   if(!r.ok){window.clearArtistSession();return {ok:false,error:'Your session expired. Sign in again.',auth_expired:true};}
   const refreshed=await r.json();if(session!==activeSession)return null;session=refreshed;sessionStorage.setItem(STORE,JSON.stringify(session));
  }
  const requestSession=session;
  const r=await fetch(BASE+'/functions/v1/artist-workspace',{method:'POST',headers:{'Content-Type':'application/json',...window.artistAuthHeaders()},body:JSON.stringify({action:'dashboard',view:view||window.crmCurrentView()||undefined})});
  const d=await r.json();if(session!==requestSession)return null;
  if(r.status===401){window.clearArtistSession();d.auth_expired=true;}
  if(d.ok&&d.view)sessionStorage.setItem(VIEW,d.view);
  return d;
 };
 window.artistSignOut=async()=>{try{if(session)await fetch(BASE+'/auth/v1/logout',{method:'POST',headers:{apikey:PUBLIC_KEY,...window.artistAuthHeaders()}});}finally{window.clearArtistSession();}};
})();
