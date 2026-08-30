import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { buildUsageReport } from "@/lib/ai/usage-report";

/** WordPress -> SaaS : the usage/prices report for the plugin's Dashboard. */

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const report = await buildUsageReport(auth.context.projectId);

  if ("error" in report) {
    return NextResponse.json(
      { success: false, error: "Could not load usage: " + report.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...report });
}
