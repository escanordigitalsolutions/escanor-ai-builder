import { after } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { creditsFor } from "@/lib/billing/cost";
import { recordUsageDebit } from "@/lib/billing/credits";
import type { Usage } from "./provider";

/**
 * Operations accounting: one row per model call, written fire-and-forget into
 * public.ai_usage (project_id, stage, model, tokens). The dashboard's usage
 * panel aggregates it. Logging must never fail the request.
 */

export type UsageStage =
  | "editplan"
  | "concept"
  | "critique"
  | "design"
  | "inner"
  | "plan"
  | "content"
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

  // Charging happens after the model has run, because what a generation costs
  // is only knowable once it has. The gate in authenticateSiteRequest is what
  // stops an empty account from starting the next one.
  void chargeCredits(projectId, model, usage);
}

/**
 * Debit the project owner for one model call.
 *
 * Wrapped in after() so it survives the response being sent — a fire-and-forget
 * promise can be cut short when the function suspends, and a dropped debit is
 * free AI work.
 */
function chargeCredits(
  projectId: string,
  model: string,
  usage: Usage | { inputTokens?: number; outputTokens?: number } | null | undefined
): void {
  const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
  const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));
  const credits = creditsFor(model, input, output);

  if (!projectId || credits <= 0) {
    return;
  }

  const debit = async () => {
    try {
      const db = createServiceClient();

      const { data: project } = await db
        .from("projects")
        .select("owner_id")
        .eq("id", projectId)
        .maybeSingle();

      if (!project?.owner_id) return;

      await recordUsageDebit(String(project.owner_id), credits, projectId, model);
    } catch (error) {
      console.error("credit debit failed:", error);
    }
  };

  try {
    after(debit);
  } catch {
    // Outside a request context (a script, a test) after() is unavailable.
    void debit();
  }
}
