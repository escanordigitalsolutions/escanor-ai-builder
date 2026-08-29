import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildUsageReport } from "@/lib/ai/usage-report";

/**
 * Dashboard: the prices-debug usage report for one project. Ownership is
 * checked with the signed-in user's client (RLS on projects); aggregation
 * happens in lib/ai/usage-report with the service client.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (error || !project) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  const report = await buildUsageReport(id);

  if ("error" in report) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Could not load usage: " +
          report.error +
          " — run the ai_usage setup SQL (and grants) in the Supabase project Vercel uses.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...report });
}
