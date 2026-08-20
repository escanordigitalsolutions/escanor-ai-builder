-- ESCANOR AI Builder — AI Workspace v2B
-- Persistent conversations, messages and AI usage runs.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  activity jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  activity jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_project_updated_idx
  on public.ai_conversations(project_id, updated_at desc);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at asc);

create index if not exists ai_runs_conversation_created_idx
  on public.ai_runs(conversation_id, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_runs enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.ai_conversations
  to authenticated;

grant select, insert, update, delete
  on table public.ai_messages
  to authenticated;

grant select, insert, update, delete
  on table public.ai_runs
  to authenticated;

drop policy if exists "Users can read own AI conversations" on public.ai_conversations;
create policy "Users can read own AI conversations"
on public.ai_conversations
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_conversations.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI conversations" on public.ai_conversations;
create policy "Users can create own AI conversations"
on public.ai_conversations
for insert
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_conversations.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI conversations" on public.ai_conversations;
create policy "Users can update own AI conversations"
on public.ai_conversations
for update
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_conversations.project_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = ai_conversations.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI conversations" on public.ai_conversations;
create policy "Users can delete own AI conversations"
on public.ai_conversations
for delete
using (
  exists (
    select 1
    from public.projects p
    where p.id = ai_conversations.project_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can read own AI messages" on public.ai_messages;
create policy "Users can read own AI messages"
on public.ai_messages
for select
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_messages.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI messages" on public.ai_messages;
create policy "Users can create own AI messages"
on public.ai_messages
for insert
with check (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_messages.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI messages" on public.ai_messages;
create policy "Users can update own AI messages"
on public.ai_messages
for update
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_messages.conversation_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_messages.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI messages" on public.ai_messages;
create policy "Users can delete own AI messages"
on public.ai_messages
for delete
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_messages.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can read own AI runs" on public.ai_runs;
create policy "Users can read own AI runs"
on public.ai_runs
for select
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_runs.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can create own AI runs" on public.ai_runs;
create policy "Users can create own AI runs"
on public.ai_runs
for insert
with check (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_runs.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can update own AI runs" on public.ai_runs;
create policy "Users can update own AI runs"
on public.ai_runs
for update
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_runs.conversation_id
      and p.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_runs.conversation_id
      and p.owner_id = auth.uid()
  )
);

drop policy if exists "Users can delete own AI runs" on public.ai_runs;
create policy "Users can delete own AI runs"
on public.ai_runs
for delete
using (
  exists (
    select 1
    from public.ai_conversations c
    join public.projects p on p.id = c.project_id
    where c.id = ai_runs.conversation_id
      and p.owner_id = auth.uid()
  )
);
