// Team operations exclude Warren's personal contacts, tasks and business settings.
export function teamDashboard(data: any) {
  const contacts=(data.contacts||[]).filter((c:any)=>c.assigned_to==='team');
  const visible=new Set(contacts.map((c:any)=>c.id));
  const pipeline=(data.pipeline||[]).filter((x:any)=>visible.has(x.contact_id));
  const followup_queue=(data.followup_queue||[]).filter((x:any)=>visible.has(x.contact_id));
  const board=(data.board||[]).filter((x:any)=>(['team','lutho'].includes(x.owner)||(!x.owner&&x.kind==='work'))).map((x:any)=>({...x,warren_comment:null}));
  const interactions=(data.interactions||[]).filter((x:any)=>visible.has(x.contact_id));
  const counts={...data.counts,contacts_total:contacts.length,inner_circle:0,
    booking_leads:contacts.filter((c:any)=>c.role==='booker').length,
    whatsapp_contacts:contacts.filter((c:any)=>c.phone_whatsapp||c.preferred_channel==='whatsapp').length,
    followups_due:followup_queue.filter((x:any)=>x.due_at<=new Date().toISOString()).length,
    board_open:board.filter((x:any)=>!x.archived_at&&['open','in_progress'].includes(x.status)).length,
    board_overdue:board.filter((x:any)=>!x.archived_at&&!['done','approved','declined'].includes(x.status)&&x.due_date<new Date().toISOString().slice(0,10)).length,
    board_due_today:board.filter((x:any)=>!x.archived_at&&x.due_date===new Date().toISOString().slice(0,10)).length,
    pipeline:Object.fromEntries(['new','contacted','replied','negotiating','confirmed','played','rebook','lost'].map(stage=>[stage,pipeline.filter((x:any)=>x.stage===stage).length]))};
  const invoices=(data.invoices||[]).filter((x:any)=>!x.contact_id||visible.has(x.contact_id));
  return {...data,contacts,pipeline,followup_queue,board,interactions,invoices,revenue:null,counts,inner_circle:[],business:null};
}
