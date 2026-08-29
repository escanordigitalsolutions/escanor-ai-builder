import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { priceFor, parsePricing } from "@/lib/ai/pricing";

/**
 * Dashboard: the operations log — every AI call with its debug meta (chat
 * message, edit instruction, inspected/changed files, design style, concept…).
 * Ownership is checked with the signed-in user's client (RLS); rows are read
 * with the service client.
 */

export async function GET(
  request: Request,
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

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));

  const db = createServiceClient();
  const { data: rows, error: opsError } = await db
    .from("ai_usage")
    .select("id, created_at, stage, model, input_tokens, output_tokens, meta")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opsError) {
    const missingMeta = /meta/i.test(opsError.message ?? "");
    return NextResponse.json(
      {
        success: false,
        error: missingMeta
          ? "The ai_usage.meta column is missing — run: alter table public.ai_usage add column if not exists meta jsonb;"
          : "Could not load operations: " + opsError.message,
      },
      { status: 500 }
    );
  }

  const pricing = parsePricing(process.env.OPENAI_PRICING);
  const ops = (rows ?? []).map((r) => {
    const price = priceFor(r.model as string, pricing);
    const cost = price
      ? ((r.input_tokens as number) / 1_000_000) * price.in +
        ((r.output_tokens as number) / 1_000_000) * price.out
      : null;
    return {
      id: r.id,
      at: r.created_at,
      stage: r.stage,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: cost,
      meta: r.meta ?? null,
    };
  });

  return NextResponse.json({ success: true, ops });
}
