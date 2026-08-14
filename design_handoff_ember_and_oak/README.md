# Handoff: Ember & Oak — complete e-commerce store ("Ember Dark" direction)

## Overview
Ember & Oak is a small-batch coffee roastery that also sells pantry goods (granola, chocolate, honey, syrups) and brewing accessories. This handoff covers the full storefront plus an internal admin orders dashboard: 7 pages, each designed at three breakpoints (desktop ~1440px, tablet ~768px, mobile ~390px).

Language: English. Currency: EUR. Tone: warm, artisanal, cozy but modern — a craft roastery, not a corporate shop.

## About the design files
The files in `design_files/` are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly**. Each `.dc.html` file is a design canvas that renders *all three breakpoints of a page side by side* (plus extra states like the cart drawer, empty states and expanded admin rows) so they can be compared at a glance. They are not responsive pages: each breakpoint is a separate fixed-width block.

The task is to **recreate these designs in the target codebase's existing environment** (React/Next, Vue, Astro, Rails views, whatever exists) using its established patterns, component library and CSS approach. If no codebase exists yet, pick an appropriate stack — a React/Next.js app with Tailwind or CSS modules maps cleanly onto this design — and implement there. Build ONE responsive page per design file, using the three blocks as the desktop / tablet / mobile targets of the same page.

Notes on reading the files:
- Every style in them is inline. That is an artifact of the design tool, not a recommendation — use the codebase's normal styling approach.
- Product/photo areas are **striped placeholders** with monospace captions describing the intended shot (e.g. `hero photo — beans on dark steel, side light`). Real photography is warm, natural food photography; the client will supply it. Use the captions as art direction and as `alt` text hints.
- `support.js` is the design tool's runtime, needed only to open the `.dc.html` files in a browser. Ignore it for implementation.

