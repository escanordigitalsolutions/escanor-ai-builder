import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { renderThumbnail } from "@/lib/agent/thumbnail";

/**
 * GET /api/agent/design-thumb/{designId} — the design's preview picture.
 *
 * Public on purpose: wp-admin puts this URL straight into an <img> tag, and an
 * image request from a browser carries no project key. What gates access is the
 * design id itself — a v4 UUID, unguessable, shown only to the site that owns
 * the design — and what leaks on a correct guess is a screenshot of a homepage
 * that was generated to be published. The row's key and content stay behind
 * the authenticated routes.
 *
 * Cached hard, busted by version: the wp-admin URL carries ?v={thumb.version},
 * which changes only when the picture is re-rendered — so a design edit shows
 * its new face immediately while everything else is served from cache.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rendering on a miss takes seconds, so this function needs the room the
// design job has, not an API route's default.
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ designId: string }> }
) {
  const { designId } = await params;

  if (!UUID.test(designId ?? "")) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const db = createServiceClient();

  const { data: design } = await db
    .from("ai_designs")
    .select("html, assets")
    .eq("id", designId)
    .single();

  if (!design) {
    return new NextResponse("Not found.", { status: 404 });
  }

  let thumb = (design.assets as { thumb?: { jpeg?: string } } | null)?.thumb;

  // A design made before thumbnails existed gets its picture the first time
  // anything asks for it — once, then stored, then immutable like the rest.
  // This is what backfills the archive: the dashboard requesting its own
  // images IS the backfill, sixty lazy renders instead of a migration.
  if (!thumb?.jpeg && typeof design.html === "string" && design.html.length > 0) {
    const rendered = await renderThumbnail(design.html);

    if (rendered) {
      await db
        .from("ai_designs")
        .update({ assets: { ...((design.assets ?? {}) as object), thumb: rendered } })
        .eq("id", designId);

      thumb = rendered;
    }
  }

  if (!thumb?.jpeg) {
    return new NextResponse("This design has no preview picture.", { status: 404 });
  }

  return new NextResponse(Buffer.from(thumb.jpeg, "base64"), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
