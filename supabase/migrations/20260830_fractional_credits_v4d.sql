-- Meikero v4D — credits become fractional
--
-- The ledger stored whole credits, and a single model call is usually worth
-- less than one: a chat message costs about 0.37 credits, writing one theme
-- file about 0.23. Rounding each charge to the nearest integer therefore
-- charged nothing at all for most calls — conversation was free, and a full
-- site build lost roughly an eighth of its price to the rounding.
--
-- numeric is exact decimal arithmetic, so summing thousands of small charges
-- cannot drift the way repeated float addition would. Four decimal places is
-- far finer than any single call, and the interface still shows whole credits.

alter table public.credit_ledger
  alter column delta type numeric(14, 4) using delta::numeric(14, 4);

comment on column public.credit_ledger.delta is
  'Credits, positive for grants and negative for usage. Fractional: one model call is usually worth less than a whole credit.';

-- ---------------------------------------------------------------------------
-- The functions that read and write it
-- ---------------------------------------------------------------------------

-- Returned as double precision rather than numeric so the application gets a
-- plain number instead of a string; the values here are nowhere near the range
-- where that loses anything.
create or replace function public.credit_balance(p_user_id uuid)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::double precision
    from public.credit_ledger
   where user_id = p_user_id;
$$;

drop function if exists public.spend_credits(uuid, integer, text, text, text);

create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount numeric,
  p_reason text default 'usage',
  p_ref text default null,
  p_note text default null
)
returns double precision
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(sum(delta), 0)
    into v_balance
    from public.credit_ledger
   where user_id = p_user_id;

  if v_balance < p_amount then
    raise exception 'insufficient_credits'
      using errcode = 'P0001',
            detail = format('balance %s, needed %s', v_balance, p_amount);
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref, note)
  values (p_user_id, -p_amount, p_reason, p_ref, p_note);

  return (v_balance - p_amount)::double precision;
end;
$$;

-- The admin overview reports the same fractional balance.
create or replace function public.admin_user_overview()
returns table (
  id uuid,
  email text,
  full_name text,
  company text,
  is_admin boolean,
  created_at timestamptz,
  stripe_customer_id text,
  credits double precision,
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
    coalesce(ledger.credits, 0)::double precision as credits,
    s.plan_key,
    s.status,
    s.current_period_end,
    s.cancel_at_period_end,
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

-- ---------------------------------------------------------------------------
-- Access, restated because the signatures changed
-- ---------------------------------------------------------------------------

revoke execute on function public.credit_balance(uuid) from public;
revoke execute on function public.spend_credits(uuid, numeric, text, text, text) from public;
revoke execute on function public.admin_user_overview() from public;

grant execute on function public.credit_balance(uuid) to authenticated, service_role;
grant execute on function public.spend_credits(uuid, numeric, text, text, text) to service_role;
grant execute on function public.admin_user_overview() to service_role;
