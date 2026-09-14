import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Warren's personal network (promoters, DJs, creative partners) vs inbound booking leads (role='booker')
const INNER_ROLES = ["promoter", "dj", "chef", "manager", "producer", "other"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Two-person access: TEAM (Lutho / agent ops) vs CLIENT (Warren). Same data, two views.
  const ADMIN_KEY = Deno.env.get("ADMIN_DASH_KEY") ?? "";
  const CLIENT_KEY = Deno.env.get("CLIENT_DASH_KEY") ?? "";
  const provided = req.headers.get("x-admin-key") ?? "";
  const role = provided && ADMIN_KEY && provided === ADMIN_KEY ? "team" : provided && CLIENT_KEY && provided === CLIENT_KEY ? "client" : null;
  if (!role) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = today.slice(0, 4) + "-01-01";

  const [contacts, opportunities, sequences, interactions, gigs, venues, board, boardComments, invoices, business] = await Promise.all([
    sb.from("contacts")
      .select("id,name,email,phone_whatsapp,instagram,role,preferred_channel,source,status,notes,created_at, venues(name,city)")
      .order("created_at", { ascending: false }).limit(200),
    sb.from("opportunities")
      .select("id,type,stage,pipeline_stage,source,contact_method,segment,region,assigned_to,next_step,follow_up_date,do_not_contact,fee_quote,next_follow_up,last_touch,created_at, contacts(name,email,phone_whatsapp), venues(name,city)")
      .order("last_touch", { ascending: false }).limit(100),
    sb.from("sequences")
      .select("id,step,due_at,channel,status, contacts(name,email,phone_whatsapp), opportunities(type,stage)")
      .eq("status", "pending").order("due_at", { ascending: true }).limit(100),
    sb.from("interactions")
      .select("id,channel,direction,summary,logged_by,created_at, contacts(name)")
      .order("created_at", { ascending: false }).limit(15),
    // Full year of gigs (past + future) so revenue-made is accurate
    sb.from("gigs")
      .select("id,date,fee,package,deposit_received,set_length, venues(name,city)")
      .gte("date", yearStart).order("date", { ascending: true }).limit(100),
    sb.from("venues").select("id,name,city,status").order("name", { ascending: true }).limit(200),
    sb.from("client_board").select("*").order("created_at", { ascending: true }).limit(200),
    // BOARD 2.0 — comment threads per board item, ascending for chat-style display
    sb.from("board_comments").select("board_id,author,body,created_at")
      .order("created_at", { ascending: true }).limit(1000),
    // §14 invoices (GoBD) — newest first, with contact + gig/venue display names
    sb.from("invoices")
      .select("id,invoice_number,doc_type,status,net_cents,vat_cents,gross_cents,issue_date,service_date,recipient_name,gig_id,contact_id,sent_at,sent_to, contacts(name), gigs(date, venues(name))")
      .order("issue_date", { ascending: false }).limit(200),
    // Warren's own business settings — both roles may read (never rendered in the client view UI)
    sb.from("business_settings").select("*").eq("id", true).limit(1),
  ]);

  const cl = contacts.data ?? [];
  const op = opportunities.data ?? [];
  const sq = sequences.data ?? [];
  const gg = gigs.data ?? [];
  const vn = venues.data ?? [];
  const stageCount = (s: string) => op.filter((o: any) => o.stage === s).length;
  const inner = cl.filter((c: any) => INNER_ROLES.includes(c.role));

  // BOARD 2.0 — attach comment threads; compute due-date counts on open, non-archived items
  const cmap: Record<string, Array<{ author: string; body: string; created_at: string }>> = {};
  for (const c of boardComments.data ?? []) {
    (cmap[c.board_id] ??= []).push({ author: c.author, body: c.body, created_at: c.created_at });
  }
  const bd = (board.data ?? []).map((x: any) => ({ ...x, comments: cmap[x.id] ?? [] }));
  const boardOpen = bd.filter((x: any) =>
    !x.archived_at && !["done", "approved", "declined"].includes(x.status));
  const boardOverdue = boardOpen.filter((x: any) => x.due_date && x.due_date < today).length;
  const boardDueToday = boardOpen.filter((x: any) => x.due_date === today).length;

  // Flatten invoice joins into stable display fields
  const inv = (invoices.data ?? []).map((i: any) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    doc_type: i.doc_type,
    status: i.status,
    net_cents: i.net_cents,
    vat_cents: i.vat_cents,
    gross_cents: i.gross_cents,
    issue_date: i.issue_date,
    service_date: i.service_date,
    recipient_name: i.recipient_name,
    gig_id: i.gig_id,
    contact_id: i.contact_id,
    sent_at: i.sent_at ?? null,
    sent_to: i.sent_to ?? null,
    contact_name: i.contacts?.name ?? null,
    gig_date: i.gigs?.date ?? null,
    venue_name: i.gigs?.venues?.name ?? null,
  }));

  // Revenue split (Netto/USt/Brutto) per compliance spec §4.
  // Sums over sent + paid; 'storno' originals are INCLUDED so a storno pair
  // (original +350 / storno doc -350, the latter with status 'sent') nets to
  // zero instead of going negative — GoBD-correct bookkeeping.
  const REV_STATUSES = ["sent", "paid", "storno"];
  const revRows = inv.filter((i: any) => REV_STATUSES.includes(i.status));
  const revenue = {
    net_cents: revRows.reduce((s: number, i: any) => s + (i.net_cents || 0), 0),
    vat_cents: revRows.reduce((s: number, i: any) => s + (i.vat_cents || 0), 0),
    gross_cents: revRows.reduce((s: number, i: any) => s + (i.gross_cents || 0), 0),
    paid_gross_cents: inv.filter((i: any) => i.status === "paid")
      .reduce((s: number, i: any) => s + (i.gross_cents || 0), 0),
  };

  return json({
    ok: true,
    role,
    generated_at: new Date().toISOString(),
    counts: {
      contacts_total: cl.length,
      inner_circle: inner.length,
      booking_leads: cl.filter((c: any) => c.role === "booker").length,
      whatsapp_contacts: cl.filter((c: any) => (c.phone_whatsapp && !String(c.phone_whatsapp).startsWith("TODO")) || c.preferred_channel === "whatsapp").length,
      venues_total: vn.length,
      pipeline: {
        new: stageCount("new"), contacted: stageCount("contacted"),
        replied: stageCount("replied"), negotiating: stageCount("negotiating"),
        confirmed: stageCount("confirmed"), played: stageCount("played"),
        rebook: stageCount("rebook"), lost: stageCount("lost"),
      },
      followups_due: sq.filter((s: any) => (s.due_at ?? "") <= new Date().toISOString()).length,
      gigs_upcoming: gg.filter((g: any) => (g.date ?? "") >= today).length,
      gigs_played: gg.filter((g: any) => (g.date ?? "") < today).length,
      board_open: bd.filter((t: any) => !t.archived_at && (t.status === "open" || t.status === "in_progress")).length,
      board_overdue: boardOverdue,
      board_due_today: boardDueToday,
    },
    followup_queue: sq,
    pipeline: op,
    contacts: cl,
    inner_circle: inner,
    interactions: interactions.data ?? [],
    gigs: gg,
    venues: vn,
    board: bd,
    invoices: inv,
    revenue,
    business: business.data?.[0] ?? null,
  });
});
