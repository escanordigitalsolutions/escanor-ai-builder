import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";

/**
 * Live agent steps for the wp-admin editor (v3A, site-key auth).
 *
 * The editor polls this during a chat request to show what the AI is doing
 * ("Listing theme files…", "Reading header.php…") before the final answer
 * lands. Steps are scoped to the caller's project and a client-supplied runId.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const url = new URL(request.url);
  const runId = (url.searchParams.get("runId") ?? "").trim();

  if (!runId) {
    return NextResponse.json({ success: true, steps: [] });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("ai_live_steps")
    .select("seq, label, created_at")
    .eq("project_id", auth.context.projectId)
    .eq("run_id", runId)
    .order("seq", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ success: true, steps: [] });
  }

  return NextResponse.json({
    success: true,
    steps: (data ?? []).map((row) => ({
      seq: row.seq,
      label: row.label,
    })),
  });
}
