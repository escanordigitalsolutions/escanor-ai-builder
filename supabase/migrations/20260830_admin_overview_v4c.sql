-- Meikero v4C — the operator's view of every account
--
-- Assembling this in the application would mean reading the whole credit
-- ledger and summing it in JavaScript. That is fine with three accounts and
-- ruinous with three hundred, because the ledger gains a row for every model
-- call anyone makes. Postgres does the aggregation where the data already is.
--
-- security definer, and executable only by service_role: the API route checks
-- profiles.is_admin before it ever gets here.

create or replace function public.admin_user_overview()
returns table (
  id uuid,
  email text,
  full_name text,
  company text,
  is_admin boolean,
  created_at timestamptz,
  stripe_customer_id text,
  credits integer,
  plan_key text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  manual_subscription boolean,
  projects integer,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email,
    p.full_name,
    p.company,
    p.is_admin,
    p.created_at,
    p.stripe_customer_id,
    coalesce(ledger.credits, 0)::integer as credits,
    s.plan_key,
    s.status,
    s.current_period_end,
    s.cancel_at_period_end,
    -- Comped accounts are marked so the interface can say which rows Stripe
    -- would overwrite and which it has no opinion about.
    coalesce(s.stripe_subscription_id like 'manual:%', false) as manual_subscription,
    coalesce(owned.projects, 0)::integer as projects,
    ledger.last_activity
  from public.profiles p
  left join (
    select
      user_id,
      sum(delta) as credits,
      max(created_at) filter (where reason = 'usage') as last_activity
    from public.credit_ledger
    group by user_id
  ) ledger on ledger.user_id = p.id
  left join public.subscriptions s on s.user_id = p.id
  left join (
    select owner_id, count(*) as projects
    from public.projects
    group by owner_id
  ) owned on owned.owner_id = p.id
  order by p.created_at desc;
$$;

revoke execute on function public.admin_user_overview() from public;
grant execute on function public.admin_user_overview() to service_role;