## Fidelity
**High fidelity.** Colors, typography, spacing, radii, shadows, hover states and copy are final. Recreate the UI faithfully. All exact values are in [Design tokens](#design-tokens).

---

## Global design system

### The "Ember Dark" pattern
This is the defining structure of the design — apply it on every storefront page:

1. A **dark espresso band** (`#2E211A`) at the top of the page holds the announcement bar, the header/nav, and the page's title block.
2. Inside that band, an **ember glow**: a large radial gradient circle, terracotta at ~40% alpha fading to transparent, positioned so only part of it is visible (usually top-left, clipped by `overflow:hidden`). This is what makes the dark feel warm.
3. The band has extra bottom padding, and the **first cream/white card of the content overlaps upward into it** via a negative top margin (`margin-top:-52px` … `-96px` depending on page) + `position:relative`. This overlap is the signature move; keep it.
4. Below the band the page is **warm cream** (`#FAF6EF`) with white cards, soft warm shadows and no hard borders on cards.
5. Footer returns to deep brown (`#4A3428`).

Announcement bar text (dark band, monospace, letterspaced, centered):
`BATCH № 214 ROASTED TUE 12 AUG · FREE EU SHIPPING OVER €49`

### Header
- Desktop: logo (terracotta dot + "Ember & Oak" in Fraunces 23px/600) left; nav right — text links `Shop`, `About`, `Brew guides` (Inter 14px/500, `#EFE4D8`, hover `#E4A07F`) followed by a **pill cart button** (transparent, 1px border `rgba(239,228,216,.32)`, radius 999px, padding 9px 17px) containing the label "Cart" and a terracotta count badge (min-width 20px, height 20px, radius 999px, `#C65F3D`, white 11px/700).
- Header height 84px desktop / 68px tablet / 62px mobile; bottom border `1px solid rgba(239,228,216,.16)`.
- Tablet + mobile: burger (3 bars, 20/20/14px × 2px, `#EFE4D8`, gap 5px) left in a 44×44 tap target, centered logo, cart icon button right (44×44) with the badge pinned to its top-right corner. Active nav item is `#E4A07F`.
- The header is **sticky** on all breakpoints.

### Buttons
- Primary: `#C65F3D`, white text, `border-radius:999px`, height 52px desktop (48–52 tablet/mobile), Inter 15px/600. Hover `#A94C2F`.
- Secondary on dark: transparent, 1px `rgba(239,228,216,.35)` border, `#EFE4D8` text, radius 999px. Hover border+text `#E4A07F`.
- Secondary on cream: white/transparent with `1px solid #E8DFD2`, hover border and text `#C65F3D`.
- Icon "add" button on product cards: 42px circle, `#2E211A`, white `+` 19px. Hover `#C65F3D`. (On mobile it becomes a full-width "Add to cart" button, min-height 44px, radius 10px.)
- Quantity steppers: pill container (radius 999px) with `−` / value / `+`; each control 44×44 minimum on tablet/mobile, 48×52–54 on desktop.

### Cards
White (`#FFFFFF`), `border-radius:14px`, **no border**, shadow `0 14px 34px rgba(46,33,26,.10)`; on hover `transform:translateY(-6px)` and shadow `0 26px 56px rgba(46,33,26,.18)`, transition `.2s`. Cards that overlap the dark band use a stronger shadow (`0 20px 48px rgba(46,33,26,.14)` on cream, `0 26px 60px rgba(0,0,0,.30)` when sitting on dark).

Dark cards (cart/checkout summary sidebars) are `#2E211A`, radius 14px, shadow `0 20px 48px rgba(46,33,26,.24)`, dividers `1px solid rgba(239,228,216,.18)`, body text `rgba(239,228,216,.70)`, values `#FAF6EF`.

### Category badge on product images
Small pill, `#2E211A` background, `#FAF6EF` text, IBM Plex Mono 10px/600, letter-spacing .08em, uppercase: `COFFEE`, `PANTRY`, `GEAR`. Positioned top-left inside the image, 14px inset.

### Placeholder imagery
- On cream: `repeating-linear-gradient(45deg,#F0E7D8 0 12px,#E9DECB 12px 24px)`
- On dark: `repeating-linear-gradient(45deg,#3B2A21 0 15px,#463227 15px 30px)`
- Caption chip: monospace 9–11px, `#8A7A6A` on cream / `#C9B8A8` on dark, translucent background, radius 4–5px.

### Responsive rules (apply globally)
- Product grid: **4 columns** desktop → **3** tablet → **2** mobile.
- Full nav desktop; burger + cart icon tablet/mobile.
- All steppers, pills and buttons: **min 44px** tap target on tablet/mobile.
- Page padding: 56px desktop, 24px tablet, 20px mobile.

---

## Screens / views

### 1. Homepage — `1 Homepage Ember Dark.dc.html`
**Purpose:** sell the roastery's freshness story and route to the shop.

Sections top to bottom:
1. **Dark hero band.** Announcement bar → header → 2-column grid (`1.15fr .85fr`, gap 56px, padding 78px 56px 0).
   - Left: eyebrow `SMALL-BATCH ROASTERY · FREIBURG · EST. 2019` (Mono 12px/500, letter-spacing .18em, `#E4A07F`); H1 in Fraunces **84px/1.0/600**, `#FAF6EF`, letter-spacing -.02em, reading “Dark, sweet and still *warm* from the drum.” where *warm* is `#E4A07F`, italic, weight 400; body paragraph Inter 17px/1.7 `rgba(239,228,216,.72)` max-width 42ch; primary CTA "Shop the roast" + secondary "Taste guide"; a stats line in mono 12px `rgba(239,228,216,.55)`: `12 PRODUCTS · SHIPS IN 48 H · ROASTED TO ORDER`.
   - Right: 470px-tall image placeholder, radius 14px, shadow `0 30px 70px rgba(0,0,0,.4)`.
   - Tablet/mobile: single column, H1 58px / 42px, hero image below the copy (320px / 250px tall), CTA full-width on mobile.
2. **Featured products** — 4 cards overlapping the band by `-96px` (tablet `-80px`, mobile `-62px`). Card: square image with category badge, name (Fraunces 18px/600), tagline (Inter 13px `#7A6A5C`), price (Inter 17px/600) + circular add button. "All 12 products →" link right-aligned beneath.
3. **Browse the shelves** — 3 category tiles, 260px tall, radius 14px, striped placeholder with `linear-gradient(transparent 40%,rgba(46,33,26,.68))` scrim; name in Fraunces 30px white, count in 13px `rgba(255,255,255,.82)` + `→`. Tablet 190px tall, mobile stacked 130px tall with name and count on one line.
4. **Inside the tannery** — band with `#F3ECDE` background, 2-column (image left, copy right). Eyebrow `INSIDE THE TANNERY` in terracotta; H2 Fraunces 44px; paragraph; three figures separated by a top border: **12 kg** PER BATCH, **48 h** ROAST TO POST, **7 yrs** SAME ROOM (numbers Fraunces 30px, labels mono 12px); "Read our story →". Stacks with image first on tablet/mobile.
5. **Newsletter band** — `#2E211A`, H3 "Know what's in the drum", sub-line, email input (300px, height 52px, radius 999px, `rgba(239,228,216,.08)` fill, `rgba(239,228,216,.30)` border, `#FAF6EF` text) + "Subscribe" primary button. Stacks vertically below desktop.
6. **Footer** — `#4A3428`, 4 columns (brand blurb, SHOP, HOUSE, HELP). Column headings mono 10px/500, letter-spacing .14em, `rgba(239,228,216,.5)`; links Inter 14px `#EFE4D8`. Bottom bar above a `rgba(239,228,216,.15)` divider: `© 2026 EMBER & OAK ROASTERY GMBH` / `PRICES INCL. VAT · FREE SHIPPING OVER €49`. Tablet 2 columns, mobile 2 columns with brand block stacked above.

### 2. Product listing `/shop` — `2 Shop.dc.html`
- Dark band: header + eyebrow `THE SHOP · 12 PRODUCTS`, H1 Fraunces 60px "Everything roasted, jarred and packed in-house.", plus a right-aligned 34ch intro paragraph on desktop (dropped on tablet/mobile, H1 40px / 32px).
- **Floating filter bar**: white card (radius 14px, shadow `0 14px 34px rgba(46,33,26,.12)`, padding 16px 20px) overlapping the band by -58px. Left: category pills `All 12` (active: `#2E211A` fill, `#FAF6EF` text) / `Coffee 6` / `Pantry 4` / `Accessories 4` (inactive: transparent, `1px solid #E8DFD2`, count in `#7A6A5C`; hover border+text terracotta). Right: sort control — pill, `#FAF6EF` fill, mono `SORT` label + bold "Price, low → high" + caret triangle. Sort options: price low→high, price high→low, name A→Z.
- **Grid**: 4 / 3 / 2 columns, gap 22px (16px / 12px). Cards as described in the global system; whole card is a link to the product page, add-button is a nested action.
- Tablet/mobile: filter card becomes stacked (pills row, then full-width sort button); pills scroll horizontally on mobile, all min 44px.
- Footer: single-row condensed variant (brand, link row, mono legal line).
- **Empty state** (filter yields nothing): the pill row stays; below it a **dark card** (`#2E211A`, radius 14px, padding 64px 32px, its own ember glow) centered: 120px striped circle placeholder ("empty jar illo"), Fraunces 28px `#FAF6EF` "Nothing on this shelf", Inter 14px/1.65 `rgba(239,228,216,.7)` max 40ch "No products match your filters right now. New batches land every Tuesday — try another shelf in the meantime.", primary "Clear filters" button.

### 3. Product detail — `3 Product Detail.dc.html`
Sample product: **Sunrise Single Origin – Ethiopia**, `€16.50`, 250 g.
- Dark band holds header, a mono back-link `← BACK TO SHOP` (`rgba(239,228,216,.72)`, hover `#E4A07F`), and a 2-column grid: gallery left (square main image on the dark stripe pattern, shadow `0 30px 70px rgba(0,0,0,.4)`, plus three 96px thumbnails — active thumbnail `2px solid #E4A07F`, others `1px solid rgba(239,228,216,.2)`), **info card right** (white, radius 14px, padding 40px, shadow `0 26px 60px rgba(0,0,0,.3)`).
- Info card contents in order: dark pill badge `COFFEE · SINGLE ORIGIN`; H1 Fraunces 44px/1.06; mono meta `250 G · WHOLE BEAN · WASHED · YIRGACHEFFE`; price Inter 32px/600 with `incl. VAT · €66.00 / kg` in 13px muted; description Inter 15px/1.75 `#7A6A5C`; **roast-profile block** (cream `#FAF6EF`, radius 12px, padding 18px): mono label `ROAST PROFILE`, an 8px-tall bar with `linear-gradient(90deg,#E4A07F,#C65F3D 55%,#4A3428)` and a 16px white knob with a 3px terracotta ring at 26% for this product, scale labels `LIGHT / MEDIUM / DARK`, then flavour chips (`Jasmine`, `Bergamot`, `Honeydew` — white pills, `1px solid #E8DFD2`, radius 999px); then the row of quantity stepper + full-width primary "Add to cart — €16.50"; then a mono reassurance row above a `1px solid #E8DFD2` divider: `✓ FREE SHIPPING OVER €49 · ✓ ROASTED THIS TUESDAY · ✓ RESEALABLE BAG`.
- **You might also like** — 3 cards on cream (16:9 image + badge, name, price), heading Fraunces 30px, "All 12 products →" right.
- Tablet: stacked — image (4:3) and thumbnails inside the dark band, info card overlapping by -70px, H1 34px. Related row becomes 3 small cards.
- Mobile: image square in the band, info card overlapping -56px, H1 28px, stepper on its own row labelled "Qty", related products as horizontal list rows (72px thumb + name + price). **Sticky bottom bar** (`#2E211A`, padding 14px 20px 22px, shadow `0 -12px 30px rgba(46,33,26,.3)`): mono `TOTAL` + price on the left, primary "Add to cart" filling the rest.

### 4. Cart — `4 Cart.dc.html`
Shipping rule: **flat €4.90, free over €49**.

**a) Slide-over drawer (desktop/tablet)** — 450px wide panel pinned right, `#2E211A`, shadow `-30px 0 70px rgba(0,0,0,.45)`, own ember glow; page behind it dimmed with `rgba(19,12,9,.55)`.
- Header: "Your cart" (Fraunces 23px `#FAF6EF`) + mono sub-line `2 ITEMS · BATCH № 214`; 38px circular close button (transparent, `1px solid rgba(239,228,216,.3)`).
- **Free-shipping meter**: "€17.60 away from free shipping" (bold part `#FAF6EF`) above a 6px track `rgba(239,228,216,.16)` with a terracotta fill (64% in the mock).
- Line items: 76px dark striped thumb, name Fraunces 15px `#FAF6EF`, mono `€14.90 EACH`, dark pill stepper (`rgba(239,228,216,.08)` fill, `rgba(239,228,216,.22)` border), line total right, `✕` remove top-right (hover `#E4A07F`); rows divided by `rgba(239,228,216,.14)`.
- Footer of the drawer switches to **cream** (`#FAF6EF`): Subtotal €31.40, Shipping €4.90, Total €36.30 (18px/600 above a `#E8DFD2` divider), primary "Proceed to checkout", then a centered "View full cart" text link.
- **"Added to cart" toast**: white card, radius 14px, padding 14px 18px, shadow `0 18px 44px rgba(0,0,0,.35)`, bottom-left of the viewport (56px inset); 26px green (`#5C8A5C`) check circle + mono `ADDED TO CART` label + product name in Inter 14px/600. Auto-dismiss ~3 s.

