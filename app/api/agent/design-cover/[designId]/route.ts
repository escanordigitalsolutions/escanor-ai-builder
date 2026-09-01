import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agent/design-cover/{designId} — the design's painted moodboard cover.
 *
 * Same access story as the thumbnail route: gated by the unguessable design
 * id, cached hard, busted by ?v={cover.version}. What a correct guess leaks is
 * an abstract painting.
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

  const cover = (design?.assets as { cover?: { image?: string; mime?: string } } | null)?.cover;

  if (!cover?.image) {
    return new NextResponse("This design has no cover.", { status: 404 });
  }

  return new NextResponse(Buffer.from(cover.image, "base64"), {
    status: 200,
    headers: {
      "Content-Type": cover.mime || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
