-- Meikero v4E — the service role may finally delete
--
-- Account deletion was written, reviewed, and would have reported success
-- while erasing nothing at all.
--
-- Earlier migrations granted the service role select/insert/update on the
-- product tables, one table at a time, as each feature needed them. DELETE was
-- never among them, because until now nothing deleted anything: the project
-- delete route relied on cascades and simply logged the errors it got back.
-- A purge that swallows `permission denied for table ai_designs` and returns
-- 200 is worse than no purge, because the person is told in writing that data
-- still sitting in the database is gone.
--
-- Granted per table rather than with `grant delete on all tables`, so a table
-- added later has to be considered rather than silently inheriting the right
-- to be wiped. to_regclass skips names that do not exist in this database,
-- which keeps the migration safe to run anywhere.
--
-- RLS is untouched. The service role bypasses it regardless; these are table
-- grants, which are a separate question from row policies, and nothing here
-- gives the browser's `authenticated` role any new right.

do $$
declare
  t text;
begin
  foreach t in array array[
    -- account-scoped
    'profiles',
    'subscriptions',
    'credit_ledger',
    -- project and its children
    'projects',
    'wordpress_sites',
    'site_api_keys',
    'ai_conversations',
    'ai_messages',
    'ai_runs',
    'ai_proposals',
    'ai_proposal_files',
    'ai_apply_runs',
    'ai_jobs',
    'ai_usage',
    'ai_designs',
    'ai_live_steps'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('grant delete on table public.%I to service_role', t);
    end if;
  end loop;
end
$$;

-- A verification query, kept here so the next person can check rather than
-- assume. Should return the same list as above:
--
--   select table_name
--     from information_schema.role_table_grants
--    where grantee = 'service_role'
--      and privilege_type = 'DELETE'
--      and table_schema = 'public'
--    order by table_name;
