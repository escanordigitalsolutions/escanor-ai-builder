import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { estimateCost, parsePricing, type ModelUsage } from "@/lib/ai/pricing";

/**
 * Dashboard: aggregated AI operations for one project — every model call from
 * every stage (design, plan, build, edit, chat, review), logged by lib/ai/usage
 * into public.ai_usage. Ownership is checked with the signed-in user's client
 * (RLS on projects); the usage rows are then read with the service client.
 */

type Row = {
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

type Bucket = { calls: number; inputTokens: number; outputTokens: number };

function bump(map: Record<string, Bucket>, key: string, row: Row): void {
  const b = (map[key] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
  b.calls += 1;
  b.inputTokens += row.input_tokens;
  b.outputTokens += row.output_tokens;
}

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
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  // RLS scopes this select to projects the signed-in user owns.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { success: false, error: "Project not found." },
      { status: 404 }
    );
  }

  const service = createServiceClient();
  const { data: rows, error: usageError } = await service
    .from("ai_usage")
    .select("stage, model, input_tokens, output_tokens, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (usageError) {
    return NextResponse.json(
      {
        success: false,
        error: "Could not load usage: " + usageError.message + " — run the ai_usage setup SQL in the SAME Supabase project Vercel uses.",
      },
      { status: 500 }
    );
  }

  const totals: Bucket = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const byModel: Record<string, Bucket> = {};
  const byStage: Record<string, Bucket> = {};

  for (const row of (rows ?? []) as Row[]) {
    totals.calls += 1;
    totals.inputTokens += row.input_tokens;
    totals.outputTokens += row.output_tokens;
    bump(byModel, row.model, row);
    bump(byStage, row.stage, row);
  }

  const modelBreakdown: ModelUsage[] = Object.entries(byModel).map(
    ([model, b]) => ({
      model,
      runs: b.calls,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      totalTokens: b.inputTokens + b.outputTokens,
    })
  );

  const { estimatedCostUsd, costComplete } = estimateCost(
    modelBreakdown,
    parsePricing(process.env.OPENAI_PRICING)
  );

  return NextResponse.json({
    success: true,
    totals,
    byModel,
    byStage,
    estimatedCostUsd,
    costComplete,
    lastCallAt: ((rows ?? []) as Row[])[0]?.created_at ?? null,
  });
}
