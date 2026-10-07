/* ==========================================================================
   Saved customer addresses move from the browser to the customer's account.

   They used to live in one global localStorage key ("husnalogy_saved_addresses")
   shared by EVERY account that ever signed in on a browser: customer B saw — and
   could check out with — customer A's name, phone and address. Addresses now
   belong to an account, follow it across devices, and are readable and
   writable only by their owner.

   Access:
     - a customer: their own rows only (RLS: user_id = auth.uid()), for select,
       insert, update and delete;
     - administrators: NO access through this table. Orders already carry the
       delivery address they were placed with; no admin workflow reads the
       address book, so none is granted;
     - anon: nothing;
     - the service role (server code) as everywhere.

   Additive and idempotent. No existing data is changed.
   ========================================================================== */

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text not null check (char_length(btrim(phone)) between 5 and 30),
  address_line1 text not null check (char_length(btrim(address_line1)) between 1 and 300),
  area text not null default '' check (char_length(area) <= 120),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  district text not null default '' check (char_length(district) <= 80),
  postal_code text not null default '' check (char_length(postal_code) <= 20),
  note text not null default '' check (char_length(note) <= 300),
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_customer_addresses_user on public.customer_addresses(user_id, created_at desc);
-- At most one default address per account.
create unique index if not exists customer_addresses_one_default on public.customer_addresses(user_id) where is_default;

drop trigger if exists set_customer_addresses_updated_at on public.customer_addresses;
create trigger set_customer_addresses_updated_at
before update on public.customer_addresses
for each row execute function public.set_updated_at();

/* An address can never be moved to another account, and an account holds at
   most 10 addresses (the address book is a convenience, not storage). */
create or replace function public.guard_customer_address()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'An address cannot be moved to another account.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.customer_addresses where user_id = new.user_id) >= 10 then
    raise exception 'An account can keep at most 10 saved addresses.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_customer_address on public.customer_addresses;
create trigger guard_customer_address
before insert or update on public.customer_addresses
for each row execute function public.guard_customer_address();

alter table public.customer_addresses enable row level security;

drop policy if exists "customer_addresses_select_own" on public.customer_addresses;
create policy "customer_addresses_select_own" on public.customer_addresses
for select to authenticated using (user_id = auth.uid());

drop policy if exists "customer_addresses_insert_own" on public.customer_addresses;
create policy "customer_addresses_insert_own" on public.customer_addresses
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "customer_addresses_update_own" on public.customer_addresses;
create policy "customer_addresses_update_own" on public.customer_addresses
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "customer_addresses_delete_own" on public.customer_addresses;
create policy "customer_addresses_delete_own" on public.customer_addresses
for delete to authenticated using (user_id = auth.uid());

revoke all on public.customer_addresses from anon;
revoke all on public.customer_addresses from authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
grant all on public.customer_addresses to service_role;
