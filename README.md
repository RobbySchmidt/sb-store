# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setting up on a new machine

Everything needed to run this project is in the repo except `.env`, which is
deliberately gitignored. It holds `DIRECTUS_API_TOKEN` — a static token on a
Directus Administrator that bypasses permissions entirely — plus the SMTP
password and the Stripe secret key, so it must never be pushed.

Requirements: Node, [yarn](https://yarnpkg.com/) and the Stripe CLI (see
*Stripe* below — checkout does not work without a key). Docker is no longer
needed unless you want the local mail catcher (see *Local mail*).

```bash
git clone <repo-url> sb-store
cd sb-store
yarn install
cp .env.example .env      # then fill in the two blanks, see below
yarn dev
```

`.env.example` carries every key with the non-secret values already filled in.
The blanks to fill:

| `.env` key | Where it comes from |
| --- | --- |
| `DIRECTUS_API_TOKEN` | Directus → User → Token, on an Administrator account |
| `MAIL_USER` / `MAIL_PASS` | the `contact@rholing.de` mailbox credentials |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys, **test mode** (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | printed by `stripe listen`, see below — different on every machine |

`SITE_URL` is already set to `http://localhost:3000` and is the absolute base
Stripe redirects back to.

### Stripe (needed for checkout to work at all)

Checkout redirects to Stripe, so without a key `/checkout` returns 502. Install
the CLI and authorise it — **test mode only, never a live key**:

```bash
winget install Stripe.StripeCli
stripe login
```

`winget` puts the binary in `%LOCALAPPDATA%\Microsoft\WinGet\Packages\…`; open a
**new terminal** afterwards or `stripe` will not be on `PATH`.

Then run the webhook forwarder in its own terminal, copy the `whsec_…` it prints
into `STRIPE_WEBHOOK_SECRET`, and restart `yarn dev`:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**That secret changes every time you start `stripe listen`.** If signature
verification suddenly starts failing, that is why. It also differs between the
two PCs, which is why it is not committed anywhere.

The forwarder is a convenience, not a requirement: payment confirmation and
expiry both work with webhooks entirely down — the confirmation page asks Stripe
directly, and `sweepExpired()` reconciles anything stale. The webhook only makes
it fast.

**The schema and data live on the shared Directus instance, so there is nothing
to migrate or seed on the second machine.** If you ever do need to rebuild it:

```bash
yarn directus:setup   # role, policy, file folder, collections, fields, relations
yarn directus:seed    # categories, products, images, demo orders
```

Both are idempotent — running them against an instance that already has
everything reports only "exists" and changes nothing.

> That instance is **shared with other projects**. Only the `Ember_Oak_Shop`
> group and the `eo_*` collections belong to this app.

## Accounts

The store has email/password accounts with two roles, backed by Directus users.

- Register at `/register`. New accounts get the **Ember & Oak Customer** role,
  created by `yarn directus:setup`. Registration goes through our own
  `/api/auth/register` rather than Directus's built-in public registration,
  because that one has a single instance-wide default role another project
  depends on.
- **Admin is any Directus user with `admin_access`** — so `schmidt@rhowerk.de`
  works with the existing Directus account, no separate signup. Note this also
  means every other Administrator on that instance can reach `/admin`.
- Admins land on `/admin` after signing in, customers on `/account`, which
  lists their own orders.
- Buying does **not** require an account — guest checkout still works. An order
  placed as a guest shows up on an account later if the email matches.
- **Nothing verifies the email address**, so that fallback is trust-on-
  assertion: registering with someone else's address would show their orders.
  Accepted for a fake shop.

Sessions are httpOnly cookies set by our own Nitro routes, holding Directus
access and refresh tokens. None of this needs redoing on the second machine.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Payments

> ⚠️ **Test mode only. No live key ever goes in `.env`.** No real money moves,
> and nothing here is built to be trusted with any.

The buyer is redirected to Stripe's hosted Checkout and comes back to
`/confirmation?session_id=…`. There is no Stripe JS in the browser. An order is
created **`pending` before the redirect and holds its stock**, so it has to be
released again — either when the buyer backs out (immediately), when Stripe says
the session expired (webhook), or by the reconciliation sweep 45 minutes later.

### Testing payments

Test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. Other
outcomes: `4000 0000 0000 0002` is a decline, `4000 0000 0000 9995` insufficient
funds.

Things worth clicking through, and what should happen:

| Do this | Expect |
| --- | --- |
| Add to cart, check out, pay | Confirmation page, one confirmation mail, `stock_available` already lower *before* you paid |
| Back out of Stripe | Bounced to `/checkout?canceled=1`, stock released at once — retrying immediately must not say "only 0 left" |
| Let a session expire | Order shows `canceled` with reason *payment expired*; hidden from `/admin` unless `?includeExpired=1` |
| Resend `checkout.session.completed` from `stripe listen` | **No second confirmation mail** |
| Refund 2 of 3 bags in `/admin` | `stock_available` rises by exactly 2, refund mail sent, order stays open and shippable |
| Cancel a paid order | Full remainder including shipping refunded, order cannot be reopened |

Expiring a checkout without waiting out Stripe's 30-minute minimum:

```bash
stripe checkout sessions expire cs_test_…
```

Refunds appear under Payments → the payment → Refunds in the Stripe dashboard,
which is the actual ledger — this app stores only `refunded_cents` and
`refunded_quantity` and derives everything else from them.

**What has not been verified.** As of the last commit no payment has been
completed end to end and no refund has ever been issued: the card-to-confirmation
hop needs a human in a browser. Every guard is traced and typechecked, and the
webhook receiver has handled real `checkout.session.expired` events, but the
money path has not executed once. Treat the table above as the checklist that
still needs running, not as a record of results.

Also unhandled: `charge.refund.updated`. A card refund that fails asynchronously
leaves the app believing it succeeded.

## Mail

> ⚠️ **Order mail goes to real inboxes.** `MAIL_*` points at the company SMTP
> server (`mail.agenturserver.de`, port 465, implicit TLS). Check out with your
> own address unless you mean it.

The transport reads `MAIL_*` and nothing else, so changing provider is an
`.env` change with no code change.

**If a test mail doesn't show up, check spam before debugging.** The first one
sent through this account landed there; the rest arrived normally. Sends are
fire-and-forget and only log on failure, so silence in the dev-server log means
the mail was accepted — not that nothing happened.

To iterate on a template without placing an order, open
http://localhost:3000/api/dev/preview-mail?template=confirmation while the dev
server runs (`shipped`, `canceled` and `refunded` are the others). `canceled`
renders the paid-and-refunded wording, which must not claim nothing was charged;
add `&reason=none` for the bare, never-charged variant. Dev only — it 404s in
production.

### Catching mail locally instead

[Mailpit](https://mailpit.axllent.org/) is still in `docker-compose.yml`. It
accepts every message and delivers nothing, so no mail leaves your machine.

```bash
docker compose up -d
```

Then point `.env` at it — inbox on http://localhost:8025:

```
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_USER=
```

`MAIL_USER` must be blank: the transport only sends credentials when one is
set, and Mailpit accepts none.
