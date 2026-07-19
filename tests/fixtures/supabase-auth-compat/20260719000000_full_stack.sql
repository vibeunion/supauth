create table if not exists public.gotrue_compat_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload text not null,
  created_at timestamptz not null default now()
);

alter table public.gotrue_compat_items enable row level security;

drop policy if exists "owners read compatibility items" on public.gotrue_compat_items;
create policy "owners read compatibility items"
  on public.gotrue_compat_items
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "owners insert compatibility items" on public.gotrue_compat_items;
create policy "owners insert compatibility items"
  on public.gotrue_compat_items
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owners delete compatibility items" on public.gotrue_compat_items;
create policy "owners delete compatibility items"
  on public.gotrue_compat_items
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, delete on public.gotrue_compat_items to authenticated;
grant all on public.gotrue_compat_items to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gotrue_compat_items'
  ) then
    alter publication supabase_realtime add table public.gotrue_compat_items;
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('gotrue-compat-private', 'gotrue-compat-private', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "owners read compatibility objects" on storage.objects;
create policy "owners read compatibility objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'gotrue-compat-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "owners insert compatibility objects" on storage.objects;
create policy "owners insert compatibility objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'gotrue-compat-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "owners delete compatibility objects" on storage.objects;
create policy "owners delete compatibility objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'gotrue-compat-private'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
