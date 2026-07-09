# Vercel Deployment

## Environment Variables

Set these in Vercel Project Settings > Environment Variables:

```bash
NEXT_PUBLIC_SITE_URL=https://your-vercel-or-custom-domain.com
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

## Build Settings

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output: Vercel default

Do not use static export. The app needs Next.js API routes, auth callbacks, Supabase reads, admin uploads, cart/wishlist, and order requests.

## Before Deploying

1. Run `supabase/schema.sql` in the Supabase SQL editor.
2. Promote at least one Supabase Auth user to admin in `public.profiles`.
3. Confirm the storage buckets exist: `product-images`, `product-mockups`, `product-videos`, `site-assets`, `customer-uploads`, `admin-assets`.
4. Add every variable from `.env.example` that applies to production.

## Upload Verification

In Vercel production:

1. Sign in as an admin.
2. Upload a product image or mockup from the dashboard.
3. Confirm the returned URL contains your Supabase project host and bucket path.
4. Publish the product as `active`.
5. Open the customer product page and confirm the image loads from Supabase Storage.

## Common Problems

- `NEXT_PUBLIC_SUPABASE_URL is missing`: add the variable to Vercel and redeploy.
- `SUPABASE_SERVICE_ROLE_KEY is missing`: add the server-only service role key to Vercel and redeploy.
- Admin dashboard returns `Unauthorized`: make sure the signed-in user's `profiles.role` is `admin`.
- Uploads fail with bucket errors: rerun `supabase/schema.sql` and confirm bucket policies exist.
- Products do not appear publicly: set product `status` to `active` and `visibility` to `public`.
