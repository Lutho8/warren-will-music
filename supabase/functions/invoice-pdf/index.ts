import { internalCrmRequest } from "../_shared/crm-identity.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

/* ═══════════════════════════════════════════════════════════════════════
   invoice-pdf — Deno/pdf-lib port of scripts/make_invoice_pdf.py
   POST { invoice_id }            → render from the invoices table row
   POST { payload: {...} }        → ad-hoc doc, same JSON shape as the
                                    Python CLI (team key only, both modes)
   Response: application/pdf bytes, attachment filename = invoice number.
   ═══════════════════════════════════════════════════════════════════════ */

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

/* ── brand + page geometry (A4, reportlab-style bottom-left origin) ── */
const MM = 2.834645669;
const A4W = 595.28, A4H = 841.89;
const M = 18 * MM;
const BOTTOM = 46 * MM;
const IVORY = rgb(1, 253 / 255, 248 / 255);
const PAPER2 = rgb(247 / 255, 244 / 255, 238 / 255);
const INK = rgb(22 / 255, 19 / 255, 14 / 255);
const INK2 = rgb(74 / 255, 68 / 255, 58 / 255);
const GOLD = rgb(169 / 255, 133 / 255, 62 / 255);
const LINE = rgb(227 / 255, 221 / 255, 210 / 255);

/* ── issuer (port of resolve_issuer; overrides via payload.issuer) ── */
const DEFAULT_ISSUER: Record<string, any> = {
  name: "Warren Stiefel",
  street: "Trogerstraße 44",
  city: "81675 München",
  country: "Deutschland",
  email: "booking@warrenwilliam.de",
  brand_name: "WARREN WILL",
  brand_mark: "WW",
  brand_sub: null,               // null -> STR.brand_sub[lang]
  reg_line: null,                // extra sender/footer line (e.g. company reg)
  footer_clauses: "ksk_gema",    // "ksk_gema" | "none"
  show_country_en: false,
};
function resolveIssuer(data: any) {
  const iss: Record<string, any> = { ...DEFAULT_ISSUER };
  for (const [k, v] of Object.entries(data?.issuer ?? {})) {
    if (v !== null && v !== undefined) iss[k] = v;
  }
  iss.oneline = `${iss.name} · ${iss.street} · ${iss.city}`;
  iss.footer = iss.email ? `${iss.oneline} · ${iss.email}` : iss.oneline;
  return iss;
}

