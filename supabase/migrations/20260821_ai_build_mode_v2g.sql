-- ESCANOR AI Builder v2G
-- Build-mode foundation: proposal create operations + persisted preflight state.

alter table public.ai_proposal_files
  add column if not exists operation text not null default 'modify';

alter table public.ai_proposal_files
  alter column original_sha256 drop not null;

alter table public.ai_proposals
  add column if not exists last_preflight_at timestamptz null;

alter table public.ai_proposals
  add column if not exists last_preflight_ok boolean null;

alter table public.ai_proposals
  add column if not exists last_preflight_json jsonb null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_proposal_files_operation_check'
      and conrelid = 'public.ai_proposal_files'::regclass
  ) then
    alter table public.ai_proposal_files
      add constraint ai_proposal_files_operation_check
      check (operation in ('modify', 'create'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_proposal_files_sha_by_operation_check'
      and conrelid = 'public.ai_proposal_files'::regclass
  ) then
    alter table public.ai_proposal_files
      add constraint ai_proposal_files_sha_by_operation_check
      check (
        (
          operation = 'modify'
          and original_sha256 is not null
          and original_sha256 ~ '^[a-f0-9]{64}$'
        )
        or
        (
          operation = 'create'
          and original_sha256 is null
        )
      );
  end if;
end
$$;
