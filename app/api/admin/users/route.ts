import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every account, with its credits, plan and site count. Admins only. */
export async function GET() {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json(
      { success: false, error: admin.error },
      { status: admin.status }
    );
  }

  try {
    const { data, error } = await createServiceClient().rpc("admin_user_overview");

    if (error) throw error;

    return NextResponse.json({ success: true, users: data ?? [] });
  } catch (error) {
    console.error("admin users error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not load accounts.",
        code: "admin_users_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
