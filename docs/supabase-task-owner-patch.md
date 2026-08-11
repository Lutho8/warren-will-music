# Supabase patch — persist task ownership

The new **Owner** control on tasks renders and groups correctly today using a value derived from `kind`
(`ask`/`approval` → Warren, `work` → Team). To make a **manually chosen** owner *save and stick*, apply
these two small changes in Supabase. Until then the frontend already sends `owner` in the payload; a
column-whitelisting `crm-update` simply ignores it, so shipping the UI first is safe.

## 1. Migration

Run in the Supabase SQL editor (or add as a migration file):

```sql
alter table board_items
  add column if not exists owner text;   -- 'warren' | 'lutho' | 'team' | null

comment on column board_items.owner is 'Responsible person for this task';
```

> If your board table is named differently (e.g. `board` or `client_board`), adjust the table name.
> Check with: `select table_name from information_schema.columns where column_name = 'title';`

## 2. `crm-update` Edge Function

In the `create` and `update` branches of the board action, accept and whitelist `owner`:

```ts
const ALLOWED_OWNERS = new Set(['warren', 'lutho', 'team']);

// --- create branch ---
const insert = {
  kind: body.kind,
  title: body.title,
  details: body.details ?? null,
  price: body.price ?? null,
  priority: body.priority ?? 'normal',
  due_date: body.due_date ?? null,
  owner: ALLOWED_OWNERS.has(body.owner) ? body.owner : null,   // <-- add
};
await supabase.from('board_items').insert(insert);

// --- update branch ---
const patch = {};
if ('title' in body)     patch.title = body.title;
if ('details' in body)   patch.details = body.details;
if ('price' in body)     patch.price = body.price;
if ('priority' in body)  patch.priority = body.priority;
if ('due_date' in body)  patch.due_date = body.due_date;
if ('status' in body)    patch.status = body.status;
if ('owner' in body)     patch.owner = ALLOWED_OWNERS.has(body.owner) ? body.owner : null; // <-- add
await supabase.from('board_items').update(patch).eq('id', body.id);
```

## 3. Deploy

```bash
supabase functions deploy crm-update
```

`crm-dashboard` already returns full board rows, so the saved `owner` flows straight back into the
dashboard and the "Tasks · who's responsible" swimlanes with no further change.

## Optional: seed sensible owners for existing tasks

```sql
update board_items set owner = 'warren' where owner is null and kind in ('ask','approval');
update board_items set owner = 'team'   where owner is null and kind = 'work';
```
