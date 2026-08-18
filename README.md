# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setting up on a new machine

Everything needed to run this project is in the repo except `.env`, which is
deliberately gitignored. It holds `DIRECTUS_API_TOKEN` — a static token on a
Directus Administrator that bypasses permissions entirely — and the SMTP
password, so it must never be pushed.

Requirements: Node and [yarn](https://yarnpkg.com/). Docker is no longer needed
unless you want the local mail catcher (see *Local mail*).

```bash
git clone <repo-url> sb-store
cd sb-store
yarn install
cp .env.example .env      # then fill in the two blanks, see below
yarn dev
```

`.env.example` carries every key with the non-secret values already filled in.
Two blanks to fill:

| `.env` key | Where it comes from |
| --- | --- |
| `DIRECTUS_API_TOKEN` | Directus → User → Token, on an Administrator account |
| `MAIL_USER` / `MAIL_PASS` | the `contact@rholing.de` mailbox credentials |

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
server runs (`shipped` and `canceled` are the other two). Dev only — it 404s in
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
