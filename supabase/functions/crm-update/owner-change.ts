// ─────────────────────────────────────────────────────────────
// crm-update — task OWNER support (paste into your existing index.ts)
//
// Your frontend already sends `owner` on two actions:
//   • action:'create'  → { kind, title, details, price, priority, owner, due_date }
//   • action:'update'  → { id, ...changed fields incl. owner }
//
// Add the 3 marked lines below to your existing handlers. Nothing else
// in crm-update changes. Deploy AFTER running the SQL migration.
// ─────────────────────────────────────────────────────────────

// 1) Near the top of the file, once:
const ALLOWED_OWNERS = new Set(['warren', 'lutho', 'team']);
const cleanOwner = (v: unknown) =>
  (typeof v === 'string' && ALLOWED_OWNERS.has(v)) ? v : null;   // unknown/empty → null

// 2) In the action:'create' branch — where you build the row to insert,
//    add `owner` to the object. Example (adapt field names to yours):
//
//    const row = {
//      kind: body.kind,
//      title: body.title,
//      details: body.details ?? null,
//      price:   body.price ?? null,
//      priority: body.priority ?? 'normal',
//      due_date: body.due_date ?? null,
//      owner: cleanOwner(body.owner),            // <-- ADD THIS LINE
//    };
//    await supabase.from('client_board').insert(row);

// 3) In the action:'update' branch — where you build the patch object,
//    only set owner when the client actually sent it:
//
//    const patch: Record<string, unknown> = {};
//    if ('title' in body)    patch.title    = body.title;
//    if ('details' in body)  patch.details  = body.details;
//    if ('price' in body)    patch.price    = body.price;
//    if ('priority' in body) patch.priority = body.priority;
//    if ('due_date' in body) patch.due_date = body.due_date;
//    if ('status' in body)   patch.status   = body.status;
//    if ('owner' in body)    patch.owner    = cleanOwner(body.owner);   // <-- ADD THIS LINE
//    await supabase.from('client_board').update(patch).eq('id', body.id);

// That's it. `crm-dashboard` already returns full board rows, so the saved
// owner flows straight back into the "Tasks · who's responsible" swimlanes.
