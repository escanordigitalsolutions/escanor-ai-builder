import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ designId: string }> }
) {
  const { designId } = await params;

  if (!UUID.test(designId ?? "")) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const { data: design } = await createServiceClient()
    .from("ai_designs")
    .select("assets")
    .eq("id", designId)
    .single();

  const thumb = (design?.assets as { thumb?: { jpeg?: string } } | null)?.thumb;

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
