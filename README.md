# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

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
