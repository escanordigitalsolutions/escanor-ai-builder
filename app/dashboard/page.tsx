import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FAST_MODEL, SMART_MODEL } from "@/lib/ai/models";
import {
  parsePricing,
  estimateCost,
  type ModelUsage,
  type ModelPricing,
} from "@/lib/ai/pricing";
import {
  resolveModules,
  resolvePlan,
  type ModuleKey,
  type Modules,
} from "@/lib/entitlements";

type SiteRow = {
  site_url: string | null;
  bridge_version: string | null;
  wp_version: string | null;
  theme_name: string | null;
  plugin_name: string | null;
  last_connected_at: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  wordpress_sites: SiteRow | SiteRow[] | null;
};

type RunRow = {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
  conversation_id: string;
};

type PropRow = {
  project_id: string;
  title: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
};

type ConvRow = { id: string; project_id: string };

type LogEvent = {
  at: string;
  project: string;
  action: "Chat" | "Build";
  model: string;
  inTok: number;
  outTok: number;
  totalTok: number;
  label?: string;
};

const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projectsData } = await supabase
    .from("projects")
    .select(`
      id,
      name,
      created_at,
      wordpress_sites (
        site_url,
        bridge_version,
        wp_version,
        theme_name,
        plugin_name,
        last_connected_at
      )
    `)
    .order("created_at", { ascending: false });

  const projects = (projectsData ?? []) as unknown as ProjectRow[];
  const projectIds = projects.map((p) => p.id);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // --- module entitlements (defensive: column may not exist yet) ---
  const moduleMap = new Map<string, Modules>();
  const planMap = new Map<string, string>();

  if (projectIds.length > 0) {
    try {
      const { data: entData, error: entError } = await supabase
        .from("projects")
        .select("id, modules, plan")
        .in("id", projectIds);

      if (!entError && entData) {
        for (const row of entData as unknown as {
          id: string;
          modules: unknown;
          plan: unknown;
        }[]) {
          moduleMap.set(row.id, resolveModules(row.modules));
          planMap.set(row.id, resolvePlan(row.plan));
        }
      }
    } catch {
      // Migration pending — cards simply omit module chips.
    }
  }

  // --- usage: chat runs (ai_runs) + build proposals (ai_proposals) ---
  const convToProject = new Map<string, string>();
  const runs: RunRow[] = [];
  const proposals: PropRow[] = [];

  if (projectIds.length > 0) {
    const { data: convData } = await supabase
      .from("ai_conversations")
      .select("id, project_id")
      .in("project_id", projectIds);

    const conversations = (convData ?? []) as unknown as ConvRow[];
    for (const c of conversations) {
      convToProject.set(c.id, c.project_id);
    }
    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length > 0) {
      const { data: runData } = await supabase
        .from("ai_runs")
        .select(
          "model, input_tokens, output_tokens, total_tokens, created_at, conversation_id"
        )
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(500);
      runs.push(...((runData ?? []) as unknown as RunRow[]));
    }

    const { data: propData } = await supabase
      .from("ai_proposals")
      .select(
        "project_id, title, model, input_tokens, output_tokens, total_tokens, created_at"
      )
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(500);
    proposals.push(...((propData ?? []) as unknown as PropRow[]));
  }

  // --- aggregate ---
  const perModel = new Map<string, ModelUsage>();
  let inTot = 0;
  let outTot = 0;
  let totalTot = 0;

  const bump = (model: string, i: number, o: number, t: number) => {
    inTot += i;
    outTot += o;
    totalTot += t;
    const b =
      perModel.get(model) ??
      { model, runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    b.runs += 1;
    b.inputTokens += i;
    b.outputTokens += o;
    b.totalTokens += t;
    perModel.set(model, b);
  };

  const events: LogEvent[] = [];

  for (const r of runs) {
    const i = r.input_tokens ?? 0;
    const o = r.output_tokens ?? 0;
    const t = r.total_tokens ?? 0;
    const model = r.model || "unknown";
    bump(model, i, o, t);
    events.push({
      at: r.created_at,
      project: projectName.get(convToProject.get(r.conversation_id) ?? "") ?? "—",
      action: "Chat",
      model,
      inTok: i,
      outTok: o,
      totalTok: t,
    });
  }

  for (const p of proposals) {
    const i = p.input_tokens ?? 0;
    const o = p.output_tokens ?? 0;
    const t = p.total_tokens ?? 0;
    const model = p.model || "unknown";
    bump(model, i, o, t);
    events.push({
      at: p.created_at,
      project: projectName.get(p.project_id) ?? "—",
      action: "Build",
      model,
      inTok: i,
      outTok: o,
      totalTok: t,
      label: p.title ?? undefined,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const recentEvents = events.slice(0, 30);

  const pricing = parsePricing(process.env.OPENAI_PRICING);
  const modelBreakdown = Array.from(perModel.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens
  );
  const { estimatedCostUsd, costComplete } = estimateCost(modelBreakdown, pricing);

  const activeCount = projects.filter((p) => {
    const site = siteOf(p);
    return connectionAge(site?.last_connected_at) === "active";
  }).length;

  const totalActions = runs.length + proposals.length;

  return (
    <main className="min-h-screen bg-[#f5f6f7] text-neutral-900">
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-400">
              ESCANOR
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
              AI Builder
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
                {(user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[220px] truncate text-sm text-neutral-700">
                {user.email}
              </span>
            </div>
            <Link
              href="/dashboard/new"
              className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              + New project
            </Link>
          </div>
        </header>

        {/* Stat cards */}
        <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Projects"
            value={String(projects.length)}
            sub={`${activeCount} active now`}
          />
          <Stat
            label="Tokens used"
            value={compact(totalTot)}
            sub={`${compact(inTot)} in · ${compact(outTot)} out`}
          />
          <Stat
            label="Estimated spend"
            value={estimatedCostUsd === null ? "—" : formatCost(estimatedCostUsd)}
            sub={
              estimatedCostUsd === null
                ? "Set OPENAI_PRICING"
                : costComplete
                  ? "all-time, all models"
                  : "partial — some models unpriced"
            }
          />
          <Stat
            label="AI actions"
            value={compact(totalActions)}
            sub={`${runs.length} chats · ${proposals.length} builds`}
          />
        </section>

        {/* Pricing + account */}
        <section className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-900">
                Pricing &amp; models
              </h2>
              <span className="text-[11px] text-neutral-400">
                USD per 1M tokens
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <ModelLine
                role="Chat & inspection"
                model={FAST_MODEL}
                price={pricing[FAST_MODEL]}
              />
              <ModelLine
                role="Build & analysis"
                model={SMART_MODEL}
                price={pricing[SMART_MODEL]}
              />
              {Object.keys(pricing)
                .filter((m) => m !== FAST_MODEL && m !== SMART_MODEL)
                .map((m) => (
                  <ModelLine key={m} role="Other" model={m} price={pricing[m]} />
                ))}
            </div>

            {Object.keys(pricing).length === 0 && (
              <p className="mt-3 text-xs text-neutral-500">
                No prices configured. Set the{" "}
                <code className="text-neutral-700">OPENAI_PRICING</code> env var
                (JSON, USD per 1M tokens) to see live cost estimates.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-medium text-neutral-900">Account</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row k="Email" v={user.email ?? "—"} />
              <Row k="Member since" v={formatDate(user.created_at)} />
              <Row k="Projects" v={String(projects.length)} />
              <Row k="Account ID" v={(user.id ?? "").slice(0, 8) + "…"} mono />
            </dl>
          </div>
        </section>

        {/* Activity logs */}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-base font-medium text-neutral-900">Activity</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Tokens and estimated cost per action (chat &amp; build).
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="hidden grid-cols-[130px_1fr_90px_150px_120px_90px] gap-3 border-b border-neutral-200 px-5 py-3 text-[11px] uppercase tracking-wider text-neutral-400 md:grid">
              <span>When</span>
              <span>Project</span>
              <span>Action</span>
              <span>Model</span>
              <span className="text-right">Tokens</span>
              <span className="text-right">Cost</span>
            </div>

            {recentEvents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-neutral-500">
                No AI activity yet. Start a chat or build in a project.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {recentEvents.map((e, i) => {
                  const cost = eventCost(e.model, e.inTok, e.outTok, pricing);
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-2 gap-x-3 gap-y-1 px-5 py-3 text-sm md:grid-cols-[130px_1fr_90px_150px_120px_90px]"
                    >
                      <span className="text-neutral-400">{relTime(e.at)}</span>
                      <span className="truncate text-neutral-800">
                        {e.project}
                        {e.label ? (
                          <span className="text-neutral-400"> · {e.label}</span>
                        ) : null}
                      </span>
                      <span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] ${
                            e.action === "Build"
                              ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                              : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {e.action}
                        </span>
                      </span>
                      <span className="self-center truncate font-mono text-xs text-neutral-500">
                        {e.model}
                      </span>
                      <span className="self-center text-right tabular-nums text-neutral-800">
                        {compact(e.totalTok)}
                        <span className="hidden text-xs text-neutral-400 md:inline">
                          {" "}
                          ({compact(e.inTok)}/{compact(e.outTok)})
                        </span>
                      </span>
                      <span className="self-center text-right tabular-nums text-neutral-600">
                        {cost === null ? "—" : formatCost(cost)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Projects */}
        <section className="mt-10">
          <h2 className="text-base font-medium text-neutral-900">Projects</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Your connected WordPress websites.
          </p>

          {projects.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
              <p className="text-neutral-500">No projects yet.</p>
              <Link
                href="/dashboard/new"
                className="mt-5 inline-block rounded-xl border border-neutral-200 bg-white px-5 py-2.5 text-sm text-neutral-700 transition hover:bg-neutral-50"
              >
                Connect WordPress
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => {
                const site = siteOf(project);
                const state = connectionAge(site?.last_connected_at);
                return (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="group rounded-xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-neutral-400">
                          WordPress Project
                        </p>
                        <h3 className="mt-1.5 text-base font-medium text-neutral-900">
                          {project.name}
                        </h3>
                      </div>
                      <StatusBadge
                        state={state}
                        at={site?.last_connected_at ?? null}
                      />
                    </div>

                    <p className="mt-3 truncate text-sm text-neutral-500">
                      {site?.site_url ?? "No site connected"}
                      {planMap.get(project.id) ? (
                        <span className="text-neutral-400">
                          {" "}
                          · Plan {planMap.get(project.id)}
                        </span>
                      ) : null}
                    </p>

                    <ModuleChips modules={moduleMap.get(project.id)} />

                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4">
                      <Meta label="WordPress" value={site?.wp_version} />
                      <Meta label="Bridge" value={site?.bridge_version} />
                      <Meta label="Theme" value={site?.theme_name} />
                      <Meta label="Plugin" value={site?.plugin_name ?? "None"} />
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <span className="text-xs text-neutral-400">
                        Open workspace
                      </span>
                      <span className="text-neutral-400 transition group-hover:text-neutral-900">
                        →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <footer className="mt-12 pb-6 text-center text-[11px] text-neutral-400">
          ESCANOR AI Builder · usage estimates are indicative and based on
          configured pricing.
        </footer>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function siteOf(project: ProjectRow): SiteRow | undefined {
  const s = project.wordpress_sites;
  return Array.isArray(s) ? s[0] : s ?? undefined;
}

function connectionAge(at: string | null | undefined): "active" | "idle" | "never" {
  if (!at) return "never";
  const age = Date.now() - new Date(at).getTime();
  if (Number.isNaN(age)) return "never";
  return age < ACTIVE_WINDOW_MS ? "active" : "idle";
}

function eventCost(
  model: string,
  inTok: number,
  outTok: number,
  pricing: Record<string, ModelPricing>
): number | null {
  const p = pricing[model];
  if (!p) return null;
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return "$" + usd.toFixed(3);
  return "$" + usd.toFixed(2);
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const days = Math.floor(h / 24);
  if (days < 30) return days + "d ago";
  const mo = Math.floor(days / 30);
  return mo + "mo ago";
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-[11px] uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{sub}</p>
    </div>
  );
}

function ModelLine({
  role,
  model,
  price,
}: {
  role: string;
  model: string;
  price: ModelPricing | undefined;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm text-neutral-800">{model}</p>
        <p className="text-[11px] text-neutral-500">{role}</p>
      </div>
      <div className="shrink-0 pl-3 text-right">
        {price ? (
          <p className="text-sm tabular-nums text-neutral-800">
            ${price.in} <span className="text-neutral-400">in</span> · ${price.out}{" "}
            <span className="text-neutral-400">out</span>
          </p>
        ) : (
          <p className="text-sm text-neutral-400">unpriced</p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={`truncate text-neutral-800 ${mono ? "font-mono text-xs" : ""}`}>
        {v}
      </dd>
    </div>
  );
}

function StatusBadge({
  state,
  at,
}: {
  state: "active" | "idle" | "never";
  at: string | null;
}) {
  if (state === "active") {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Active
      </div>
    );
  }
  if (state === "idle") {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-amber-600">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {at ? `Seen ${relTime(at)}` : "Idle"}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
      <span className="h-2 w-2 rounded-full bg-neutral-300" />
      Not connected
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm text-neutral-700">
        {value ?? "Unknown"}
      </p>
    </div>
  );
}

function ModuleChips({ modules }: { modules?: Modules }) {
  if (!modules) return null;

  const items: { key: ModuleKey; label: string }[] = [
    { key: "content", label: "Content" },
    { key: "seo", label: "SEO" },
    { key: "health", label: "Health" },
    { key: "build", label: "Build" },
  ];

  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = Boolean(modules[it.key]);
        return (
          <span
            key={it.key}
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              on
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-400 line-through"
            }`}
          >
            {it.label}
          </span>
        );
      })}
    </div>
  );
}