**b) Full cart page** — dark band with eyebrow `YOUR CART · 4 ITEMS`, H1 Fraunces 52px "Ready when you are." and a mono `← CONTINUE SHOPPING` link right. Content: `1fr 410px` grid overlapping the band by -56px. Left white card lists items (92px thumb, name Fraunces 18px, mono meta `250 G · WHOLE BEAN · €16.50 EACH`, cream pill stepper, line total, `✕` hover `#B0483B`), footed by "← Continue shopping" and mono `ROASTED TUE 12 AUG · SHIPS WED`. Right: **dark sticky summary** (top 24px) with a green success chip `✓ You've unlocked free shipping` (`rgba(92,138,92,.18)` fill, `rgba(92,138,92,.5)` border, text `#A8CDA8`), Subtotal €56.40, Shipping **Free** (`#A8CDA8`), Total €56.40 (20px/600), mono `INCL. VAT`, primary checkout button.

**c) Mobile drawer** — full-screen `#2E211A` sheet, same header/meter/items, cream totals block pinned to the bottom; stepper controls 44px.

**d) Empty cart** — full-screen dark sheet: 140px striped circle ("empty cup illo"), Fraunces 26px `#FAF6EF` "Your cart is empty", `rgba(239,228,216,.68)` copy "Nothing brewing yet. The good stuff is one shelf away.", primary "Browse the shop".

