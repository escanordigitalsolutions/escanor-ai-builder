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
    <main className="relative min-h-screen bg-[#0c0d0f] text-neutral-200">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(1100px_460px_at_50%_-140px,rgba(110,168,254,0.10),transparent)]" />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 py-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
              ESCANOR
            </p>
            <h1 className="text-2xl font-semibold tracking-tight mt-1 text-white">
              AI Builder
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur px-3.5 py-2">
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400/70 to-indigo-500/70 flex items-center justify-center text-[11px] font-semibold text-white">
                {(user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="text-sm text-neutral-300 max-w-[220px] truncate">
                {user.email}
              </span>
            </div>
            <Link
              href="/dashboard/new"
              className="rounded-xl bg-white text-black px-4 py-2.5 text-sm font-semibold hover:bg-neutral-200 transition"
            >
              + New project
            </Link>
          </div>
        </header>

        {/* Stat cards */}
        <section className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat
            label="Projects"
            value={String(projects.length)}
            sub={`${activeCount} active now`}
            accent="sky"
          />
          <Stat
            label="Tokens used"
            value={compact(totalTot)}
            sub={`${compact(inTot)} in · ${compact(outTot)} out`}
            accent="violet"
          />
          <Stat
            label="Estimated spend"
            value={
              estimatedCostUsd === null ? "—" : formatCost(estimatedCostUsd)
            }
            sub={
              estimatedCostUsd === null
                ? "Set OPENAI_PRICING"
                : costComplete
                  ? "all-time, all models"
                  : "partial — some models unpriced"
            }
            accent="emerald"
          />
          <Stat
            label="AI actions"
            value={compact(totalActions)}
            sub={`${runs.length} chats · ${proposals.length} builds`}
            accent="amber"
          />
        </section>

        {/* Pricing + account */}
        <section className="mt-4 grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Pricing &amp; models</h2>
              <span className="text-[11px] text-neutral-500">USD per 1M tokens</span>
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
                No prices configured. Set the <code className="text-neutral-300">OPENAI_PRICING</code> env
                var (JSON, USD per 1M tokens) to see live cost estimates.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-5">
            <h2 className="text-sm font-medium text-white">Account</h2>
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
              <h2 className="text-base font-medium text-white">Activity</h2>
              <p className="text-neutral-500 text-sm mt-1">
                Tokens and estimated cost per action (chat &amp; build).
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[130px_1fr_90px_150px_120px_90px] gap-3 px-5 py-3 text-[11px] uppercase tracking-wider text-neutral-500 border-b border-white/10">
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
              <div className="divide-y divide-white/[0.06]">
                {recentEvents.map((e, i) => {
                  const cost = eventCost(e.model, e.inTok, e.outTok, pricing);
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-2 md:grid-cols-[130px_1fr_90px_150px_120px_90px] gap-x-3 gap-y-1 px-5 py-3 text-sm"
                    >
                      <span className="text-neutral-500 md:text-neutral-400">
                        {relTime(e.at)}
                      </span>
                      <span className="text-neutral-200 truncate">
                        {e.project}
                        {e.label ? (
                          <span className="text-neutral-500"> · {e.label}</span>
                        ) : null}
                      </span>
                      <span>
                        <span
                          className={`text-[11px] rounded-md px-2 py-0.5 border ${
                            e.action === "Build"
                              ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                              : "border-white/10 bg-white/5 text-neutral-300"
                          }`}
                        >
                          {e.action}
                        </span>
                      </span>
                      <span className="text-neutral-400 font-mono text-xs truncate self-center">
                        {e.model}
                      </span>
                      <span className="text-right text-neutral-200 tabular-nums self-center">
                        {compact(e.totalTok)}
                        <span className="hidden md:inline text-neutral-600 text-xs">
                          {" "}
                          ({compact(e.inTok)}/{compact(e.outTok)})
                        </span>
                      </span>
                      <span className="text-right text-neutral-300 tabular-nums self-center">
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
          <h2 className="text-base font-medium text-white">Projects</h2>
          <p className="text-neutral-500 text-sm mt-1">
            Your connected WordPress websites.
          </p>

          {projects.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
              <p className="text-neutral-400">No projects yet.</p>
              <Link
                href="/dashboard/new"
                className="inline-block mt-5 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm hover:bg-white/10 transition"
              >
                Connect WordPress
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
              {projects.map((project) => {
                const site = siteOf(project);
                const state = connectionAge(site?.last_connected_at);
                return (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="group rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-5 hover:border-white/20 hover:bg-white/[0.06] transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                          WordPress Project
                        </p>
                        <h3 className="text-base font-medium mt-1.5 text-white">
                          {project.name}
                        </h3>
                      </div>
                      <StatusBadge
                        state={state}
                        at={site?.last_connected_at ?? null}
                      />
                    </div>

                    <p className="text-neutral-500 text-sm mt-3 truncate">
                      {site?.site_url ?? "No site connected"}
                    </p>

                    <div className="border-t border-white/10 mt-5 pt-4 grid grid-cols-2 gap-3">
                      <Meta label="WordPress" value={site?.wp_version} />
                      <Meta label="Bridge" value={site?.bridge_version} />
                      <Meta label="Theme" value={site?.theme_name} />
                      <Meta label="Plugin" value={site?.plugin_name ?? "None"} />
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <span className="text-xs text-neutral-500">Open workspace</span>
                      <span className="text-neutral-500 group-hover:text-white transition">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <footer className="mt-12 pb-6 text-center text-[11px] text-neutral-600">
          ESCANOR AI Builder · usage estimates are indicative and based on configured pricing.
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
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "sky" | "violet" | "emerald" | "amber";
}) {
  const dot = {
    sky: "bg-sky-400",
    violet: "bg-violet-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
  }[accent];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-xl p-5">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white tabular-nums">{value}</p>
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
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-neutral-200 font-mono truncate">{model}</p>
        <p className="text-[11px] text-neutral-500">{role}</p>
      </div>
      <div className="text-right shrink-0 pl-3">
        {price ? (
          <p className="text-sm text-neutral-200 tabular-nums">
            ${price.in} <span className="text-neutral-600">in</span> · ${price.out}{" "}
            <span className="text-neutral-600">out</span>
          </p>
        ) : (
          <p className="text-sm text-neutral-500">unpriced</p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={`text-neutral-200 truncate ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
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
      <div className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
        Active
      </div>
    );
  }
  if (state === "idle") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-400/90 shrink-0">
        <span className="w-2 h-2 rounded-full bg-amber-400/80" />
        {at ? `Seen ${relTime(at)}` : "Idle"}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-500 shrink-0">
      <span className="w-2 h-2 rounded-full bg-neutral-600" />
      Not connected
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="text-sm mt-0.5 text-neutral-300 truncate">{value ?? "Unknown"}</p>
    </div>
  );
}
