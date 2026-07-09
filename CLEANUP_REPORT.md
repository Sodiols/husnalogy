# Cleanup Report

## What Changed

The Husnalogy app now uses Supabase tables and Supabase Storage for production data. The previous local JSON fallback system and local admin upload folder have been removed from live code.

## Removed

- Removed `lib/storage/json-store.ts`.
- Removed `lib/storage/supabase-store.ts`.
- Removed local JSON database files under `data/`.
- Removed old local uploaded admin product images and mockups under `public/uploads/`.
- Removed the `/uploads/admin/:path*` cache header from `next.config.mjs`.
- Removed order fallback logic that wrote to `data/order-requests.json`.
- Removed product/category/settings/contact/newsletter collection writes to JSON files.

## Replaced With Supabase

- Products: `products`, `product_images`, `product_mockups`, `product_videos`, `product_collection_products`, `reviews`.
- Categories: `categories`.
- Product collections: `product_collections`.
- Orders and order requests: `orders`, `order_items`, `order_requests`.
- Cart and wishlist: `cart_items`, `wishlist_items`.
- Contact messages: `contact_messages`.
- Newsletter subscribers: `newsletter_subscribers`.
- Settings: `site_settings`.
- Customer uploads: `customer_uploads` plus `customer-uploads` Storage bucket.
- Admin/product uploads: Supabase Storage buckets only.

## Upload Storage

Admin uploads now require Supabase Storage. The upload API no longer writes to `public/uploads` and no longer honors `STORAGE_DRIVER=json` or `STORAGE_DRIVER=local`.

Storage buckets required:

- `product-images`
- `product-mockups`
- `product-videos`
- `site-assets`
- `customer-uploads`
- `admin-assets`

## Supabase Tables Required

See `SUPABASE_SETUP.md` and `supabase/schema.sql` for the full table, index, RLS, grant, and storage policy setup.

## Environment Variables Required

See `.env.example`.

Required for production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `DELETE_ADMIN_EMAIL`
- `DELETE_ADMIN_PASSWORD`

## Commands Run

- `rg --files`
- `rg` scans for JSON fallback, upload, Firebase, and Supabase references
- targeted `Get-Content` inspections for routes, libs, schema, config, and package files
- local cleanup commands for explicitly listed old binary upload files and empty upload/data directories
- `npm run build`

## Verification

`npm run build` completed successfully.

During sitemap generation, the current live Supabase schema reported that `product_mockups` is not in the schema cache yet. The sitemap handler caught that and the build still passed. Run `supabase/schema.sql` before production testing so the new product media relationships exist at runtime.

## Remaining Manual Steps

1. Run `supabase/schema.sql` in the target Supabase project.
2. Upload or recreate any old local products/images in Supabase if you still need that legacy content.
3. Promote at least one Supabase Auth user to `admin`.
4. Set production environment variables on Vercel before deploying.
5. Test admin product upload, publish, public product display, contact form, newsletter form, cart, wishlist, and order request submission against the live Supabase project.