### 5. Checkout (2 steps) — `5 Checkout.dc.html`
- Dark band per step: minimal header (mono `← BACK TO CART`, centered logo, mono `SECURE CHECKOUT`), H1 Fraunces 40px "Checkout", then the **step indicator**: numbered 32px circles joined by a 76px 1px rule. Current step = terracotta fill, white number, label `#FAF6EF`/600. Completed step = green `#5C8A5C` circle with `✓`, label muted, connector turns terracotta. Upcoming = transparent circle with `rgba(239,228,216,.35)` border.
- Layout: `1fr 400px`, form card left (white, radius 14px, padding 36px) overlapping the band by -52px; **dark order summary** right, sticky on step 1.
- **Step 1 — Contact & shipping**: First name / Last name (2-col), Email (full, with helper "Order confirmation goes here — no newsletter unless you ask."), Street & number (full, shown in focus state: `2px solid #C65F3D` + white fill), ZIP / City (2-col), Country (select, "Germany"). Field labels are mono 10px/500, letter-spacing .12em, `#7A6A5C`, uppercase; inputs height 50px, radius 10px, `#FAF6EF` fill, `1px solid #E8DFD2`. Primary "Continue to payment →" bottom-right.
- **Step 2 — Payment (demo)**: heading row with an amber demo chip `DEMO — NO REAL CHARGE` (`#FBF3E1` fill, `#EAD9AE` border, `#9A7217` text); an explanatory cream strip "This is a design prototype. The fields below are dummies — nothing is stored or charged."; Name on card, Card number (mono `4242 4242 4242 4242` with a grey card-brand placeholder), Expiry `08 / 29`, CVC. Footer row: "← Back to shipping" text link left, primary "Place order — €56.40" right. **Non-functional by design** — wire it to a mock/stub, never to a real PSP.
- **Order summary** (dark, both steps): title, then per line item a 54px dark thumb with a terracotta quantity bubble at its top-right, name, line total; totals block (Subtotal €56.40, Shipping Free, Total €56.40, mono `INCL. VAT`). On step 2 it also shows a `SHIPS TO` block with the address.
- Tablet/mobile: summary becomes a **collapsible accordion above the form** — a white 54–56px pill/bar showing "Order summary (4 items)" and the total with a caret; expanded it reveals the items and totals. Mobile H1 25px, step labels shortened ("Shipping" / "Payment").

