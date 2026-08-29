import { createServiceClient } from "@/lib/supabase/service";
import type { Usage } from "./provider";

/**
 * Operations accounting: one row per model call, written fire-and-forget into
 * public.ai_usage (project_id, stage, model, tokens). The dashboard's usage
 * panel aggregates it. Logging must never fail the request.
 */

export type UsageStage =
  | "concept"
  | "critique"
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
  usage: Usage | { inputTokens?: number; outputTokens?: number } | null | undefined,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
    const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));
    if (!projectId || (!input && !output)) {
      return;
    }
    const db = createServiceClient();
    const row: Record<string, unknown> = {
      project_id: projectId,
      stage,
      model,
      input_tokens: input,
      output_tokens: output,
    };
    if (meta && Object.keys(meta).length) {
      // Debug detail for the operations log. If the meta column has not been
      // added yet the insert fails — retry without it so accounting survives.
      const withMeta = await db.from("ai_usage").insert({ ...row, meta });
      if (withMeta.error) {
        await db.from("ai_usage").insert(row);
      }
      return;
    }
    await db.from("ai_usage").insert(row);
  } catch (error) {
    console.error("usage log error:", error);
  }
}
