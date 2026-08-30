import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripe, stripeConfigured, missingStripeConfig } from "@/lib/billing/stripe";
import { errorDetail } from "@/lib/debug";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

/**
 * Hand the customer to Stripe's own billing portal.
 *
 * Changing plan, updating a card, cancelling and downloading invoices all live
 * there. Rebuilding any of that ourselves would mean reimplementing proration,
 * dunning and tax receipts — Stripe already does it, correctly.
 */
export async function POST() {
  if (!stripeConfigured()) {
    const missing = missingStripeConfig();
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

  const db = createServiceClient();
  const { data: profile } = await db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customerId = profile?.stripe_customer_id;

  if (!customerId) {
    return NextResponse.json(
      { success: false, error: "There is nothing to manage yet — no purchase has been made." },
      { status: 400 }
    );
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: String(customerId),
      return_url: `${SITE_URL}/dashboard`,
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    console.error("portal error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not open the billing portal.",
        code: "portal_failed",
        ...errorDetail(error),
      },
      { status: 502 }
    );
  }
}
