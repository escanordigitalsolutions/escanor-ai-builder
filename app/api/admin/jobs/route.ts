import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/security/admin";
import { loadJobLog } from "@/lib/admin/jobs";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent generations and what happened to them. Admins only. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "40", 10) || 40;

  try {
    return NextResponse.json({ success: true, jobs: await loadJobLog(limit) });
  } catch (error) {
    console.error("admin jobs error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not load the job log.",
        code: "admin_jobs_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
