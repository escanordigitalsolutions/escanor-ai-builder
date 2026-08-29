import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewSiteForm from "@/components/new-site-form";

type SiteRow = {
  site_url: string | null;
  bridge_version: string | null;
  wp_version: string | null;
  php_version: string | null;
  theme_name: string | null;
  last_connected_at: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  wordpress_sites: SiteRow | SiteRow[] | null;
};

function siteOf(p: ProjectRow): SiteRow | null {
  const s = p.wordpress_sites;
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

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
    .select(
      `
      id,
      name,
      created_at,
      wordpress_sites (
        site_url,
        bridge_version,
        wp_version,
        php_version,
        theme_name,
        last_connected_at
      )
    `
    )
    .order("created_at", { ascending: false });

  const projects = (projectsData ?? []) as unknown as ProjectRow[];

  return (
    <main className="app-shell p-8 text-neutral-900">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]">
              ESCANOR · AI Builder
            </p>
            <h1 className="mt-1.5 text-[1.7rem] font-semibold tracking-tight text-neutral-900">
              Your sites
            </h1>
          </div>
          <NewSiteForm />
        </div>

        <p className="mt-2 text-sm text-neutral-500">
          {user.email}
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {projects.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-sm text-neutral-600">
                No sites yet. Use “New site” above to connect your first
                WordPress site.
              </p>
            </div>
          ) : (
            projects.map((project) => {
              const site = siteOf(project);
              // "Connected" only when the bridge checked in within 24h — an old
              // timestamp is shown as unverified instead of pretending.
              const fresh = Boolean(
                site?.last_connected_at &&
                  Date.now() - new Date(site.last_connected_at).getTime() <
                    24 * 3600 * 1000
              );
              const label = fresh
                ? "Connected"
                : site?.site_url
                  ? "Not verified"
                  : "Not connected";
              return (
                <Link
                  key={project.id}
                  href={`/dashboard/projects/${project.id}`}
                  className="glass-card block p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-medium text-neutral-900">
                        {project.name}
                      </h2>
                      <p className="mt-1 truncate text-sm text-neutral-500">
                        {site?.site_url ?? "No WordPress site connected"}
                      </p>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium " +
                        (fresh ? "pill-on" : "pill-off")
                      }
                    >
                      {label}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                    <span>Theme: {site?.theme_name ?? "—"}</span>
                    <span>WordPress: {site?.wp_version ?? "—"}</span>
                    <span>PHP: {site?.php_version ?? "—"}</span>
                    <span>Bridge: {site?.bridge_version ?? "—"}</span>
                    <span>Created {fmtDate(project.created_at)}</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
