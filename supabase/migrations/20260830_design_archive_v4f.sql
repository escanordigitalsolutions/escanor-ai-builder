-- Meikero v4F — the design archive keeps the whole design
--
-- ai_designs stored one column of HTML: the homepage. Everything else the
-- generation produced — the inner page, the stylesheet, the header and footer
-- markup, the section fragments, the art direction that decided it all — lived
-- only in ai_jobs.result, and a sweep deletes those rows after a day.
--
-- So the inner page was not "missing from the archive". It was never in it, and
-- after twenty-four hours it was gone for good. That also made prompt work
-- unmeasurable: two runs a week apart could not be compared, because the older
-- one no longer existed.
--
-- Wide columns rather than one blob: the listing screens need model, concept and
-- validation without dragging fifty kilobytes of HTML across the wire for every
-- row, and Postgres will not let a select skip part of a jsonb value.

alter table public.ai_designs
  add column if not exists job_id text,
  add column if not exists shape text,
  add column if not exists concept text,
  add column if not exists inner_html text,
  add column if not exists assets jsonb,
  add column if not exists direction jsonb,
  add column if not exists validation jsonb,
  add column if not exists critique text,
  add column if not exists retried boolean not null default false;

comment on column public.ai_designs.job_id is
  'The generation job that produced this. Lets a killed run be told apart from one that produced nothing, which decides whether a refund is owed.';

comment on column public.ai_designs.assets is
  'Everything the splitter cut out: css, header, footer, fonts, sections, innerCss, pageHero. The build reads these instead of re-deriving them.';

comment on column public.ai_designs.direction is
  'The art direction the design was told to execute — tokens, signature move, section plan, avoid list. Kept so a design can be judged against what it was asked to be.';

-- Finding a design by its job is how job-status decides whether work was
-- delivered before a run died; without an index that is a sequential scan of
-- every design in the system.
create index if not exists ai_designs_job_idx on public.ai_designs(job_id)
  where job_id is not null;

create index if not exists ai_designs_created_idx on public.ai_designs(created_at desc);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Unchanged in spirit: the browser never reads this table directly. WordPress
-- reaches it through the authenticated site routes and the admin screens go
-- through requireAdmin() and the service client, both server-side.
grant delete on table public.ai_designs to service_role;
