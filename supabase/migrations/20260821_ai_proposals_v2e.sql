-- ESCANOR AI Builder v2E
-- AI change proposals + stored diffs. No live WordPress writes.

create table if not exists public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid null references public.ai_conversations(id) on delete set null,

  request_text text not null,
  title text not null,
  summary text not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'discarded')),

  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),

  theme_fingerprint text null,
  plugin_fingerprint text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz null,
  discarded_at timestamptz null
);

create table if not exists public.ai_proposal_files (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.ai_proposals(id) on delete cascade,

  scope text not null check (scope in ('theme', 'plugin')),
  path text not null,
  change_summary text not null,

  original_sha256 text not null,
  original_content text not null,
  proposed_content text not null,
  diff_json jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  unique (proposal_id, scope, path)
);

create index if not exists ai_proposals_project_created_idx
  on public.ai_proposals(project_id, created_at desc);

create index if not exists ai_proposal_files_proposal_idx
  on public.ai_proposal_files(proposal_id);

alter table public.ai_proposals enable row level security;
alter table public.ai_proposal_files enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.ai_proposals
  to authenticated;

grant select, insert, update, delete
  on table public.ai_proposal_files
  to authenticated;

drop policy if exists "Users can read own AI proposals" on public.ai_proposals;
create policy "Users can read own AI proposals"
on public.ai_proposals
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_proposals.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI proposals" on public.ai_proposals;
create policy "Users can create own AI proposals"
on public.ai_proposals
for insert
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_proposals.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI proposals" on public.ai_proposals;
create policy "Users can update own AI proposals"
on public.ai_proposals
for update
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_proposals.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_proposals.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI proposals" on public.ai_proposals;
create policy "Users can delete own AI proposals"
on public.ai_proposals
for delete
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_proposals.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can read own AI proposal files" on public.ai_proposal_files;
create policy "Users can read own AI proposal files"
on public.ai_proposal_files
for select
using (
  exists (
    select 1
    from public.ai_proposals proposal
    join public.projects p on p.id = proposal.project_id
    where proposal.id = ai_proposal_files.proposal_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI proposal files" on public.ai_proposal_files;
create policy "Users can create own AI proposal files"
on public.ai_proposal_files
for insert
with check (
  exists (
    select 1
    from public.ai_proposals proposal
    join public.projects p on p.id = proposal.project_id
    where proposal.id = ai_proposal_files.proposal_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI proposal files" on public.ai_proposal_files;
create policy "Users can update own AI proposal files"
on public.ai_proposal_files
for update
using (
  exists (
    select 1
    from public.ai_proposals proposal
    join public.projects p on p.id = proposal.project_id
    where proposal.id = ai_proposal_files.proposal_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.ai_proposals proposal
    join public.projects p on p.id = proposal.project_id
    where proposal.id = ai_proposal_files.proposal_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI proposal files" on public.ai_proposal_files;
create policy "Users can delete own AI proposal files"
on public.ai_proposal_files
for delete
using (
  exists (
    select 1
    from public.ai_proposals proposal
    join public.projects p on p.id = proposal.project_id
    where proposal.id = ai_proposal_files.proposal_id
      and p.owner_id = auth.uid()
  )
);
