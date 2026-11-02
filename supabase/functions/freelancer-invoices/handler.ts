const MAX_PDF=5242880;
const ORIGINS=['https://www.warrenwill.net','https://warrenwill.net'];
const uuid=(s:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
const text=(s:unknown,max:number)=>{if(typeof s!=='string'||s.trim().length>max)throw new HttpError(400,'Check the text fields.');return s.trim();};
const day=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
class HttpError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
const ok=(r:any)=>{if(r.error)throw new HttpError(503,'The invoice service could not save or load this record. Please refresh.');return r.data;};
export function validIBAN(input:unknown){
 if(typeof input!=='string')return false;const value=input.toUpperCase().replace(/\s/g,'');
 if(!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(value))return false;
 // SWIFT ISO 13616 IBAN Registry, release 103 (September 2026).
 // https://www.swift.com/swift-resource/9606/download?language=en
 const lengths:Record<string,number>={AD:24,AE:23,AL:28,AT:20,AZ:28,BA:20,BE:16,BG:22,BH:22,BI:27,BR:29,BY:28,CH:21,CR:22,CY:28,CZ:24,DE:22,DJ:27,DK:18,DO:28,EE:20,EG:29,ES:24,FI:18,FK:18,FO:18,FR:27,GB:22,GE:22,GI:23,GL:18,GR:27,GT:28,HN:28,HR:21,HU:28,IE:22,IL:23,IQ:23,IS:26,IT:27,JO:30,KW:30,KZ:20,LB:28,LC:32,LI:21,LT:20,LU:20,LV:21,LY:25,MC:27,MD:24,ME:22,MK:19,MN:20,MR:27,MT:31,MU:30,NI:28,NL:18,NO:15,OM:23,PK:24,PL:28,PS:29,PT:25,QA:29,RO:24,RS:22,RU:33,SA:24,SC:31,SD:18,SE:24,SI:19,SK:24,SM:27,SO:23,ST:25,SV:28,TL:23,TN:24,TR:26,UA:29,VA:22,VG:24,XK:20,YE:30};
 if(lengths[value.slice(0,2)]!==value.length)return false;
 let remainder=0;for(const char of value.slice(4)+value.slice(0,4))for(const digit of (/\d/.test(char)?char:String(char.charCodeAt(0)-55)))remainder=(remainder*10+Number(digit))%97;
 return remainder===1;
}
async function boundedBody(req:Request,limit:number){
 if(Number(req.headers.get('content-length'))>limit)throw new HttpError(413,'The invoice PDF must be no larger than 5 MB.');
 const reader=req.body?.getReader();if(!reader)throw new HttpError(400,'Request data is missing.');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'The invoice PDF must be no larger than 5 MB.');}chunks.push(value);}
 const body=new Uint8Array(size);let pos=0;for(const chunk of chunks){body.set(chunk,pos);pos+=chunk.length;}return body;
}
export function createInvoiceHandler(sb:any,managementKey:()=>string){
 return async(req:Request)=>{
 const origin=req.headers.get('origin');const headers={'Access-Control-Allow-Origin':origin&&ORIGINS.includes(origin)?origin:ORIGINS[0],'Access-Control-Allow-Headers':'authorization,content-type,x-admin-key','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin','Content-Type':'application/json'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!ORIGINS.includes(origin))return reply({ok:false,error:'Origin is not allowed.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({ok:false,error:'Method is not allowed.'},405);
 try{
 let role:string,actor:string,profile:any=null;
 const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'');
 if(bearer){
  const {data,error}=await sb.auth.getUser(bearer);const user=data?.user;
  if(error||!user?.email_confirmed_at||!user.email)throw new HttpError(401,'Please sign in with a verified personal account.');
  actor=user.id;
  const assignment=ok(await sb.from('crm_user_roles').select('role,active').eq('user_id',user.id).eq('active',true).maybeSingle());
  if(user.app_metadata?.crm_enabled===true&&assignment&&['management','artist'].includes(assignment.role))role='team';
  else {profile=ok(await sb.from('freelancer_profiles').select('id,display_name,email,active').eq('email',user.email.trim().toLowerCase()).eq('active',true).maybeSingle());
   if(!profile)throw new HttpError(403,'Your email has not been enabled for freelancer invoices. Contact management.');role='freelancer';}
 }else{throw new HttpError(401,'Please sign in with your personal email and password.');}

 const team=()=>{if(role!=='team')throw new HttpError(403,'Only management can perform this action.');};
 const invoice=async(id:unknown)=>{
  if(!uuid(id))throw new HttpError(400,'Select an invoice.');
  let query=sb.from('freelancer_invoices').select('*').eq('id',id);if(profile)query=query.eq('freelancer_id',profile.id);
  const inv=ok(await query.maybeSingle());if(!inv)throw new HttpError(404,'Invoice not found.');return inv;
 };
 const type=req.headers.get('content-type')||'';
 if(type.startsWith('multipart/form-data')){
  const bytes=await boundedBody(req,MAX_PDF+65536);
  const form=await new Request(req.url,{method:'POST',headers:{'content-type':type},body:bytes}).formData();
  let data:any;try{data=JSON.parse(String(form.get('metadata')));}catch{throw new HttpError(400,'Invoice details are missing.');}
  if(!data||data.action!=='upload_invoice'||!uuid(data.id))throw new HttpError(400,'Invalid upload request.');
  const freelancerId=profile?.id||data.freelancer_id;
  if(!uuid(freelancerId))throw new HttpError(400,'Choose a freelancer.');
  if(role==='team'){const p=ok(await sb.from('freelancer_profiles').select('id').eq('id',freelancerId).eq('active',true).maybeSingle());if(!p)throw new HttpError(400,'Choose an active freelancer.');}
  const value={id:data.id,freelancer_id:freelancerId,invoice_number:text(data.invoice_number,120),description:text(data.description,1000),payee_name:text(data.payee_name,200),iban:typeof data.iban==='string'?data.iban.toUpperCase().replace(/\s/g,''):'',amount_cents:data.amount_cents,issue_date:data.issue_date,due_date:data.due_date};
  if(!value.invoice_number||!value.description||!value.payee_name||!validIBAN(value.iban)||!Number.isSafeInteger(value.amount_cents)||value.amount_cents<1||value.amount_cents>100000000||!day(value.issue_date)||!day(value.due_date)||value.due_date<value.issue_date)throw new HttpError(400,'Check invoice number, work description, bank details, total and dates.');
  const file=form.get('pdf');if(!(file instanceof File)||file.type!=='application/pdf'||file.size<6||file.size>MAX_PDF)throw new HttpError(400,'Choose an invoice PDF of at most 5 MB.');
  const pdf=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-')throw new HttpError(400,'This file is not a PDF.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pdf)),n=>n.toString(16).padStart(2,'0')).join('');
  const existing=ok(await sb.from('freelancer_invoices').select('*').eq('id',value.id).maybeSingle());
  if(existing){if(existing.freelancer_id!==freelancerId||existing.pdf_sha256!==hash||Object.entries(value).some(([key,v])=>existing[key]!==v))throw new HttpError(409,'This upload identifier has already been used. Refresh before uploading.');return reply({ok:true,id:existing.id,repeated:true});}
  const path=`${freelancerId}/${value.id}.pdf`;
  const upload=await sb.storage.from('freelancer-invoices').upload(path,pdf,{contentType:'application/pdf',upsert:false});
  if(upload.error)throw new HttpError(409,'Upload was not confirmed. Refresh to check the invoice before trying again.');
  const saved=await sb.rpc('submit_freelancer_invoice',{p:{...value,object_path:path,file_name:(file.name||'invoice.pdf').slice(0,200),pdf_sha256:hash},p_actor:actor});
  if(saved.error){
   // A network error can occur after commit. Recheck before deleting anything.
   const check=await sb.from('freelancer_invoices').select('id').eq('id',value.id).eq('freelancer_id',freelancerId).maybeSingle();
   if(!check.error&&check.data)return reply({ok:true,id:check.data.id});
   if(!check.error&&!check.data&&['23505','23514','23503','P0001'].includes(saved.error.code))await sb.storage.from('freelancer-invoices').remove([path]);
   throw new HttpError(409,saved.error.code==='23505'?'This invoice number or PDF has already been submitted.':'Save was not confirmed. Refresh to check before trying again.');
  }
  return reply({ok:true,id:saved.data});
 }
 if(!type.startsWith('application/json'))throw new HttpError(415,'Use JSON or a PDF upload.');
 let b:any;try{b=JSON.parse(new TextDecoder().decode(await boundedBody(req,16384)));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid request data.');}
 if(!b||typeof b!=='object'||Array.isArray(b))throw new HttpError(400,'Invalid request data.');
 if(b.action==='dashboard'){
  let query=sb.from('freelancer_invoices').select('*').order('created_at',{ascending:false});if(profile)query=query.eq('freelancer_id',profile.id);
  const invoices=ok(await query.limit(501));const limited=invoices.length>500;invoices.length=Math.min(invoices.length,500);
  const profiles=role==='team'?ok(await sb.from('freelancer_profiles').select('id,display_name,email,active').order('display_name')):[profile];
  return reply({ok:true,role,profile,invoices,profiles,limited,generated_at:new Date().toISOString()});
 }
 if(b.action==='save_profile'){
  team();const name=text(b.display_name,120),email=text(b.email,254).toLowerCase();
  if(!name||!/^\S+@\S+\.\S+$/.test(email))throw new HttpError(400,'Enter the freelancer name and sign-in email.');
  const saved=await sb.from('freelancer_profiles').insert({display_name:name,email}).select('id').single();
  if(saved.error?.code==='23505')throw new HttpError(409,'This email has already been registered.');return reply({ok:true,id:ok(saved).id});
 }
 if(b.action==='profile_active'){
  team();if(!uuid(b.id)||typeof b.active!=='boolean')throw new HttpError(400,'Select a freelancer and access status.');
  ok(await sb.from('freelancer_profiles').update({active:b.active}).eq('id',b.id).select('id').single());return reply({ok:true});
 }
 if(b.action==='invoice_pdf'||b.action==='invoice_history'){
  const inv=await invoice(b.id);
  if(b.action==='invoice_history')return reply({ok:true,events:ok(await sb.from('freelancer_invoice_events').select('from_status,to_status,note,created_at').eq('invoice_id',inv.id).order('created_at'))});
  const signed=ok(await sb.storage.from('freelancer-invoices').createSignedUrl(inv.object_path,60,{download:inv.file_name}));return reply({ok:true,url:signed.signedUrl});
 }
 if(b.action==='review_invoice'){
  team();const inv=await invoice(b.id);
  if(!Number.isInteger(b.version)||b.version!==inv.version)throw new HttpError(409,'Invoice changed. Refresh before continuing.');
  if(!({submitted:['approved','rejected'],approved:['paid','rejected']} as Record<string,string[]>)[inv.status]?.includes(b.status))throw new HttpError(409,'This status change is not allowed.');
  const note=text(b.note||'',2000),reference=text(b.payment_reference||'',200);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
  if(b.status==='paid'&&(!day(b.paid_at)||b.paid_at>today||!reference))throw new HttpError(400,'Enter the actual payment date and bank reference.');
  if(b.status==='rejected'&&!note)throw new HttpError(400,'Explain the requested correction.');
  const result=await sb.rpc('review_freelancer_invoice',{p_id:inv.id,p_version:b.version,p_status:b.status,p_paid_at:b.status==='paid'?b.paid_at:null,p_reference:b.status==='paid'?reference:null,p_note:note,p_actor:actor});
  if(result.error)throw new HttpError(409,'The invoice could not be updated. Refresh and check its current status.');return reply({ok:true,id:result.data});
 }
 throw new HttpError(400,'Action is not supported.');
 }catch(e){return reply({ok:false,error:e instanceof HttpError?e.message:'The invoice service is temporarily unavailable.'},e instanceof HttpError?e.status:503);}
 };
}
