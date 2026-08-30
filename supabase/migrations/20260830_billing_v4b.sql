-- Meikero v4B — subscriptions and credits
--
-- Two ideas carry this schema.
--
-- 1. The ledger is append-only. There is no `balance` column anywhere,
--    because a mutable balance is exactly the thing two concurrent AI calls
--    corrupt: both read 40, both subtract 30, and the account ends at 10
--    having spent 60. The balance is derived — sum(delta) — and the only way
--    to change it is to add a row.
--
-- 2. Money events are idempotent by construction. Stripe redelivers webhooks,
--    sometimes many times, so every grant carries a `ref` naming the Stripe
--    object that caused it, and a unique index makes the second insert a
--    no-op instead of free credits.

-- ---------------------------------------------------------------------------
-- Subscriptions — a mirror of Stripe, never the source of truth
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique
    references auth.users(id) on delete cascade,

  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,

  -- 'starter' | 'pro' | 'agency' — resolved from the price id in code, stored
  -- here so a lookup never depends on Stripe being reachable.
  plan_key text not null,

  -- Stripe's own vocabulary: active, trialing, past_due, canceled, unpaid...
  status text not null,

  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_customer_idx
  on public.subscriptions(stripe_customer_id);

-- ---------------------------------------------------------------------------
-- Credit ledger — append only
-- ---------------------------------------------------------------------------

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,

  user_id uuid not null
    references auth.users(id) on delete cascade,

  -- Positive grants, negative spends. Never zero.
  delta integer not null check (delta <> 0),

  reason text not null check (
    reason in ('signup_grant', 'plan_grant', 'topup', 'usage', 'refund', 'admin')
  ),

  -- What caused this row: a Stripe invoice or session id, an ai_usage id, a
  -- user id for the one-off signup grant. Nullable for manual adjustments.
  ref text null,

  note text null,

  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx
  on public.credit_ledger(user_id, created_at desc);

-- The idempotency guarantee: one grant per (reason, ref). A redelivered
-- invoice.paid, a double-clicked checkout, a retried webhook — all collapse
-- to the row that already exists. Spends are excluded because many legitimate
-- 'usage' rows share a null ref.
create unique index if not exists credit_ledger_grant_once
  on public.credit_ledger(reason, ref)
  where ref is not null and delta > 0;

-- ---------------------------------------------------------------------------
-- Stripe event log — the outer idempotency guard
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Spending credits atomically
-- ---------------------------------------------------------------------------

/**
 * Check the balance and debit it in one indivisible step.
 *
 * The advisory lock is the whole point. Two AI calls arriving together would
 * otherwise both read the same balance, both find it sufficient, and both
 * insert a debit — overdrawing the account. Locking on the user id serialises
 * only that user's spends and holds until the transaction ends.
 *
 * Raises 'insufficient_credits' when the balance will not cover the amount;
 * the caller turns that into an HTTP 402.
 */
create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'usage',
  p_ref text default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
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

  return v_balance - p_amount;
end;
$$;

/** Current balance for one user. Cheap: an index scan and a sum. */
create or replace function public.credit_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer
    from public.credit_ledger
   where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- The free trial, granted once per account
-- ---------------------------------------------------------------------------

create or replace function public.grant_signup_credits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ref = the user id, so the unique grant index makes this one-per-account
  -- even if the trigger somehow fires twice.
  insert into public.credit_ledger (user_id, delta, reason, ref, note)
  values (new.id, 50, 'signup_grant', new.id::text, 'Free trial')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_profile_created_grant on public.profiles;
create trigger on_profile_created_grant
  after insert on public.profiles
  for each row
  execute function public.grant_signup_credits();

-- Everyone who signed up before credits existed gets the same trial.
insert into public.credit_ledger (user_id, delta, reason, ref, note)
select p.id, 50, 'signup_grant', p.id::text, 'Free trial'
  from public.profiles p
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.subscriptions enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.stripe_events enable row level security;

grant usage on schema public to authenticated;

-- Read-only for the browser. Every write goes through the service client in a
-- webhook or the spend_credits function — a user who could insert into
-- credit_ledger could grant themselves credits.
grant select on table public.subscriptions to authenticated;
grant select on table public.credit_ledger to authenticated;

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription"
on public.subscriptions
for select
using (user_id = auth.uid());

drop policy if exists "Users can read own credit ledger" on public.credit_ledger;
create policy "Users can read own credit ledger"
on public.credit_ledger
for select
using (user_id = auth.uid());

-- stripe_events is service-only: no grants, no policies, so RLS denies the
-- authenticated role outright.

-- Postgres grants EXECUTE on a new function to PUBLIC by default, so revoking
-- from `authenticated` alone would change nothing — the right is inherited.
-- Strip it from PUBLIC first, then hand it back deliberately.
revoke execute on function public.credit_balance(uuid) from public;
revoke execute on function public.spend_credits(uuid, integer, text, text, text)
  from public;

-- Reading your own balance is harmless. Debiting it is not: spend_credits is
-- security definer and writes to a table the browser must never reach, so it
-- stays server-only.
grant execute on function public.credit_balance(uuid) to authenticated, service_role;
grant execute on function public.spend_credits(uuid, integer, text, text, text)
  to service_role;
