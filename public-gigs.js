/* Only explicitly published CRM gigs are public. Never expose fees or contacts. */
(async()=>{
 const host=document.getElementById('publicShows');if(!host)return;
 const status=document.getElementById('publicShowStatus');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 try{
 const r=await fetch('https://tqwaepvdsvyyfgtlurkm.supabase.co/functions/v1/artist-workspace?view=public-gigs',{cache:'no-store'});
 if(!r.ok)throw new Error();const d=await r.json();if(!d.ok||!Array.isArray(d.gigs))throw new Error();
 host.innerHTML=d.gigs.map(g=>{const date=new Date(g.date+'T12:00:00');return `<div class="gig-row"><div class="g-date"><span class="g-d">${date.getDate()}</span><span class="g-m">${date.toLocaleDateString('en-GB',{month:'short'}).toUpperCase()}</span></div><div class="g-info"><h4>${esc(g.venues?.name||'To be announced')}</h4><p>${esc(g.venues?.city||'')}${g.set_length?' · '+esc(g.set_length):''}</p></div><span class="g-tag">Live</span></div>`;}).join('');
 status.textContent=d.gigs.length?'Updated from the booking calendar.':'New dates coming soon.';
 }catch{host.replaceChildren();status.textContent='Dates are temporarily unavailable. Please contact booking for confirmed dates.';}
})();
