-- ESCANOR AI Builder v3D
-- Live agent activity steps, so the wp-admin editor can show what the AI is
-- doing while it works (the editor polls these during a chat request).
--
-- Written only by the service-role agent routes; read back through the same
-- site-key path. Rows are disposable progress markers, safe to prune.

create table if not exists public.ai_live_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id text not null,
  seq integer not null default 0,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_live_steps_run_idx
  on public.ai_live_steps(project_id, run_id, seq);

create index if not exists ai_live_steps_created_idx
  on public.ai_live_steps(created_at);

alter table public.ai_live_steps enable row level security;

-- Server-side agent routes only.
grant select, insert, delete on public.ai_live_steps to service_role;
