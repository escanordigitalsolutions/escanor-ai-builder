import { after } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { creditsFor } from "@/lib/billing/cost";
import { recordUsageDebit } from "@/lib/billing/credits";
import type { Usage } from "./provider";

/**
 * Operations accounting and billing for one model call.
 *
 * Both halves are registered with after() the moment this is called, before
 * anything is awaited. That ordering is the whole point: callers invoke this
 * without awaiting it, so a version that awaited its way to the charge could
 * be cut short when the response was sent — and an unrecorded charge is free
 * AI work.
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

export function logUsage(
  projectId: string,
  stage: UsageStage,
  model: string,
  usage: Usage | { inputTokens?: number; outputTokens?: number } | null | undefined,
  meta?: Record<string, unknown>
): void {
  const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
  const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));

  if (!projectId || (!input && !output)) {
    return;
  }

  const work = async () => {
    await Promise.allSettled([
      writeUsageRow(projectId, stage, model, input, output, meta),
      chargeCredits(projectId, model, input, output),
    ]);
  };

  try {
    after(work);
  } catch {
    // Outside a request context (a script, a test) after() is unavailable.
    void work();
  }
}

async function writeUsageRow(
  projectId: string,
  stage: UsageStage,
  model: string,
  input: number,
  output: number,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
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

/**
 * Debit the project owner for what this call actually cost.
 *
 * The amount is fractional on purpose. A chat message costs about a third of
 * a credit and a file write about a fifth; rounding each one to the nearest
 * whole number charged nothing for either, which made conversation free and
 * lost roughly an eighth of the price of a full build. The ledger carries the
 * fraction and the interface rounds only for display.
 */
async function chargeCredits(
  projectId: string,
  model: string,
  input: number,
  output: number
): Promise<void> {
  const credits = creditsFor(model, input, output);

  if (credits <= 0) {
    return;
  }

  try {
    const db = createServiceClient();

    const { data: project } = await db
      .from("projects")
      .select("owner_id")
      .eq("id", projectId)
      .maybeSingle();

    if (!project?.owner_id) {
      return;
    }

    await recordUsageDebit(String(project.owner_id), credits, projectId, model);
  } catch (error) {
    console.error("credit debit failed:", error);
  }
}
