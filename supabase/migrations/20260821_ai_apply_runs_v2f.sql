-- ESCANOR AI Builder v2F
-- Controlled live apply tracking for Bridge v0.4.

create table if not exists public.ai_apply_runs (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects(id) on delete cascade,

  proposal_id uuid not null
    references public.ai_proposals(id) on delete cascade,

  snapshot_id text null,

  status text not null default 'applying'
    check (status in ('applying', 'applied', 'failed', 'rolled_back')),

  files_count integer not null default 0
    check (files_count >= 0),

  bridge_version text null,
  error_text text null,
  result_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  rolled_back_at timestamptz null
);

create index if not exists ai_apply_runs_project_created_idx
  on public.ai_apply_runs(project_id, created_at desc);

create index if not exists ai_apply_runs_proposal_created_idx
  on public.ai_apply_runs(proposal_id, created_at desc);

alter table public.ai_apply_runs enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.ai_apply_runs
  to authenticated;

drop policy if exists "Users can read own AI apply runs"
on public.ai_apply_runs;

create policy "Users can read own AI apply runs"
on public.ai_apply_runs
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_apply_runs.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI apply runs"
on public.ai_apply_runs;

create policy "Users can create own AI apply runs"
on public.ai_apply_runs
for insert
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_apply_runs.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI apply runs"
on public.ai_apply_runs;

create policy "Users can update own AI apply runs"
on public.ai_apply_runs
for update
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_apply_runs.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_apply_runs.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI apply runs"
on public.ai_apply_runs;

create policy "Users can delete own AI apply runs"
on public.ai_apply_runs
for delete
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_apply_runs.project_id
      and p.owner_id = auth.uid()
  )
);
