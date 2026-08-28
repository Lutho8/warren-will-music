import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const KINDS = ["work", "ask", "approval"];
const STATUSES = ["open", "in_progress", "done", "approved", "declined"];
const CONTACT_ROLES = ["promoter", "booker", "club_manager", "dj", "chef", "other"];
const DOC_TYPES = ["invoice", "deposit_invoice", "final_invoice", "receipt", "booking_confirmation"];
const VAT_SCHEMES = ["kleinunternehmer", "vat19", "vat7", "reverse_charge"];
const INV_STATUSES = ["sent", "paid", "cancelled", "draft"];
const TEAM_ONLY = ["create_invoice", "update_invoice_status", "storno_invoice", "save_business_settings", "send_invoice_email", "archive_item", "unarchive_item", "archive_all_done"];
const BOARD_PRIORITIES = ["high", "normal", "low"];
const cut = (v: unknown, n = 500) => String(v ?? "").trim().slice(0, n);
const isId = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ""));
const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
const isEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? "").trim());

/* ── invoice e-mail helpers ── */
const INV_DOC_DE: Record<string, string> = {
  invoice: "Rechnung",
  deposit_invoice: "Abschlagsrechnung",
  final_invoice: "Schlussrechnung",
  receipt: "Quittung",
  booking_confirmation: "Buchungsbestätigung",
};
const eur = (cents: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
const deDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
};
const escHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const ADMIN_KEY = Deno.env.get("ADMIN_DASH_KEY") ?? "ww-admin-starni-2026";
  const CLIENT_KEY = Deno.env.get("CLIENT_DASH_KEY") ?? "ww-warren-2026";
  const provided = req.headers.get("x-admin-key") ?? "";
  const role = provided === ADMIN_KEY ? "team" : provided === CLIENT_KEY ? "client" : null;
  if (!role) return json({ ok: false, error: "unauthorized" }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const action = cut(b.action, 30);

  // Invoice + business-settings writes are TEAM-role only — Warren's client key gets 403.
  if (role !== "team" && TEAM_ONLY.includes(action)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Warren's self-contact anchors every dashboard interaction log
  const { data: selfRows } = await sb.from("contacts").select("id").eq("source", "system-self").limit(1);
  const selfId = selfRows?.[0]?.id ?? null;
  const log = async (summary: string, contactId?: string | null) => {
    const cid = contactId ?? selfId;
    if (!cid) return;
    await sb.from("interactions").insert({
      contact_id: cid, channel: "dashboard", direction: "inbound",
      summary: summary.slice(0, 500), logged_by: role === "client" ? "warren" : "lutho",
    });
  };
  const boardTitle = async (id: string) => {
    const { data } = await sb.from("client_board").select("title").eq("id", id).limit(1);
    return data?.[0]?.title ?? "item";
  };

  /* ───────── BOARD 2.0 shared actions (both roles) ───────── */
  if (action === "comment_item") {
    if (!isId(b.item_id)) return json({ ok: false, error: "item_id required" }, 400);
    const body = cut(b.body, 1000);
    if (!body) return json({ ok: false, error: "body required" }, 400);
    const { data: item } = await sb.from("client_board").select("id,title").eq("id", b.item_id).limit(1);
    if (!item?.length) return json({ ok: false, error: "board item not found" }, 404);
    const author = role === "team" ? "lutho" : "warren";
    const { error } = await sb.from("board_comments").insert({ board_id: b.item_id, author, body });
    if (error) return json({ ok: false, error: error.message }, 500);
    await log(`${author === "lutho" ? "Lutho" : "Warren"} commented on board item \"${item[0].title}\" — \"${body.slice(0, 200)}\"`);
    return json({ ok: true, author });
  }

  if (action === "reopen_item") {
    if (!isId(b.item_id)) return json({ ok: false, error: "item_id required" }, 400);
    const { data: item } = await sb.from("client_board").select("id,title,kind,status").eq("id", b.item_id).limit(1);
    if (!item?.length) return json({ ok: false, error: "board item not found" }, 404);
    const it = item[0];
    // Warren's undo is restricted to his completed asks; team reopen stays unrestricted
    if (role !== "team" && !(it.kind === "ask" && it.status === "done")) {
      return json({ ok: false, error: "only completed asks can be reopened" }, 400);
    }
    const { error } = await sb.from("client_board")
      .update({ status: "open", done_at: null, updated_at: new Date().toISOString() }).eq("id", b.item_id);
    if (error) return json({ ok: false, error: error.message }, 500);
    await log(`${role === "client" ? "Warren reopened (Rückgängig)" : "Reopened"} board item \"${it.title}\" (${it.status} → open)`);
    return json({ ok: true, status: "open" });
  }

  /* ───────── GIG edit / delete (both roles: Warren client + team) ───────── */
  // Shared venue resolver: reuse by case-insensitive name, else create as researching
  const resolveVenue = async (venueName: string, city: string) => {
    const { data: vn } = await sb.from("venues").select("id").ilike("name", venueName).limit(1);
    if (vn?.length) {
      if (city) await sb.from("venues").update({ city, updated_at: new Date().toISOString() }).eq("id", vn[0].id);
      return { id: vn[0].id as string, error: null as string | null };
    }
    const { data: nv, error: vErr } = await sb.from("venues")
      .insert({ name: venueName, city: city || null, type: "club", status: "researching", source: "warren-dashboard" })
      .select("id").limit(1);
    return { id: (nv?.[0]?.id ?? null) as string | null, error: vErr?.message ?? null };
  };

  if (action === "edit_gig") {
    if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
    const { data: cur } = await sb.from("gigs").select("id,date,fee,venue_id, venues(name)").eq("id", b.id).limit(1);
    if (!cur?.length) return json({ ok: false, error: "gig not found" }, 404);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changed: string[] = [];
    if (b.date !== undefined) {
      if (!isDate(b.date)) return json({ ok: false, error: "date must be YYYY-MM-DD" }, 400);
      patch.date = cut(b.date, 10); changed.push("date");
    }
    if (b.fee !== undefined) {
      patch.fee = b.fee === null || b.fee === "" ? null : Math.max(0, Math.min(1000000, Number(b.fee) || 0));
      changed.push("fee");
    }
    if (b.set_length !== undefined) { patch.set_length = cut(b.set_length, 40) || null; changed.push("set_length"); }
    if (b.deposit_received !== undefined) { patch.deposit_received = !!b.deposit_received; changed.push("deposit"); }
    if (b.venue_name !== undefined) {
      const venueName = cut(b.venue_name, 120);
      if (!venueName) return json({ ok: false, error: "venue_name cannot be empty" }, 400);
      const v = await resolveVenue(venueName, cut(b.city, 80));
      if (v.error) return json({ ok: false, error: v.error }, 500);
      patch.venue_id = v.id; changed.push("venue");
    }
    if (!changed.length) return json({ ok: false, error: "nothing to update" }, 400);
    const { error } = await sb.from("gigs").update(patch).eq("id", b.id);
    if (error) return json({ ok: false, error: error.message }, 500);
    const vname = (cur[0] as any)?.venues?.name ?? "gig";
    await log(`${role === "client" ? "Warren" : "Team"} edited gig: ${vname} on ${patch.date ?? cur[0].date} (${changed.join(", ")})${patch.deposit_received === true ? " · deposit ✓" : ""}`);
    return json({ ok: true, changed });
  }

  if (action === "delete_gig") {
    if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
    const { data: cur } = await sb.from("gigs").select("id,date,fee, venues(name)").eq("id", b.id).limit(1);
    if (!cur?.length) return json({ ok: false, error: "gig not found" }, 404);
    // GoBD guard: a gig that fiscal documents point at must not vanish — storno first, then team removes it
    const { data: inv } = await sb.from("invoices").select("id").eq("gig_id", b.id).limit(1);
    if (inv?.length) {
      return json({ ok: false, error: "gig_has_invoices", detail: "An invoice references this gig — it cannot be deleted. Ask the team (storno flow)." }, 400);
    }
    const { error } = await sb.from("gigs").delete().eq("id", b.id);
    if (error) return json({ ok: false, error: error.message }, 500);
    await log(`${role === "client" ? "Warren" : "Team"} deleted gig: ${(cur[0] as any)?.venues?.name ?? "—"} on ${cur[0].date}${cur[0].fee ? ` · €${cur[0].fee}` : ""}`);
    return json({ ok: true });
  }

  /* ───────── TEAM actions (Lutho / ops) ───────── */
  if (role === "team") {
    if (action === "create") {
      const kind = cut(b.kind, 20), title = cut(b.title, 200);
      if (!KINDS.includes(kind) || !title) return json({ ok: false, error: "kind + title required" }, 400);
      const { data, error } = await sb.from("client_board").insert({
        kind, title, details: cut(b.details, 1000) || null,
        price: cut(b.price, 60) || null, created_by: "team", owner: ["warren","lutho","team"].includes(cut(b.owner,10)) ? cut(b.owner,10) : null,
        priority: BOARD_PRIORITIES.includes(cut(b.priority, 10)) ? cut(b.priority, 10) : "normal",
        due_date: isDate(b.due_date) ? cut(b.due_date, 10) : null,
        sort_order: Math.max(-100000, Math.min(100000, Math.trunc(Number(b.sort_order) || 0))),
      }).select("id").limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, id: data?.[0]?.id });
    }
    if (action === "update") {
      if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.title !== undefined) patch.title = cut(b.title, 200); if (b.owner !== undefined) patch.owner = ["warren","lutho","team"].includes(cut(b.owner,10)) ? cut(b.owner,10) : null;
      if (b.details !== undefined) patch.details = cut(b.details, 1000) || null;
      if (b.price !== undefined) patch.price = cut(b.price, 60) || null;
      if (b.priority !== undefined) {
        if (!BOARD_PRIORITIES.includes(cut(b.priority, 10))) return json({ ok: false, error: "bad priority" }, 400);
        patch.priority = cut(b.priority, 10);
      }
      if (b.due_date !== undefined) patch.due_date = isDate(b.due_date) ? cut(b.due_date, 10) : null;
      if (b.sort_order !== undefined) patch.sort_order = Math.max(-100000, Math.min(100000, Math.trunc(Number(b.sort_order) || 0)));
      if (b.status !== undefined) {
        if (!STATUSES.includes(cut(b.status, 20))) return json({ ok: false, error: "bad status" }, 400);
        patch.status = cut(b.status, 20);
        patch.done_at = ["done", "approved", "declined"].includes(patch.status as string) ? new Date().toISOString() : null;
      }
      const { error } = await sb.from("client_board").update(patch).eq("id", b.id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "remove") {
      if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
      const { error } = await sb.from("client_board").delete().eq("id", b.id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    /* ── BOARD 2.0 archive actions (team) ── */
    if (action === "archive_item" || action === "unarchive_item") {
      if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
      const archiving = action === "archive_item";
      const title = await boardTitle(b.id);
      const { error } = await sb.from("client_board")
        .update({ archived_at: archiving ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("id", b.id);
      if (error) return json({ ok: false, error: error.message }, 500);
      await log(`${archiving ? "Archived" : "Unarchived"} board item \"${title}\"`);
      return json({ ok: true, archived: archiving });
    }
    if (action === "archive_all_done") {
      const { data, error } = await sb.from("client_board")
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("status", "done").is("archived_at", null).select("id");
      if (error) return json({ ok: false, error: error.message }, 500);
      const n = data?.length ?? 0;
      await log(`Archived ${n} done board item${n === 1 ? "" : "s"} (bulk)`);
      return json({ ok: true, archived: n });
    }

    /* ── §14 invoices (GoBD) ── */
    if (action === "create_invoice") {
      const fee = Number(b.fee_euros);
      if (!isFinite(fee) || fee <= 0 || fee > 1000000) {
        return json({ ok: false, error: "fee_euros (positive number) required" }, 400);
      }
      const docType = DOC_TYPES.includes(cut(b.doc_type, 30)) ? cut(b.doc_type, 30) : "invoice";
      const { data: bsRows } = await sb.from("business_settings").select("default_vat_scheme").eq("id", true).limit(1);
      const defScheme = bsRows?.[0]?.default_vat_scheme ?? "kleinunternehmer";
      const vatScheme = VAT_SCHEMES.includes(cut(b.vat_scheme, 20)) ? cut(b.vat_scheme, 20) : defScheme;
      let gig: any = null, contact: any = null;
      if (isId(b.gig_id)) {
        const { data } = await sb.from("gigs").select("id,date, venues(name)").eq("id", b.gig_id).limit(1);
        gig = data?.[0] ?? null;
      }
      if (isId(b.contact_id)) {
        const { data } = await sb.from("contacts").select("id,name,email").eq("id", b.contact_id).limit(1);
        contact = data?.[0] ?? null;
      }
      const issueDate = new Date().toISOString().slice(0, 10);
      const serviceDate = isDate(b.service_date) ? cut(b.service_date, 10) : (gig?.date ?? issueDate);
      const dueDays = Math.max(0, Math.min(365, Math.trunc(Number(b.due_days) || 14)));
      const dueDate = new Date(Date.parse(issueDate + "T00:00:00Z") + dueDays * 86400000).toISOString().slice(0, 10);
      const recipientName = cut(b.recipient_name, 200) || contact?.name || gig?.venues?.name || null;
      const recipientAddress = cut(b.recipient_address, 500) || null;
      const recipientEmail = cut(b.recipient_email, 120) || contact?.email || null;
      const netC = Math.round(fee * 100);
      const vatC = vatScheme === "vat19" ? Math.round(netC * 0.19) : vatScheme === "vat7" ? Math.round(netC * 0.07) : 0;
      const grossC = netC + vatC;
      // Number drawn only after all validation passed (keeps the sequence gapless)
      const { data: num, error: nErr } = await sb.rpc("next_invoice_number");
      if (nErr || !num) return json({ ok: false, error: nErr?.message ?? "invoice number sequence failed" }, 500);
      const { data, error } = await sb.from("invoices").insert({
        invoice_number: num, doc_type: docType, status: "draft", vat_scheme: vatScheme,
        net_cents: netC, vat_cents: vatC, gross_cents: grossC,
        issue_date: issueDate, service_date: serviceDate, due_date: dueDate,
        recipient_name: recipientName, recipient_address: recipientAddress, recipient_email: recipientEmail,
        gig_id: gig?.id ?? null, contact_id: contact?.id ?? null,
        notes: cut(b.notes, 1000) || null,
      }).select().limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      await log(`Invoice ${num} created (${docType}, ${fee} €, draft)`, contact?.id ?? null);
      return json({ ok: true, invoice: data?.[0] });
    }

    if (action === "update_invoice_status") {
      if (!isId(b.invoice_id)) return json({ ok: false, error: "invoice_id required" }, 400);
      const st = cut(b.status, 20);
      if (!INV_STATUSES.includes(st)) return json({ ok: false, error: "status must be sent|paid|cancelled|draft" }, 400);
      const { data: cur } = await sb.from("invoices").select("id,invoice_number,status,contact_id").eq("id", b.invoice_id).limit(1);
      if (!cur?.length) return json({ ok: false, error: "invoice not found" }, 404);
      const { error } = await sb.from("invoices").update({ status: st }).eq("id", b.invoice_id);
      if (error) return json({ ok: false, error: error.message }, 500);
      await log(`Invoice ${cur[0].invoice_number} status: ${cur[0].status} → ${st}`, cur[0].contact_id ?? null);
      return json({ ok: true, invoice_number: cur[0].invoice_number, status: st });
    }

    if (action === "storno_invoice") {
      if (!isId(b.invoice_id)) return json({ ok: false, error: "invoice_id required" }, 400);
      const { data: cur } = await sb.from("invoices").select("*").eq("id", b.invoice_id).limit(1);
      const orig = cur?.[0];
      if (!orig) return json({ ok: false, error: "invoice not found" }, 404);
      if (orig.status === "draft") return json({ ok: false, error: "draft invoices cannot be storno'd (drafts carry no fiscal effect)" }, 400);
      if (orig.status === "storno") return json({ ok: false, error: "invoice already storno'd" }, 400);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await sb.from("invoices").insert({
        invoice_number: orig.invoice_number + "-S", doc_type: orig.doc_type, status: "sent",
        vat_scheme: orig.vat_scheme,
        net_cents: -orig.net_cents, vat_cents: -orig.vat_cents, gross_cents: -orig.gross_cents,
        issue_date: today, service_date: orig.service_date, due_date: orig.due_date,
        recipient_name: orig.recipient_name, recipient_address: orig.recipient_address, recipient_email: orig.recipient_email,
        gig_id: orig.gig_id, contact_id: orig.contact_id,
        storno_of: orig.id, notes: `Storno zu ${orig.invoice_number}`,
      }).select().limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      const { error: uErr } = await sb.from("invoices").update({ status: "storno" }).eq("id", orig.id);
      if (uErr) return json({ ok: false, error: uErr.message }, 500);
      await log(`Storno ${orig.invoice_number}-S issued for ${orig.invoice_number}`, orig.contact_id ?? null);
      return json({ ok: true, storno: data?.[0] });
    }

    /* ── send invoice e-mail with PDF attachment (Resend, graceful mailto fallback) ── */
    if (action === "send_invoice_email") {
      if (!isId(b.invoice_id)) return json({ ok: false, error: "invoice_id required" }, 400);
      const { data: invRows } = await sb.from("invoices").select("*").eq("id", b.invoice_id).limit(1);
      const inv = invRows?.[0];
      if (!inv) return json({ ok: false, error: "invoice not found" }, 404);
      if (inv.status !== "draft") {
        return json({ ok: false, error: `only draft invoices can be sent (current: ${inv.status})` }, 400);
      }

      /* recipient chain: explicit override → invoice → linked contact → gig opportunity contact → venue impressum */
      let to = isEmail(b.to) ? cut(b.to, 120) : "";
      if (!to && isEmail(inv.recipient_email)) to = cut(inv.recipient_email, 120);
      let contactId: string | null = inv.contact_id ?? null;
      if (!to && contactId) {
        const { data: c } = await sb.from("contacts").select("email").eq("id", contactId).limit(1);
        if (isEmail(c?.[0]?.email)) to = cut(c[0].email, 120);
      }
      let gig: any = null;
      if (isId(inv.gig_id)) {
        const { data: g } = await sb.from("gigs").select("id,opportunity_id,venue_id").eq("id", inv.gig_id).limit(1);
        gig = g?.[0] ?? null;
      }
      if (!to && gig?.opportunity_id) {
        const { data: o } = await sb.from("opportunities").select("contact_id").eq("id", gig.opportunity_id).limit(1);
        const oc = o?.[0]?.contact_id ?? null;
        if (oc) {
          contactId = contactId ?? oc;
          const { data: c } = await sb.from("contacts").select("email").eq("id", oc).limit(1);
          if (isEmail(c?.[0]?.email)) to = cut(c[0].email, 120);
        }
      }
      if (!to && gig?.venue_id) {
        const { data: v } = await sb.from("venues").select("impressum_email").eq("id", gig.venue_id).limit(1);
        if (isEmail(v?.[0]?.impressum_email)) to = cut(v[0].impressum_email, 120);
      }
      if (!to) {
        return json({
          ok: false, error: "no_recipient",
          detail: "No e-mail on invoice, contact, opportunity or venue — pass { to } to override.",
        }, 400);
      }

      /* mail content (German, plain text + branded HTML) */
      const docName = INV_DOC_DE[inv.doc_type] ?? "Rechnung";
      const subject = `${docName} ${inv.invoice_number} — Warren Will`;
      const gross = eur(inv.gross_cents);
      const dueDays = Math.max(0, Math.round((Date.parse(inv.due_date) - Date.parse(inv.issue_date)) / 86400000));
      const terms = `Zahlbar innerhalb von ${dueDays} Tagen ohne Abzug (bis ${deDate(inv.due_date)}).`;
      const greet = inv.recipient_name ? `Guten Tag ${inv.recipient_name},` : "Sehr geehrte Damen und Herren,";
      const extra = cut(b.message, 500);
      const text = [
        greet, "",
        `anbei erhalten Sie die ${docName} ${inv.invoice_number} über ${gross}.`,
        terms,
        ...(extra ? ["", extra] : []),
        "", `Die ${docName} finden Sie im Anhang.`, "",
        "Freundliche Grüße", "Warren Will", "booking@warrenwilliam.de",
      ].join("\n");
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <div style="background:#0d0d0d;padding:20px 24px">
    <span style="color:#c9a227;font-size:20px;letter-spacing:4px;font-weight:bold">WARREN WILL</span><br>
    <span style="color:#888888;font-size:11px;letter-spacing:2px">DJ &amp; PRODUCER · MÜNCHEN</span>
  </div>
  <div style="padding:24px;border:1px solid #eeeeee;border-top:none;font-size:14px;line-height:1.6">
    <p style="margin:0 0 14px">${escHtml(greet)}</p>
    <p style="margin:0 0 14px">anbei erhalten Sie die <b>${escHtml(docName)} ${escHtml(inv.invoice_number)}</b> über <b>${escHtml(gross)}</b>.</p>
    <p style="margin:0 0 14px">${escHtml(terms)}</p>
    ${extra ? `<p style="margin:0 0 14px">${escHtml(extra)}</p>` : ""}
    <p style="margin:0 0 14px">Die ${escHtml(docName)} finden Sie im Anhang.</p>
    <p style="margin:18px 0 0">Freundliche Grüße<br><b>Warren Will</b><br>
    <a href="mailto:booking@warrenwilliam.de" style="color:#c9a227;text-decoration:none">booking@warrenwilliam.de</a></p>
  </div>
</div>`;

      /* graceful degradation: without Resend secrets, hand the dashboard a prefilled mailto draft */
      const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
      const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "";
      if (!RESEND_KEY || !RESEND_FROM) {
        const mailBody = text +
          "\n\n[Hinweis: Rechnungs-PDF bitte manuell aus dem Dashboard anhängen (PDF-Button in der Rechnungszeile.)]";
        const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;
        return json({ ok: false, error: "email_not_configured", mailto, to, subject });
      }

      /* fetch the PDF from our own invoice-pdf function */
      const PDF_KEY = Deno.env.get("INVOICE_PDF_KEY") ?? ADMIN_KEY;
      const pdfRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/invoice-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": PDF_KEY },
        body: JSON.stringify({ invoice_id: inv.id }),
      });
      if (!pdfRes.ok) {
        return json({ ok: false, error: "pdf_generation_failed", detail: `invoice-pdf HTTP ${pdfRes.status}` }, 502);
      }
      const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

      const rRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [to],
          reply_to: "booking@warrenwilliam.de",
          subject, text, html,
          attachments: [{ filename: `${inv.invoice_number}.pdf`, content: b64(pdfBytes) }],
        }),
      });
      if (!rRes.ok) {
        const detail = cut(await rRes.text().catch(() => ""), 300);
        return json({ ok: false, error: "resend_failed", detail }, 502);
      }

      /* GoBD-safe transition draft → sent + audit fields (status/sent_at/sent_to are not content-locked) */
      const now = new Date().toISOString();
      const { error: uErr } = await sb.from("invoices")
        .update({ status: "sent", sent_at: now, sent_to: to }).eq("id", inv.id);
      if (uErr) return json({ ok: false, error: uErr.message }, 500);
      // never log keys, PDF bytes, iban or steuernummer — number + recipient + timestamp only
      await log(`invoice_email_sent: ${inv.invoice_number} → ${to} at ${now}`, contactId);
      return json({ ok: true, sent: true, to, invoice_number: inv.invoice_number, status: "sent" });
    }

    if (action === "save_business_settings") {
      const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
      const changed: string[] = [];
      if (b.legal_name !== undefined) { patch.legal_name = cut(b.legal_name, 200); changed.push("legal_name"); }
      if (b.address_lines !== undefined) {
        patch.address_lines = (Array.isArray(b.address_lines) ? b.address_lines : String(b.address_lines).split("\n"))
          .map((x: unknown) => cut(x, 200)).filter(Boolean);
        changed.push("address_lines");
      }
      if (b.steuernummer !== undefined) { patch.steuernummer = cut(b.steuernummer, 60) || null; changed.push("steuernummer"); }
      if (b.ust_idnr !== undefined) { patch.ust_idnr = cut(b.ust_idnr, 20) || null; changed.push("ust_idnr"); }
      if (b.iban !== undefined) { patch.iban = cut(b.iban, 40) || null; changed.push("iban"); }
      if (b.default_vat_scheme !== undefined) {
        if (!VAT_SCHEMES.includes(cut(b.default_vat_scheme, 20))) return json({ ok: false, error: "bad vat scheme" }, 400);
        patch.default_vat_scheme = cut(b.default_vat_scheme, 20); changed.push("default_vat_scheme");
      }
      if (b.kleinunternehmer_since !== undefined) {
        patch.kleinunternehmer_since = isDate(b.kleinunternehmer_since) ? cut(b.kleinunternehmer_since, 10) : null;
        changed.push("kleinunternehmer_since");
      }
      if (!changed.length) return json({ ok: false, error: "nothing to save" }, 400);
      const { error } = await sb.from("business_settings").upsert(patch);
      if (error) return json({ ok: false, error: error.message }, 500);
      // never log iban/steuernummer values — field names only
      await log(`Business settings updated: ${changed.join(", ")}`);
      return json({ ok: true, changed });
    }

    return json({ ok: false, error: "unknown team action" }, 400);
  }

  /* ───────── CLIENT actions (Warren) ───────── */
  if (action === "comment" || action === "ask_done" || action === "approve" || action === "decline") {
    if (!isId(b.id)) return json({ ok: false, error: "id required" }, 400);
    const comment = cut(b.comment, 500) || null;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (comment) patch.warren_comment = comment;
    if (action === "ask_done") { patch.status = "done"; patch.done_at = new Date().toISOString(); }
    if (action === "approve") { patch.status = "approved"; patch.done_at = new Date().toISOString(); }
    if (action === "decline") { patch.status = "declined"; patch.done_at = new Date().toISOString(); }
    const { error } = await sb.from("client_board").update(patch).eq("id", b.id);
    if (error) return json({ ok: false, error: error.message }, 500);
    const title = await boardTitle(b.id);
    const verb = action === "comment" ? "commented on" : action === "ask_done" ? "marked done" : action;
    await log(`Warren ${verb} board item \"${title}\"${comment ? ` — \"${comment}\"` : ""}`);
    return json({ ok: true });
  }

  if (action === "add_gig") {
    const date = cut(b.date, 10), venueName = cut(b.venue_name, 120), city = cut(b.city, 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !venueName) return json({ ok: false, error: "date + venue required" }, 400);
    const fee = b.fee === null || b.fee === undefined || b.fee === "" ? null : Math.max(0, Math.min(1000000, Number(b.fee) || 0));
    // venue: reuse by case-insensitive name, else create as researching
    let venueId: string | null = null;
    const { data: vn } = await sb.from("venues").select("id").ilike("name", venueName).limit(1);
    if (vn?.length) {
      venueId = vn[0].id;
    } else {
      const { data: nv, error: vErr } = await sb.from("venues")
        .insert({ name: venueName, city: city || null, type: "club", status: "researching", source: "warren-dashboard" })
        .select("id").limit(1);
      if (vErr) return json({ ok: false, error: vErr.message }, 500);
      venueId = nv?.[0]?.id ?? null;
    }
    const setLength = cut(b.set_length, 40) || null;
    const { error: gErr } = await sb.from("gigs").insert({
      venue_id: venueId, date, fee, set_length: setLength, deposit_received: false,
    });
    if (gErr) return json({ ok: false, error: gErr.message }, 500);
    await log(`Warren added a gig: ${venueName}${city ? ` (${city})` : ""} on ${date}${fee ? ` · €${fee}` : ""}`);
    return json({ ok: true });
  }

  if (action === "update_contact") { if (!isId(b.contact_id)) return json({ ok:false, error:"contact_id required" }, 400); const patch = {}; if ("name" in b) { const nm = cut(b.name,120); if(nm) patch.name = nm; } if ("phone_whatsapp" in b) patch.phone_whatsapp = cut(b.phone_whatsapp,40) || null; if ("email" in b) patch.email = cut(b.email,120) || null; if ("role" in b) patch.role = CONTACT_ROLES.includes(cut(b.role,20)) ? cut(b.role,20) : "other"; if ("note" in b) patch.notes = cut(b.note,500) || null; const { error: uErr } = await sb.from("contacts").update(patch).eq("id", b.contact_id); if (uErr) return json({ ok:false, error: uErr.message }, 500); await log("Contact details updated", b.contact_id); return json({ ok:true }); } if (action === "add_contact") {
    const name = cut(b.name, 120);
    if (!name) return json({ ok: false, error: "name required" }, 400);
    const cRole = CONTACT_ROLES.includes(cut(b.role, 20)) ? cut(b.role, 20) : "other";
    const phone = cut(b.phone_whatsapp, 40) || null;
    const email = cut(b.email, 120) || null;
    const notes = cut(b.note, 500) || null;
    const { data: nc, error: cErr } = await sb.from("contacts").insert({
      name, role: cRole, phone_whatsapp: phone, email,
      preferred_channel: phone ? "whatsapp" : "email",
      source: "warren-dashboard", lawful_basis: "existing_relationship", status: "new", notes,
    }).select("id").limit(1);
    if (cErr) return json({ ok: false, error: cErr.message }, 500);
    const contactId = nc?.[0]?.id ?? null;
    // booking-relevant roles get an opportunity so the follow-up loop picks them up
    if (contactId && ["promoter", "booker", "club_manager"].includes(cRole)) {
      await sb.from("opportunities").insert({
        contact_id: contactId, type: "club", stage: "new",
        next_follow_up: new Date(Date.now() + 2 * 86400000).toISOString(),
      });
    }
    if (contactId) await log(`Warren added contact: ${name} (${cRole})${phone ? " · WhatsApp" : ""}${email ? " · email" : ""}`, contactId);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown client action" }, 400);
});
