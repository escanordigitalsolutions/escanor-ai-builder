import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { createServiceClient } from "@/lib/supabase/service";
import { stripe, webhookSecret } from "@/lib/billing/stripe";
import { grantCredits } from "@/lib/billing/credits";
import { PLANS, TOPUP_CREDITS, planForPriceId } from "@/lib/billing/plans";
import { errorDetail } from "@/lib/debug";

// Node, not edge: verifying the signature needs the raw body and Stripe's SDK.
export const runtime = "nodejs";

/**
 * Stripe -> Meikero.
 *
 * Two layers of idempotency, because Stripe redelivers aggressively and a
 * double-processed invoice means free credits:
 *
 *   1. stripe_events — the event id is a primary key, so a redelivery loses
 *      the insert race and returns early.
 *   2. credit_ledger's unique (reason, ref) index — even if layer 1 is
 *      bypassed, the grant itself cannot be written twice.
 *
 * The endpoint is excluded from the session proxy in proxy.ts: Stripe sends no
 * cookies, and a session refresh here would be pure latency.
 */

/** Resolve which Meikero account a Stripe customer belongs to. */
async function userIdForCustomer(customerId: string): Promise<string | null> {
  const db = createServiceClient();

  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (data?.id) return String(data.id);

  // Fallback for the very first event of a customer's life, which can arrive
  // before the profile row has been updated with the customer id.
  try {
    const customer = await stripe().customers.retrieve(customerId);
    if (!customer.deleted) {
      const fromMeta = customer.metadata?.supabase_user_id;
      if (fromMeta) {
        await db
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", fromMeta);
        return fromMeta;
      }
    }
  } catch (error) {
    console.error("customer lookup failed:", error);
  }

  return null;
}

async function upsertSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";

  const userId =
    sub.metadata?.supabase_user_id ?? (await userIdForCustomer(customerId));

  if (!userId) {
    console.error("subscription with no resolvable user:", sub.id);
    return null;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  const planKey = planForPriceId(priceId);

  if (!planKey) {
    console.error("subscription price maps to no plan:", priceId);
  }

  // period end moved onto the item in recent API versions; fall back for
  // anything created under an older one.
  const periodEnd =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number })?.current_period_end ??
    null;

  const db = createServiceClient();

  await db.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      plan_key: planKey ?? "free",
      status: sub.status,
      current_period_end: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null,
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  return userId;
}


