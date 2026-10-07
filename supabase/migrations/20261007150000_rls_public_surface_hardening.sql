/* ==========================================================================
   RLS audit (2026-10-07): close public access that no application path uses.

   1. Customizer WORKING DRAFTS (product_customizer_templates) were readable
      with the public key for every active product. The draft is the
      designer's unreviewed scratch pad; customers are served only immutable
      published versions (customizer_template_versions, which stay publicly
      readable for active products). Every server read of drafts uses the
      service role (lib/customizer/store.ts), so the public read is removed.

   2. contact_messages and newsletter_subscribers accepted direct INSERTs from
      anyone with the public key, bypassing the API routes' validation and
      rate limits (/api/contact, /api/newsletter write with the service role
      after both). The public insert policies and grants are removed.

   Additive and idempotent: no data changes; admin access is unchanged.
   ========================================================================== */

drop policy if exists "customizer_templates_public_read_active" on public.product_customizer_templates;
revoke select on public.product_customizer_templates from anon;

-- Published versions stay public for active products. Their read policy used
-- to look the draft row up with the CALLER's privileges, which would now fail
-- for anon; this narrow definer function answers only "is this template's
-- product public and the template enabled" — it returns no draft content.
create or replace function public.customizer_template_is_public(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.product_customizer_templates t
    join public.products p on p.id = t.product_id
    where t.id = p_template_id and t.enabled and p.status = 'active' and p.visibility <> 'hidden'
  )
$$;
revoke all on function public.customizer_template_is_public(uuid) from public;
grant execute on function public.customizer_template_is_public(uuid) to anon, authenticated, service_role;

drop policy if exists "customizer_template_versions_read" on public.customizer_template_versions;
create policy "customizer_template_versions_read" on public.customizer_template_versions
for select using (public.is_admin() or public.customizer_template_is_public(template_id));

drop policy if exists "contact_messages_public_insert" on public.contact_messages;
revoke insert on public.contact_messages from anon, authenticated;
-- Admins keep their access through contact_messages_admin_manage.
grant select, update, delete on public.contact_messages to authenticated;

drop policy if exists "newsletter_public_insert" on public.newsletter_subscribers;
revoke insert on public.newsletter_subscribers from anon, authenticated;
grant select, update, delete on public.newsletter_subscribers to authenticated;
