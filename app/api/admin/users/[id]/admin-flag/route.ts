import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Grant or remove admin rights.
 *
 * Worth having here rather than in the SQL editor, since it was needed on day
 * one and will be needed again. Two guards: only an admin may call it, and
 * nobody may remove their own flag — locking the last operator out of the
 * admin area would otherwise take one careless click and a database session
 * to undo.
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

  const isAdmin = Boolean(body.isAdmin);

  if (userId === admin.userId && !isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "You cannot remove your own admin rights.",
        code: "self_demotion",
      },
      { status: 400 }
    );
  }

  try {
    const { error } = await createServiceClient()
      .from("profiles")
      .update({ is_admin: isAdmin, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) throw error;

    return NextResponse.json({ success: true, isAdmin });
  } catch (error) {
    console.error("admin flag error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not change admin rights.",
        code: "admin_flag_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