### 6. Order confirmation — in `5 Checkout.dc.html`
Dark band with a centered glow: 64px green check circle, Fraunces 52px "Thank you, Lena!", paragraph "Your order is in. We'll roast on Tuesday and ship within 48 hours — a confirmation is on its way to lena.hoffmann@example.com.", and an outlined mono chip `ORDER № EO-2026-0847`. Below, overlapping by -70px, a `1.3fr 1fr` grid: "Your items" card (rows with 54px thumb, `name × qty`, line total; then "Total (free shipping) €56.40") and two stacked cards — `DELIVERS TO` (full address) and `ESTIMATED DELIVERY` ("Thu–Fri, Aug 20–21" in Fraunces 20px + "Roasted fresh on Tuesday, Aug 18"). Centered primary "Back to shop". Mobile: same order, H1 30px, cards stacked full-width.

### 7. Admin orders dashboard `/admin` — `6 Admin.dc.html`
Internal tool, **no login**. Utilitarian and denser than the shop, but on the same palette: page background `#F6F2EA`.
- **Dark topbar**: logo + `/ Orders` + outlined mono `INTERNAL` chip; right side mono `THU 14 AUG 2026 · 8 ORDERS THIS WEEK`. Below it, still on dark, four counters (Fraunces 28px `#FAF6EF` value + mono 10px label): `8 ORDERS THIS WEEK`, `3 OPEN`, `€298.10 WEEK REVENUE`, `18 BAGS TO ROAST`.
- **Toolbar card** overlapping by -32px: status filter pills `All 8` (active dark) / `Open 3` / `Marked 3` / `Canceled 2` — inactive pills show their count in the status color and hover to that border color — plus a 330px search pill "Search customer or order №…" (searches customer name **and** order number).
- **Table card**: header row on `#FAF6EF`, mono 10px/600 letter-spacing .12em, columns `ORDER · DATE · CUSTOMER · EMAIL · ITEMS · TOTAL · STATUS · SET STATUS` at grid widths `130px 92px 1.2fr 1.5fr 64px 90px 118px 220px`, gap 16px, row padding 14px 20px, row divider `#F0EAE0`, row hover `#FDFBF7`. Order numbers are mono/600 with a disclosure triangle (pointing right when collapsed, down when expanded).
- **Status badge**: pill with a 7px dot — Open `#FBF1DC`/`#9A6E14`/dot `#D99A2B`; Marked `#E9F2E9`/`#43703F`/dot `#5C8A5C`; Canceled `#F7E4E1`/`#94382C`/dot `#B0483B`.
- **Per-row action**: 3-segment control (radius 999px, `1px solid #E8DFD2`, white segments, `#7A6A5C` labels) `Open | Marked | Cancel`; the segment matching the current status is filled with that status color and white text. Clicking a segment sets the status.
- **Expanded row** (first row expanded in the mock): background `#FDFBF7`, indented 56px, two cream sub-panels (radius 12px) — `LINE ITEMS` (each `name × qty` with line total, plus a Shipping row where free shows in green) and `SHIPPING ADDRESS`.
- Footer of the table: mono `SHOWING 8 OF 8 ORDERS` + circular prev/next buttons.
- Tablet: toolbar stacks (search above pills); table collapses to **2-column order cards** — order № + status badge, customer + email, `date · N items` + total, and the same 3-segment status control at min 44px height.
- Mobile: single-column cards, pills scroll horizontally; the first card is shown **expanded** with a cream inner panel holding LINE ITEMS and SHIPS TO.

