-- Stop `site_settings` from being world-readable.
--
-- `site_settings_public_read` was `for select using (true)`, and the row it
-- exposes is a single JSONB blob that also holds SECRETS:
--
--   settings->'email'->>'smtpPassword'
--   settings->'email'->>'smtpUser'
--   settings->'payment'->>'sslCommerzStorePassword'
--   settings->'payment'->>'sslCommerzApiKey'
--
-- The publishable/anon key ships inside every browser bundle, so anyone could
-- have read the SMTP credentials and the payment gateway secrets straight out
-- of PostgREST. The application never relied on that access: `lib/settings`
-- is the only reader of this table and it always goes through the service-role
-- client (which bypasses RLS), and the public surface is the already-redacted
-- `toPublicSettings()` projection served by /api/settings. So admin-only read
-- costs the storefront nothing.
--
-- Written as a policy replacement rather than a schema change: the table, its
-- columns and every existing row are untouched, and re-running this migration
-- is a no-op.

drop policy if exists "site_settings_public_read" on public.site_settings;

drop policy if exists "site_settings_admin_read" on public.site_settings;
create policy "site_settings_admin_read" on public.site_settings
for select using (public.is_admin());

-- `site_settings_admin_manage` (for all, is_admin) already exists in
-- supabase/schema.sql and is deliberately left in place — it covers writes.
