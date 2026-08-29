import { createServiceClient } from "@/lib/supabase/service";
import { parsePricing, priceFor, type ModelPricing } from "./pricing";

/**
 * The prices-debug usage report: every aggregate carries the exact rates used
 * (USD per 1M tokens) and the computed cost, so the dashboard doubles as a
 * price audit. Shared by the dashboard route (user-session) and the
 * agent/usage route (site-key, for the WordPress plugin's Dashboard page).
 */

type Row = {
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
};

export type ModelReportRow = {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  rateIn: number | null;
  rateOut: number | null;
  costUsd: number | null;
};

export type StageReportRow = {
  stage: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type UsageReport = {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costComplete: boolean;
  };
  byModel: ModelReportRow[];
  byStage: StageReportRow[];
  lastCallAt: string | null;
};

function rowCost(row: Row, price: ModelPricing | null): number | null {
  if (!price) {
    return null;
  }
  return (
    (row.input_tokens / 1_000_000) * price.in +
    (row.output_tokens / 1_000_000) * price.out
  );
}

export async function buildUsageReport(
  projectId: string
): Promise<UsageReport | { error: string }> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("ai_usage")
    .select("stage, model, input_tokens, output_tokens, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return { error: error.message };
  }

  const rows = (data ?? []) as Row[];
  const pricing = parsePricing(process.env.OPENAI_PRICING);

  const byModel = new Map<string, ModelReportRow>();
  const byStage = new Map<string, StageReportRow>();
  const totals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costComplete: true,
  };

  for (const row of rows) {
    const price = priceFor(row.model, pricing);
    const cost = rowCost(row, price);

    totals.calls += 1;
    totals.inputTokens += row.input_tokens;
    totals.outputTokens += row.output_tokens;
    if (cost == null) {
      totals.costComplete = false;
    } else {
      totals.costUsd += cost;
    }

    const m = byModel.get(row.model) ?? {
      model: row.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      rateIn: price?.in ?? null,
      rateOut: price?.out ?? null,
      costUsd: price ? 0 : null,
    };
    m.calls += 1;
    m.inputTokens += row.input_tokens;
    m.outputTokens += row.output_tokens;
    if (cost != null && m.costUsd != null) {
      m.costUsd += cost;
    }
    byModel.set(row.model, m);

    const st = byStage.get(row.stage) ?? {
      stage: row.stage,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0 as number | null,
    };
    st.calls += 1;
    st.inputTokens += row.input_tokens;
    st.outputTokens += row.output_tokens;
    st.costUsd = cost == null ? null : st.costUsd == null ? null : st.costUsd + cost;
    byStage.set(row.stage, st);
  }

  const round = (n: number | null) =>
    n == null ? null : Math.round(n * 10000) / 10000;

  return {
    totals: { ...totals, costUsd: Math.round(totals.costUsd * 10000) / 10000 },
    byModel: [...byModel.values()]
      .map((m) => ({ ...m, costUsd: round(m.costUsd) }))
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)),
    byStage: [...byStage.values()]
      .map((s) => ({ ...s, costUsd: round(s.costUsd) }))
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)),
    lastCallAt: rows[0]?.created_at ?? null,
  };
}