---

## Interactions & behavior
- **Add to cart** (anywhere) → item added, cart badge increments, slide-over drawer opens from the right (transform/opacity, ~250 ms ease-out; backdrop fades in), and the "added to cart" toast appears bottom-left for ~3 s. On mobile the drawer is a full-screen sheet sliding up/over.
- **Free-shipping meter** recalculates on every cart change: remaining = `max(0, 49 − subtotal)`, bar width = `min(100%, subtotal / 49)`. At ≥ €49 the meter is replaced by the green "You've unlocked free shipping" chip and shipping shows "Free".
- **Quantity steppers** update line totals, subtotal, shipping and total immediately; decrementing below 1 removes the line (or disable `−` at 1 — either is acceptable, be consistent).
- **Filters + sort** on /shop are client-side, combinable, and reflected in the URL (e.g. `?category=coffee&sort=price-asc`) so a filtered shelf is shareable. No results → empty state; "Clear filters" resets to All.
- **Checkout** is a 2-step wizard; step 1 validates before advancing. Validation: name/street/ZIP/city required; email must be a valid address; ZIP 5 digits for Germany. Show inline errors under the field in `#B0483B` with the input border matching. Step 2 is a **dummy payment** — "Place order" simply creates the order and routes to the confirmation page.
- **Order numbers** follow `EO-<year>-<4-digit sequence>` (e.g. `EO-2026-0847`); the admin table shows the short form `#0847`.
- **Admin status change** applies optimistically and updates the counters and filter counts; expandable rows toggle on clicking the row or the disclosure triangle. Search filters as you type across customer name, email and order number.
- **Hover states**: cards lift 6px with a deeper shadow; primary buttons darken to `#A94C2F`; dark-band links go `#E4A07F`; remove/cancel controls go `#B0483B`.
- Respect `prefers-reduced-motion`: keep opacity changes, drop transforms.

