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

        if (userId && session.payment_status === "paid") {
          await grantCredits(
            userId,
            TOPUP_CREDITS,
            "topup",
            session.id,
            "Credit top-up"
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;

        const subscriptionId =
          (invoice as unknown as { subscription?: string | { id: string } })
            .subscription;

        const subId =
          typeof subscriptionId === "string"
            ? subscriptionId
            : subscriptionId?.id ?? null;

        if (!subId) break;

        // Refresh our mirror first so the plan we credit is the one just paid
        // for, not the one from before an upgrade.
        const sub = await stripe().subscriptions.retrieve(subId);
        const userId = await upsertSubscription(sub);
        if (!userId) break;

        const planKey = planForPriceId(sub.items.data[0]?.price?.id);
        const credits = planKey ? PLANS[planKey].monthlyCredits : 0;

        if (credits > 0) {
          // ref is the invoice id, so one grant per billing period — a
          // redelivered invoice.paid cannot top the account up twice.
          await grantCredits(
            userId,
            credits,
            "plan_grant",
            invoice.id ?? `${subId}-${event.id}`,
            `${planKey} monthly credits`
          );
        }
        break;
      }

      default:
        break;
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
