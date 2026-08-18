# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setting up on a new machine

Everything needed to run this project is in the repo except `.env`, which holds
the Supabase keys and is deliberately gitignored — `SUPABASE_SECRET_KEY` is the
service-role key and bypasses row level security, so it must never be pushed.

Requirements: Node, [yarn](https://yarnpkg.com/), and Docker Desktop (for the
local mail catcher).

```bash
git clone <repo-url> sb-store
cd sb-store
yarn install
cp .env.example .env      # then fill in the Supabase values, see below
docker compose up -d      # pulls and starts Mailpit
yarn dev
```

Fill the four Supabase values in `.env` from the Supabase dashboard of the
existing project — **Project Settings → API** gives you the project URL and both
keys, **Project Settings → Database** gives you the connection string:

| `.env` key | Where it comes from |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_KEY` | anon / publishable key |
| `SUPABASE_SECRET_KEY` | service_role / secret key — server-side only |
| `DATABASE_URL` | Database connection string |

The `MAIL_*` values in `.env.example` already point at the local Mailpit
container and need no changes. The database itself is hosted at Supabase, so
both machines share the same data — no migration or seeding needed on the
second machine.

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
