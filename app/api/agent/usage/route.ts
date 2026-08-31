import { NextRequest, NextResponse } from "next/server";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { buildCreditReport } from "@/lib/ai/credit-report";

/**
 * WordPress -> SaaS : the usage summary shown on the plugin's Dashboard.
 *
 * Credits only. This endpoint used to answer with model names, the rate paid
 * per million tokens and the dollar cost of every call — to the browser of the
 * person being billed in credits. Hiding those columns in the plugin would not
 * have been a fix: the numbers still travelled, one devtools panel away.
 */

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const report = await buildCreditReport(auth.context.projectId);

  if ("error" in report) {
    return NextResponse.json(
      { success: false, error: "Could not load usage: " + report.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...report });
}
