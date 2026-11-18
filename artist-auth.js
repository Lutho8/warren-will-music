/* Personal CRM sign-in; server-owned roles determine workspace access. */
(() => {
 const BASE='https://tqwaepvdsvyyfgtlurkm.supabase.co';
 const PUBLIC_KEY='sb_publishable_qMkHF94cXQxAgoOBsONR3A_acb9DL7q';
 const STORE='ww-personal-session',VIEW='ww-crm-view';
 localStorage.removeItem('wwAdminKey');localStorage.removeItem('wwAdminRole');
 let session,refreshFlight;try{session=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{session=null;}
 const normalise=s=>({...s,expires_at:Number(s.expires_at)||Math.floor(Date.now()/1000)+Number(s.expires_in||0)});
 window.hasArtistSession=()=>!!session?.access_token;
 window.artistAuthHeaders=()=>session?.access_token?{'Authorization':'Bearer '+session.access_token}:{};
 window.crmCurrentView=()=>sessionStorage.getItem(VIEW)||'';
 window.clearArtistSession=()=>{window.hideTeamBoard?.();window.hideArtistWorkspace?.();session=null;refreshFlight=null;sessionStorage.removeItem(STORE);sessionStorage.removeItem(VIEW);Object.keys(sessionStorage).filter(k=>k.startsWith('ww-draft:')).forEach(k=>sessionStorage.removeItem(k));};
 window.artistSignIn=async(email,password)=>{
  window.clearArtistSession();
  const r=await fetch(BASE+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:String(email).trim().toLowerCase(),password})});
  if(!r.ok)throw new Error('Sign-in failed. Check your email and password.');
  session=normalise(await r.json());sessionStorage.setItem(STORE,JSON.stringify(session));
 };
 async function sessionReady(){
  if(!session)return false;
  if(Number(session.expires_at)*1000>Date.now()+60000)return session;
  if(refreshFlight)return refreshFlight;
  const activeSession=session;
  const request=(async()=>{
   const r=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:activeSession.refresh_token})});
   if(session!==activeSession)return false;
   if(!r.ok){if([400,401,403].includes(r.status)){window.clearArtistSession();return false;}throw new Error('Could not renew your session. Your work is still open; check your connection and retry.');}
   const refreshed=normalise(await r.json());if(session!==activeSession)return false;
   if(!refreshed.access_token||!refreshed.refresh_token||refreshed.expires_at*1000<=Date.now())throw new Error('Could not renew your session. Please retry.');
   session=refreshed;sessionStorage.setItem(STORE,JSON.stringify(session));return session;
  })();
  refreshFlight=request;
  try{return await request;}finally{if(refreshFlight===request)refreshFlight=null;}
 }
 // Every CRM request renews its token first. Never attach the personal token to an external URL.
 window.artistFetch=async(url,options={})=>{
  if(typeof url!=='string'||!url.startsWith(BASE+'/functions/v1/'))throw new Error('Invalid CRM request.');
  const ready=await sessionReady();if(!ready||session!==ready)throw new Error('Your session expired. Sign in again.');
  return fetch(url,{...options,headers:{...options.headers,...window.artistAuthHeaders()}});
 };
 window.artistLoadData=async(view)=>{
  if(!session)return null;
  const ready=await sessionReady();if(!ready||session!==ready)return null;
  const requestSession=session;
  const r=await fetch(BASE+'/functions/v1/artist-workspace',{method:'POST',headers:{'Content-Type':'application/json',...window.artistAuthHeaders()},body:JSON.stringify({action:'dashboard',view:view||window.crmCurrentView()||undefined})});
  const d=await r.json();if(session!==requestSession)return null;
  if(r.status===401){window.clearArtistSession();d.auth_expired=true;}
  if(d.ok&&d.view)sessionStorage.setItem(VIEW,d.view);
  return d;
 };
 window.artistSignOut=async()=>{try{if(session)await fetch(BASE+'/auth/v1/logout',{method:'POST',headers:{apikey:PUBLIC_KEY,...window.artistAuthHeaders()}});}finally{window.clearArtistSession();}};
})();
