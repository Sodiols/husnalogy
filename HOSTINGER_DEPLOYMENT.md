# Hostinger Deployment

Use Hostinger only with a plan that supports Node.js applications. This is not a static site because it uses Next.js server routes, Supabase Auth, protected admin APIs, uploads, cart/wishlist, and dynamic product pages.

## Required Hosting Type

- Node.js hosting support.
- Ability to run `npm install`, `npm run build`, and `npm start`.
- Environment variable configuration.
- HTTPS enabled for production domains.

Supabase remains the external backend for database, auth, and storage. Do not move uploads or production data into Hostinger local folders.

## Environment Variables

Set the same variables as `.env.example`:

```bash
NEXT_PUBLIC_SITE_URL=https://your-hostinger-domain.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
DELETE_ADMIN_EMAIL=owner@example.com
DELETE_ADMIN_PASSWORD=choose-a-long-random-password
```

Optional:

```bash
LOGY_USE_OPENAI=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
SODIOL_FACEBOOK_LINK=
SODIOL_INSTAGRAM_LINK=
```

## Commands

```bash
npm install
npm run build
npm start
```

Hostinger must route traffic to the Node.js app port used by `npm start`.

## Deployment Steps

1. Upload or clone the project onto the Hostinger Node.js app directory.
2. Configure environment variables in the Hostinger panel.
3. Run `npm install`.
4. Run `npm run build`.
5. Start the app with `npm start`.
6. Configure the domain and HTTPS.

## Common Problems

- Static hosting plan: upgrade to Node.js hosting.
- API routes return 404: the app was deployed as static files; deploy it as a Node.js Next.js app.
- Uploads fail: check `SUPABASE_SERVICE_ROLE_KEY` and run `supabase/schema.sql`.
- Auth callback fails: set `NEXT_PUBLIC_SITE_URL` to the final Hostinger domain and add the domain to Supabase Auth redirect URLs.
- Products missing: confirm product rows exist in Supabase and are `active` plus `public`.
