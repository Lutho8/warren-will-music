// One derived view of existing tasks; never copies or changes the source records.
export function teamFocus(tasks:any[],members:any[]){
 const active=tasks.filter(t=>t.kind==='work'&&(!t.owner||['team','lutho'].includes(t.owner))&&!t.archived_at&&['open','in_progress','review'].includes(t.status));
 const priorities:Record<string,number>={high:0,normal:1,low:2};
 const rank=(t:any)=>priorities[t.priority]??1;
 const sorted=[...active].sort((a,b)=>rank(a)-rank(b)||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
 const ids=new Set(members.map(m=>m.user_id));
 return {members:members.map(m=>({id:m.user_id,name:m.display_name,tasks:sorted.filter(t=>t.assignee_id===m.user_id).slice(0,3)})),unassigned_count:active.filter(t=>!ids.has(t.assignee_id)).length,total_open:active.length,limit_reached:tasks.length>=1000};
}
