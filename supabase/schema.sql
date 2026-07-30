-- ============================================================
-- Time Tracker — Supabase schema
-- Run this once in your Supabase project's SQL Editor.
-- Safe to re-run: every statement is idempotent.
-- ============================================================

-- ---------- Roles ----------
-- 'admin' exists from day one so the manager view can be switched
-- on later without a migration.
do $$ begin
  create type user_role as enum ('employee', 'admin');
exception when duplicate_object then null;
end $$;

-- ---------- Profiles ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        user_role not null default 'employee',
  created_at  timestamptz not null default now()
);

-- ---------- Records ----------
create table if not exists records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  time_in      text not null default '',
  time_out     text,
  total_hours  numeric(5,2),
  status       text not null check (status in ('Working','Completed','Note','WFH','Leave')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One record per user per day. upsertManualEntry() relies on this.
  constraint records_user_date_key unique (user_id, date)
);

create index if not exists records_user_date_idx on records (user_id, date desc);

-- ---------- Auto-create a profile on first sign-in ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Keep updated_at fresh ----------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists records_touch_updated_at on records;
create trigger records_touch_updated_at
  before update on records
  for each row execute function touch_updated_at();

-- ============================================================
-- Row-Level Security — this is what actually isolates users.
-- Without these policies every signed-in user could read every
-- row. Do not skip.
-- ============================================================

alter table profiles enable row level security;
alter table records  enable row level security;

-- security definer so the policy can read `profiles` without
-- re-entering the policy that calls it (infinite recursion).
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- Profile policies ----------
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles
  for update using (id = auth.uid());

-- ---------- Record policies ----------
-- The `or is_admin()` on select means the admin/manager view is
-- already permitted at the DB layer; Phase 6 only needs a UI.
drop policy if exists "read own records" on records;
create policy "read own records" on records
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists "insert own records" on records;
create policy "insert own records" on records
  for insert with check (user_id = auth.uid());

drop policy if exists "update own records" on records;
create policy "update own records" on records
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own records" on records;
create policy "delete own records" on records
  for delete using (user_id = auth.uid());

-- ============================================================
-- Account deletion (Google Play requires an in-app deletion path
-- for any app with sign-in). Deletes the caller's auth user; the
-- cascades above remove their profile and records.
-- ============================================================
create or replace function delete_own_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function delete_own_account() from public, anon;
grant execute on function delete_own_account() to authenticated;

-- ============================================================
-- To promote someone to admin later (Phase 6):
--   update profiles set role = 'admin' where email = 'you@company.com';
-- ============================================================
