import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { isPlanKey } from "@/lib/billing/plans";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Stripe's own vocabulary, so a comped row reads like a real one. */
const STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
]);

/**
 * Set an account's plan by hand.
 *
 * For comped accounts, testing and support — not for anything Stripe is
 * already managing. A row created here is marked with a `manual:` subscription
 * id so both this interface and a future reader can tell the difference, and
 * so removing it later cannot delete a real Stripe link by accident.
 *
 * Stripe stays the source of truth: if a webhook later arrives for this user,
 * it overwrites whatever is set here. That is the correct precedence, and the
 * interface says so.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json(
      { success: false, error: admin.error },
      { status: admin.status }
    );
  }

  const { id: userId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const plan = body.plan;
  const status = typeof body.status === "string" ? body.status : "active";

  try {
    const db = createServiceClient();

    const { data: existing } = await db
      .from("subscriptions")
      .select("id, stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    const isManual = Boolean(
      existing?.stripe_subscription_id?.startsWith("manual:")
    );

    // Back to free means removing the entitlement — but only ever one we
    // created. A real Stripe subscription is cancelled in Stripe, not here.
    if (plan === "free" || plan === null) {
      if (!existing) {
        return NextResponse.json({ success: true, plan: "free" });
      }

      if (!isManual) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This subscription belongs to Stripe. Cancel it in Stripe — removing the row here would only hide it.",
            code: "stripe_managed",
          },
          { status: 409 }
        );
      }

      const { error } = await db.from("subscriptions").delete().eq("id", existing.id);
      if (error) throw error;

      return NextResponse.json({ success: true, plan: "free" });
    }

    if (!isPlanKey(plan) || plan === "free") {
      return NextResponse.json(
        { success: false, error: "Unknown plan." },
        { status: 400 }
      );
    }

    if (!STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: "Unknown status." },
        { status: 400 }
      );
    }

    if (existing && !isManual) {
      // Changing the plan of a live Stripe subscription here would desync the
      // two systems until the next webhook silently undid it.
      return NextResponse.json(
        {
          success: false,
          error:
            "This account is on a real Stripe subscription. Change the plan in Stripe so billing follows it.",
          code: "stripe_managed",
        },
        { status: 409 }
      );
    }

    const row = {
      user_id: userId,
      stripe_customer_id: `manual:${userId}`,
      stripe_subscription_id: `manual:${userId}`,
      stripe_price_id: `manual:${plan}`,
      plan_key: plan,
      status,
      // A comped plan has no billing period; give it a year so anything
      // reading current_period_end does not treat it as lapsed.
      current_period_end: new Date(
        Date.now() + 365 * 24 * 3600 * 1000
      ).toISOString(),
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await db
      .from("subscriptions")
      .upsert(row, { onConflict: "user_id" });

    if (error) throw error;

    return NextResponse.json({ success: true, plan, status, manual: true });
  } catch (error) {
    console.error("admin subscription error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not change the plan.",
        code: "admin_subscription_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
