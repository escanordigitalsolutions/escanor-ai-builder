import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { creditBalance } from "@/lib/billing/credits";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Adjust an account's credits by hand.
 *
 * Written as an ordinary ledger row rather than by moving a balance, because
 * there is no balance to move — a grant and a refund are the same operation
 * with opposite signs, and both stay visible in the account's history next to
 * the AI usage that spent them.
 *
 * No `ref` is set: an admin adjustment is a deliberate act that may legitimately
 * be repeated, so the one-grant-per-reference guard that protects Stripe
 * webhooks would be wrong here.
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

  const delta = Math.trunc(Number(body.delta));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

  if (!Number.isFinite(delta) || delta === 0) {
    return NextResponse.json(
      { success: false, error: "Enter a non-zero number of credits." },
      { status: 400 }
    );
  }

  if (Math.abs(delta) > 1_000_000) {
    return NextResponse.json(
      { success: false, error: "That is more than any account should need at once." },
      { status: 400 }
    );
  }

  try {
    const db = createServiceClient();

    const { data: target } = await db
      .from("profiles")
      .select("id, email")
      .eq("id", userId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json(
        { success: false, error: "No such account." },
        { status: 404 }
      );
    }

    const { error } = await db.from("credit_ledger").insert({
      user_id: userId,
      delta,
      reason: "admin",
      // Who did this, so the ledger answers "where did these come from".
      note: note ? `${note} — by ${admin.email}` : `Adjusted by ${admin.email}`,
    });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      balance: await creditBalance(userId),
    });
  } catch (error) {
    console.error("admin credit adjust error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not adjust credits.",
        code: "admin_credits_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
