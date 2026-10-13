-- ===========================================================================
-- Repaint Queenstown website CMS  (repaintqueenstown.nz)
--
-- Runs in Supabase project bffddgypusotsdwpaliy, alongside the Everest
-- Painters CMS and the CRM.
--
-- Everything is namespaced with a `repaint_` / `repaint-` prefix so it cannot
-- collide with anything else in that project: Everest's everest_site_content,
-- the CRM's own tables and buckets, and their policies are never touched.
--
-- Run once in the Supabase SQL editor. Safe to re-run: every statement is
-- create-if-missing, drop-and-recreate of a repaint_ policy or trigger, or an
-- insert that does nothing when the row is already there.
-- ===========================================================================

-- ------------------------------------------------------------------ editors
-- Who may edit the Repaint site. Membership here is the ONLY thing that grants
-- write access. Being a CRM user, or an Everest editor, is not enough.
create table if not exists public.repaint_site_editors (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now()
);

alter table public.repaint_site_editors enable row level security;

-- Deliberately no policies: the table is readable and writable only by the
-- service role and the SQL editor. Nobody manages this list from the browser.

create or replace function public.repaint_is_site_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.repaint_site_editors
    where user_id = auth.uid()
  );
$$;

-- The write policies below call this as the signed-in user.
grant execute on function public.repaint_is_site_editor() to authenticated;

-- ------------------------------------------------------------------ content
create table if not exists public.repaint_site_content (
  key         text primary key,
  data        jsonb       not null default '{}'::jsonb,
  type        text        not null default 'text',
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id) on delete set null
);

comment on table public.repaint_site_content is
  'One row per editable element on repaintqueenstown.nz. key matches the '
  'data-cms attribute in the HTML; data holds {v, href} for text, {v} for '
  'attributes and lists, or {src, alt} for images.';

create or replace function public.repaint_site_content_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists repaint_site_content_touch on public.repaint_site_content;
create trigger repaint_site_content_touch
  before insert or update on public.repaint_site_content
  for each row execute function public.repaint_site_content_touch();

alter table public.repaint_site_content enable row level security;

-- Table privileges. RLS decides WHICH rows; these decide whether the role may
-- touch the table at all. Without them PostgREST returns 42501 "permission
-- denied for table" before any policy is consulted. Not inherited from
-- default privileges in newer projects, so they are granted explicitly.
grant usage on schema public to anon, authenticated;
grant select on public.repaint_site_content to anon, authenticated;
grant insert, update, delete on public.repaint_site_content to authenticated;

-- repaint_site_editors deliberately gets no grants: it is only ever read
-- through repaint_is_site_editor(), which is security definer and so runs as
-- the table owner. No browser role can read the allowlist directly.

-- Anyone may read: this is public website copy.
drop policy if exists "repaint_site_content read" on public.repaint_site_content;
create policy "repaint_site_content read"
  on public.repaint_site_content for select
  using (true);

-- Only a listed Repaint editor may write. Scoped per command rather than
-- `for all`, so a missing WITH CHECK cannot widen anything.
drop policy if exists "repaint_site_content insert" on public.repaint_site_content;
create policy "repaint_site_content insert"
  on public.repaint_site_content for insert
  to authenticated
  with check (public.repaint_is_site_editor());

drop policy if exists "repaint_site_content update" on public.repaint_site_content;
create policy "repaint_site_content update"
  on public.repaint_site_content for update
  to authenticated
  using (public.repaint_is_site_editor())
  with check (public.repaint_is_site_editor());

drop policy if exists "repaint_site_content delete" on public.repaint_site_content;
create policy "repaint_site_content delete"
  on public.repaint_site_content for delete
  to authenticated
  using (public.repaint_is_site_editor());

-- ------------------------------------------------------------------- images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'repaint-site-images', 'repaint-site-images', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict (id) do nothing;

-- Every policy below is scoped to bucket_id = 'repaint-site-images', so
-- Everest's bucket and the CRM's own buckets are unaffected.
drop policy if exists "repaint_site_images read" on storage.objects;
create policy "repaint_site_images read"
  on storage.objects for select
  using (bucket_id = 'repaint-site-images');

drop policy if exists "repaint_site_images insert" on storage.objects;
create policy "repaint_site_images insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'repaint-site-images' and public.repaint_is_site_editor());

drop policy if exists "repaint_site_images update" on storage.objects;
create policy "repaint_site_images update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'repaint-site-images' and public.repaint_is_site_editor())
  with check (bucket_id = 'repaint-site-images' and public.repaint_is_site_editor());

drop policy if exists "repaint_site_images delete" on storage.objects;
create policy "repaint_site_images delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'repaint-site-images' and public.repaint_is_site_editor());

-- ===========================================================================
-- AFTER creating the admin user in Authentication -> Users, run this to let
-- them edit (replace the email):
--
--   insert into public.repaint_site_editors (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict (user_id) do nothing;
--
-- To revoke access later, without deleting their account:
--
--   delete from public.repaint_site_editors
--   where user_id = (select id from auth.users where email = 'you@example.com');
-- ===========================================================================
