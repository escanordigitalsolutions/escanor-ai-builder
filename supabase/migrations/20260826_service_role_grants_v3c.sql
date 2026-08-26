-- ESCANOR AI Builder v3C
-- Service-role privileges for the wp-admin editor BUILD path (proposals + apply).
--
-- v3B granted the read/chat tables. The editor's "Propose change" and "Apply"
-- (agent/proposals, agent/apply) use the service-role client too, so it needs
-- privileges on the proposal + deployment tables as well. Without these, the
-- editor build flow would hit "permission denied for table ai_proposals".
--
-- service_role is server-side only and bypasses RLS; every query on this path
-- scopes by project_id explicitly.

grant select, insert, update on public.ai_proposals      to service_role;
grant select, insert, update on public.ai_proposal_files to service_role;
grant select, insert, update on public.ai_apply_runs     to service_role;