/**
 * The subscription an invoice belongs to.
 *
 * Stripe moved this. Up to API version 2025-03-31 it was `invoice.subscription`;
 * from 2025-04-30 it lives at `invoice.parent.subscription_details.subscription`
 * and the old field is gone entirely. Reading only the old one — which this did,
 * behind an `as unknown as` cast that hid the mistake from the compiler — meant
 * every renewal silently granted nothing: the plan updated from the
 * subscription event, and the credits never arrived.
 *
 * Both are read so the handler keeps working across an SDK upgrade in either
 * direction.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent?.subscription_details?.subscription;

  if (typeof parent === "string") return parent;
  if (parent && typeof parent === "object" && "id" in parent) {
    return String(parent.id);
  }

  const legacy = (invoice as unknown as { subscription?: unknown }).subscription;

  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    return String((legacy as { id: unknown }).id);
  }

  return null;
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Must be the untouched bytes — any parsing breaks the signature.
  const raw = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe().webhooks.constructEvent(raw, signature, webhookSecret());
  } catch (error) {
    // A bad signature means this did not come from Stripe. Never process it.
    console.error("stripe signature verification failed:", error);
    // Stripe shows this body in its own dashboard, which is the fastest place
    // to notice a webhook secret that belongs to a different endpoint.
    return NextResponse.json(
      { error: "Invalid signature.", code: "bad_signature", ...errorDetail(error) },
      { status: 400 }
    );
  }

  const db = createServiceClient();

  // Layer 1: claim the event. A redelivery collides on the primary key here.
  const { error: claimError } = await db
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    if (claimError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("stripe_events insert failed:", claimError);
    // Fail loudly so Stripe retries rather than silently dropping the event.
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Subscriptions are credited by invoice.paid instead, which also
        // covers every renewal rather than only the first purchase.
        if (session.mode !== "payment") break;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? "";

        const userId =
          session.metadata?.supabase_user_id ??
          (await userIdForCustomer(customerId));

        if (!userId) {
          return NextResponse.json({
            received: true,
            handled: false,
            reason: "no Meikero account for this Stripe customer",
          });
        }

        // "no_payment_required" is what a fully discounted purchase reports —
        // a 100% coupon leaves nothing to charge, so Stripe never marks it
        // "paid". The customer still bought the thing and is owed the credits.
        const settled =
          session.payment_status === "paid" ||
          session.payment_status === "no_payment_required";

        if (!settled) {
          return NextResponse.json({
            received: true,
            handled: false,
            reason: `payment_status is ${session.payment_status}`,
          });
        }

        const granted = await grantCredits(
          userId,
          TOPUP_CREDITS,
          "topup",
          session.id,
          "Credit top-up"
        );

        return NextResponse.json({
          received: true,
          handled: true,
          granted: granted ? TOPUP_CREDITS : 0,
          reason: granted ? undefined : "already granted for this session",
        });
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await upsertSubscription(sub);
        const planKey = planForPriceId(sub.items.data[0]?.price?.id);

        return NextResponse.json({
          received: true,
          handled: Boolean(userId),
          plan: planKey,
          status: sub.status,
          // A subscription that starts on a trial is never invoiced, so no
          // credits arrive until the trial converts. Worth seeing here.
          reason: userId
            ? planKey
              ? undefined
              : `price ${sub.items.data[0]?.price?.id} maps to no plan — check STRIPE_PRICE_*`
            : "no Meikero account for this Stripe customer",
        });
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;

        const subId = subscriptionIdOf(invoice);

        if (!subId) {
          // Not every paid invoice belongs to a subscription — a one-off
          // charge produces one too. Say so in the response rather than
          // returning a silent success, because Stripe's dashboard shows this
          // body per event and it is the fastest place to see why an invoice
          // granted nothing.
          return NextResponse.json({
            received: true,
            handled: false,
            reason: "invoice has no subscription",
          });
        }

        // Refresh our mirror first so the plan we credit is the one just paid
        // for, not the one from before an upgrade.
        const sub = await stripe().subscriptions.retrieve(subId);
        const userId = await upsertSubscription(sub);
        if (!userId) break;

        const planKey = planForPriceId(sub.items.data[0]?.price?.id);
        const credits = planKey ? PLANS[planKey].monthlyCredits : 0;

        if (credits <= 0) {
          return NextResponse.json({
            received: true,
            handled: false,
            reason: planKey
              ? `${planKey} grants no monthly credits`
              : `price ${sub.items.data[0]?.price?.id} maps to no plan — check STRIPE_PRICE_*`,
          });
        }

        // ref is the invoice id, so one grant per billing period — a
        // redelivered invoice.paid cannot top the account up twice.
        const granted = await grantCredits(
          userId,
          credits,
          "plan_grant",
          invoice.id ?? `${subId}-${event.id}`,
          `${planKey} monthly credits`
        );

        return NextResponse.json({
          received: true,
          handled: true,
          plan: planKey,
          granted: granted ? credits : 0,
          reason: granted ? undefined : "already granted for this invoice",
        });
      }

      default:
        return NextResponse.json({
          received: true,
          handled: false,
          reason: `${event.type} is not handled`,
        });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`stripe webhook (${event.type}) failed:`, error);
    const detail = errorDetail(error, { event: event.type, eventId: event.id });

    // Let Stripe retry: drop the claim so the retry is not treated as a
    // duplicate of an event we never actually finished handling.
    await db.from("stripe_events").delete().eq("id", event.id);

    return NextResponse.json(
      { error: "Handler failed.", code: "handler_failed", ...detail },
      { status: 500 }
    );
  }
}
