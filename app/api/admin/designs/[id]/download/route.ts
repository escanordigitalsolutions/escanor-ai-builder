import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/security/admin";
import { errorDetail } from "@/lib/debug";
import { createZip } from "@/lib/zip";
import {
  buildDesignPack,
  packFileName,
  type DesignRecord,
} from "@/lib/admin/design-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One archived design, as a folder you can open.
 *
 * The archive page can show a design but not hand it over, and a screenshot is
 * not something you can measure, diff or send to anybody. This packs every
 * screen, every alternative colourway and the direction that produced them into
 * a zip: enough to judge a design away from the tool that made it, and enough
 * to compare two runs a week apart.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const { id } = await params;

  try {
    const { data, error } = await createServiceClient()
      .from("ai_designs")
      .select(
        "id, created_at, html, inner_html, pages, direction, validation, critique, concept, shape, brief, model, project_id"
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
    }

    const design = data as unknown as DesignRecord;
    const entries = buildDesignPack(design);

    if (entries.length === 0) {
      return NextResponse.json(
        { success: false, error: "That design has no screens to download." },
        { status: 404 }
      );
    }

    const zip = createZip(entries, new Date(design.created_at));
    const name = packFileName(design);

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("admin design download error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not build the design pack.",
        code: "admin_design_download_failed",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