## State management
- `cart`: `[{ productId, name, unitPrice, qty, image }]`, persisted (localStorage or server cart) — derived: `itemCount`, `subtotal`, `shipping` (`subtotal >= 49 ? 0 : 4.90`), `total`, `amountToFreeShipping`.
- `drawerOpen`, `toast: { visible, productName }`.
- `shopFilters`: `{ category: 'all'|'coffee'|'pantry'|'accessories', sort: 'price-asc'|'price-desc'|'name-asc' }` (URL-synced).
- `checkout`: `{ step: 1|2, contact: {...}, address: {...}, payment: {...}, errors: {...} }`.
- `order`: created on place-order → `{ number, date, items, totals, address, status: 'open' }`.
- Admin: `orders[]` + `{ statusFilter, query, expandedOrderId }`. Data needs: product catalogue, cart, order create, order list, order status update.

## Design tokens
**Colors**
| Token | Value | Use |
|---|---|---|
| espresso | `#2E211A` | dark bands, dark cards, primary text on cream |
| deep brown | `#4A3428` | footer |
| dark stripe A / B | `#3B2A21` / `#463227` | image placeholders on dark |
| cream | `#FAF6EF` | page background, text on dark |
| cream alt | `#F3ECDE` | story band |
| admin background | `#F6F2EA` | /admin page |
| surface | `#FFFFFF` | cards |
| text muted | `#7A6A5C` | secondary text on cream |
| muted on dark | `rgba(239,228,216,.72)` / `.55` | body / meta on dark |
| terracotta | `#C65F3D` | primary accent, links, badges |
| terracotta hover | `#A94C2F` | button hover |
| ember | `#E4A07F` | accent on dark, active nav, hero emphasis |
| border | `#E8DFD2` | dividers, input borders |
| border on dark | `rgba(239,228,216,.16)` / `.32` | dividers / control borders |
| status open | `#D99A2B` (bg `#FBF1DC`, text `#9A6E14`) | admin |
| status marked | `#5C8A5C` (bg `#E9F2E9`, text `#43703F`, on dark `#A8CDA8`) | admin, success |
| status canceled | `#B0483B` (bg `#F7E4E1`, text `#94382C`) | admin, destructive |
| demo chip | bg `#FBF3E1`, border `#EAD9AE`, text `#9A7217` | payment step |

**Ember glow**: `radial-gradient(circle, rgba(198,95,61,.34–.42), rgba(198,95,61,0) 68%)`, 460–1000px square, absolutely positioned and clipped.

**Typography**
- Headlines: **Fraunces** 600 (Google Fonts) — 84/60/52/44/40/34/30/26/23/20/18px steps; letter-spacing −.02em on the largest sizes.
- Body & UI: **Inter** 400/500/600/700 — 17/16/15/14/13/12px; prices 600.
- Meta, labels, batch data: **IBM Plex Mono** 400/500/600 — 12/11/10/9px, uppercase, letter-spacing .06–.18em.
- Minimum body size 12px (meta) / 13–14px (copy); mobile hit targets ≥ 44px.

**Spacing** 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 26 · 28 · 32 · 36 · 40 · 48 · 56 · 64 · 80 px. Page padding 56 / 24 / 20. Grid gaps 22 / 16 / 12.

**Radii** 8 (thumbs) · 10 (inputs, small buttons) · 12 (inner panels) · 14 (cards) · 999 (pills, steppers, primary buttons).

