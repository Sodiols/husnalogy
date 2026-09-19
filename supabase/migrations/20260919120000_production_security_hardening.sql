-- Production security hardening before the public launch.
--
-- Forward-only and data-preserving: no table, column or row is dropped or
-- rewritten. Safe to re-run.

/* --------------------------------------------------- 1. role self-escalation --

`profiles_update_own_or_admin` lets a signed-in user UPDATE their own profile
row, and RLS cannot restrict individual columns. That included `role`, so any
customer holding the public (publishable) key could run

    update profiles set role = 'admin' where id = auth.uid();

through PostgREST and become an administrator: `is_admin()`, every admin RLS
policy and the application's role checks all read this column.

This trigger makes `role` writable only by a privileged caller — the service
role (the server's admin APIs), a database owner session (SQL editor,
migrations, the `handle_new_user` trigger) or an existing admin. Every other
profile field stays editable by its owner exactly as before.

SECURITY INVOKER on purpose: a SECURITY DEFINER trigger would run as its owner
and see every caller as privileged. */

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  privileged boolean;
begin
  privileged :=
    current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role'
    or public.is_admin();

  if tg_op = 'INSERT' then
    if coalesce(new.role, 'customer') <> 'customer' and not privileged then
      raise exception 'Only an administrator can assign a profile role.'
        using errcode = '42501';
    end if;
  elsif new.role is distinct from old.role and not privileged then
    raise exception 'Only an administrator can change a profile role.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before insert or update on public.profiles
for each row execute function public.protect_profile_role();

/* ------------------------------------------- 2. direct order row insertion --

`orders_customer_insert_own` allowed a customer to INSERT an `orders` row
directly through PostgREST with any total, status or payment fields. The
application never uses it: checkout creates orders on the server through the
service-role client after recalculating every price, so a directly inserted
row could only ever be a forged order in the admin queue. Customers keep read
access to their own orders through `orders_customer_read`. */

drop policy if exists "orders_customer_insert_own" on public.orders;
