-- Designer role: product ownership and the review workflow (spec §7, §9, §45).
--
-- `profiles.role` has always allowed 'designer', but nothing in the application
-- read it, so the value was inert. Giving designers a real workspace needs two
-- things the products table did not have: who owns a product, and where it is
-- in the review pipeline.
--
-- Forward-only and safe on a populated database:
--   * every column is nullable or has a default, so existing rows stay valid;
--   * `workflow_state` is BACKFILLED from the existing `status` so current
--     products land in the state that matches what they already are;
--   * `status`/`visibility` keep their present meaning and are still what the
--     public queries filter on — `workflow_state` describes the editorial
--     pipeline, it does not replace publication.

/* ------------------------------------------------------------------ owners */

alter table public.products
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_designer_id uuid references public.profiles(id) on delete set null;

comment on column public.products.created_by is
  'Designer or admin who created the product. Authorization is checked against this server side.';
comment on column public.products.assigned_designer_id is
  'Designer an admin explicitly assigned. Grants the same edit rights as created_by.';

/* ---------------------------------------------------------------- workflow */

alter table public.products
  add column if not exists workflow_state text not null default 'draft',
  add column if not exists submitted_at timestamp with time zone,
  add column if not exists reviewed_at timestamp with time zone,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_note text;

-- Backfill BEFORE the constraint so existing rows cannot violate it. An active
-- product is already public, so it is 'published'; anything else is a draft.
update public.products
set workflow_state = case
  when status = 'active' then 'published'
  when status = 'deleted' then 'archived'
  else 'draft'
end
where workflow_state is null or workflow_state = 'draft';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_workflow_state_check'
  ) then
    alter table public.products
      add constraint products_workflow_state_check
      check (workflow_state in ('draft', 'in_review', 'needs_revision', 'approved', 'published', 'archived'));
  end if;
end $$;

-- A designer's workspace lists "my products" and the admin review queue lists
-- "everything waiting on me"; both are keyed on these columns.
create index if not exists idx_products_created_by on public.products(created_by);
create index if not exists idx_products_assigned_designer on public.products(assigned_designer_id);
create index if not exists idx_products_workflow_state on public.products(workflow_state);

/* --------------------------------------------------------------------- RLS */

-- `is_admin()` already exists. Designers need a predicate of their own so the
-- policies below can name the role without repeating the lookup.
create or replace function public.is_designer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'designer', false)
$$;

-- Designers may read and update ONLY the products they own or were assigned.
-- These policies sit alongside the existing admin policies; they do not widen
-- anything for customers, and every write still passes the application's own
-- capability checks first.
drop policy if exists "products_designer_read_own" on public.products;
create policy "products_designer_read_own" on public.products
for select using (
  public.is_designer() and (created_by = auth.uid() or assigned_designer_id = auth.uid())
);

drop policy if exists "products_designer_update_own" on public.products;
create policy "products_designer_update_own" on public.products
for update using (
  public.is_designer()
  and (created_by = auth.uid() or assigned_designer_id = auth.uid())
  and workflow_state in ('draft', 'needs_revision', 'in_review')
) with check (
  public.is_designer()
  and (created_by = auth.uid() or assigned_designer_id = auth.uid())
  -- A designer may never move a product into a published or approved state:
  -- publication is the admin's decision and the review workflow's whole point.
  and workflow_state in ('draft', 'in_review', 'needs_revision')
  and status <> 'active'
);

drop policy if exists "products_designer_insert_own" on public.products;
create policy "products_designer_insert_own" on public.products
for insert with check (
  public.is_designer()
  and created_by = auth.uid()
  and workflow_state = 'draft'
  and status <> 'active'
);
