# Order Confirmation Email — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation planning

## Goal

When a customer completes checkout, send them an order confirmation email. The
confirmation page already promises one ("a confirmation is on its way to
{{ order.email }}"), so today the shop tells a small lie. This closes that gap.

Mail is captured locally by a Mailpit container instead of being delivered to
the internet. This is a learning/fun project; a self-hosted delivering
mailserver on a home connection would be blocked by ISP port filtering and
rejected by receivers for missing rDNS/SPF/DKIM. Mailpit exercises the exact
same SMTP code path a real relay would, so nothing built here is throwaway.

## Non-goals

- Real outbound delivery to actual inboxes.
- Persisting mail status on the order row (no `confirmation_sent_at` column).
- A resend action in the admin UI.
- Emails for status changes (marked / canceled) — confirmation only.
- Any test framework; the project has none and this feature does not justify
  introducing one.

## Architecture

```
checkout.vue ──POST /api/orders──> orders.post.ts
                                       │
                                       ├─ price + insert order & items (unchanged)
                                       │
                                       └─ event.waitUntil(sendOrderConfirmation)
                                                  │
                                          orderEmail.ts (pure build)
                                                  │
                                          mailer.ts (nodemailer)
                                                  │
                                          SMTP localhost:1025
                                                  │
                                          Mailpit container ──> http://localhost:8025
```

The send is fire-and-forget: a mail failure never fails the order. The customer
always reaches the confirmation page; failures surface as a server-side log line.

## Components

### `docker-compose.yml` (new, repo root)

```yaml
services:
  mailpit:
    image: axllent/mailpit:latest
    container_name: sb-store-mail
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # web UI
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
```

Accepts any sender, recipient and credentials. Messages are held in memory and
inspectable in the web UI (HTML render, plain-text part, raw source, spam score).

### Configuration

New environment variables, added to `.env` and to a new committed `.env.example`
(`.gitignore` already whitelists `.env.example`):

| Variable | Local value | Purpose |
| --- | --- | --- |
| `MAIL_HOST` | `localhost` | SMTP host |
| `MAIL_PORT` | `1025` | SMTP port |
| `MAIL_SECURE` | `false` | implicit TLS off for Mailpit |
| `MAIL_USER` | *(empty)* | auth only attached when set |
| `MAIL_PASS` | *(empty)* | — |
| `MAIL_FROM` | `Ember & Oak <hello@emberandoak.test>` | From header |

`.env.example` also documents the existing `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SECRET_KEY` and `DATABASE_URL` keys with empty values.

Switching to a real relay later is an `.env` change only — no code change.

### Dependency

`nodemailer` plus `@types/nodemailer` (dev), installed with yarn to match the
existing `yarn.lock`.

### `shared/utils/shop.ts` (new — targeted cleanup)

Nuxt 4 auto-imports `shared/utils/*` into both the app and the Nitro server.
These pure helpers move out of `app/composables/useShop.ts` into it:

- `FREE_SHIPPING_CENTS`, `SHIPPING_FLAT_CENTS`
- `fmtPrice(cents)`
- `batchInfo(now?)` and its private helpers `lastTuesday`, `nextTuesday`,
  `isoWeek`, `MONTHS`

Rationale: the two shipping constants are currently duplicated verbatim at the
top of `server/api/orders.post.ts`, and the email needs the same price
formatting and roast/delivery dates the confirmation page shows. Sharing one
definition prevents the email and the page from drifting apart.

`useCatalog` (Vue-dependent) and `badgeLabel` (UI-only) stay in
`app/composables/useShop.ts`. Its `import type { Category, Product }` line stays.
Because both old and new locations are auto-imported in the app, no call sites in
`.vue` files change. `orders.post.ts` drops its two local constant declarations.

### `server/utils/mailer.ts` (new)

Lazily-constructed nodemailer transporter held in a module-level singleton,
mirroring the shape of `server/utils/supabaseAdmin.ts`.

- Reads the `MAIL_*` env vars; throws if `MAIL_HOST`, `MAIL_PORT` or `MAIL_FROM`
  is missing. `MAIL_SECURE` is passed as nodemailer's `secure` option
  (`=== 'true'`), so implicit TLS is off for Mailpit.
- Attaches `auth` only when `MAIL_USER` is a non-empty string, so Mailpit needs
  no credentials.
- Exports `sendMail({ to, subject, html, text })` which sends with the configured
  `from` and resolves to nodemailer's send info.

### `server/utils/orderEmail.ts` (new)

Two exports:

- `buildOrderConfirmation(order)` — pure, no I/O. Returns
  `{ subject, html, text }`.
- `sendOrderConfirmation(order)` — builds, then calls `sendMail` to `order.email`.

Input is the order row joined with its items, i.e. the object `orders.post.ts`
already returns: `order_number`, `customer_name`, `email`, `street`, `zip`,
`city`, `country`, `subtotal_cents`, `shipping_cents`, `total_cents`, and
`order_items[]` of `{ product_name, unit_price_cents, quantity }`.

**Subject:** `Order EO-2026-0842 confirmed — Ember & Oak`

**HTML:** table-based layout, max width 600px, inline styles only, no external
CSS, no images. Brand palette taken from `app/assets/css/main.css`:
espresso `#2E211A`, cream `#FAF6EF`, terra `#C65F3D`, muted `#7A6A5C`, line
`#E8DFD2`. System font stack — the Google Fonts used on the site are not
reliable in mail clients.

Content, mirroring `app/pages/confirmation.vue`:

1. Espresso header band with the "Ember & Oak" wordmark.
2. "Thank you, {first name}!" — first name is `customer_name.split(' ')[0]`.
3. Order number.
4. Item lines: `{product_name} × {quantity}` and the line total
   (`unit_price_cents * quantity`, via `fmtPrice`).
5. Subtotal, shipping (`Free` when `shipping_cents === 0`, otherwise the
   formatted amount), total.
6. Delivery address block.
7. Roast and delivery dates from `batchInfo()`: `nextRoastHuman` and
   `deliveryHuman`.
8. Footer noting this is a demo shop and no real order was placed.

**Text:** the same information as a readable plain-text alternative part, sent in
the same message so mail clients pick their preferred version.

All user-supplied values (name, address, product names) are HTML-escaped in the
HTML part via a small local `esc()` helper.

### `server/api/orders.post.ts` (modified)

After the `order_items` insert succeeds, replacing the current bare return:

```ts
const full = { ...order, order_items: lines }
event.waitUntil(
  sendOrderConfirmation(full).catch(err =>
    console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
  ),
)
return full
```

`event.waitUntil` keeps the runtime alive until the send settles. If it turns out
not to be available on this Nitro version, fall back to calling
`sendOrderConfirmation(full).catch(...)` directly without awaiting — behaviour is
identical for the local Node dev server.

The response body is unchanged, so `checkout.vue`, the cart store and
`confirmation.vue` need no changes. The two local shipping constants at the top
of the file are removed in favour of the shared ones.

### `server/api/dev/preview-mail.get.ts` (new)

Development-only route for iterating on the template without placing an order.
Guarded by `if (!import.meta.dev) throw createError({ statusCode: 404 })`.
Builds the confirmation from a hardcoded sample order and returns the HTML with
`content-type: text/html`. Reachable at `http://localhost:3000/api/dev/preview-mail`.

## Error handling

- Missing mail env vars → `mailer.ts` throws on first use; caught by the
  `.catch` in the order route and logged. Orders continue to work.
- Mailpit down / connection refused → same path, logged with the order number.
- The mail is never awaited by the request, so checkout latency is unaffected.
- Nothing about a mail failure is surfaced to the customer; the confirmation page
  is shown regardless, since the order genuinely exists.

## Verification

Manual, no automated tests:

1. `docker compose up -d`, confirm http://localhost:8025 loads.
2. `yarn dev`, place an order through checkout.
3. In Mailpit, confirm the message shows: correct `EO-…` order number, every
   cart line with the right quantity and line total, correct subtotal, shipping
   (free above €49, €4.90 below) and total, the delivery address as entered, and
   the roast/delivery dates matching the confirmation page.
4. Check the HTML tab renders and the Text tab reads sensibly.
5. Failure case: `docker compose stop mailpit`, place another order, confirm the
   order still lands in Supabase, the confirmation page still appears, and the
   Nuxt terminal logs one `[mail] confirmation for … failed` line.
6. `http://localhost:3000/api/dev/preview-mail` renders the sample.

## Documentation

README gains a short "Local mail" section: what Mailpit is, `docker compose up -d`,
the UI URL, and the note that no mail leaves the machine.