**Shadows**
- card: `0 14px 34px rgba(46,33,26,.10)`
- card hover: `0 26px 56px rgba(46,33,26,.18)`
- overlapping card: `0 20px 48px rgba(46,33,26,.14)`
- card on dark: `0 26px 60px rgba(0,0,0,.30)`
- hero image: `0 30px 70px rgba(0,0,0,.40)`
- drawer: `-30px 0 70px rgba(0,0,0,.45)`
- sticky mobile bar: `0 -12px 30px rgba(46,33,26,.30)`
- toast: `0 18px 44px rgba(0,0,0,.35)`

**Breakpoints** desktop ≥1200 (designed at 1440) · tablet 768–1199 · mobile <768 (designed at 390).

## Assets
No real imagery yet — every photo is a striped placeholder with a monospace caption describing the intended shot (hero: beans on dark steel with side light; product bags; granola/honey jars; ceramic dripper; the drum roaster mid-batch; category shelf shots). The client will supply warm, natural food photography; wire up an image component with sensible aspect ratios (1:1 product, 4:3 and 16:9 editorial) and use the captions as `alt` text starting points. Icons in the design are CSS primitives only (circles, triangles, bars) — substitute the codebase's icon set (cart, burger, close, search, chevron, check).

Sample catalogue used throughout (12 products): Ember Blend – Dark Roast 250g €14.90 · Sunrise Single Origin – Ethiopia 250g €16.50 · Midnight Espresso Blend 250g €13.90 · Cloud Forest – Colombia 250g €15.50 · Honey Almond Granola 500g €8.50 · 70% Dark Cacao Bar €6.90 · Oat Milk Syrup – Vanilla €7.50 · Wildflower Honey 350g €9.90 · Ceramic Pour-Over Dripper €24.00 · Hand Burr Grinder €54.00 · Paper Filters – 100 pack €4.50 · Double-Wall Glass Mug €18.00.

## Screenshots
`screenshots/` holds a rendered PNG per screen and state (captured at 0.5×, so measurements come from this README, not from the pixels):

| File | Screen |
|---|---|
| `1-homepage-desktop / -tablet / -mobile.png` | Homepage, all three breakpoints |
| `2-shop-desktop / -tablet / -mobile.png` | Product listing |
| `2-shop-empty-state.png` | Listing with no results |
| `3-product-detail-desktop / -tablet / -mobile.png` | Product detail (mobile shows the sticky bar) |
| `4-cart-drawer-toast-desktop.png` | Slide-over drawer + "added to cart" toast |
| `4-cart-page-desktop.png` | Full cart page (free shipping reached) |
| `4-cart-drawer-mobile.png` | Full-screen mobile drawer |
| `4-cart-empty-mobile.png` | Empty cart |
| `5-checkout-step1-desktop / step2-desktop.png` | Checkout steps 1 and 2 |
| `5-checkout-step1-tablet.png` | Tablet with collapsed summary accordion |
| `5-checkout-step2-mobile.png` | Mobile with expanded summary accordion |
| `6-confirmation-desktop / -mobile.png` | Order confirmation |
| `7-admin-desktop / -tablet / -mobile.png` | Admin orders (desktop table, stacked cards, expanded card) |

## Files
In `design_files/` (open any in a browser; `support.js` must sit alongside them):
- `0 Overview.dc.html` — index: palette, type, system notes, links to every page
- `1 Homepage Ember Dark.dc.html` — homepage, 3 breakpoints ← **the current direction**
- `2 Shop.dc.html` — listing, 3 breakpoints + empty state
- `3 Product Detail.dc.html` — detail, 3 breakpoints incl. sticky mobile bar
- `4 Cart.dc.html` — drawer + toast, full cart page, mobile drawer, empty cart
- `5 Checkout.dc.html` — step 1 & 2 desktop, tablet accordion, mobile step 2, confirmation (desktop + mobile)
- `6 Admin.dc.html` — dashboard, 3 breakpoints, expanded row/card
- `1 Homepage.dc.html`, `1 Homepage Directions.dc.html` — **archive only**: the earlier all-cream homepage and the three explored directions. Do not build from these; "Ember dark" won.
