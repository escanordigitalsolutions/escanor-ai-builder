import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/security/admin";
import { loadDesignArchive } from "@/lib/admin/designs";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The design archive, for anything that needs it over HTTP. Admins only. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "60", 10) || 60;

  try {
    return NextResponse.json({ success: true, designs: await loadDesignArchive(limit) });
  } catch (error) {
    console.error("admin designs error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not load the design archive.",
        code: "admin_designs_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
