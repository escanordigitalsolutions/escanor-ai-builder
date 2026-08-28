-- ESCANOR AI Builder — projects service-role write grant
--
-- The per-project module-licensing route (app/api/projects/[id]/modules)
-- updates projects.modules / projects.plan through the service-role client.
-- service_role bypasses RLS but still needs table privileges, and it was only
-- ever granted SELECT on public.projects — so the UPDATE failed with 42501
-- (permission denied). Grant the minimum the feature needs.

grant select, update on public.projects to service_role;
