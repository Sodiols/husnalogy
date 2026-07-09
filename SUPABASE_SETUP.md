# Supabase Setup

This project now uses Supabase as the production backend for products, categories, media, orders, customer data, contact messages, newsletter subscribers, settings, and uploads. Local JSON files and the generic `site_data` bridge are not production storage.

## 1. Environment Variables

Create the production environment variables from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
DELETE_ADMIN_EMAIL=
DELETE_ADMIN_PASSWORD=
```

Use the service role key only on the server. Never expose it in client-side code.

## 2. Run The Schema

Open Supabase Dashboard > SQL Editor and run:

```sql
-- paste and run supabase/schema.sql
```

The schema creates:

- `profiles`
- `categories`
- `product_collections`
- `products`
- `product_images`
- `product_mockups`
- `product_videos`
- `product_variants`
- `product_collection_products`
- `cart_items`
- `wishlist_items`
- `orders`
- `order_items`
- `order_requests`
- `customer_uploads`
- `reviews`
- `contact_messages`
- `newsletter_subscribers`
- `site_settings`
- `design_help_requests`
- `customer_product_options`

It also drops the old `site_data` table so the app cannot silently fall back to generic JSON storage.

## 3. Storage Buckets

The schema creates and configures these buckets:

- `product-images`: public product images, 15MB limit.
- `product-mockups`: public product mockups, 15MB limit.
- `product-videos`: public product videos, 120MB limit.
- `site-assets`: public logo/favicon assets, 5MB limit.
- `customer-uploads`: private customer uploaded files, 25MB limit.
- `admin-assets`: private admin-only assets, 15MB limit.

## 4. Admin User

Create a normal Supabase Auth user first. Then promote the user:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@husnalogy.com';
```

Admin APIs use the signed-in user's profile role. Product/category/settings/order/upload actions require `role = 'admin'`.

## 5. RLS Policy Summary

- Public users can read active, non-hidden products and public product media.
- Public users can insert contact messages and newsletter subscribers.
- Signed-in customers manage their own cart, wishlist, uploads, orders, and product options.
- Admin users manage products, categories, settings, orders, uploads, contact messages, newsletter subscribers, and reviews.
- Product media is public only through the product media/site asset buckets.
- Customer uploads are private and scoped by the signed-in user path.

## 6. Existing Local Data

The live app no longer reads `data/*.json` or `public/uploads`. If you need old local products/images in production, upload those assets to Supabase Storage and recreate or import the records into the tables above before launch.
