import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { refundJobUsage } from "@/lib/billing/credits";

/**
 * WordPress -> SaaS : poll a background job started by build-files-start.
 * Returns { status: "running" | "done" | "error", result?, error? }.
 * Scoped to the authenticated site's project.
 *
 * This endpoint is also where dead jobs are buried.
 *
 * The work runs inside after(), which Vercel kills the moment maxDuration is
 * reached — no catch block runs, no final row is written. The job simply stays
 * "running" forever, and the browser polls it until its own eight-minute
 * timeout and reports something misleading about the design step.
 *
 * A job older than any function is allowed to live cannot still be working, so
 * it is resolved here, on read, with no cron to maintain: if the row already
 * holds a finished result it is handed over, and if it does not, the job is
 * failed and its credits are given back.
 */

/**
 * How long each kind of job is allowed to live before it is certainly dead.
 *
 * Per kind rather than one number, because the design route runs at
 * maxDuration 800 while every other generating route runs at 300. A single
 * ceiling would either declare a live design job dead at five minutes, or
 * leave a failed build spinning for fourteen. Raising any route's maxDuration
 * above its entry here makes live jobs look dead, so these must move together.
 */
const DEAD_AFTER_MS: Record<string, number> = {
  mockup: 840_000,
};

const DEAD_AFTER_DEFAULT_MS = 330_000;

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

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

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: "A jobId is required." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data: job, error } = await supabase
    .from("ai_jobs")
    .select("id, kind, status, result, error, created_at")
    .eq("id", jobId)
    .eq("project_id", auth.context.projectId)
    .single();

  if (error || !job) {
    return NextResponse.json(
      { success: false, error: "Job not found." },
      { status: 404 }
    );
  }

  const result = (job.result ?? null) as Record<string, unknown> | null;

  if (job.status === "running" && certainlyDead(job.kind, job.created_at)) {
    // The row carries a finished artefact: the run got there and was killed
    // during a later, optional stage. Deliver what it produced.
    if (result?.success === true) {
      await supabase
        .from("ai_jobs")
        .update({ status: "done", error: null, updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .then(
          () => {},
          () => {}
        );

      return NextResponse.json({ success: true, status: "done", result, error: null });
    }

    // A design can exist even when the job row never recorded it, and charging
    // for delivered work is right while refunding it is not. Checked before the
    // refund rather than after, because the refund cannot be undone.
    const delivered = await designExistsFor(supabase, jobId);

    // Refund FIRST, then record the failure. Flipping the status first would
    // close the only branch that can reach this code, so a refund that failed
    // on a transient error could never be retried on a later poll.
    let refunded = 0;

    if (!delivered) {
      try {
        refunded = await refundJobUsage(jobId, "Refund: generation exceeded its time limit");
      } catch (refundError) {
        console.error("refund for stalled job failed:", refundError);
      }
    }

    const message =
      "The generation ran past its time limit and was stopped. " +
      (delivered
        ? "Its output was saved to your design archive."
        : refunded > 0
          ? `The ${round(refunded)} credits it used have been refunded — try again.`
          : "Try again.");

    await supabase
      .from("ai_jobs")
      .update({ status: "error", error: message, result: null, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(
        () => {},
        () => {}
      );

    return NextResponse.json({ success: true, status: "error", result: null, error: message });
  }

  return NextResponse.json({
    success: true,
    status: job.status,
    result,
    error: job.error ?? null,
  });
}

function certainlyDead(kind: unknown, createdAt: unknown): boolean {
  const started = Date.parse(String(createdAt ?? ""));

  if (!Number.isFinite(started)) return false;

  const limit = DEAD_AFTER_MS[String(kind ?? "")] ?? DEAD_AFTER_DEFAULT_MS;

  return Date.now() - started > limit;
}

/**
 * Did this job actually produce something before it died?
 *
 * The design routes stamp the job id into the archived design, so a run that
 * was killed after storing its work can be told apart from one that produced
 * nothing. Only the second kind is owed a refund.
 */
async function designExistsFor(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string
): Promise<boolean> {
  // The job_id COLUMN, not brief->>jobId. The v4F migration added the column and
  // an index for it; querying the json path instead left that index unused and
  // made this a sequential scan of every design in the system — on a lookup that
  // runs inside a request handler, for every poll of a stalled job.
  const { data, error } = await supabase
    .from("ai_designs")
    .select("id")
    .eq("job_id", jobId)
    .limit(1);

  if (error) {
    // Unknown is treated as "nothing delivered": the person keeps their credits.
    console.error("design lookup for stalled job failed:", error.message);
    return false;
  }

  return Boolean(data && data.length);
}

function round(credits: number): string {
  return credits >= 1 ? String(Math.round(credits)) : credits.toFixed(2);
}
