import { createClient } from 'jsr:@supabase/supabase-js@2.57.4';

const cors = {'Access-Control-Allow-Origin':'https://www.warrenwill.net','Access-Control-Allow-Headers':'authorization,content-type,x-admin-key','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const response = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const cut=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
const id=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const date=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(Date.parse(String(v)));
const https=(v:unknown)=>{try{return new URL(String(v)).protocol==='https:';}catch{return false;}};
const requireOK=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
const admin = ()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const legacyKey=(role:string)=>Deno.env.get(role==='team'?'ADMIN_DASH_KEY':'CLIENT_DASH_KEY')||'';
async function identity(req:Request,sb:any){
 const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'');
 if(bearer){const {data,error}=await sb.auth.getUser(bearer);const m=data?.user?.app_metadata;
 if(!error && m?.crm_enabled===true && ['artist','management','social'].includes(m.crm_role))return {role:({artist:'client',management:'team',social:'social'} as any)[m.crm_role],actor:data.user.id};}
 const key=req.headers.get('x-admin-key');
 for(const role of ['team','client'])if(key && legacyKey(role) && key===legacyKey(role))return {role,actor:role==='client'?'legacy:warren':'legacy:team'};
 return null;
}
async function legacy(path:string,role:string,body?:unknown){
 if(!legacyKey(role))throw new Error('Zugangsumstellung noch nicht eingerichtet.');
 const r=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-admin-key':legacyKey(role)},...(body?{body:JSON.stringify(body)}:{})});
 return r;
}
const platformHosts:Record<string,string[]>={Instagram:['instagram.com'],TikTok:['tiktok.com'],YouTube:['youtube.com','youtu.be'],Facebook:['facebook.com','fb.watch'],Threads:['threads.net','threads.com'],LinkedIn:['linkedin.com']};
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(!['GET','POST'].includes(req.method))return response({ok:false,error:'Methode nicht erlaubt.'},405);
 const sb=admin();
 try{
 // Public endpoint is deliberately a field allowlist and requires explicit publication.
 if(req.method==='GET' && new URL(req.url).searchParams.get('view')==='public-gigs'){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
 const gigs=requireOK(await sb.from('gigs').select('id,date,set_length,venues(name,city)').eq('is_public',true).eq('booking_status','confirmed').gte('date',today).order('date').limit(100));
 return response({ok:true,gigs,generated_at:new Date().toISOString()});}
 const auth=await identity(req,sb);if(!auth)return response({ok:false,error:'Bitte erneut anmelden.'},401);
 const {role,actor}=auth;
 const b=req.method==='GET'?{action:'dashboard'}:await req.json();
 const action=cut(b.action,60);
 const audit=async(entity?:string,details={})=>requireOK(await sb.from('crm_audit').insert({actor,action,entity_id:entity,details}));
 const team=()=>{if(role!=='team')throw new Error('Nur das Management kann diese Aktion ausführen.');};
 const contentTeam=()=>{if(role==='client')throw new Error('Diese Aktion gehört zum Social-Team.');};
 const rpc=async(name:string,p:unknown)=>requireOK(await sb.rpc(name,{p,actor}));
 if(action==='dashboard'){
 const base=role==='social'?{ok:true,role,contacts:[],gigs:[],board:[],invoices:[],pipeline:[],interactions:[]}:await(await legacy('crm-dashboard',role)).json();
 if(!base.ok)return response(base,502);
 const definitions=[['content','artist_content'],['publications','content_publications'],['metrics','artist_metrics'],['channels','social_channels']];
 if(role!=='social')definitions.push(['rentals','equipment_bookings'],['offers','equipment_offers'],['inventory','equipment_inventory'],['contact_extensions','contacts'],['gig_extensions','gigs'],['invoice_extensions','invoices']);
 const extra:any={};
 for(const [key,table] of definitions){
 const select=table==='contacts'?'id,name,email,phone_whatsapp,instagram,role,preferred_channel,source,status,notes,created_at,follow_up_date,next_action,tags,assigned_to,opt_out_at,venues(name,city)':table==='gigs'?'id,is_public,booking_status':table==='invoices'?'id,equipment_booking_id,recipient_email,recipient_address,due_date':'*';
 let query=sb.from(table).select(select);
 if(['artist_content','equipment_bookings'].includes(table))query=query.order('updated_at',{ascending:false});
 else if(table==='artist_metrics')query=query.order('recorded_at',{ascending:false});
 else if(table==='content_publications')query=query.order('updated_at',{ascending:false});
 extra[key]=requireOK(await query.limit(1000));}
 for(const [key,ext] of [['contacts','contact_extensions'],['gigs','gig_extensions'],['invoices','invoice_extensions']])base[key]=(base[key]||[]).map((x:any)=>({...x,...extra[ext]?.find((e:any)=>e.id===x.id)}));
 base.contacts=extra.contact_extensions||base.contacts;delete extra.contact_extensions;delete extra.gig_extensions;delete extra.invoice_extensions;
 return response({...base,...extra,role,app_ready:true,generated_at:new Date().toISOString(),capabilities:{personal_login:actor.indexOf('legacy:')!==0,email:!!(Deno.env.get('RESEND_API_KEY')&&Deno.env.get('RESEND_FROM')),social_sync:false,music_sync:false}});
 }
 if(role==='social' && !['save_content','save_publication','save_metric','save_channel'].includes(action))return response({ok:false,error:'Kein Zugriff auf Buchungs- oder Kontaktdaten.'},403);
 if(action==='save_gig'){
 if(!id(b.id)||!date(b.date)||!cut(b.venue_name)||!['draft','confirmed','cancelled'].includes(b.booking_status)||typeof b.is_public!=='boolean'||(b.fee!==null&&(!Number.isFinite(b.fee)||b.fee<0||b.fee>1000000)))throw new Error('Datum, Venue, Gage und Buchungsstatus prüfen.');
 await rpc('save_artist_gig',b);return response({ok:true});}
 if(action==='create_rental_invoice'){
 team();if(!id(b.id)||!cut(b.recipient_name)||!cut(b.recipient_address)||!/^\S+@\S+\.\S+$/.test(b.recipient_email))throw new Error('Empfängerdaten prüfen.');
 return response({ok:true,invoice:await rpc('create_rental_invoice',{id:b.id,recipient_name:cut(b.recipient_name,200),recipient_address:cut(b.recipient_address,500),recipient_email:cut(b.recipient_email,120)})});}
 if(action==='save_contact'){
 if(!id(b.id)||!cut(b.name)||!['promoter','booker','club_manager','dj','chef','other'].includes(b.role)||!['warren','team'].includes(b.assigned_to)||(b.follow_up_date&&!date(b.follow_up_date))||(b.email&&!/^\S+@\S+\.\S+$/.test(b.email)))throw new Error('Kontaktfelder prüfen.');
 requireOK(await sb.from('contacts').update({name:cut(b.name,120),email:cut(b.email,120)||null,phone_whatsapp:cut(b.phone_whatsapp,40)||null,role:b.role,notes:cut(b.note,500)||null,follow_up_date:b.follow_up_date||null,next_action:cut(b.next_action,300)||null,tags:(Array.isArray(b.tags)?b.tags:[]).slice(0,20).map((t:unknown)=>cut(t,40)),assigned_to:b.assigned_to,updated_at:new Date().toISOString()}).eq('id',b.id).select('id').single());await audit(b.id);return response({ok:true});}
 if(action==='save_contact_followup'){
 if(!id(b.id)|| (b.follow_up_date&&!date(b.follow_up_date)) || !['warren','team'].includes(b.assigned_to))throw new Error('Kontakt, Zuständigkeit und Datum prüfen.');
 requireOK(await sb.from('contacts').update({follow_up_date:b.follow_up_date||null,next_action:cut(b.next_action,300)||null,tags:(Array.isArray(b.tags)?b.tags:[]).slice(0,20).map((t:unknown)=>cut(t,40)),assigned_to:b.assigned_to,updated_at:new Date().toISOString()}).eq('id',b.id).select('id').single());
 await audit(b.id);return response({ok:true});}
 if(action==='contact_history'){
 if(!id(b.id))throw new Error('Kontakt fehlt.');const history=requireOK(await sb.from('interactions').select('id,summary,channel,direction,created_at').eq('contact_id',b.id).order('created_at',{ascending:false}).limit(100));return response({ok:true,history});}
 if(action==='log_contact'){
 if(!id(b.id)||!cut(b.summary))throw new Error('Kontakt und Gesprächsnotiz erforderlich.');
 requireOK(await sb.from('interactions').insert({contact_id:b.id,channel:'dashboard',direction:'inbound',summary:cut(b.summary),logged_by:role==='client'?'warren':'lutho'}));await audit(b.id);return response({ok:true});}
 if(action==='import_contacts'){
 team();if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>50||!cut(b.source))throw new Error('Importquelle und maximal 50 Zeilen erforderlich.');
 for(const row of b.rows){if(!cut(row.name,120)||(!cut(row.email)&&!cut(row.phone_whatsapp)))throw new Error('Jede Zeile braucht Name und E-Mail oder Telefon.');if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))throw new Error('Ungültige E-Mail im Import.');}
 return response({ok:true,...requireOK(await sb.rpc('import_artist_contacts',{rows:b.rows,source_name:cut(b.source,200),basis:b.lawful_basis,actor}))});}
 if(action==='gig_visibility'){
 if(!id(b.id)||typeof b.is_public!=='boolean'||!['draft','confirmed','cancelled'].includes(b.booking_status))throw new Error('Ungültiger Buchungsstatus.');
 requireOK(await sb.from('gigs').update({is_public:b.is_public,booking_status:b.booking_status,updated_at:new Date().toISOString()}).eq('id',b.id).select('id').single());await audit(b.id);return response({ok:true});}
 if(action==='save_rental'){
 if(!id(b.id)||!cut(b.customer_name,120)||!Number.isInteger(b.version)||b.version<0||!Number.isInteger(b.deposit_cents)||b.deposit_cents<0||b.deposit_cents>100000000)throw new Error('Kunde, Kaution und Version prüfen.');
 if(!['draft','reserved','collected','returned','cancelled'].includes(b.status)||!['open','received','returned'].includes(b.deposit_status)||!['open','partial','paid'].includes(b.payment_status)||!cut(b.offer_code,40))throw new Error('Mietstatus und Angebot prüfen.');
 const start=Date.parse(b.starts_at),end=Date.parse(b.ends_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>365*86400000||(b.contact_id&&!id(b.contact_id)))throw new Error('Mietzeitraum und Kontakt prüfen.');
 if(b.rental_details&&(typeof b.rental_details!=='object'||Array.isArray(b.rental_details)||JSON.stringify(b.rental_details).length>40000))throw new Error('Mietdetails prüfen.');
 return response({ok:true,rental:await rpc('save_equipment_workflow',{...b,customer_name:cut(b.customer_name,120),notes:cut(b.notes,1000)})});}
 if(action==='save_inventory'){
 team();if(!Number.isInteger(b.quantity)||b.quantity<0||b.quantity>1000)throw new Error('Stückzahl zwischen 0 und 1000 eingeben.');
 // SQL row update shares the inventory lock used by reservations. Do not reduce below existing commitments.
 requireOK(await sb.rpc('set_equipment_quantity',{item_code:cut(b.code,40),new_quantity:b.quantity,actor}));return response({ok:true});}
 if(action==='save_content'){
 contentTeam();if(!id(b.id)||!cut(b.title,200)||!['draft','waiting'].includes(b.approval)||(b.preview_url&&!https(b.preview_url)))throw new Error('Titel, Status und HTTPS-Vorschaulink prüfen.');
 return response({ok:true,content:await rpc('save_artist_content',{id:b.id,version:b.version,title:cut(b.title,200),caption:cut(b.caption,5000),preview_url:cut(b.preview_url,2000),approval:b.approval,operation:'edit'})});}
 if(action==='review_content'){
 if(role!=='client')throw new Error('Nur Warren kann Inhalte freigeben.');
 if(!id(b.id)||!['approved','changes'].includes(b.approval))throw new Error('Ungültige Freigabe.');
 return response({ok:true,content:await rpc('save_artist_content',{id:b.id,version:b.version,approval:b.approval,review_note:cut(b.review_note,1000),operation:'review'})});}
 if(action==='save_publication'){
 contentTeam();if(!id(b.content_id)||!cut(b.platform,80)||!['planned','published','failed'].includes(b.status))throw new Error('Plattform und Status prüfen.');
 if(b.status==='published'){
 if(!https(b.post_url)||!b.published_at||isNaN(Date.parse(b.published_at))||Date.parse(b.published_at)>Date.now())throw new Error('Beitragslink und tatsächlichen Veröffentlichungszeitpunkt eintragen.');
 const host=new URL(b.post_url).hostname;const expected=platformHosts[b.platform];if(expected&&!expected.some(h=>host===h||host.endsWith('.'+h)))throw new Error('Beitragslink gehört nicht zur gewählten Plattform.');}
 if(b.status==='planned'&&(!b.scheduled_at||isNaN(Date.parse(b.scheduled_at))))throw new Error('Geplanten Zeitpunkt eingeben.');
 await rpc('save_publication',{...b,note:cut(b.note,500),post_url:cut(b.post_url,2000)});return response({ok:true});}
 if(action==='save_metric'){
 contentTeam();if(!cut(b.platform,80)||!cut(b.metric,120)||!Number.isFinite(b.value)||b.value<0||!date(b.period_start)||!date(b.period_end)||!https(b.source_url))throw new Error('Kennzahl, Zeitraum und Quellenlink prüfen.');
 requireOK(await sb.from('artist_metrics').upsert({platform:b.platform,metric:cut(b.metric,120),value:b.value,period_start:b.period_start,period_end:b.period_end,source_url:cut(b.source_url,2000),note:cut(b.note,500),recorded_at:new Date().toISOString()},{onConflict:'platform,metric,period_start,period_end'}));await audit();return response({ok:true});}
 if(action==='save_channel'){
 contentTeam();if(!cut(b.platform,80)||!['manual','export','api'].includes(b.proof_method)||(b.profile_url&&!https(b.profile_url)))throw new Error('Plattform, Nachweisart und Kanal-Link prüfen.');
 requireOK(await sb.from('social_channels').insert({platform:cut(b.platform,80),handle:cut(b.handle,120)||null,profile_url:cut(b.profile_url,2000)||null,proof_method:b.proof_method,note:cut(b.note,500)||null,created_by:actor}));await audit();return response({ok:true});}
 if(action==='invoice_pdf'){
 if(!id(b.invoice_id))throw new Error('Rechnung fehlt.');const r=await legacy('invoice-pdf','team',{invoice_id:b.invoice_id});return new Response(r.body,{status:r.status,headers:{...cors,'Content-Type':r.headers.get('content-type')||'application/pdf'}});}
 if(action==='send_invoice_email'){
 team();if(!id(b.invoice_id))throw new Error('Rechnung fehlt.');
 const inv=requireOK(await sb.from('invoices').select('id,status,recipient_email').eq('id',b.invoice_id).single());
 if(inv.status!=='draft'||!inv.recipient_email)throw new Error('Entwurf mit geprüftem Empfänger erforderlich.');
 if(b.confirmed_recipient!==inv.recipient_email)throw new Error('Empfänger vor dem Versand bestätigen.');
 const claim=await sb.from('invoice_delivery').insert({invoice_id:inv.id,state:'sending',recipient:inv.recipient_email}).select('dispatch_token').single();
 if(claim.error)throw new Error('Versand bereits gestartet. Bei unklarem Ergebnis zuerst den Versandstatus prüfen; nicht erneut senden.');
 try{
 const result=await(await legacy('crm-update','team',{action:'send_invoice_email',invoice_id:inv.id,to:inv.recipient_email,delivery_token:claim.data.dispatch_token})).json();
 if(result.ok)requireOK(await sb.from('invoice_delivery').update({state:'sent'}).eq('invoice_id',inv.id));
 else if(['email_not_configured','no_recipient','pdf_generation_failed'].includes(result.error))requireOK(await sb.from('invoice_delivery').delete().eq('invoice_id',inv.id));
 else requireOK(await sb.from('invoice_delivery').update({state:'unknown'}).eq('invoice_id',inv.id));
 await audit(inv.id,{sent:result.ok===true});return response(result,result.ok?200:409);
 }catch(e){await sb.from('invoice_delivery').update({state:'unknown'}).eq('invoice_id',inv.id);throw e;}}
 if(action==='update_invoice_draft'){
 team();if(!id(b.invoice_id)||!cut(b.recipient_name)||!cut(b.recipient_address)||!/^\S+@\S+\.\S+$/.test(b.recipient_email))throw new Error('Name, Anschrift und E-Mail erforderlich.');
 requireOK(await sb.from('invoices').update({recipient_name:cut(b.recipient_name,200),recipient_address:cut(b.recipient_address,500),recipient_email:cut(b.recipient_email,120)}).eq('id',b.invoice_id).eq('status','draft').select('id').single());await audit(b.invoice_id);return response({ok:true});}
 if(action==='legacy'){
 const allowed=['edit_gig','add_gig','update_contact','add_contact','ask_done','approve','decline','comment_item','create_invoice','update_invoice_status','create','update','remove','reopen_item','archive_item','unarchive_item','archive_all_done','save_business_settings'];
 if(!allowed.includes(b.payload?.action))throw new Error('Aktion nicht unterstützt.');
 if(['create_invoice','update_invoice_status','create','update','remove','archive_item','unarchive_item','archive_all_done','save_business_settings'].includes(b.payload.action))team();
 if(['approve','decline','ask_done'].includes(b.payload.action)){
 if(role!=='client')throw new Error('Diese Entscheidung gehört Warren.');
 const item=requireOK(await sb.from('client_board').select('id,kind,owner,status,archived_at').eq('id',b.payload.id).single());
 if(item.archived_at||!['open','in_progress'].includes(item.status)||(item.owner&&item.owner!=='warren')||(b.payload.action==='ask_done'?item.kind!=='ask':item.kind!=='approval'))throw new Error('Dieser Eintrag wartet nicht auf deine Entscheidung.');}
 if(b.payload.action==='update_invoice_status'){
 const inv=requireOK(await sb.from('invoices').select('status').eq('id',b.payload.invoice_id).single());if(inv.status!=='sent'||b.payload.status!=='paid')throw new Error('Hier können nur versendete Rechnungen als bezahlt markiert werden.');}

 const result=await(await legacy('crm-update',role,b.payload)).json();
 if(result.ok)await audit(b.payload.id||b.payload.contact_id||b.payload.invoice_id,{operation:b.payload.action});
 return response(result,result.ok?200:400);}
 return response({ok:false,error:'Aktion nicht unterstützt.'},400);
 }catch(e){return response({ok:false,error:e instanceof Error?e.message:'Speichern fehlgeschlagen.'},400);}
});
