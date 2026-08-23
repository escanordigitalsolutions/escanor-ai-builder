import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  estimateCost,
  parsePricing,
  type ModelUsage,
} from "@/lib/ai/pricing";

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

  const { data: conversations, error: conversationsError } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("project_id", id);

  if (conversationsError) {
    return NextResponse.json(
      { success: false, error: "Could not load AI usage." },
      { status: 500 }
    );
  }

  const conversationIds = (conversations ?? []).map(
    (conversation) => conversation.id
  );

  if (conversationIds.length === 0) {
    return NextResponse.json({
      success: true,
      usage: {
        conversations: 0,
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCalls: 0,
        lastRunAt: null,
        models: {},
        modelBreakdown: [],
        estimatedCostUsd: null,
        costComplete: true,
      },
    });
  }

  const { data: runs, error: runsError } = await supabase
    .from("ai_runs")
    .select(
      "model, input_tokens, output_tokens, total_tokens, tool_calls, created_at"
    )
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  if (runsError) {
    console.error("AI usage query error:", runsError);

    return NextResponse.json(
      { success: false, error: "Could not load AI usage." },
      { status: 500 }
    );
  }

  const perModel = new Map<string, ModelUsage>();

  const totals = (runs ?? []).reduce(
    (summary, run) => {
      const input = run.input_tokens ?? 0;
      const output = run.output_tokens ?? 0;
      const total = run.total_tokens ?? 0;

      summary.inputTokens += input;
      summary.outputTokens += output;
      summary.totalTokens += total;
      summary.toolCalls += run.tool_calls ?? 0;

      const model = run.model || "unknown";
      summary.models[model] = (summary.models[model] ?? 0) + 1;

      const bucket =
        perModel.get(model) ??
        {
          model,
          runs: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };

      bucket.runs += 1;
      bucket.inputTokens += input;
      bucket.outputTokens += output;
      bucket.totalTokens += total;

      perModel.set(model, bucket);

      return summary;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      toolCalls: 0,
      models: {} as Record<string, number>,
    }
  );

  const modelBreakdown = Array.from(perModel.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens
  );

  const { estimatedCostUsd, costComplete } = estimateCost(
    modelBreakdown,
    parsePricing(process.env.OPENAI_PRICING)
  );

  return NextResponse.json({
    success: true,
    usage: {
      conversations: conversationIds.length,
      runs: runs?.length ?? 0,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      toolCalls: totals.toolCalls,
      lastRunAt: runs?.[0]?.created_at ?? null,
      models: totals.models,
      modelBreakdown,
      estimatedCostUsd,
      costComplete,
    },
  });
}
