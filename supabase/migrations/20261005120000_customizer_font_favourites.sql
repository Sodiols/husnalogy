-- Favourite Fonts (Customizer Point 4).
--
-- Husnalogy-wide favourite font families, marked by an administrator in the
-- Design Studio and offered to customers as the "Favourite Fonts" category.
-- One row per family: a row existing IS the favourite flag, so toggling is an
-- insert or a delete and two admins can never write conflicting booleans.
--
-- A favourite never widens what a template allows: the customer selector
-- filters by the template's allowed fonts FIRST, and the save validator checks
-- fonts against the template regardless of this table.
--
-- The application reads and writes through the service-role client; the
-- policies below are defence in depth for direct PostgREST access. The data is
-- not sensitive (a list of public Google Fonts family names), so it is
-- readable by anyone.

create table if not exists public.customizer_font_favourites (
  family text primary key check (char_length(family) between 1 and 120),
  created_at timestamp with time zone not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

alter table public.customizer_font_favourites enable row level security;

drop policy if exists "customizer_font_favourites_public_read" on public.customizer_font_favourites;
create policy "customizer_font_favourites_public_read" on public.customizer_font_favourites
for select using (true);

drop policy if exists "customizer_font_favourites_admin_manage" on public.customizer_font_favourites;
create policy "customizer_font_favourites_admin_manage" on public.customizer_font_favourites
for all using (public.is_admin()) with check (public.is_admin());
