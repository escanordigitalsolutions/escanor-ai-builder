-- Meikero v4G — a design is more than one page
--
-- Until now a generation produced a homepage and, if the clock allowed, one
-- inner page. Everything else a WordPress theme needs — the component set, the
-- blog archive, the 404, the brand sheet — either did not exist or was invented
-- again from scratch on every page that needed it, which is why inner pages
-- never quite matched.
--
-- One jsonb column rather than four text ones: these are whole HTML documents
-- that are only ever read together, by a preview that asks for one of them by
-- name. A column per page would mean a migration every time the pipeline learns
-- to draw another.

alter table public.ai_designs
  add column if not exists pages jsonb;

comment on column public.ai_designs.pages is
  'Whole HTML documents keyed by name: components, archive, notfound, brand. The homepage is html and the inner page is inner_html, both from before this column existed.';
