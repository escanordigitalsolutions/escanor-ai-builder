import { after } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { creditsFor } from "@/lib/billing/cost";
import { recordUsageDebit, usageRef } from "@/lib/billing/credits";
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
  meta?: Record<string, unknown>,
  /**
   * The background job this call belongs to, when there is one.
   *
   * It becomes the ledger row's ref, which is what makes a refund possible: a
   * run that charges four times and then dies can only be made whole if the
   * four rows can be found again. Without it every row for a project shares one
   * ref and no single failure can be unwound.
   */
  jobId?: string
): void {
  const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
  const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));

  if (!projectId || (!input && !output)) {
    return;
  }

  const work = () => recordUsage(projectId, stage, model, usage, meta, jobId);

  try {
    after(work);
  } catch {
    // Outside a request context (a script, a test) after() is unavailable.
    void work();
  }
}

/**
 * The same accounting, but awaitable.
 *
 * logUsage defers this into after(), which is right for a request handler: the
 * caller must not wait for a ledger write before answering. It is wrong inside
 * a background job that may later have to REFUND what it charged — the refund
 * sums the ledger rows for the job, and a debit still sitting in a deferred
 * callback is a debit the refund cannot see. That produced a refund smaller
 * than the charge, and because the ledger allows only one refund per job, the
 * shortfall could never be corrected afterwards.
 *
 * So any code path that can end in a refund awaits this instead.
 */
export async function recordUsage(
  projectId: string,
  stage: UsageStage,
  model: string,
  usage: Usage | { inputTokens?: number; outputTokens?: number } | null | undefined,
  meta?: Record<string, unknown>,
  jobId?: string
): Promise<void> {
  const input = Math.max(0, Math.round(usage?.inputTokens ?? 0));
  const output = Math.max(0, Math.round(usage?.outputTokens ?? 0));

  if (!projectId || (!input && !output)) return;

  // The job id rides along in meta as well as on the ledger row, so the
  // operations log can be read back per generation rather than per project.
  const withJob = jobId ? { ...(meta ?? {}), jobId } : meta;

  await Promise.allSettled([
    writeUsageRow(projectId, stage, model, input, output, withJob),
    chargeCredits(projectId, model, input, output, jobId),
  ]);
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
  output: number,
  jobId?: string
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

    await recordUsageDebit(
      String(project.owner_id),
      credits,
      jobId ? usageRef(jobId) : projectId,
      model
    );
  } catch (error) {
    console.error("credit debit failed:", error);
  }
}
