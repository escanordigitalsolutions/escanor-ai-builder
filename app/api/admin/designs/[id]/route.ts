import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { errorDetail } from "@/lib/debug";
import {
  availablePages,
  colorwayCss,
  pickPage,
  resolvePage,
} from "@/lib/agent/design-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One archived design in full — the markup, and what it was asked to be. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const { id } = await params;
  const which = resolvePage(request.nextUrl.searchParams.get("which"));

  try {
    const { data, error } = await createServiceClient()
      .from("ai_designs")
      .select("id, html, inner_html, pages, direction, validation, critique, concept, created_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      which,
      html: pickPage(data, which),
      available: availablePages(data),
      colorways: colorwayCss(data.direction),
      concept: data.concept,
      critique: data.critique,
      direction: data.direction,
      validation: data.validation,
      createdAt: data.created_at,
    });
  } catch (error) {
    console.error("admin design read error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Could not load the design.",
        code: "admin_design_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
