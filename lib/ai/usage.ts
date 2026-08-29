import { createServiceClient } from "@/lib/supabase/service";
import type { Usage } from "./provider";

/**
 * Operations accounting: one row per model call, written fire-and-forget into
 * public.ai_usage (project_id, stage, model, tokens). The dashboard's usage
 * panel aggregates it. Logging must never fail the request.
 */

export type UsageStage =
  | "design"
  | "plan"
  | "build"
  | "edit"
  | "chat"
  | "review";

export async function logUsage(
  projectId: string,
  stage: UsageStage,
  model: string,
  usage: Usage | { inputTokens?: number; outputTokens?: number } | null | undefined
): Promise<void> {
  try {
    const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
    const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));
    if (!projectId || (!input && !output)) {
      return;
    }
    await createServiceClient().from("ai_usage").insert({
      project_id: projectId,
      stage,
      model,
      input_tokens: input,
      output_tokens: output,
    });
  } catch (error) {
    console.error("usage log error:", error);
  }
}
