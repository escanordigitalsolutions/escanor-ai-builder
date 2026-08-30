import { createServiceClient } from "@/lib/supabase/service";

/**
 * What every recent generation actually did.
 *
 * Built because answering "why did that theme fail" required reading Vercel's
 * logs, and reading those requires a browser session nobody else has. The facts
 * that matter are already in the database — the job's last stage, its error, how
 * long it ran, what it charged and whether that was given back — they were just
 * never shown anywhere.
 *
 * This is the operations screen the launch checklist called error monitoring.
 * It does not replace Vercel's logs for a crash inside the platform, but it
 * answers the question that actually comes up: this run, what happened.
 */

export type AdminJobUsage = {
  stage: string;
  model: string;
  ms: number | null;
  inputTokens: number;
  outputTokens: number;
};

export type AdminJobRow = {
  id: string;
  kind: string;
  status: string;
  stage: string;
  note: string;
  error: string;
  project: string;
  owner: string;
  createdAt: string;
  seconds: number | null;
  charged: number;
  refunded: number;
  hasResult: boolean;
  usage: AdminJobUsage[];
};

export async function loadJobLog(limit = 40): Promise<AdminJobRow[]> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("ai_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));

  if (error) throw error;

  const jobs = (data ?? []) as unknown as Record<string, unknown>[];

  if (!jobs.length) return [];

  const jobIds = jobs.map((j) => String(j.id));
  const projectIds = [...new Set(jobs.map((j) => String(j.project_id)).filter(Boolean))];
  const oldest = jobs[jobs.length - 1]?.created_at as string | undefined;

  const [projectsRes, ledgerRes, usageRes] = await Promise.all([
    projectIds.length
      ? db.from("projects").select("id, name, owner_id").in("id", projectIds)
      : Promise.resolve({ data: [] }),

    // Job-scoped since the refund work: every charge carries ref = job:<id>.
    db
      .from("credit_ledger")
      .select("ref, delta, reason")
      .in("ref", jobIds.map((id) => `job:${id}`)),

    // ai_usage has no job column, so the window is bounded by the oldest job on
    // screen and the rows are matched on meta->>jobId in memory. Cheap enough
    // for an operator screen, and exact.
    oldest
      ? db
          .from("ai_usage")
          .select("stage, model, input_tokens, output_tokens, meta, created_at")
          .gte("created_at", oldest)
          .order("created_at", { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [] }),
  ]);

  const projects = (projectsRes.data ?? []) as unknown as Record<string, unknown>[];
  const ledger = (ledgerRes.data ?? []) as unknown as Record<string, unknown>[];
  const usageRows = (usageRes.data ?? []) as unknown as Record<string, unknown>[];

  const ownerIds = [...new Set(projects.map((p) => String(p.owner_id)).filter(Boolean))];

  const { data: ownerRows } = ownerIds.length
    ? await db.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] };

  const owners = (ownerRows ?? []) as unknown as Record<string, unknown>[];

  const projectById = new Map(projects.map((p) => [String(p.id), p]));
  const emailById = new Map(owners.map((o) => [String(o.id), String(o.email ?? "")]));

  const money = new Map<string, { charged: number; refunded: number }>();

  for (const row of ledger) {
    const jobId = String(row.ref ?? "").replace(/^job:/, "");
    const delta = Number(row.delta ?? 0);
    const entry = money.get(jobId) ?? { charged: 0, refunded: 0 };

    if (delta < 0) entry.charged += Math.abs(delta);
    else entry.refunded += delta;

    money.set(jobId, entry);
  }

  const usageByJob = new Map<string, AdminJobUsage[]>();

  for (const row of usageRows) {
    const meta = (row.meta ?? null) as Record<string, unknown> | null;
    const jobId = typeof meta?.jobId === "string" ? meta.jobId : "";

    if (!jobId) continue;

    const list = usageByJob.get(jobId) ?? [];

    list.push({
      stage: String(row.stage ?? ""),
      model: String(row.model ?? ""),
      ms: typeof meta?.ms === "number" ? meta.ms : null,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
    });

    usageByJob.set(jobId, list);
  }

  return jobs.map((job) => {
    const id = String(job.id);
    const project = projectById.get(String(job.project_id));
    const result = (job.result ?? null) as Record<string, unknown> | null;
    const progress = (result?.progress ?? null) as Record<string, unknown> | null;
    const spent = money.get(id) ?? { charged: 0, refunded: 0 };

    const started = Date.parse(String(job.created_at ?? ""));
    const ended = Date.parse(String(job.updated_at ?? job.created_at ?? ""));

    return {
      id,
      kind: String(job.kind ?? ""),
      status: String(job.status ?? ""),
      // The last stage a running job reached is the single most useful fact
      // about a generation that died: it says where, not just that.
      stage: String(progress?.stage ?? (result?.success ? "finished" : "")),
      note: String(progress?.note ?? ""),
      error: String(job.error ?? ""),
      project: String(project?.name ?? "(deleted site)"),
      owner: project ? (emailById.get(String(project.owner_id)) ?? "") : "",
      createdAt: String(job.created_at ?? ""),
      seconds:
        Number.isFinite(started) && Number.isFinite(ended) && ended >= started
          ? Math.round((ended - started) / 1000)
          : null,
      charged: round4(spent.charged),
      refunded: round4(spent.refunded),
      hasResult: result?.success === true,
      usage: usageByJob.get(id) ?? [],
    };
  });
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
