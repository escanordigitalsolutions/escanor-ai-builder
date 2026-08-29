import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateBuildFiles } from "@/lib/agent/build-files-core";

// Long generations (a solo main.css/main.js on Claude can take 1-2+ minutes).
// Without this Vercel kills the function at the plan default and the WordPress
// side only ever sees a dead request — which looks like an endless retry.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : generate a BATCH of theme files in ONE synchronous call.
 *
 * This is the legacy/fallback path — the wizard prefers the async pair
 * (build-files-start + job-status) so no request in the chain has to stay open
 * for minutes. The generation core is shared: lib/agent/build-files-core.
 */

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const blueprint = body.blueprint;
  const rawPaths = Array.isArray(body.paths) ? (body.paths as unknown[]) : [];
  const paths = rawPaths
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 12);

  if (!blueprint || typeof blueprint !== "object") {
    return NextResponse.json(
      { success: false, error: "A blueprint is required." },
      { status: 400 }
    );
  }
  if (paths.length === 0) {
    return NextResponse.json(
      { success: false, error: "At least one path is required." },
      { status: 400 }
    );
  }

  let modelConfig: unknown = {};
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("projects")
      .select("model_config")
      .eq("id", auth.context.projectId)
      .single();
    modelConfig = data?.model_config ?? {};
  } catch {
    modelConfig = {};
  }

  try {
    const result = await generateBuildFiles(modelConfig, blueprint, paths);

    if (result.files.length > 0) {
      return NextResponse.json({
        success: true,
        files: result.files,
        truncated: result.truncated,
        usage: result.usage,
      });
    }

    return NextResponse.json(
      {
        success: false,
        usage: result.usage,
        error: result.truncated
          ? "This batch was too large to finish in one pass. Retrying with fewer files usually fixes it."
          : "The generator returned no files for this batch. Please try again.",
        truncated: result.truncated,
      },
      { status: 502 }
    );
  } catch (error) {
    console.error("build-files generate error:", error);
    return NextResponse.json(
      { success: false, error: "The file generator could not be reached. Try again." },
      { status: 502 }
    );
  }
}
