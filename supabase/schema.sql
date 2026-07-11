create extension if not exists pgcrypto;

drop table if exists public.site_data cascade;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  role text not null default 'customer' check (role in ('customer', 'admin', 'designer')),
  avatar_url text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.categories (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text unique not null,
  description text,
  parent_category text,
  status text not null default 'active' check (status in ('draft', 'active', 'hidden')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_collections (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text unique not null,
  description text,
  parent_collection_id text references public.product_collections(id) on delete set null,
  is_trending_wedding boolean not null default false,
  is_suite boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.product_collections add column if not exists parent_collection_id text references public.product_collections(id) on delete set null;
alter table public.product_collections add column if not exists is_trending_wedding boolean not null default false;
alter table public.product_collections add column if not exists is_suite boolean not null default false;

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  slug text unique not null,
  title text not null,
  category_id text references public.categories(id) on delete set null,
  category text,
  status text not null default 'draft' check (status in ('draft', 'active', 'hidden', 'deleted')),
  visibility text not null default 'public' check (visibility in ('public', 'hidden', 'direct')),
  price numeric(12,2) default 0,
  sale_price numeric(12,2),
  thumbnail text,
  description text,
  featured boolean not null default false,
  is_new_arrival boolean not null default false,
  is_best_seller boolean not null default false,
  is_stock_out boolean not null default false,
  coming_in_days integer check (coming_in_days is null or coming_in_days > 0),
  data jsonb not null default '{}'::jsonb,
  deleted_at timestamp with time zone,
  published_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.products add column if not exists category_id text references public.categories(id) on delete set null;
alter table public.products add column if not exists visibility text not null default 'public';
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists is_new_arrival boolean not null default false;
alter table public.products add column if not exists is_best_seller boolean not null default false;
alter table public.products add column if not exists is_stock_out boolean not null default false;
alter table public.products add column if not exists coming_in_days integer;
alter table public.products add column if not exists deleted_at timestamp with time zone;
alter table public.products add column if not exists published_at timestamp with time zone;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_mockups (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  mockup_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_videos (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  video_url text not null,
  title text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  sku text,
  title text not null,
  option_values jsonb not null default '{}'::jsonb,
  price_delta numeric(12,2) not null default 0,
  stock_quantity integer,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_collection_products (
  product_id text not null references public.products(id) on delete cascade,
  collection_id text not null references public.product_collections(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (product_id, collection_id)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_slug text,
  product_title text not null,
  product_image text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  product_slug text,
  product_title text not null,
  product_image text,
  price numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.orders (
  id text primary key,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  product_id text references public.products(id) on delete set null,
  product_title text,
  product_slug text,
  subtotal numeric(12,2) not null default 0,
  delivery_charge numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid',
  status text not null default 'pending',
  message text,
  address jsonb not null default '{}'::jsonb,
  customization_details jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_slug text,
  product_title text not null,
  product_image text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  selected_options jsonb not null default '{}'::jsonb,
  customization_values jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '{}'::jsonb,
  preview_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.order_requests (
  id text primary key default gen_random_uuid()::text,
  order_id text references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending',
  request_data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customer_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  assigned_designer_id uuid references public.profiles(id) on delete set null,
  bucket text not null default 'customer-uploads',
  path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_name text,
  customer_email text,
  rating integer not null check (rating between 1 and 5),
  title text,
  body text not null,
  verified_purchase boolean not null default true,
  status text not null default 'published',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (product_id, order_id, customer_email)
);

alter table public.reviews alter column order_id drop not null;
alter table public.reviews alter column customer_id drop not null;
alter table public.reviews add column if not exists customer_name text;
alter table public.reviews add column if not exists customer_email text;
alter table public.reviews add column if not exists verified_purchase boolean not null default true;
alter table public.reviews add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.contact_messages (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  email text not null,
  phone text,
  subject text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.newsletter_subscribers (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  source text not null default 'website',
  status text not null default 'active',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.newsletter_campaigns (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  subject text not null,
  preview_text text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  audience text not null default 'all_active',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  emails_sent integer not null default 0,
  open_rate numeric
);

create table if not exists public.site_settings (
  id text primary key default 'global',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.design_help_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  assigned_designer_id uuid references public.profiles(id) on delete set null,
  order_id text references public.orders(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  status text not null default 'new',
  subject text,
  message text,
  request_data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customer_product_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_key text not null,
  product_id text references public.products(id) on delete set null,
  product_slug text,
  product_title text,
  options jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, product_key)
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    lower(new.email),
    'customer',
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, email, role, avatar_url)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  lower(u.email),
  'customer',
  coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

do $$ declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','categories','product_collections','products','product_images','product_mockups',
    'product_videos','product_variants','product_collection_products','cart_items','wishlist_items',
    'orders','order_items','order_requests','customer_uploads','reviews','contact_messages',
    'newsletter_subscribers','newsletter_campaigns','site_settings','design_help_requests','customer_product_options'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own_customer" on public.profiles;
create policy "profiles_insert_own_customer" on public.profiles
for insert with check (id = auth.uid() and role = 'customer');

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "categories_public_read_active" on public.categories;
create policy "categories_public_read_active" on public.categories
for select using (status = 'active' or public.is_admin());

drop policy if exists "categories_admin_manage" on public.categories;
create policy "categories_admin_manage" on public.categories
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_collections_public_read" on public.product_collections;
create policy "product_collections_public_read" on public.product_collections
for select using (true);

drop policy if exists "product_collections_admin_manage" on public.product_collections;
create policy "product_collections_admin_manage" on public.product_collections
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "products_public_read_active" on public.products;
create policy "products_public_read_active" on public.products
for select using (status = 'active' and visibility <> 'hidden' or public.is_admin());

drop policy if exists "products_admin_manage" on public.products;
create policy "products_admin_manage" on public.products
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_images_public_read" on public.product_images;
drop policy if exists "product_images_public_read_active_product" on public.product_images;
create policy "product_images_public_read_active_product" on public.product_images
for select using (
  public.is_admin() or exists (
    select 1 from public.products p
    where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
  )
);

drop policy if exists "product_images_admin_manage" on public.product_images;
create policy "product_images_admin_manage" on public.product_images
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_mockups_public_read_active_product" on public.product_mockups;
create policy "product_mockups_public_read_active_product" on public.product_mockups
for select using (
  public.is_admin() or exists (
    select 1 from public.products p
    where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
  )
);

drop policy if exists "product_mockups_admin_manage" on public.product_mockups;
create policy "product_mockups_admin_manage" on public.product_mockups
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_videos_public_read_active_product" on public.product_videos;
create policy "product_videos_public_read_active_product" on public.product_videos
for select using (
  public.is_admin() or exists (
    select 1 from public.products p
    where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
  )
);

drop policy if exists "product_videos_admin_manage" on public.product_videos;
create policy "product_videos_admin_manage" on public.product_videos
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_variants_public_read_active" on public.product_variants;
create policy "product_variants_public_read_active" on public.product_variants
for select using (
  is_active and exists (
    select 1 from public.products p where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
  ) or public.is_admin()
);

drop policy if exists "product_variants_admin_manage" on public.product_variants;
create policy "product_variants_admin_manage" on public.product_variants
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "product_collection_products_public_read" on public.product_collection_products;
create policy "product_collection_products_public_read" on public.product_collection_products
for select using (true);

drop policy if exists "product_collection_products_admin_manage" on public.product_collection_products;
create policy "product_collection_products_admin_manage" on public.product_collection_products
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "cart_items_owner_manage" on public.cart_items;
create policy "cart_items_owner_manage" on public.cart_items
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "wishlist_items_owner_manage" on public.wishlist_items;
create policy "wishlist_items_owner_manage" on public.wishlist_items
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "orders_customer_read" on public.orders;
create policy "orders_customer_read" on public.orders
for select using (customer_id = auth.uid() or lower(customer_email) = lower(auth.jwt()->>'email') or public.is_admin());

drop policy if exists "orders_customer_insert_own" on public.orders;
create policy "orders_customer_insert_own" on public.orders
for insert with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists "orders_admin_manage" on public.orders;
create policy "orders_admin_manage" on public.orders
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "order_items_customer_read" on public.order_items;
create policy "order_items_customer_read" on public.order_items
for select using (
  public.is_admin() or exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = auth.uid() or lower(o.customer_email) = lower(auth.jwt()->>'email'))
  )
);

drop policy if exists "order_items_admin_manage" on public.order_items;
create policy "order_items_admin_manage" on public.order_items
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "order_requests_customer_read" on public.order_requests;
create policy "order_requests_customer_read" on public.order_requests
for select using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "order_requests_admin_manage" on public.order_requests;
create policy "order_requests_admin_manage" on public.order_requests
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer_uploads_owner_or_assignee_read" on public.customer_uploads;
create policy "customer_uploads_owner_or_assignee_read" on public.customer_uploads
for select using (user_id = auth.uid() or assigned_designer_id = auth.uid() or public.is_admin());

drop policy if exists "customer_uploads_owner_insert" on public.customer_uploads;
create policy "customer_uploads_owner_insert" on public.customer_uploads
for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "customer_uploads_owner_update" on public.customer_uploads;
create policy "customer_uploads_owner_update" on public.customer_uploads
for update using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "customer_uploads_admin_manage" on public.customer_uploads;
create policy "customer_uploads_admin_manage" on public.customer_uploads
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reviews_public_read_published" on public.reviews;
create policy "reviews_public_read_published" on public.reviews
for select using (status = 'published' or customer_id = auth.uid() or public.is_admin());

drop policy if exists "reviews_customer_insert_verified_purchase" on public.reviews;
create policy "reviews_customer_insert_verified_purchase" on public.reviews
for insert with check (
  customer_id = auth.uid()
  and exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.id = reviews.order_id
      and o.customer_id = auth.uid()
      and oi.product_id = reviews.product_id
      and lower(o.status) in ('confirmed', 'delivered', 'completed', 'customer approved')
  )
);

drop policy if exists "reviews_admin_manage" on public.reviews;
create policy "reviews_admin_manage" on public.reviews
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "contact_messages_public_insert" on public.contact_messages;
create policy "contact_messages_public_insert" on public.contact_messages
for insert with check (true);

drop policy if exists "contact_messages_admin_manage" on public.contact_messages;
create policy "contact_messages_admin_manage" on public.contact_messages
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "newsletter_public_insert" on public.newsletter_subscribers;
create policy "newsletter_public_insert" on public.newsletter_subscribers
for insert with check (true);

drop policy if exists "newsletter_admin_manage" on public.newsletter_subscribers;
create policy "newsletter_admin_manage" on public.newsletter_subscribers
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "newsletter_campaigns_admin_manage" on public.newsletter_campaigns;
create policy "newsletter_campaigns_admin_manage" on public.newsletter_campaigns
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read" on public.site_settings
for select using (true);

drop policy if exists "site_settings_admin_manage" on public.site_settings;
create policy "site_settings_admin_manage" on public.site_settings
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "design_help_requests_customer_read" on public.design_help_requests;
create policy "design_help_requests_customer_read" on public.design_help_requests
for select using (customer_id = auth.uid() or assigned_designer_id = auth.uid() or public.is_admin());

drop policy if exists "design_help_requests_customer_insert" on public.design_help_requests;
create policy "design_help_requests_customer_insert" on public.design_help_requests
for insert with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists "design_help_requests_admin_manage" on public.design_help_requests;
create policy "design_help_requests_admin_manage" on public.design_help_requests
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer_product_options_owner_manage" on public.customer_product_options;
create policy "customer_product_options_owner_manage" on public.customer_product_options
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('product-images', 'product-images', true, 15728640, array['image/jpeg','image/png','image/webp','image/gif','image/avif']),
    ('product-mockups', 'product-mockups', true, 15728640, array['image/jpeg','image/png','image/webp','image/gif','image/avif']),
    ('product-videos', 'product-videos', true, 125829120, array['video/mp4','video/webm','video/quicktime','video/x-msvideo']),
    ('site-assets', 'site-assets', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/x-icon']),
    ('customer-uploads', 'customer-uploads', false, 26214400, array['image/jpeg','image/png','image/webp','image/gif','application/pdf']),
    ('admin-assets', 'admin-assets', false, 15728640, array['image/jpeg','image/png','image/webp','image/gif','image/avif','application/pdf'])
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
end $$;

drop policy if exists "public_product_media_read_storage" on storage.objects;
create policy "public_product_media_read_storage" on storage.objects
for select using (bucket_id in ('product-images', 'product-mockups', 'product-videos', 'site-assets'));

drop policy if exists "admin_public_media_write_storage" on storage.objects;
create policy "admin_public_media_write_storage" on storage.objects
for all using (bucket_id in ('product-images', 'product-mockups', 'product-videos', 'site-assets') and public.is_admin())
with check (bucket_id in ('product-images', 'product-mockups', 'product-videos', 'site-assets') and public.is_admin());

drop policy if exists "customer_uploads_owner_read_storage" on storage.objects;
create policy "customer_uploads_owner_read_storage" on storage.objects
for select using (
  bucket_id = 'customer-uploads'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or public.is_admin()
    or exists (
      select 1 from public.customer_uploads cu
      where cu.path = storage.objects.name
        and cu.assigned_designer_id = auth.uid()
    )
  )
);

drop policy if exists "customer_uploads_owner_insert_storage" on storage.objects;
create policy "customer_uploads_owner_insert_storage" on storage.objects
for insert with check (
  bucket_id = 'customer-uploads'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "customer_uploads_owner_update_storage" on storage.objects;
create policy "customer_uploads_owner_update_storage" on storage.objects
for update using (
  bucket_id = 'customer-uploads'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'customer-uploads'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
);

drop policy if exists "customer_uploads_owner_delete_storage" on storage.objects;
create policy "customer_uploads_owner_delete_storage" on storage.objects
for delete using (
  bucket_id = 'customer-uploads'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
);

drop policy if exists "admin_assets_admin_manage_storage" on storage.objects;
create policy "admin_assets_admin_manage_storage" on storage.objects
for all using (bucket_id = 'admin-assets' and public.is_admin())
with check (bucket_id = 'admin-assets' and public.is_admin());

create index if not exists idx_categories_slug on public.categories(slug);
create index if not exists idx_product_collections_slug on public.product_collections(slug);
create index if not exists idx_product_collections_parent on public.product_collections(parent_collection_id);
create index if not exists idx_product_collections_trending_wedding on public.product_collections(is_trending_wedding);
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_products_status_visibility on public.products(status, visibility);
create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_featured on public.products(featured);
create index if not exists idx_products_new_arrival on public.products(is_new_arrival);
create index if not exists idx_products_best_seller on public.products(is_best_seller);
create index if not exists idx_product_images_product_id on public.product_images(product_id);
create index if not exists idx_product_mockups_product_id on public.product_mockups(product_id);
create index if not exists idx_product_videos_product_id on public.product_videos(product_id);
create index if not exists idx_cart_items_user_id on public.cart_items(user_id);
create index if not exists idx_wishlist_items_user_id on public.wishlist_items(user_id);
create index if not exists idx_orders_customer_id on public.orders(customer_id);
create index if not exists idx_orders_customer_email on public.orders(lower(customer_email));
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_requests_customer_id on public.order_requests(customer_id);
create index if not exists idx_reviews_product_id on public.reviews(product_id);
create index if not exists idx_customer_uploads_user_id on public.customer_uploads(user_id);
create index if not exists idx_contact_messages_status on public.contact_messages(status);
create index if not exists idx_newsletter_subscribers_email on public.newsletter_subscribers(lower(email));
create index if not exists idx_newsletter_campaigns_status on public.newsletter_campaigns(status);
create index if not exists idx_design_help_requests_customer_id on public.design_help_requests(customer_id);

do $$ declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','categories','product_collections','products','product_images','product_mockups',
    'product_videos','product_variants','cart_items','wishlist_items','orders','order_items',
    'order_requests','customer_uploads','reviews','contact_messages','newsletter_subscribers',
    'newsletter_campaigns','site_settings','design_help_requests','customer_product_options'
  ]
  loop
    execute format('drop trigger if exists set_%s_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;

grant select on public.products, public.product_images, public.product_mockups, public.product_videos, public.product_variants, public.categories, public.product_collections, public.product_collection_products, public.reviews, public.site_settings to anon;
grant insert on public.contact_messages, public.newsletter_subscribers to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- ============================================================================
-- Product customizer (Zazzle-style personalization)
-- Additive only. Does not modify or drop any existing table.
-- ============================================================================

create table if not exists public.product_customizer_templates (
  id uuid primary key default gen_random_uuid(),
  product_id text not null unique references public.products(id) on delete cascade,
  enabled boolean not null default false,
  version integer not null default 1,
  engine text not null default 'svg',
  canvas_width_px integer not null default 1500,
  canvas_height_px integer not null default 2100,
  card_width_in numeric(6,2) default 5,
  card_height_in numeric(6,2) default 7,
  dpi integer not null default 300,
  orientation text not null default 'portrait',
  default_page text not null default 'front',
  pages jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  layers jsonb not null default '[]'::jsonb,
  safe_area jsonb not null default '{}'::jsonb,
  bleed jsonb not null default '{}'::jsonb,
  assets jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_customizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  template_id uuid references public.product_customizer_templates(id) on delete set null,
  cart_item_id uuid references public.cart_items(id) on delete set null,
  order_id text references public.orders(id) on delete set null,
  template_version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'in_cart', 'ordered', 'archived')),
  values jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '{}'::jsonb,
  selected_options jsonb not null default '{}'::jsonb,
  preview_images jsonb not null default '{}'::jsonb,
  render_data jsonb not null default '{}'::jsonb,
  print_files jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.product_customizer_templates enable row level security;
alter table public.product_customizations enable row level security;

-- Admins manage every template; customers may read enabled templates for
-- products that are active and not hidden.
drop policy if exists "customizer_templates_public_read_active" on public.product_customizer_templates;
create policy "customizer_templates_public_read_active" on public.product_customizer_templates
for select using (
  public.is_admin() or (
    enabled and exists (
      select 1 from public.products p
      where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
    )
  )
);

drop policy if exists "customizer_templates_admin_manage" on public.product_customizer_templates;
create policy "customizer_templates_admin_manage" on public.product_customizer_templates
for all using (public.is_admin()) with check (public.is_admin());

-- Customers manage only their own customizations; admins read/manage all.
drop policy if exists "product_customizations_owner_manage" on public.product_customizations;
create policy "product_customizations_owner_manage" on public.product_customizations
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "product_customizations_admin_manage" on public.product_customizations;
create policy "product_customizations_admin_manage" on public.product_customizations
for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_product_customizer_templates_updated_at on public.product_customizer_templates;
create trigger set_product_customizer_templates_updated_at
before update on public.product_customizer_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_product_customizations_updated_at on public.product_customizations;
create trigger set_product_customizations_updated_at
before update on public.product_customizations
for each row execute function public.set_updated_at();

create index if not exists idx_customizer_templates_product_id on public.product_customizer_templates(product_id);
create index if not exists idx_product_customizations_user_id on public.product_customizations(user_id);
create index if not exists idx_product_customizations_product_id on public.product_customizations(product_id);
create index if not exists idx_product_customizations_order_id on public.product_customizations(order_id);
create index if not exists idx_product_customizations_status on public.product_customizations(status);

grant all on public.product_customizer_templates to service_role;
grant all on public.product_customizations to service_role;
grant select on public.product_customizer_templates to anon;
grant select, insert, update, delete on public.product_customizer_templates to authenticated;
grant select, insert, update, delete on public.product_customizations to authenticated;

-- ============================================================================
-- Homepage hero collection ("The Wedding Suite" section)
-- Additive only. Powers the featured collection block on the homepage and is
-- fully managed from Admin → Home Hero. Images live in the public site-assets
-- storage bucket (folder: hero-collection).
-- ============================================================================

create table if not exists public.hero_collections (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  slug text not null default '',
  season_label text not null default '',
  collection_label text not null default '',
  heading_line_one text not null default '',
  heading_line_two text not null default '',
  description text not null default '',
  primary_button_text text not null default '',
  primary_button_url text not null default '',
  secondary_link_text text not null default '',
  secondary_link_url text not null default '',
  main_image text not null default '',
  thumbnail_one text not null default '',
  thumbnail_two text not null default '',
  thumbnail_three text not null default '',
  source_collection_id text not null default '',
  is_active boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Hero images are pulled from this product collection's child collections
-- (first child -> main image, next three -> thumbnails).
alter table public.hero_collections add column if not exists source_collection_id text not null default '';

alter table public.hero_collections enable row level security;

-- Anyone may read published (active) records so the homepage can render them;
-- admins see and manage everything.
drop policy if exists "hero_collections_public_read_active" on public.hero_collections;
create policy "hero_collections_public_read_active" on public.hero_collections
for select using (is_active or public.is_admin());

drop policy if exists "hero_collections_admin_manage" on public.hero_collections;
create policy "hero_collections_admin_manage" on public.hero_collections
for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_hero_collections_updated_at on public.hero_collections;
create trigger set_hero_collections_updated_at
before update on public.hero_collections
for each row execute function public.set_updated_at();

-- Keep homepage hero selection deterministic and enforce one featured record.
create index if not exists idx_hero_collections_featured
  on public.hero_collections(is_active, is_featured);

create or replace function public.enforce_single_featured_hero_collection()
returns trigger
language plpgsql
as $$
begin
  if new.is_featured then
    update public.hero_collections
    set is_featured = false, updated_at = now()
    where id <> new.id and is_featured;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_single_featured_hero_collection on public.hero_collections;
create trigger enforce_single_featured_hero_collection
before insert or update of is_featured on public.hero_collections
for each row execute function public.enforce_single_featured_hero_collection();

grant all on public.hero_collections to service_role;
grant select on public.hero_collections to anon;
grant select, insert, update, delete on public.hero_collections to authenticated;
