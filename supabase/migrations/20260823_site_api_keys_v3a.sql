-- ESCANOR AI Builder v3A
-- Auth flip: WordPress authenticates to the SaaS with a site-scoped API key.
--
-- Until now the SaaS was always the client and WordPress the server. The
-- wp-admin builder needs the reverse direction, so each project can mint
-- long-lived keys that identify a *site* rather than a browser session.
--
-- Only the SHA-256 of the key secret is stored. The plaintext is returned
-- exactly once, at creation time.

create table if not exists public.site_api_keys (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects(id) on delete cascade,

  label text not null default 'WordPress plugin',

  -- Public lookup id, embedded in the key. Indexed so authentication is a
  -- single row fetch instead of a scan over every hash.
  key_id text not null unique,

  -- SHA-256 of the key secret. Never returned to the browser.
  key_hash text not null,

  created_by uuid null
    references auth.users(id) on delete set null,

  last_used_at timestamptz null,
  last_used_ip text null,
  last_actor_login text null,

  revoked_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint site_api_keys_key_id_format
    check (key_id ~ '^[a-f0-9]{16}$'),

  constraint site_api_keys_key_hash_format
    check (key_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists site_api_keys_project_created_idx
  on public.site_api_keys(project_id, created_at desc);

-- Authentication only ever looks at live keys.
create index if not exists site_api_keys_active_idx
  on public.site_api_keys(key_id)
  where revoked_at is null;

alter table public.site_api_keys enable row level security;

grant usage on schema public to authenticated;

-- Deliberately column-scoped: `key_hash` is never selectable by the
-- authenticated role, even through a direct PostgREST query.
grant select (
  id,
  project_id,
  label,
  key_id,
  created_by,
  last_used_at,
  last_used_ip,
  last_actor_login,
  revoked_at,
  created_at
) on table public.site_api_keys to authenticated;

-- No insert/update/delete grant for `authenticated`. Every write goes through
-- a server route using the service role, after that route has verified project
-- ownership against the caller's session.

drop policy if exists "Users can read own site API keys"
on public.site_api_keys;

create policy "Users can read own site API keys"
on public.site_api_keys
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = site_api_keys.project_id
      and p.owner_id = auth.uid()
  )
);
