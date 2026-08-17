# Order Confirmation Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a branded order confirmation email to the customer when checkout completes, captured locally by a Mailpit container instead of being delivered to the internet.

**Architecture:** `server/api/orders.post.ts` keeps doing exactly what it does today — price the cart, insert the order and its items — and then fires the mail without awaiting it, so a mail failure can never fail an order. The mail body is produced by a pure builder (`server/utils/orderEmail.ts`) and handed to a thin nodemailer wrapper (`server/utils/mailer.ts`) that points at whatever `MAIL_HOST:MAIL_PORT` says. Locally that's a Mailpit container, which accepts everything and shows it in a web UI at `localhost:8025`.

**Tech Stack:** Nuxt 4 / Nitro server routes, nodemailer, Mailpit (Docker), Supabase (hosted), yarn.

**Spec:** `docs/superpowers/specs/2026-08-17-order-confirmation-email-design.md`

**Conventions for this plan:**
- Package manager is **yarn** (the repo has `yarn.lock`, no `package-lock.json`).
- Server-side files use **explicit relative imports** for anything under `shared/`. Files in `server/utils/` are auto-imported into server routes by Nitro — that is how `supabaseAdmin()` is already used in `server/api/orders.post.ts` without an import — so route files need no import for `sendOrderConfirmation`.
- Every commit message carries a `Co-Authored-By` trailer, passed as a second `-m` flag.

---

### Task 0: Install dependencies

`node_modules` does not exist in this checkout, so nothing runs until this is done.

**Files:**
- None (installs only)

- [ ] **Step 1: Install**

```bash
yarn install
```

- [ ] **Step 2: Verify the dev server boots**

Run: `yarn dev`
Expected: Nitro prints `➜ Local: http://localhost:3000/`. Open it — the Ember & Oak homepage renders with product prices.
Stop it again with Ctrl+C.

No commit (nothing changed in git).

---

### Task 1: Mailpit container and mail configuration

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `.env` (gitignored — not committed)

- [ ] **Step 1: Create the compose file**

Create `docker-compose.yml`:

```yaml
services:
  mailpit:
    image: axllent/mailpit:latest
    container_name: sb-store-mail
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP — the Nuxt server sends here
      - "8025:8025"   # web UI — you read the mail here
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
```

- [ ] **Step 2: Start it**

Run: `docker compose up -d`
Expected: `✔ Container sb-store-mail  Started`

- [ ] **Step 3: Verify the UI is up**

Open http://localhost:8025 in a browser.
Expected: the Mailpit inbox, empty, with a "No results" / empty message list.

- [ ] **Step 4: Add the mail variables to `.env`**

Append to the existing `.env` (keep the Supabase lines untouched):

```
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_USER=
MAIL_PASS=
MAIL_FROM="Ember & Oak <hello@emberandoak.test>"
```

- [ ] **Step 5: Create `.env.example`**

`.gitignore` ignores `.env*` but explicitly whitelists `!.env.example`, so this file is committed. Values are empty on purpose except the local mail defaults.

```
# Supabase (hosted project)
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SECRET_KEY=
DATABASE_URL=

# Outgoing mail — defaults target the local Mailpit container (docker compose up -d)
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_USER=
MAIL_PASS=
MAIL_FROM="Ember & Oak <hello@emberandoak.test>"
```

- [ ] **Step 6: Confirm `.env` itself is not staged**

Run: `git status --short`
Expected: `docker-compose.yml` and `.env.example` show as untracked. `.env` does **not** appear.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "Add Mailpit container and mail env config" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add nodemailer

**Files:**
- Modify: `package.json`, `yarn.lock`

- [ ] **Step 1: Install**

```bash
yarn add nodemailer
yarn add -D @types/nodemailer
```

- [ ] **Step 2: Verify**