/* ── strings (verbatim port of the Python STR table) ── */
const STR: Record<string, Record<string, string>> = {
  doc_invoice:      { de: "RECHNUNG", en: "INVOICE" },
  doc_deposit:      { de: "ABSCHLAGSRECHNUNG", en: "DEPOSIT INVOICE" },
  doc_deposit_sub:  { de: "({pct} % Anzahlung)", en: "({pct} % deposit)" },
  doc_final:        { de: "SCHLUSSRECHNUNG", en: "FINAL INVOICE" },
  doc_receipt:      { de: "ZAHLUNGSBESTÄTIGUNG · QUITTUNG", en: "PAYMENT RECEIPT" },
  doc_confirmation: { de: "BUCHUNGSBESTÄTIGUNG", en: "BOOKING CONFIRMATION" },
  brand_sub:        { de: "DJ & PRODUCER · MÜNCHEN", en: "DJ & PRODUCER · MUNICH" },
  invoice_no:       { de: "Rechnungsnummer", en: "Invoice no." },
  booking_no:       { de: "Buchungsnummer", en: "Booking ref." },
  issue_date:       { de: "Ausstellungsdatum", en: "Issue date" },
  service_date:     { de: "Leistungsdatum", en: "Service date" },
  tax_no:           { de: "Steuernummer", en: "Tax no." },
  vat_id:           { de: "USt-IdNr", en: "VAT ID" },
  rcpt_vat_id:      { de: "USt-IdNr Leistungsempfänger", en: "Recipient VAT ID" },
  to_invoice:       { de: "Rechnungsempfänger", en: "Invoice to" },
  to_recipient:     { de: "Empfänger", en: "Recipient" },
  th_pos:           { de: "POS.", en: "NO." },
  th_desc:          { de: "LEISTUNGSBESCHREIBUNG", en: "DESCRIPTION" },
  th_amount:        { de: "BETRAG", en: "AMOUNT" },
  net:              { de: "Netto", en: "Net" },
  vat_row:          { de: "USt {pct} %", en: "VAT {pct} %" },
  gross:            { de: "Brutto", en: "Total (gross)" },
  less_deposit:     { de: "Abzüglich Anzahlung (bereits gezahlt)", en: "Less deposit (already paid)" },
  due_amount:       { de: "Restbetrag", en: "Amount due" },
  ku_line:          { de: "Gemäß § 19 UStG wird keine Umsatzsteuer ausgewiesen.",
                      en: "In accordance with § 19 UStG no VAT is charged." },
  rc_line:          { de: "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).",
                      en: "Reverse charge — VAT liability rests with the recipient (§ 13b UStG)." },
  pay_terms:        { de: "Zahlbar innerhalb von {days} Tagen ohne Abzug (bis {due}).",
                      en: "Payable within {days} days of the invoice date, no deductions (by {due})." },
  pay_iban:         { de: "Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer auf folgendes Konto:",
                      en: "Please transfer the amount, quoting the invoice number, to the following account:" },
  pay_ref:          { de: "Verwendungszweck", en: "Payment reference" },
  notes_label:      { de: "HINWEISE", en: "NOTES" },
  receipt_intro:    { de: "Hiermit wird der Zahlungseingang in voller Höhe bestätigt:",
                      en: "We hereby confirm receipt of the payment in full:" },
  receipt_invoice:  { de: "Für Rechnung", en: "For invoice" },
  receipt_amount:   { de: "Betrag", en: "Amount" },
  receipt_date:     { de: "Zahlungseingang am", en: "Payment received on" },
  conf_intro:       { de: "Hiermit bestätigen wir verbindlich die folgende Buchung:",
                      en: "We hereby confirm the following booking:" },
  ev_event:         { de: "Veranstaltung", en: "Event" },
  ev_venue:         { de: "Venue", en: "Venue" },
  ev_city:          { de: "Stadt", en: "City" },
  ev_date:          { de: "Datum", en: "Date" },
  ev_set:           { de: "Setzeit", en: "Set time" },
  ev_fee:           { de: "Gage", en: "Fee" },
  conf_not_invoice: { de: "Diese Buchungsbestätigung ist keine Rechnung. Die Abschlagsrechnung über die Anzahlung folgt separat.",
                      en: "This booking confirmation is not an invoice. The deposit invoice follows separately." },
  cancel_title:     { de: "STORNOBEDINGUNGEN", en: "CANCELLATION TERMS" },
  cancel_client:    { de: "Kostenfreie Stornierung durch den Veranstalter bis 14 Tage vor dem Veranstaltungstermin. Bei späterer Stornierung werden 50 % der Gage fällig.",
                      en: "Free cancellation by the client up to 14 days before the event date; cancellations after that point are charged at 50% of the fee." },
  cancel_artist:    { de: "Bei Absage durch den Künstler wird die geleistete Anzahlung innerhalb von 7 Tagen vollständig erstattet.",
                      en: "If the artist cancels, any deposit paid is refunded in full within 7 days." },
  ksk:              { de: "Der Veranstalter ist ggf. zur Abgabe an die Künstlersozialkasse (KSK) verpflichtet (§ 25 KSVG).",
                      en: "The organizer may be liable for the artists' social insurance levy (Künstlersozialkasse, KSK) under § 25 KSVG." },
  gema:             { de: "Die GEMA-Anmeldung der Veranstaltung obliegt dem Veranstalter.",
                      en: "GEMA registration of the event is the organizer's responsibility." },
  page:             { de: "Seite", en: "Page" },
  deposit_item:     { de: "Anzahlung ({pct} %) — {desc}", en: "Deposit ({pct} %) — {desc}" },
  default_item:     { de: "DJ-Auftritt — {desc}", en: "DJ performance — {desc}" },
};

/* ── WinAnsi-safe sanitizer (pdf-lib standard fonts throw on others) ── */
const CP1252_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
function S(txt: any): string {
  if (txt === null || txt === undefined) return "";
  let s = String(txt);
  for (const [k, v] of [["→", "-"], ["−", "-"], ["•", "·"], ["‒", "-"]]) s = s.split(k).join(v);
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out += (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_HIGH.has(cp) ? ch : "?";
  }
  return out;
}

