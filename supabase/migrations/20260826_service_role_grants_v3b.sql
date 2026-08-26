-- ESCANOR AI Builder v3B
-- Service-role table privileges for the WordPress -> SaaS (v3A) path.
--
-- The v3A flip authenticates a *site*, not a browser user, so those routes use
-- the service-role client (lib/supabase/service.ts) which has no auth.uid().
-- Earlier migrations granted table privileges only to `authenticated`, so
-- service_role hit "permission denied for table projects [42501]" the moment
-- the wp-admin editor called agent/session or agent/chat.
--
-- service_role is used server-side only (the secret key never reaches a
-- browser) and bypasses RLS, so granting it the privileges these routes need
-- is safe. Every query on this path already scopes by project_id explicitly.

-- Read the project + its WordPress site (agent/session, agent/chat).
grant select on public.projects        to service_role;
grant select on public.wordpress_sites to service_role;

-- Persist wp-admin editor conversations, messages and usage runs (agent/chat).
grant select, insert, update on public.ai_conversations to service_role;
grant select, insert         on public.ai_messages      to service_role;
grant select, insert         on public.ai_runs          to service_role;

-- Site key lookup + last-used stamping (authenticateSiteRequest).
grant select, insert, update on public.site_api_keys to service_role;