Run: `yarn info nodemailer version` or check `package.json`
Expected: `nodemailer` under `dependencies`, `@types/nodemailer` under `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "Add nodemailer" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Move the pure shop helpers into `shared/`

Nuxt 4 auto-imports `shared/utils/*` into **both** the app and the Nitro server. Today `fmtPrice` and `batchInfo` live in `app/composables/useShop.ts` (invisible to the server), and the two shipping constants are copy-pasted at the top of `server/api/orders.post.ts`. The email needs all of them, so they move to one home.

**Files:**
- Create: `shared/utils/shop.ts`
- Modify: `app/composables/useShop.ts` (remove the moved code)
- Modify: `app/stores/cart.ts:3` (explicit import path changes)
- Modify: `server/api/orders.post.ts:1-2` (drop the duplicated constants)

- [ ] **Step 1: Create `shared/utils/shop.ts`**

This is the code lifted verbatim from `app/composables/useShop.ts` lines 3–8 and 16–55:

```ts
export const FREE_SHIPPING_CENTS = 4900
export const SHIPPING_FLAT_CENTS = 490

export function fmtPrice(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function lastTuesday(from = new Date()): Date {
  const d = new Date(from)
  // getDay(): Tue = 2
  const diff = (d.getDay() - 2 + 7) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function nextTuesday(from = new Date()): Date {
  const d = new Date(from)
  const diff = (2 - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Batch info used in the announcement bar, cart, confirmation page and email */
export function batchInfo(now = new Date()) {
  const roasted = lastTuesday(now)
  const upcoming = nextTuesday(now)
  const delivStart = new Date(upcoming); delivStart.setDate(upcoming.getDate() + 2)
  const delivEnd = new Date(upcoming); delivEnd.setDate(upcoming.getDate() + 3)
  const short = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]!.toUpperCase()}`
  const human = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return {
    number: isoWeek(now) + 181,
    roastedShort: `TUE ${short(roasted)}`,          // TUE 11 AUG
    nextRoastHuman: `Tuesday, ${human(upcoming)}`,  // Tuesday, Aug 18
    deliveryHuman: `Thu–Fri, ${human(delivStart)}–${delivEnd.getDate()}`,
  }
}
```

- [ ] **Step 2: Strip the moved code out of `app/composables/useShop.ts`**

The file becomes exactly this — `badgeLabel` is UI-only and `useCatalog` is Vue-dependent, so both stay:

```ts
import type { Category, Product } from '~/types/shop'

/** Accessories show as GEAR in badges, per the design */
export function badgeLabel(categorySlug?: string | null): string {
  if (!categorySlug) return ''
  return categorySlug === 'accessories' ? 'GEAR' : categorySlug.toUpperCase()
}

/** Catalog: categories + active products, fetched once, shared via useAsyncData */
export function useCatalog() {
  const supabase = useSupabaseClient()
  return useAsyncData('catalog', async () => {
    const [cats, prods] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('products').select('*, categories(name, slug)').order('created_at'),
    ])
    if (cats.error) throw cats.error
    if (prods.error) throw prods.error
    return {
      categories: (cats.data ?? []) as Category[],
      products: (prods.data ?? []) as Product[],
    }
  })
}
```

- [ ] **Step 3: Fix the one explicit import in `app/stores/cart.ts`**

Line 3 currently reads `import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '~/composables/useShop'`. Replace it with:

```ts
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '~~/shared/utils/shop'
```

(`~~` is the project root alias. Every other consumer — `CartDrawer.vue`, `ProductCard.vue`, `StoreHeader.vue`, `admin.vue`, `cart.vue`, `checkout.vue`, `confirmation.vue`, `index.vue`, `products/[slug].vue` — uses auto-imports and needs no edit.)

- [ ] **Step 4: Drop the duplicated constants from `server/api/orders.post.ts`**

Replace lines 1–2:

```ts
const FREE_SHIPPING_CENTS = 4900
const SHIPPING_FLAT_CENTS = 490
```

with an explicit import:

```ts
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../../shared/utils/shop'
```

The rest of the file is unchanged; line 51's `subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS` now uses the shared values.

- [ ] **Step 5: Verify nothing broke**

Run: `yarn dev`, then in the browser:
1. `http://localhost:3000/` — the announcement bar shows the batch line ("TUE …"), prices render as `€14.90`.
2. `http://localhost:3000/shop` — every product card shows a price.
3. `http://localhost:3000/cart` — add something first; the cart shows prices and the roast date.

Expected: no `fmtPrice is not defined` / `batchInfo is not defined` errors in the browser console or the Nitro terminal.

If the app *does* report those as undefined, the `shared/` auto-import is not active — add this line to `app/composables/useShop.ts` as a fallback and re-check:

```ts
export { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS, fmtPrice, batchInfo } from '~~/shared/utils/shop'
```

- [ ] **Step 6: Verify checkout still works end to end**

Place a test order through `http://localhost:3000/checkout`.
Expected: the confirmation page appears with an `EO-…` number, correct total, and free shipping above €49.

- [ ] **Step 7: Commit**

```bash
git add shared/utils/shop.ts app/composables/useShop.ts app/stores/cart.ts server/api/orders.post.ts
git commit -m "Move pure shop helpers to shared/ so the server can use them" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The mail transport

**Files:**
- Create: `server/utils/mailer.ts`

- [ ] **Step 1: Write the transport**

Same lazy-singleton shape as the existing `server/utils/supabaseAdmin.ts`:

```ts
import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | null = null

/** Lazily built from MAIL_* env vars. Locally this points at the Mailpit container. */
function mailer(): Transporter {
  if (!transporter) {
    const host = process.env.MAIL_HOST
    const port = Number(process.env.MAIL_PORT)
    if (!host || !port || !process.env.MAIL_FROM) {
      throw new Error('MAIL_HOST / MAIL_PORT / MAIL_FROM missing in env')
    }
    const user = process.env.MAIL_USER
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.MAIL_SECURE === 'true',
      // Mailpit needs no credentials — only send auth when a user is configured
      auth: user ? { user, pass: process.env.MAIL_PASS ?? '' } : undefined,
    })
  }
  return transporter
}

export interface OutgoingMail {
  to: string
  subject: string
  html: string
  text: string
}

export function sendMail(mail: OutgoingMail) {
  return mailer().sendMail({ from: process.env.MAIL_FROM, ...mail })
}
```

- [ ] **Step 2: Commit**

Nothing calls it yet, so there is nothing to run.

```bash
git add server/utils/mailer.ts
git commit -m "Add nodemailer transport driven by MAIL_* env vars" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The email body

**Files:**
- Create: `server/utils/orderEmail.ts`

- [ ] **Step 1: Write the builder**

`buildOrderConfirmation` is pure — no SMTP, no database, no `event` — which is what makes the preview route in Task 6 possible. The types are local to this file rather than imported from `app/types/shop.ts`, because the object the order route passes in has items without an `id`.

