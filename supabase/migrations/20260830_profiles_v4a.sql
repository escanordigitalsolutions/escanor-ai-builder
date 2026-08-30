-- Meikero v4A — user profiles
--
-- Until now the only thing the app knew about a person was their auth.users
-- row. Going commercial needs a place to hang product-level facts on: the
-- Stripe customer id, whether they may see the internal admin workspace, and
-- the details we ask for at signup.
--
-- Design notes:
--  - id IS auth.users.id (shared primary key), so a profile can never drift
--    from the account it belongs to and joins stay trivial.
--  - The row is created by a trigger on auth.users, not by the app. Signup
--    happens inside Supabase's own transaction; creating the profile there
--    means no code path can ever produce a user without a profile.
--  - is_admin and stripe_customer_id are deliberately NOT writable by the
--    authenticated role. A user who could set is_admin on themselves would
--    own the admin workspace; one who could set stripe_customer_id could
--    point their subscription at someone else's billing.

create table if not exists public.profiles (
  id uuid primary key
    references auth.users(id) on delete cascade,

  email text not null default '',
  full_name text not null default '',
  company text not null default '',

  -- Set by the Stripe webhook only, never by the browser.
  stripe_customer_id text null unique,

  -- Gates the internal /admin workspace. Flip it by hand in Supabase.
  is_admin boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profile creation on signup
-- ---------------------------------------------------------------------------

-- security definer so it can write to a table the signing-up user has no
-- INSERT grant on; search_path is pinned so the function can't be hijacked
-- by a rogue schema earlier on the path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, company)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Keep the profile's email in step when the user changes it in Supabase.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set email = coalesce(new.email, ''),
           updated_at = now()
     where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  execute function public.handle_user_email_change();

-- Backfill anyone who signed up before this migration ran.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

grant usage on schema public to authenticated;

-- Column-scoped on purpose: the authenticated role can read its own row in
-- full, but may only ever write the three fields a person actually owns.
grant select on table public.profiles to authenticated;
grant update (full_name, company) on table public.profiles to authenticated;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- No INSERT or DELETE policy: rows appear and disappear with the auth.users
-- row they belong to, through the triggers and the cascade above.
