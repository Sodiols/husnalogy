/* ==========================================================================
   Customer profile data lives on the account, and profile photos are real
   uploads.

   1. The phone number used to be stored in a global localStorage key
      ("husnalogy_profile") shared by every account on the browser, and the
      "Change photo" button only showed a blob: preview that vanished on
      refresh. Both now live on `public.profiles`, which RLS already limits to
      its owner (profiles_select_own_or_admin / profiles_update_own_or_admin)
      and whose role/email are trigger-protected.

   2. Profile photos are stored in a PRIVATE bucket, `customer-avatars`, at
      `<user id>/<file>.webp`. Customers never write Storage directly: the
      server verifies the session, decodes and re-encodes the image, writes it
      with the service role and records the path in `profiles.avatar_path`.
      The photo is shown through short-lived signed URLs.

   3. Bounds on customer-writable profile columns. They are added NOT VALID:
      enforced for every new write, without failing on legacy rows.

   Additive and idempotent.
   ========================================================================== */

alter table public.profiles add column if not exists avatar_path text;

do $$ begin
  alter table public.profiles add constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 120) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_phone_format check (phone is null or (char_length(phone) <= 30 and phone ~ '^[0-9+()\-. ]*$')) not valid;
exception when duplicate_object then null; end $$;

-- A provider photo (e.g. Google) is an https URL; nothing else may be stored there.
do $$ begin
  alter table public.profiles add constraint profiles_avatar_url_https check (avatar_url is null or avatar_url = '' or (avatar_url ~ '^https://' and char_length(avatar_url) <= 1000)) not valid;
exception when duplicate_object then null; end $$;

-- An uploaded photo can only ever point inside the account's own folder.
do $$ begin
  alter table public.profiles add constraint profiles_avatar_path_own_folder check (
    avatar_path is null
    or (avatar_path like id::text || '/%' and char_length(avatar_path) <= 200 and avatar_path !~ '\.\.')
  ) not valid;
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-avatars', 'customer-avatars', false, 2097152, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policy is granted for customer-avatars: reads and writes
-- go through /api/account/avatar (session-checked, service role).