```ts
import { fmtPrice, batchInfo } from '../../shared/utils/shop'
import { sendMail } from './mailer'

export interface OrderEmailItem {
  product_name: string
  unit_price_cents: number
  quantity: number
}

export interface OrderEmailOrder {
  order_number: string
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  order_items: OrderEmailItem[]
}

// Brand palette, mirrored from app/assets/css/main.css
const ESPRESSO = '#2E211A'
const CREAM = '#FAF6EF'
const TERRA = '#C65F3D'
const MUTED = '#7A6A5C'
const LINE = '#E8DFD2'
// The site's Google Fonts are unreliable in mail clients — system stack instead
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildOrderConfirmation(order: OrderEmailOrder) {
  const batch = batchInfo()
  const firstName = order.customer_name.trim().split(' ')[0] ?? ''
  const shipping = order.shipping_cents === 0 ? 'Free' : fmtPrice(order.shipping_cents)
  const subject = `Order ${order.order_number} confirmed — Ember & Oak`

  const itemRows = order.order_items.map(item => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${ESPRESSO};">
            ${esc(item.product_name)} × ${item.quantity}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;color:${ESPRESSO};text-align:right;white-space:nowrap;">
            ${fmtPrice(item.unit_price_cents * item.quantity)}
          </td>
        </tr>`).join('')

  const totalRow = (label: string, value: string, strong = false) => `
        <tr>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${strong ? ESPRESSO : MUTED};${strong ? 'font-weight:600;' : ''}">${label}</td>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${ESPRESSO};text-align:right;${strong ? 'font-weight:600;' : ''}">${value}</td>
        </tr>`

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- header band -->
        <tr><td style="background:${ESPRESSO};border-radius:14px 14px 0 0;padding:28px 32px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${TERRA};"></span>
          <span style="font-size:19px;font-weight:600;color:${CREAM};padding-left:8px;">Ember &amp; Oak</span>
        </td></tr>

        <!-- greeting -->
        <tr><td style="background:#FFFFFF;padding:32px 32px 8px;">
          <h1 style="margin:0;font-size:26px;font-weight:600;color:${ESPRESSO};">
            Thank you${firstName ? `, ${esc(firstName)}` : ''}!
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:${MUTED};">
            Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.
          </p>
          <p style="margin:18px 0 0;font-size:11px;letter-spacing:0.1em;font-weight:600;color:${TERRA};">
            ORDER № ${esc(order.order_number)}
          </p>
        </td></tr>

        <!-- items -->
        <tr><td style="background:#FFFFFF;padding:16px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemRows}
            ${totalRow('Subtotal', fmtPrice(order.subtotal_cents))}
            ${totalRow('Shipping', shipping)}
            ${totalRow('Total', fmtPrice(order.total_cents), true)}
          </table>
        </td></tr>

        <!-- delivery -->
        <tr><td style="background:#FFFFFF;padding:28px 32px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" valign="top" style="padding-right:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">DELIVERS TO</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:${ESPRESSO};">
                  ${esc(order.customer_name)}<br>
                  ${esc(order.street)}<br>
                  ${esc(order.zip)} ${esc(order.city)}, ${esc(order.country)}
                </p>
              </td>
              <td width="50%" valign="top" style="padding-left:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">ESTIMATED DELIVERY</p>
                <p style="margin:0;font-size:18px;font-weight:600;color:${ESPRESSO};">${batch.deliveryHuman}</p>
                <p style="margin:6px 0 0;font-size:13px;color:${MUTED};">Roasted fresh on ${batch.nextRoastHuman}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- footer -->
        <tr><td style="background:#FFFFFF;border-radius:0 0 14px 14px;border-top:1px solid ${LINE};padding:20px 32px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
            Ember &amp; Oak is a demo shop — no real order was placed and nothing will be shipped.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const itemLines = order.order_items
    .map(item => `  ${item.product_name} × ${item.quantity}   ${fmtPrice(item.unit_price_cents * item.quantity)}`)
    .join('\n')

  const text = `Thank you${firstName ? `, ${firstName}` : ''}!

Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.

ORDER № ${order.order_number}

YOUR ITEMS
${itemLines}

  Subtotal   ${fmtPrice(order.subtotal_cents)}
  Shipping   ${shipping}
  Total      ${fmtPrice(order.total_cents)}

DELIVERS TO
  ${order.customer_name}
  ${order.street}
  ${order.zip} ${order.city}, ${order.country}

ESTIMATED DELIVERY
  ${batch.deliveryHuman} — roasted fresh on ${batch.nextRoastHuman}

Ember & Oak is a demo shop — no real order was placed and nothing will be shipped.
`

  return { subject, html, text }
}

export function sendOrderConfirmation(order: OrderEmailOrder) {
  const { subject, html, text } = buildOrderConfirmation(order)
  return sendMail({ to: order.email, subject, html, text })
}
```

- [ ] **Step 2: Commit**

Verification happens in Task 6, which gives this a browser preview.

```bash
git add server/utils/orderEmail.ts
git commit -m "Add order confirmation email builder" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dev-only preview route

Lets you iterate on the template in a browser without placing an order or touching SMTP.

**Files:**
- Create: `server/api/dev/preview-mail.get.ts`

- [ ] **Step 1: Write the route**

```ts
import { buildOrderConfirmation, type OrderEmailOrder } from '../../utils/orderEmail'

const SAMPLE: OrderEmailOrder = {
  order_number: 'EO-2026-0842',
  customer_name: 'Lena Hoffmann',
  email: 'lena.hoffmann@example.com',
  street: 'Lindenstraße 24',
  zip: '79098',
  city: 'Freiburg',
  country: 'Germany',
  subtotal_cents: 4680,
  shipping_cents: 490,
  total_cents: 5170,
  order_items: [
    { product_name: 'Ember Blend – Dark Roast 250g', unit_price_cents: 1490, quantity: 1 },
    { product_name: 'Sunrise Single Origin – Ethiopia 250g', unit_price_cents: 1650, quantity: 1 },
    { product_name: 'Honey Almond Granola 500g', unit_price_cents: 850, quantity: 1 },
    { product_name: '70% Dark Cacao Bar', unit_price_cents: 690, quantity: 1 },
  ],
}

/** Dev-only: renders the confirmation mail in the browser. 404s in production. */
export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return buildOrderConfirmation(SAMPLE).html
})
```

