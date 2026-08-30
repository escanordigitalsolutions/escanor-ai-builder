import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe, stripeConfigured, missingStripeConfig } from "@/lib/billing/stripe";
import { errorDetail } from "@/lib/debug";
import {
  isPlanKey,
  priceEnvFor,
  priceIdFor,
  priceProblem,
  topupPriceId,
} from "@/lib/billing/plans";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

/**
 * Start a Stripe Checkout session — a plan subscription or a credit top-up.
 *
 * The customer is resolved server-side from the signed-in session, never from
 * the request body: a client that could name its own customer id could buy
 * credits into somebody else's account.
 */

async function stripeCustomerFor(userId: string, email: string): Promise<string> {
  const db = createServiceClient();

  const { data: profile } = await db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.stripe_customer_id) {
    return String(profile.stripe_customer_id);
  }

  const customer = await stripe().customers.create({
    email,
    // The webhook reads this back to know whose account to credit.
    metadata: { supabase_user_id: userId },
  });

  await db
    .from("profiles")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("id", userId);

  return customer.id;
}

export async function POST(request: NextRequest) {
  const missing = missingStripeConfig();

  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: `Billing is not configured: missing ${missing.join(", ")}.`,
        code: "stripe_not_configured",
        missing,
      },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Sign in to continue." },
      { status: 401 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const mode = body.mode === "topup" ? "topup" : "subscription";

  try {
    const customerId = await stripeCustomerFor(user.id, user.email ?? "");

    const priceId =
      mode === "topup"
        ? topupPriceId()
        : isPlanKey(body.plan)
          ? priceIdFor(body.plan)
          : null;

    if (!priceId) {
      const envName =
        mode === "topup"
          ? "STRIPE_PRICE_TOPUP"
          : (isPlanKey(body.plan) && priceEnvFor(body.plan)) || "";

      return NextResponse.json(
        {
          success: false,
          error: envName
            ? (priceProblem(envName) ?? `${envName} is not usable.`)
            : "That plan does not exist.",
          code: "price_not_configured",
          env: envName || undefined,
        },
        { status: 400 }
      );
    }

    const session = await stripe().checkout.sessions.create({
      mode: mode === "topup" ? "payment" : "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_URL}/dashboard?checkout=done`,
      cancel_url: `${SITE_URL}/pricing?checkout=cancelled`,
      // Stripe Tax works out EU VAT from the address collected here, so we
      // never implement rate tables ourselves.
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      // Repeated on the session because a one-off payment has no subscription
      // object for the webhook to read the customer's metadata from.
      metadata: { supabase_user_id: user.id, kind: mode },
      ...(mode === "subscription"
        ? { subscription_data: { metadata: { supabase_user_id: user.id } } }
        : {}),
    });

    if (!session.url) {
      return NextResponse.json(
        { success: false, error: "Stripe did not return a checkout URL." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    console.error("checkout error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not start checkout.",
        code: "checkout_failed",
        ...errorDetail(error),
      },
      { status: 502 }
    );
  }
}
