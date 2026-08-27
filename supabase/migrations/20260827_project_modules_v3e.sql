-- ESCANOR AI Builder — module entitlements
-- Which product modules a project is licensed for. The wp-admin plugin reads
-- these through the site-key session handshake and locks the modules a project
-- is not entitled to. NULL means "not configured" and resolves to the
-- permissive default in lib/entitlements.ts, so existing projects are unchanged
-- until an entitlement is set deliberately.
--
-- Module keys: content (base, always on), seo, health, build.

alter table public.projects
  add column if not exists modules jsonb,
  add column if not exists plan text;

comment on column public.projects.modules is
  'Per-project module entitlements, e.g. {"content":true,"seo":false,"health":false,"build":false}. NULL = use default in lib/entitlements.ts.';

comment on column public.projects.plan is
  'Human-readable plan label surfaced in the dashboard (e.g. free, pro). NULL = free.';
