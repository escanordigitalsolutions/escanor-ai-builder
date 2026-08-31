import { createServiceClient } from "@/lib/supabase/service";
import { creditsFor } from "@/lib/billing/cost";

/**
 * What a customer is allowed to see about their own usage.
 *
 * The previous report sent model names, the rate paid per million tokens, and
 * the dollar cost of every call — straight into the browser of the person being
 * billed in credits. Anyone who opened that page could read the margin off it.
 * That was an operations report shown to the wrong audience.
 *
 * This one is denominated only in credits, the unit they actually buy, and
 * grouped by what the work was for rather than by which model did it. Nothing
 * here lets a price be reconstructed: credits are computed with the same
 * function that charged the ledger, so the numbers agree with the balance
 * without exposing what produced them.
 */

/** Which stages belong to which piece of work, in the customer's language. */
const ACTIVITY: { key: string; label: string; stages: string[] }[] = [
  {
    key: "design",
    label: "Designing",
    stages: ["concept", "design", "critique", "inner"],
  },
  {
    key: "build",
    label: "Building the theme",
    stages: ["plan", "build", "content", "review"],
  },
  { key: "edit", label: "Edits", stages: ["editplan", "edit"] },
  { key: "chat", label: "Conversation", stages: ["chat"] },
];

const STAGE_ACTIVITY = new Map<string, { key: string; label: string }>();

for (const activity of ACTIVITY) {
  for (const stage of activity.stages) {
    STAGE_ACTIVITY.set(stage, { key: activity.key, label: activity.label });
  }
}

export type CreditActivity = {
  key: string;
  label: string;
  credits: number;
  runs: number;
};

export type CreditReport = {
  totalCredits: number;
  activities: CreditActivity[];
  designs: number;
  lastAt: string | null;
};

export async function buildCreditReport(
  projectId: string
): Promise<CreditReport | { error: string }> {
  const { data, error } = await createServiceClient()
    .from("ai_usage")
    .select("stage, model, input_tokens, output_tokens, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return { error: error.message };
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const totals = new Map<string, CreditActivity>();

  let totalCredits = 0;
  let designs = 0;

  for (const row of rows) {
    const stage = String(row.stage ?? "");
    const credits = creditsFor(
      String(row.model ?? ""),
      Number(row.input_tokens ?? 0),
      Number(row.output_tokens ?? 0)
    );

    totalCredits += credits;

    if (stage === "design") designs += 1;

    // An unrecognised stage is grouped under the work it most likely belongs
    // to rather than dropped: a total that does not match the balance is worse
    // than a slightly coarse label.
    const activity = STAGE_ACTIVITY.get(stage) ?? { key: "other", label: "Other work" };
    const entry = totals.get(activity.key) ?? { ...activity, credits: 0, runs: 0 };

    entry.credits += credits;
    entry.runs += 1;
    totals.set(activity.key, entry);
  }

  const activities = [...totals.values()]
    .map((row) => ({ ...row, credits: round(row.credits) }))
    .filter((row) => row.credits > 0)
    .sort((a, b) => b.credits - a.credits);

  return {
    totalCredits: round(totalCredits),
    activities,
    designs,
    lastAt: rows.length ? String(rows[0].created_at ?? "") || null : null,
  };
}

function round(credits: number): number {
  return credits >= 10 ? Math.round(credits) : Math.round(credits * 10) / 10;
}