- [ ] **Step 2: Verify the preview renders**

Run: `yarn dev`, open `http://localhost:3000/api/dev/preview-mail`
Expected: the mail renders — dark espresso header with the wordmark, "Thank you, Lena!", `ORDER № EO-2026-0842`, four item lines, `Subtotal €46.80 / Shipping €4.90 / Total €51.70`, the Freiburg address, and a delivery estimate.

- [ ] **Step 3: Commit**

```bash
git add server/api/dev/preview-mail.get.ts
git commit -m "Add dev-only mail preview route" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Send on order creation

**Files:**
- Modify: `server/api/orders.post.ts` (the final return, currently line 80)

- [ ] **Step 1: Replace the return**

The file currently ends with:

```ts
  return { ...order, order_items: lines }
})
```

Replace those two lines with:

```ts
  // Fire-and-forget: a mail failure must never fail an order that is already in the database
  const full = { ...order, order_items: lines }
  event.waitUntil(
    sendOrderConfirmation(full).catch(err =>
      console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
    ),
  )

  return full
})
```

`sendOrderConfirmation` needs no import — Nitro auto-imports `server/utils/`, exactly as `supabaseAdmin()` on line 35 is used today.

If TypeScript reports that `waitUntil` does not exist on the event, drop it and call the promise directly — behaviour is identical on the local Node server:

```ts
  void sendOrderConfirmation(full).catch(err =>
    console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
  )
```

- [ ] **Step 2: Verify the happy path**

With `docker compose up -d` running and `yarn dev` up:
1. Add two or three products to the cart at `http://localhost:3000/shop`.
2. Complete checkout with any address and a made-up email like `test@example.com`.
3. Confirm the confirmation page appears as before.
4. Open `http://localhost:8025`.

Expected in Mailpit: one message, subject `Order EO-…-… confirmed — Ember & Oak`, to `test@example.com`, from `Ember & Oak <hello@emberandoak.test>`. In the HTML tab it renders like the preview. Every cart line appears with the right quantity and line total. Subtotal, shipping (`Free` above €49, `€4.90` below) and total match the confirmation page exactly. The address is the one you typed.

- [ ] **Step 3: Verify the plain-text part**

In Mailpit, switch to the **Text** tab of the same message.
Expected: a readable text version with the same order number, items, totals and address.

- [ ] **Step 4: Verify the failure path**

```bash
docker compose stop mailpit
```

Place another order through checkout.
Expected: the order still succeeds — the confirmation page shows a new `EO-…` number — and the Nitro terminal logs a single line like `[mail] confirmation for EO-2026-0844 failed: Error: connect ECONNREFUSED ::1:1025`. No error reaches the browser.

Then bring it back up:

```bash
docker compose start mailpit
```

- [ ] **Step 5: Commit**

```bash
git add server/api/orders.post.ts
git commit -m "Send order confirmation email after checkout" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Document it

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Local mail" section**

Append to `README.md`:

````markdown
## Local mail

Order confirmations are sent over SMTP to [Mailpit](https://mailpit.axllent.org/),
a local mail catcher running in Docker. It accepts every message and delivers
nothing — no mail ever leaves your machine, so you can check out with any
made-up address.

```bash
docker compose up -d     # start it
```

- Inbox UI: http://localhost:8025
- SMTP endpoint: `localhost:1025` (configured via `MAIL_*` in `.env`, see `.env.example`)

Copy `.env.example` to `.env` and fill in the Supabase values before running the
app. Pointing at a real mail provider later is an `.env` change only.

To iterate on the mail template without placing an order, open
http://localhost:3000/api/dev/preview-mail while the dev server runs.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document local mail setup" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `docker compose up -d` + `yarn dev` + a checkout produces a correctly rendered mail in Mailpit, in both HTML and text.
- Stopping the container does not break checkout; it only logs.
- `http://localhost:3000/api/dev/preview-mail` renders the sample mail.
- No secrets committed — only `.env.example` is in git.
