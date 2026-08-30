# WARREN WILL — Brand Positioning & Brand Guide

**v1.1 · 2026-08-30 · codified from the live DARK site (canonical): [warrenwill.de](https://warrenwill.de)**

This guide is the single source of truth for every Warren Will touchpoint: website, CRM dashboard, invoices, e-mails, social, EPK, flyers, and anything a promoter ever sees. Every token below was extracted from the live codebase — where surfaces have drifted, this guide canonizes one value and marks the fix.

---

## 1. Brand Positioning

| | |
|---|---|
| **Who** | Warren Will — DJ & producer, Munich |
| **What** | Groovy, bass-driven Tech House / Afro House — warm, physical, dancefloor-first |
| **Arc** | *"From Munich clubs to mountain dancefloors."* Club residencies → festivals → private events |
| **For whom** | Promoters, bookers and club managers who need a reliable, crowd-reading DJ — and the dancers who follow him |
| **Promise** | A packed, moving floor — delivered professionally: confirmed fees, deposits, invoices, on-time, no drama |
| **Personality** | Bavarian warmth (**Servus**, direct, human) × club-culture darkness (night, bass, gold light) × Swabian-grade reliability (the CRM *is* the brand backstage) |
| **Differentiator** | The only DJ whose booking experience feels as produced as his sets — instant confirmation, branded invoices, post-gig recap clips |

**One-liner (EN):** Groovy, bass-driven Tech House from Munich — club nights, festivals, private events.

**One-liner (DE):** Warren Will — DJ & Producer aus München. Tech House mit Groove und Bass — vom Club auf den Berg.

**Voice constants:** `Servus` opens, never "Dear Sir". Short sentences. Warm but never goofy. German for people, English for the scene. The wordmark is always set in caps: **WARREN WILL**, never "Warren will" in headlines.

---

## 2. Logo / Brand Mark

The brand has **no image-file logo** — the mark is typographic, code-drawn, and renders identically everywhere. Keep it that way: it can never pixelate, break, or be hot-linked wrong.

### 2.1 Construction (canonical spec, from `#nav` on the live site)

```
┌────────┐  WARREN WILL
│  WW    │  ← wordmark: Bebas Neue, 20 px, letter-spacing .18em, ALL CAPS
└────────┘
   ↑ monogram: 34×34 px gold square (sharp corners, NO radius)
     "WW" in Bebas Neue 16 px, letter-spacing .05em
     gold #C8A96E background · ink #050505 letters
     gap between mark and wordmark: 10 px
```

### 2.2 Variants

| Context | Mark | Wordmark |
|---|---|---|
| Dark surfaces (site, social overlays) | gold square, ink letters | `--text` #F2EFE9 |
| Light surfaces (CRM, print, invoice body) | gold square, ink letters | ink #16130E |
| Favicon / app icon / avatar | monogram alone, full-bleed gold square | — |
| E-mail header (invoice mails) | — | WARREN WILL, letter-spacing 4 px, gold on #0D0D0D, subtitle "DJ & PRODUCER · MÜNCHEN" |

### 2.3 Rules

- Minimum size: monogram 24 px, wordmark 14 px.
- Clearspace: height of the monogram on all sides.
- **Never:** rounded corners on the square, gradients, drop shadows, outline/stroke versions, gold wordmark on gold background, or any font other than Bebas Neue in the mark.
- "WW" letters always optically centered (the mark uses `place-items:center`).

---

## 3. Typography

Three typefaces, three jobs — loaded from Google Fonts on every surface:

```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

| Role | Font | Usage | Live example |
|---|---|---|---|
| **Display** — `--bebas` | `'Bebas Neue', sans-serif` | Headlines, dates, fees, the wordmark. ALL CAPS, letter-spacing .16–.18em | Hero menu `clamp(28px, 3.8vw, 46px)`, gig dates 32 px |
| **Body** — `--grot` | `'Space Grotesk', sans-serif` (300–600) | Paragraphs, UI text, forms. Sentence case. | 15–16 px / 1.6 |
| **Meta** — `--mono` | `'Space Mono', monospace` | Labels, eyebrows, buttons, badges, legal. ALL CAPS, letter-spacing .16–.22em, 9–11 px | Nav links 10 px / .22em |

**Rules**
- Bebas Neue is **never** used below 14 px or for body copy — it is a display face.
- Space Mono labels are always uppercase + tracked out; they are the brand's "technical stamp".
- Hover voice: links go gold and *breathe* — letter-spacing .16em → .24em with an 8 px slide (the hero menu move). This is the signature micro-interaction; reuse it, don't invent others.
- Fallbacks: `sans-serif` for Bebas/Grotesk, `monospace` for Space Mono. Never substitute other display fonts.

---

## 4. Color

### 4.1 Core palette — DARK (canonical, public site)

| Token | Hex | Job |
|---|---|---|
| `--black` | `#050505` | Page background — true club black |
| `--panel` | `#0C0C0C` | Cards, raised sections |
| `--line` | `#222222` | Hairlines, borders |
| `--text` | `#F2EFE9` | Warm off-white (never pure #FFF) |
| `--muted` | `#9A958C` | Warm gray — secondary text |
| `--gold` | `#C8A96E` | **THE brand gold** — accents, CTAs, the mark |

### 4.2 Derived palette — LIGHT (CRM dashboard, print)

| Token | Hex | Job |
|---|---|---|
| `--paper` | `#FFFDF8` | Light background |
| `--ivory` | `#F7F4EE` | Inputs, wells |
| `--ink` | `#16130E` | Text |
| `--ink2` | `#4A443A` | Secondary text |
| `--gold` (light) | `#A9853E` | Darkened gold — passes contrast on paper |
| `--gold-soft` | `#C8AB72` | Light-theme highlight gold |

### 4.3 Semantic

`--red #B04030` (overdue/deposit open/delete) · `--green #1F8A44` (done/paid/deposit ✓). Used only as status — never decoration.

### 4.4 ⚠ Gold drift — canonize this

Three golds are live today. **Canonical: `#C8A96E`.**

| Surface | Current | Action |
|---|---|---|
| Website (dark) | `#C8A96E` | ✅ canonical |
| CRM dashboard (light) | `#A9853E` | ✅ keep — deliberate light-theme derivative |
| Invoice e-mail header | `#C9A227` | 🔧 fix → `#C8A96E` on next `crm-update` touch |

**Ratio rule:** ~85 % black/panel, 10 % text, 5 % gold. Gold is a spotlight, never a floodlight. No other accent colors. No gradients. No purple/blue — ever.

---

## 5. Voice & Tone

| | DO | DON'T |
|---|---|---|
| Greeting | „Servus!" / „Servus Rene," | „Sehr geehrte…" for scene contacts |
| Close | „Servus!" / „Bis bald im Booth" | Corporate sign-offs |
| Numbers | Exact — „€350, 23:00–01:00, Deposit 50 %" | „affordable", „flexible" |
| Feel | Backstage, direct, warm | Hype-beast, emoji walls, exclamation stacks |
| Languages | DE for promoters/venues · EN for the international scene · bilingual EPK | Mixing languages mid-sentence |

**Tagline bank (approved):** *"From Munich clubs to mountain dancefloors."* · *"Groovy, bass-driven Tech House."* · *"Servus. Let's pack the floor."*

---

## 6. Surface Applications

| Surface | Theme | Notes |
|---|---|---|
| **Website** (canonical) | DARK | Video hero (`hero-1080.mp4`), hairline borders, mono nav, Bebas menu. This guide was codified from it |
| **CRM dashboard** (`/admin.html`) | LIGHT | Same 3 fonts, paper palette, gold `#A9853E`. Warren's client view: light, calm, „SERVUS, WARREN." in Bebas |
| **Invoices / e-mail** | Light body, dark branded header (`#0D0D0D` + gold wordmark) | GoBD-clean layout; brand lives in the header block only |
| **Instagram / social** | DARK | Gold WW avatar; recap clips graded dark+warm; captions open with Servus; Space Mono for text overlays |
| **EPK** (DE/EN) | DARK cover, light interior pages | Monogram + wordmark top-left, one press photo, fee-on-request |
| **Flyers / venue assets** | DARK | Always send venues the gold-on-black pack, never let them re-set the name in their house font without Bebas |

---

## 7. Imagery & Motion

- **Photo/video treatment:** dark, warm-gold grade, high contrast, real sweat — clubs (Pacha, Pimpernel) and mountains (Starnberg/Alpen sets). Stocky AI-smooth visuals are off-brand.
- **Hero media:** `object-position: center 35%` — faces/hands above the fold, always.
- **Motion vocabulary:** ONE signature move (gold hover-breathe, see §3). Plus slow video. Nothing else: no spinners, no parallax confetti, no fade-in-up soup.

---

## 8. Copy-paste token sheet

```css
:root{
  /* WARREN WILL — canonical DARK */
  --black:#050505; --panel:#0c0c0c; --line:#222;
  --text:#f2efe9; --muted:#9a958c; --gold:#c8a96e;
  /* LIGHT derivative (CRM/print) */
  --paper:#fffdf8; --ivory:#f7f4ee; --ink:#16130e; --ink2:#4a443a;
  --gold-light:#a9853e; --gold-soft:#c8ab72;
  /* semantic */
  --red:#b04030; --green:#1f8a44;
  /* type */
  --bebas:'Bebas Neue',sans-serif;
  --grot:'Space Grotesk',sans-serif;
  --mono:'Space Mono',monospace;
}
```

*Maintained by CRM_INFRASTRUCTURE · The Warren Will Company. Changes to tokens require updating this file + the site + admin.html in the same PR.*

---

## 9. Equipment Hire Extension

**Public name:** WARREN WILL Equipment Hire

**Primary local proposition:** Professional DJ and audio equipment rental in Munich for artists, venues and private events.

**German search phrase:** *DJ-Equipment mieten München*

**Canonical route:** `https://www.warrenwill.net/dj-equipment-mieten-muenchen.html`

The rental offer is a service line inside WARREN WILL, not a separate visual brand. It uses the same DARK palette, WW monogram, type system and warm/direct voice. The distinction is functional: precise inventory, exact 24-hour rates, transparent deposits, itemized handover and reliable return handling.

### Customer promise

> Clubstandard-Technik. Transparent gebucht. Sicher übergeben.

### Required rental language

- An availability request is **not** a reservation.
- A booking is confirmed only after the customer accepts the offer/rental agreement and required payments are received.
- Every quote states equipment, quantity, accessories, rental window, logistics, rental fee and security deposit.
- Every handover and return uses a timestamped condition record with serial numbers and photos.
- Normal wear is not charged; deductions are documented and tied to repair, cleaning, replacement or evidenced follow-on loss.

### Search and listing consistency

Use the identical business name, phone, email, Munich service area and rental-page URL in the Google Business Profile, Bing Places, Apple Business Connect and relevant Munich/event-rental directories. Do not create a second domain or a detached rental identity. All listings should link directly to the canonical rental route.
