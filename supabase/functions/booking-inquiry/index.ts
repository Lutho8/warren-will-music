import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyBooking } from "./notification.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const clean = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") {
    return json({
      ok: true,
      notification_configured: Boolean(
        Deno.env.get("RESEND_API_KEY") && Deno.env.get("RESEND_FROM"),
      ),
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }

  // Honeypot: bots fill the hidden 'website' field, humans never see it.
  if (clean(b.website)) return json({ ok: true, dropped: true });

  const name = clean(b.name, 120);
  const email = clean(b.email, 160).toLowerCase();
  const kind = b.kind === "inner-circle" ? "inner-circle" : "booking";
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "name and valid email required" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 864e5);

  // 1) Contact: find by email, else create.
  const { data: existing, error: lookupError } = await sb
    .from("contacts").select("id").eq("email", email).maybeSingle();
  if (lookupError) return json({ ok: false, error: "contact_lookup_failed" }, 500);
  let contactId = existing?.id as string | undefined;
  if (!contactId) {
    const { data: c, error } = await sb.from("contacts").insert({
      name,
      email,
      role: kind === "booking" ? "booker" : "other",
      preferred_channel: "email",
      source: "website-v5-light",
      lawful_basis: "consent",
      notes: kind === "inner-circle"
        ? "Inner Circle email-list signup (website v5 light)"
        : "Website booking inquiry (v5 light)",
      status: "new",
    }).select("id").single();
    if (error) return json({ ok: false, error: error.message }, 500);
    contactId = c.id;
  }

  // 2) Always log the inbound interaction.
  const summary = kind === "inner-circle"
    ? `Inner Circle signup via website. Name: ${name}.`
    : `Booking inquiry via website — ${clean(b.event_type, 60) || "type n/a"} · ${
      clean(b.city_venue, 120) || "city n/a"
    } · ${clean(b.event_date, 60) || "date tbc"}. Message: ${clean(b.message, 4000) || "—"}`;
  const { data: interaction, error: interactionError } = await sb.from("interactions").insert({
    contact_id: contactId,
    channel: "email",
    direction: "inbound",
    summary,
    logged_by: "agent",
  }).select("id").single();
  if (interactionError) return json({ ok: false, error: "inquiry_save_failed" }, 500);

  // 3) Booking inquiries → opportunity + reply task on tomorrow's send-list.
  if (kind === "booking") {
    const since = new Date(now.getTime() - 14 * 864e5).toISOString();
    const { data: openOpp } = await sb
      .from("opportunities").select("id")
      .eq("contact_id", contactId)
      .gte("created_at", since)
      .not("stage", "in", "(lost,played)")
      .limit(1).maybeSingle();

    const typeMap: Record<string, string> = {
      "Club night": "club",
      "Festival / Open Air": "festival",
      "Private / Wedding": "private",
      "Residency": "residency",
      "Other": "club",
    };

    let oppId = openOpp?.id as string | undefined;
    if (!oppId) {
      const { data: o, error } = await sb.from("opportunities").insert({
        contact_id: contactId,
        type: typeMap[clean(b.event_type, 60)] ?? "club",
        stage: "new",
        next_follow_up: tomorrow.toISOString(),
        last_touch: now.toISOString(),
      }).select("id").single();
      if (error) console.error("Booking opportunity could not be created");
      oppId = o?.id;
    } else {
      await sb.from("opportunities").update({
        next_follow_up: tomorrow.toISOString(),
        last_touch: now.toISOString(),
      }).eq("id", oppId);
    }

    if (oppId) await sb.from("sequences").insert({
      contact_id: contactId,
      opportunity_id: oppId,
      step: 1,
      due_at: tomorrow.toISOString(),
      channel: "email",
      status: "pending",
    });
  }

  if (kind === "booking") {
    const notification = await notifyBooking({
      name,
      email,
      eventType: clean(b.event_type, 60),
      eventDate: clean(b.event_date, 60),
      cityVenue: clean(b.city_venue, 120),
      message: clean(b.message, 4000),
    }, {
      apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
      from: Deno.env.get("RESEND_FROM") ?? "",
    }, String(interaction.id));
    if (notification.status !== "accepted") {
      console.error("Booking saved; inbox notification unavailable", notification.reason);
    }
    return json({ ok: true, saved: true, kind, notification });
  }
  return json({ ok: true, saved: true, kind });
});
