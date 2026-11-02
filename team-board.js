/* Shared team work. All persisted data lives in the CRM; no Notion or local task store. */
(() => {
 const API='https://tqwaepvdsvyyfgtlurkm.supabase.co/functions/v1/team-board';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const states={open:'To do',in_progress:'In progress',review:'In review',done:'Done'};
 const newId=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
 const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
 const shared=t=>t.kind==='work'&&(!t.owner||['team','lutho'].includes(t.owner));
 let root,dialog,data={tasks:[],members:[]},filter='all',generation=0,current,comments=[],saving=false;
 const name=id=>data.members.find(m=>m.id===id)?.name||'Unassigned';
 const options=(selected,empty='Unassigned')=>`<option value="">${empty}</option>`+data.members.map(m=>`<option value="${E(m.id)}" ${m.id===selected?'selected':''}>${E(m.name)}</option>`).join('');
 async function api(body){
  if(!navigator.onLine)throw new Error('You are offline. Please reconnect before saving.');
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',...window.artistAuthHeaders()},body:JSON.stringify(body)});
  let d;try{d=await r.json();}catch{throw new Error('Could not reach the team board. Please retry.');}
  if(!r.ok||!d.ok)throw new Error(d.error||'Could not save. Please retry.');return d;
 }
 function init(){
  if(root)return;root=document.getElementById('teamBoard');
  dialog=document.createElement('dialog');dialog.id='teamTaskDialog';dialog.className='team-dialog';document.body.append(dialog);
  root.addEventListener('click',async e=>{const b=e.target.closest('[data-team]');if(!b)return;
   if(b.dataset.team==='retry')return window.renderTeamBoard();
   if(b.dataset.team==='new')return openTask();
   if(b.dataset.team==='open')return openTask(b.dataset.id);
   if(b.dataset.team==='archive')return archiveTask();
   if(b.dataset.team==='filter'){filter=b.dataset.filter;render();}
  });
  root.addEventListener('change',async e=>{if(!e.target.matches('[data-team-status]'))return;
   const el=e.target,t=data.tasks.find(t=>t.id===el.dataset.teamStatus);if(!t)return;el.disabled=true;
   try{const r=await api({action:'save',id:t.id,task:{...t,status:el.value}});data.tasks=data.tasks.map(x=>x.id===t.id?r.task:x);render();message(r.warning||'Task updated.');notify();}
   catch(err){el.value=t.status;el.disabled=false;message(err.message,true);}
  });
  dialog.addEventListener('click',e=>{if(e.target.closest('[data-team=archive]')){archiveTask();return;}if(e.target.closest('[data-team-close]')&&!saving)dialog.close();});
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  dialog.addEventListener('submit',async e=>{
   e.preventDefault();if(saving)return;const form=e.target,submit=form.querySelector('[type=submit]');saving=true;submit.disabled=true;dialog.querySelector('[role=alert]').textContent='';
   try{
    const f=new FormData(form);
    if(form.id==='teamCommentForm'){
     await api({action:'comment',id:current.id,body:f.get('comment')});form.reset();await loadComments(current.id);
    }else{
     const task={task_version:current.task_version,title:f.get('title'),details:f.get('details'),assignee_id:f.get('assignee_id')||null,reviewer_id:f.get('reviewer_id')||null,due_date:f.get('due_date')||null,status:f.get('status'),priority:f.get('priority'),blocked_reason:f.get('blocked_reason')};
     const r=await api({action:'save',id:current.id,task});
     data.tasks=[r.task,...data.tasks.filter(t=>t.id!==r.task.id)];dialog.close();render();message(r.warning||'Task saved.');notify();
    }
   }catch(err){dialog.querySelector('[role=alert]').textContent=err.message;}
   finally{saving=false;submit.disabled=false;}
  });
 }
 function message(s,error=false){const el=root.querySelector('[role=status]');if(el){el.textContent=s;el.classList.toggle('team-error',error);}}
 function render(){
  const mine=t=>t.assignee_id===data.actor||(t.status==='review'&&(t.reviewer_id||t.creator_id)===data.actor);
  const list=data.tasks.filter(t=>filter!=='mine'||mine(t));
  const overdue=t=>t.status!=='done'&&t.due_date&&t.due_date<day();
  root.innerHTML=`<div class="team-heading"><div><h1>Team board</h1><p>One place to see what needs doing and finish it.</p></div><button type="button" class="bbtn gold" data-team="new">+ New task</button></div>
   <div class="team-toolbar"><button type="button" class="bbtn" data-team="filter" data-filter="all" aria-pressed="${filter==='all'}">All tasks</button><button type="button" class="bbtn" data-team="filter" data-filter="mine" aria-pressed="${filter==='mine'}">My work</button><button type="button" class="bbtn" data-team="retry">Refresh</button><span>${data.tasks.filter(t=>t.status!=='done').length} open · ${data.tasks.filter(overdue).length} overdue</span></div>
   <p role="status" aria-live="polite"></p>
   ${data.email_configured?'':'<p class="team-note">Email alerts are not configured yet. Assignments and updates remain available here.</p>'}
   ${data.tasks.length>=1000?'<p class="team-note">Showing the latest 1,000 tasks.</p>':''}
   <div class="team-columns">${Object.entries(states).map(([status,label])=>{
    const items=list.filter(t=>t.status===status).sort((a,b)=>Number(!!b.blocked_reason)-Number(!!a.blocked_reason)||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))||String(b.created_at).localeCompare(String(a.created_at)));
    return `<section class="team-column" aria-label="${label}"><h2>${label} <span>${items.length}</span></h2>${items.map(t=>`<article class="team-ticket ${overdue(t)?'team-overdue':''}"><button type="button" class="team-title" data-team="open" data-id="${E(t.id)}">${E(t.title)}</button><p>${E(name(t.assignee_id))}</p>${t.blocked_reason?`<p class="team-error">Blocked: ${E(t.blocked_reason)}</p>`:''}${t.due_date?`<p class="${overdue(t)?'team-error':''}">${overdue(t)?'Overdue · ':'Due '}${E(t.due_date)}</p>`:''}${status==='review'?`<p>Review: ${E(name(t.reviewer_id||t.creator_id))}</p>`:''}<label class="team-sr" for="status-${E(t.id)}">Status for ${E(t.title)}</label><select id="status-${E(t.id)}" data-team-status="${E(t.id)}">${Object.entries(states).map(([s,l])=>`<option value="${s}" ${s===status?'selected':''}>${l}</option>`).join('')}</select></article>`).join('')||'<p class="team-empty">No tasks here.</p>'}</section>`;
   }).join('')}</div>`;
 }
 async function loadComments(id){
  const r=await api({action:'comments',id});if(current?.id!==id||!dialog.open)return;comments=r.comments;
  dialog.querySelector('#teamComments').innerHTML=comments.map(c=>`<div class="team-comment"><b>${E(c.author_id?name(c.author_id):c.author==='warren'?'Warren':'Team')}</b><small>${E(new Date(c.created_at).toLocaleString('en-GB'))}</small><p>${E(c.body)}</p></div>`).join('')||'<p>No comments yet.</p>';
 }
 function notify(){window.dispatchEvent(new Event('ww:tasks-changed'));}
 async function archiveTask(){if(!current||saving||!confirm('Remove this task from the boards? It can be restored from the admin archive.'))return;saving=true;try{const r=await api({action:'archive',id:current.id,task_version:current.task_version});data.tasks=data.tasks.filter(t=>t.id!==current.id);dialog.close();render();message(r.warning||'Task archived.');notify();if(!root.hidden)await window.load?.('team');}catch(e){dialog.querySelector('[role=alert]').textContent=e.message;}finally{saving=false;}}
 async function openTask(id,readOnly=false){
  current=id?data.tasks.find(t=>t.id===id):{id:newId(),task_version:0,status:'open',priority:'normal'};if(!current)return;const t=current;
  dialog.innerHTML=`<div class="team-heading"><h2>${id?'Task details':'New task'}</h2><button type="button" class="bbtn" data-team-close>Close</button></div><p role="alert" class="team-error"></p>
   <form id="teamTaskForm"><label>Task title<input name="title" required maxlength="200" value="${E(t.title)}" placeholder="What needs to be done?"/></label>
   <label>Assigned to<select name="assignee_id">${options(t.assignee_id)}</select></label>
   <label>Due date <small>(optional)</small><input name="due_date" type="date" value="${E(t.due_date)}"/></label>
   <label>Status<select name="status">${Object.entries(states).map(([s,l])=>`<option value="${s}" ${s===t.status?'selected':''}>${l}</option>`).join('')}</select></label>
   <label>Details <small>(optional)</small><textarea name="details" maxlength="1000" rows="3" placeholder="Instructions, expected result or a link to the work">${E(t.details)}</textarea></label>
   <details ${t.blocked_reason?'open':''}><summary>Review, priority & blockers</summary><label>Reviewer<select name="reviewer_id">${options(t.reviewer_id,'Task creator')}</select></label><label>Priority<select name="priority">${['normal','high','low'].map(p=>`<option value="${p}" ${t.priority===p?'selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select></label><label>What is blocking this task?<textarea name="blocked_reason" rows="2" maxlength="500">${E(t.blocked_reason)}</textarea></label></details>
   <button class="bbtn gold" type="submit">${id?'Save changes':'Create task'}</button>${id&&data.can_manage_all?'<button class="bbtn" type="button" data-team="archive">Remove task</button>':''}</form>
   ${id?'<h3>Comments</h3><div id="teamComments">Loading comments…</div><form id="teamCommentForm"><label>Add a comment<textarea name="comment" required maxlength="1000" rows="2"></textarea></label><button class="bbtn" type="submit">Send comment</button></form>':''}`;
  if(readOnly){dialog.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);dialog.querySelectorAll('[type=submit],[data-team=archive]').forEach(el=>el.hidden=true);}
  dialog.showModal();dialog.querySelector('[name=title]').focus();
  if(id)try{await loadComments(id);}catch(err){if(current?.id===id)dialog.querySelector('#teamComments').textContent=err.message;}
 }
 window.WWTeamBoardReady=false;
 window.hideTeamBoard=()=>{window.WWTeamBoardReady=false;generation++;if(dialog?.open)dialog.close();if(root){root.hidden=true;root.innerHTML='';}data={tasks:[],members:[]};};
 window.renderTeamBoard=async()=>{
  init();root.hidden=false;const seq=++generation;
  root.innerHTML='<p role="status">Loading team tasks…</p>';
  try{const result=await api({action:'list'});if(seq!==generation)return;data=result;window.WWTeamBoardReady=true;window.onTeamBoardReady?.();render();
   const match=location.hash.match(/^#team-task\/([a-f0-9-]+)$/i);if(match){await openTask(match[1]);history.replaceState(null,'',location.pathname+location.search);}
  }catch(err){if(seq!==generation)return;root.innerHTML=`<h1>Team board</h1><p role="alert">${E(err.message)}</p><button type="button" class="bbtn" data-team="retry">Retry</button>`;}
 };
 window.openSharedTeamTask=async(id,readOnly=false)=>{init();data=await api({action:'list'});return openTask(id,readOnly);};
 window.WWTeamBoardUtils={shared,escape:E};
})();