/* ── money / dates: integer cents internally, half-up at display ── */
const roundHU = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
const cents = (v: any) => roundHU(Number(String(v)) * 100);
function money(c: number, lang: string): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(Math.trunc(c));
  const euros = Math.floor(a / 100), rem = a % 100;
  const grp = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, lang === "de" ? "." : ",");
  return lang === "de"
    ? `${sign}${grp},${String(rem).padStart(2, "0")} €`
    : `${sign}€${grp}.${String(rem).padStart(2, "0")}`;
}
const pctOf = (base: number, pct: any) => roundHU((base * Number(String(pct))) / 100);
function fmtDate(s: any, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return S(s);
  return lang === "de" ? `${m[3]}.${m[2]}.${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
}
const asLines = (v: any): string[] =>
  typeof v === "string"
    ? v.split("\n").map((x) => x.trim()).filter(Boolean)
    : (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const fill = (tpl: string, kw: Record<string, any>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k) => (kw[k] !== undefined ? String(kw[k]) : ""));

/* ── Doc: single-document builder, footer on every page ── */
class Doc {
  pdf: any; page: any; fonts: any; lang = "de"; issuer: any;
  y = A4H - M; pageNum = 1; footerDrawn = false;

  static async create(lang: string, metaTitle: string, issuer: any) {
    const d = new Doc();
    d.lang = lang; d.issuer = issuer;
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(S(metaTitle));
    d.pdf.setAuthor(S(issuer.name));
    d.pdf.setSubject(S(metaTitle));
    d.fonts = {
      body: await d.pdf.embedFont(StandardFonts.Helvetica),
      bold: await d.pdf.embedFont(StandardFonts.HelveticaBold),
      oblique: await d.pdf.embedFont(StandardFonts.HelveticaOblique),
    };
    d.page = d.pdf.addPage([A4W, A4H]);
    d.bg();
    return d;
  }
  t(key: string, kw: Record<string, any> = {}) { return S(fill(STR[key][this.lang], kw)); }
  w(txt: string, font: any, size: number) { return font.widthOfTextAtSize(S(txt), size); }
  bg() { this.page.drawRectangle({ x: 0, y: 0, width: A4W, height: A4H, color: IVORY }); }
  text(txt: string, o: { x: number; y: number; size: number; font?: any; color?: any }) {
    this.page.drawText(S(txt), { x: o.x, y: o.y, size: o.size, font: o.font ?? this.fonts.body, color: o.color ?? INK });
  }
  textRight(txt: string, o: { y: number; size: number; font?: any; color?: any }) {
    const f = o.font ?? this.fonts.body;
    this.text(txt, { x: A4W - M - this.w(txt, f, o.size), y: o.y, size: o.size, font: f, color: o.color });
  }
  wrap(txt: string, font: any, size: number, maxw: number): string[] {
    const lines: string[] = [];
    for (const raw of S(txt).split("\n")) {
      let line = "";
      for (const wd of raw.split(/\s+/).filter(Boolean)) {
        const t = line ? line + " " + wd : wd;
        if (this.w(t, font, size) <= maxw) line = t;
        else { if (line) lines.push(line); line = wd; }
      }
      lines.push(line);
    }
    return lines;
  }
  para(txt: string, o: { size?: number; leading?: number; maxw?: number; font?: any; color?: any; x?: number } = {}) {
    const size = o.size ?? 9.5, font = o.font ?? this.fonts.body;
    const maxw = o.maxw ?? (A4W - 2 * M), x = o.x ?? M;
    const leading = o.leading ?? size * 1.45;
    for (const line of this.wrap(txt, font, size, maxw)) {
      this.ensure(leading);
      this.text(line, { x, y: this.y, size, font, color: o.color ?? INK2 });
      this.y -= leading;
    }
  }
  ensure(needed: number) {
    if (this.y - needed < BOTTOM) {
      this.footer();
      this.page = this.pdf.addPage([A4W, A4H]);
      this.pageNum += 1;
      this.bg();
      this.y = A4H - M;
      this.footerDrawn = false;
    }
  }
  rule(y?: number, color = LINE, width = 0.8) {
    const yy = y ?? this.y;
    this.page.drawLine({ start: { x: M, y: yy }, end: { x: A4W - M, y: yy }, thickness: width, color });
  }
  box(y: number, h: number) {
    this.page.drawRectangle({ x: M, y: y - h, width: A4W - 2 * M, height: h, color: PAPER2, borderColor: GOLD, borderWidth: 1 });
  }
  footer() {
    if (this.footerDrawn) return;
    this.footerDrawn = true;
    this.rule(32 * MM);
    if (this.issuer.footer_clauses !== "none") {
      let yy = 28.2 * MM;
      for (const clause of [this.t("ksk"), this.t("gema")]) {
        for (const line of this.wrap(clause, this.fonts.body, 6.8, A4W - 2 * M)) {
          this.text(line, { x: M, y: yy, size: 6.8, color: INK2 });
          yy -= 3.1 * MM;
        }
      }
    }
    if (this.issuer.reg_line) this.text(S(this.issuer.reg_line), { x: M, y: 15.4 * MM, size: 6.8, color: INK2 });
    this.text(S(this.issuer.footer), { x: M, y: 12 * MM, size: 7, color: INK2 });
    const pl = `${this.t("page")} ${this.pageNum}`;
    this.textRight(pl, { y: 12 * MM, size: 7.5, font: this.fonts.bold, color: GOLD });
  }
  async save(): Promise<Uint8Array> {
    this.footer();
    return await this.pdf.save();
  }
}

/* ── document assembly (port of build()) ── */
async function buildPdf(data: any): Promise<{ bytes: Uint8Array; title: string; fileName: string }> {
  let lang = String(data?.lang ?? "de").toLowerCase();
  lang = lang === "en" ? "en" : "de";
  let docType = String(data?.doc_type ?? "invoice").toLowerCase();
  if (!["invoice", "deposit_invoice", "final_invoice", "receipt", "booking_confirmation"].includes(docType)) docType = "invoice";

  const iss = resolveIssuer(data ?? {});
  const invNo = String(data?.invoice_number ?? "").trim();
  const issueDate = data?.issue_date ?? null;
  const serviceDate = data?.service_date ?? null;
  const dueDays = Math.trunc(Number(data?.due_days ?? 14)) || 14;
  const steuernr = String(data?.steuernummer ?? "").trim();
  const ustIdnr = String(data?.ust_idnr ?? "").trim();
  const iban = String(data?.iban ?? "").trim();
  const notes = String(data?.notes ?? "").trim();
  const vatScheme = String(data?.vat_scheme ?? "kleinunternehmer").toLowerCase();
  const rcpt = data?.recipient ?? {};
  const rcptVat = String(rcpt?.ust_idnr ?? "").trim();
  const event = data?.event ?? {};
  const depositPaidC = data?.deposit_already_paid !== null && data?.deposit_already_paid !== undefined ? cents(data.deposit_already_paid) : null;
  const depositPct = event?.deposit_pct ?? data?.deposit_pct ?? 50;
  const feeC = event?.fee !== null && event?.fee !== undefined ? cents(event.fee)
    : (data?.fee !== null && data?.fee !== undefined ? cents(data.fee) : null);

  const isInvoiceDoc = ["invoice", "deposit_invoice", "final_invoice"].includes(docType);

  /* line items (integer cents) */
  const items: Array<[string, number]> = [];
  for (const it of data?.items ?? []) {
    const desc = String(it?.description ?? "").trim();
    if (desc && it?.amount !== null && it?.amount !== undefined) items.push([desc, cents(it.amount)]);
  }
  const eventDesc = () => {
    const parts = [event?.name, event?.venue];
    if (event?.city) parts.push(event.city);
    if (event?.date) parts.push(fmtDate(event.date, lang));
    if (event?.set_time) parts.push(String(event.set_time));
    return parts.filter(Boolean).join(", ");
  };
  if (isInvoiceDoc && items.length === 0) {
    const baseDesc = eventDesc() || String(rcpt?.name ?? "");
    if (docType === "deposit_invoice" && feeC !== null) {
      const short = fill(STR.default_item[lang], { desc: baseDesc }).split(" — ").slice(1).join(" — ") || baseDesc;
      items.push([fill(STR.deposit_item[lang], { pct: depositPct, desc: short }), pctOf(feeC, depositPct)]);
    } else if (feeC !== null) {
      items.push([fill(STR.default_item[lang], { desc: baseDesc }), feeC]);
    }
  }

  const netC = items.reduce((s, [, a]) => s + a, 0);
  const vatRate = vatScheme === "vat19" ? 0.19 : vatScheme === "vat7" ? 0.07 : 0;
  const vatC = vatRate ? roundHU(netC * vatRate) : 0;
  const grossC = netC + vatC;
  const vatPctLabel = vatScheme === "vat19" ? "19" : "7";

  const titleKey = { invoice: "doc_invoice", deposit_invoice: "doc_deposit", final_invoice: "doc_final", receipt: "doc_receipt", booking_confirmation: "doc_confirmation" }[docType]!;
  const docTitle = STR[titleKey][lang];
  const metaTitle = `${docTitle} ${invNo}`.trim();
  const d = await Doc.create(lang, metaTitle, iss);
  const B = d.fonts.bold, BODY = d.fonts.body;

  /* ── header: gold mark + wordmark, doc title right (auto-sized) ── */
  d.page.drawRectangle({ x: M, y: A4H - M - 14 * MM, width: 14 * MM, height: 14 * MM, color: GOLD });
  d.text(S(iss.brand_mark), {
    x: M + 7 * MM - d.w(S(iss.brand_mark), B, 17) / 2, y: A4H - M - 10.2 * MM, size: 17, font: B, color: IVORY,
  });
  d.text(S(iss.brand_name), { x: M + 18.5 * MM, y: A4H - M - 9.5 * MM, size: 24, font: B, color: INK });
  d.text(iss.brand_sub ? S(iss.brand_sub) : d.t("brand_sub"), { x: M + 18.5 * MM, y: A4H - M - 13.8 * MM, size: 6.5, font: B, color: GOLD });
  let ts = 26;
  while (d.w(docTitle, B, ts) > A4W - 2 * M - 220 && ts > 13) ts -= 1;
  d.textRight(S(docTitle), { y: A4H - M - 9.5 * MM, size: ts, font: B, color: INK });
  if (docType === "deposit_invoice") {
    d.textRight(d.t("doc_deposit_sub", { pct: depositPct }), { y: A4H - M - 14.5 * MM, size: 8, font: B, color: INK2 });
  }
  d.y = A4H - M - 22 * MM;

  /* ── sender one-liner (DIN-style above recipient) ── */
  const showCountry = lang === "de" || iss.show_country_en;
  d.text(S(iss.oneline + (showCountry && iss.country ? ` · ${iss.country}` : "")), { x: M, y: d.y, size: 6.8, color: INK2 });
  d.y -= 4 * MM;
  if (iss.reg_line) { d.text(S(iss.reg_line), { x: M, y: d.y, size: 6.8, color: INK2 }); d.y -= 4 * MM; }

  /* ── recipient block (left) ── */
  let yLeft = d.y;
  d.text(d.t(isInvoiceDoc ? "to_invoice" : "to_recipient").toUpperCase(), { x: M, y: yLeft, size: 6.8, font: B, color: GOLD });
  yLeft -= 5 * MM;
  if (rcpt?.name) { d.text(S(rcpt.name), { x: M, y: yLeft, size: 10.5, font: B, color: INK }); yLeft -= 5 * MM; }
  for (const line of asLines(rcpt?.address_lines)) { d.text(S(line), { x: M, y: yLeft, size: 9.5, color: INK2 }); yLeft -= 4.6 * MM; }
  if (rcpt?.email) { d.text(S(rcpt.email), { x: M, y: yLeft, size: 9.5, color: INK2 }); yLeft -= 4.6 * MM; }

  /* ── meta block (right) ── */
  const xMeta = A4W - M - 66 * MM;
  let yRight = d.y;
  const metaRows: Array<[string, string]> = [];
  if (docType === "booking_confirmation") { if (invNo) metaRows.push([d.t("booking_no"), invNo]); }
  else if (invNo) metaRows.push([d.t("invoice_no"), invNo]);
  if (issueDate) metaRows.push([d.t("issue_date"), fmtDate(issueDate, lang)]);
  if (serviceDate && isInvoiceDoc) metaRows.push([d.t("service_date"), fmtDate(serviceDate, lang)]);
  if (steuernr && docType !== "booking_confirmation") metaRows.push([d.t("tax_no"), steuernr]);
  if (ustIdnr && vatScheme === "reverse_charge") metaRows.push([d.t("vat_id"), ustIdnr]);
  if (rcptVat && vatScheme === "reverse_charge") metaRows.push([d.t("rcpt_vat_id"), rcptVat]);
  for (const [label, value] of metaRows) {
    d.text(S(label).toUpperCase(), { x: xMeta, y: yRight, size: 6.8, font: B, color: INK2 });
    d.textRight(S(value), { y: yRight, size: 9.5, font: B, color: INK });
    yRight -= 5.6 * MM;
  }

  d.y = Math.min(yLeft, yRight) - 3 * MM;
  d.rule();
  d.y -= 8 * MM;

  /* ══ BOOKING CONFIRMATION ══ */
  if (docType === "booking_confirmation") {
    d.para(d.t("conf_intro"), { size: 9.5, color: INK2 });
    d.y -= 2 * MM;
    const grid: Array<[string, string, boolean]> = [];
    if (event?.name) grid.push([d.t("ev_event"), String(event.name), true]);
    if (event?.venue) grid.push([d.t("ev_venue"), String(event.venue), false]);
    if (event?.city) grid.push([d.t("ev_city"), String(event.city), false]);
    if (event?.date) grid.push([d.t("ev_date"), fmtDate(event.date, lang), false]);
    if (event?.set_time) grid.push([d.t("ev_set"), String(event.set_time), false]);
    if (feeC !== null) grid.push([d.t("ev_fee"), money(feeC, lang), true]);
    for (const [label, value, strong] of grid) {
      d.ensure(6 * MM);
      d.text(S(label).toUpperCase(), { x: M, y: d.y, size: 6.8, font: B, color: INK2 });
      d.text(S(value), { x: M + 45 * MM, y: d.y, size: 10, font: strong ? B : BODY, color: INK });
      d.y -= 6 * MM;
    }
    d.y -= 4 * MM;
    d.rule();
    d.y -= 8 * MM;
    d.text(d.t("cancel_title"), { x: M, y: d.y, size: 7.5, font: B, color: GOLD });
    d.y -= 6 * MM;
    for (const clause of [d.t("cancel_client"), d.t("cancel_artist")]) {
      let first = true;
      for (const line of d.wrap(clause, BODY, 9, A4W - 2 * M - 6 * MM)) {
        d.ensure(4.5 * MM);
        if (first) { d.text("—", { x: M, y: d.y, size: 9, color: GOLD }); first = false; }
        d.text(line, { x: M + 6 * MM, y: d.y, size: 9, color: INK2 });
        d.y -= 4.4 * MM;
      }
      d.y -= 1.5 * MM;
    }
    d.y -= 3 * MM;
    d.para(d.t("conf_not_invoice"), { size: 8, font: d.fonts.oblique, color: INK2 });
    if (notes) {
      d.y -= 3 * MM;
      d.text(d.t("notes_label"), { x: M, y: d.y, size: 6.8, font: B, color: GOLD });
      d.y -= 4.6 * MM;
      d.para(notes, { size: 9, color: INK2 });
    }
  /* ══ RECEIPT ══ */
  } else if (docType === "receipt") {
    const amountC = data?.amount_paid !== null && data?.amount_paid !== undefined ? cents(data.amount_paid)
      : (depositPaidC !== null ? depositPaidC : grossC);
    const payDate = data?.payment_date ?? issueDate;
    d.para(d.t("receipt_intro"), { size: 9.5, color: INK2 });
    d.y -= 4 * MM;
    const boxH = 26 * MM;
    d.ensure(boxH + 4 * MM);
    d.box(d.y, boxH);
    const rows: Array<[string, string]> = [];
    if (invNo) rows.push([d.t("receipt_invoice"), invNo]);
    rows.push([d.t("receipt_amount"), money(amountC, lang)]);
    if (payDate) rows.push([d.t("receipt_date"), fmtDate(payDate, lang)]);
    let ry = d.y - 9 * MM;
    for (const [label, value] of rows) {
      d.text(S(label).toUpperCase(), { x: M + 7 * MM, y: ry, size: 6.8, font: B, color: INK2 });
      d.textRight(S(value), { y: ry, size: 11, font: B, color: label === d.t("receipt_amount") ? GOLD : INK });
      ry -= 7.5 * MM;
    }
    d.y -= boxH + 6 * MM;
    if (notes) {
      d.text(d.t("notes_label"), { x: M, y: d.y, size: 6.8, font: B, color: GOLD });
      d.y -= 4.6 * MM;
      d.para(notes, { size: 9, color: INK2 });
    }
  /* ══ INVOICE DOCS ══ */
  } else {
    d.text(d.t("th_pos"), { x: M, y: d.y, size: 6.8, font: B, color: GOLD });
    d.text(d.t("th_desc"), { x: M + 12 * MM, y: d.y, size: 6.8, font: B, color: GOLD });
    d.textRight(d.t("th_amount"), { y: d.y, size: 6.8, font: B, color: GOLD });
    d.y -= 2.2 * MM;
    d.rule(d.y, GOLD, 1);
    d.y -= 5.4 * MM;
    const descW = A4W - 2 * M - 12 * MM - 34 * MM;
    items.forEach(([desc, amt], i) => {
      const lines = d.wrap(desc, BODY, 9.5, descW);
      d.ensure(lines.length * 4.4 * MM + 1.6 * MM);
      d.text(String(i + 1), { x: M, y: d.y, size: 9, color: INK2 });
      lines.forEach((line, li) => {
        d.text(line, { x: M + 12 * MM, y: d.y, size: 9.5, color: INK });
        if (li === 0) d.textRight(money(amt, lang), { y: d.y, size: 9.5, color: INK });
        d.y -= 4.4 * MM;
      });
      d.y -= 1.6 * MM;
    });
    d.y -= 2 * MM;
    d.rule();
    d.y -= 6.5 * MM;

    /* totals block (right) */
    const tx = A4W - M - 70 * MM;
    const totalRow = (label: string, value: string, bold = false, color: any = INK) => {
      d.text(S(label), { x: tx, y: d.y, size: bold ? 10.5 : 9.5, font: bold ? B : BODY, color: bold ? color : INK2 });
      d.textRight(S(value), { y: d.y, size: bold ? 10.5 : 9.5, font: bold ? B : BODY, color });
      d.y -= 5.6 * MM;
    };
    d.ensure(5.6 * MM);
    totalRow(d.t("net"), money(netC, lang));
    if (vatRate) totalRow(d.t("vat_row", { pct: vatPctLabel }), money(vatC, lang));
    d.rule(d.y + 2.2 * MM);
    totalRow(d.t("gross"), money(grossC, lang), true);
    if (docType === "final_invoice" && depositPaidC) {
      totalRow(d.t("less_deposit"), "-" + money(depositPaidC, lang));
      const restC = grossC - depositPaidC;
      d.rule(d.y + 2.2 * MM, GOLD, 1.1);
      totalRow(d.t("due_amount"), money(restC, lang), true, GOLD);
    }
    d.y -= 1.5 * MM;

    if (vatScheme === "kleinunternehmer") d.para(d.t("ku_line"), { size: 7.5, color: INK2 });
    else if (vatScheme === "reverse_charge") d.para(d.t("rc_line"), { size: 7.5, color: INK2 });
    d.y -= 3 * MM;

    /* payment box */
    let dueS = "";
    const mIssue = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(issueDate ?? ""));
    if (mIssue) dueS = fmtDate(new Date(Date.parse(`${mIssue[1]}-${mIssue[2]}-${mIssue[3]}T00:00:00Z`) + dueDays * 86400000).toISOString().slice(0, 10), lang);
    const payLines: string[] = [];
    if (issueDate && dueS) payLines.push(d.t("pay_terms", { days: dueDays, due: dueS }));
    if (iban) payLines.push(d.t("pay_iban"));
    if (payLines.length) {
      const wrapped = payLines.map((pl) => d.wrap(pl, BODY, 9, A4W - 2 * M - 14 * MM));
      const ibanH = iban ? 5 * MM : 0;
      const boxH = 8 * MM + wrapped.reduce((s, wl) => s + wl.length * 4.3 * MM, 0) + ibanH;
      d.ensure(boxH + 4 * MM);
      d.box(d.y, boxH);
      let py = d.y - 6.5 * MM;
      wrapped.forEach((wl, wi) => {
        for (const line of wl) {
          d.text(line, { x: M + 7 * MM, y: py, size: 9, font: wi === 0 ? B : BODY, color: wi === 0 ? INK : INK2 });
          py -= 4.3 * MM;
        }
      });
      if (iban) {
        py -= 0.8 * MM;
        d.text(`IBAN: ${S(iban)}`, { x: M + 7 * MM, y: py, size: 10, font: B, color: INK });
        if (invNo) d.textRight(`${d.t("pay_ref")}: ${S(invNo)}`, { y: py, size: 8, color: INK2 });
      }
      d.y -= boxH + 6 * MM;
    }

    if (notes) {
      d.text(d.t("notes_label"), { x: M, y: d.y, size: 6.8, font: B, color: GOLD });
      d.y -= 4.6 * MM;
      d.para(notes, { size: 9, color: INK2 });
    }
  }

  const bytes = await d.save();
  const fileName = (S(invNo || docTitle).replace(/[^A-Za-z0-9-_]/g, "-") || "document") + ".pdf";
  return { bytes, title: metaTitle, fileName };
}

/* ── HTTP handler ── */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!internalCrmRequest(req)) return json({ok:false,error:"Personal sign-in required"},401);
  const ADMIN_KEY = Deno.env.get("ADMIN_DASH_KEY") ?? "";
  const CLIENT_KEY = Deno.env.get("CLIENT_DASH_KEY") ?? "";
  const provided = req.headers.get("x-admin-key") ?? "";
  const role = provided === ADMIN_KEY ? "team" : provided === CLIENT_KEY ? "client" : null;
  if (!role) return json({ ok: false, error: "unauthorized" }, 401);
  if (role !== "team") return json({ ok: false, error: "forbidden" }, 403);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  let data: any = null;

  if (b.payload && typeof b.payload === "object") {
    /* ad-hoc document — raw JSON payload, same shape as the Python CLI */
    data = b.payload;
  } else if (b.invoice_id) {
    /* render from the invoices table row */
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error } = await sb.from("invoices")
      .select("*, gigs(date,fee, venues(name,city))")
      .eq("id", String(b.invoice_id)).limit(1);
    if (error) return json({ ok: false, error: error.message }, 500);
    const inv = rows?.[0];
    if (!inv) return json({ ok: false, error: "invoice not found" }, 404);
    const { data: bsRows } = await sb.from("business_settings").select("*").eq("id", true).limit(1);
    const bs = bsRows?.[0] ?? {};
    const venueName = inv.gigs?.venues?.name ?? null;
    const gigCity = inv.gigs?.venues?.city ?? null;
    const gigDate = inv.gigs?.date ?? inv.service_date ?? null;
    const feeEuros = (inv.net_cents ?? 0) / 100;
    const dueDays = inv.due_date && inv.issue_date
      ? Math.max(0, Math.round((Date.parse(inv.due_date) - Date.parse(inv.issue_date)) / 86400000))
      : 14;
    const descParts = [venueName, gigCity, inv.service_date ? fmtDate(inv.service_date, "de") : null].filter(Boolean);
    data = {
      lang: b.lang === "en" ? "en" : "de",
      doc_type: inv.doc_type,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      service_date: inv.service_date,
      due_days: dueDays,
      vat_scheme: inv.vat_scheme,
      steuernummer: bs.steuernummer ?? undefined,
      ust_idnr: bs.ust_idnr ?? undefined,
      iban: bs.iban ?? undefined,
      recipient: {
        name: inv.recipient_name ?? "",
        address_lines: inv.recipient_address ? String(inv.recipient_address).split("\n") : [],
        email: inv.recipient_email ?? "",
      },
      notes: inv.notes ?? "",
      items: descParts.length
        ? [{ description: `DJ-Auftritt — ${descParts.join(", ")}`, amount: feeEuros }]
        : [{ description: "DJ-Auftritt", amount: feeEuros }],
      event: venueName || gigDate
        ? { name: venueName, venue: venueName, city: gigCity, date: gigDate, fee: feeEuros }
        : undefined,
    };
  } else {
    return json({ ok: false, error: "invoice_id or payload required" }, 400);
  }

  try {
    const { bytes, fileName } = await buildPdf(data);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});
