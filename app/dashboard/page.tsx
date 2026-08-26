import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select(`
      id,
      name,
      created_at,
      updated_at,
      wordpress_sites (
        site_url,
        bridge_version,
        wp_version,
        php_version,
        theme_name,
        theme_slug,
        plugin_name,
        plugin_slug,
        last_connected_at
      )
    `)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("Dashboard projects error:", error);
  }

  return (
    <main className="min-h-screen bg-[#f5f6f7] text-neutral-900">
      <div className="max-w-7xl mx-auto px-8 py-8">
        <header className="flex items-center justify-between border-b border-neutral-200 pb-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">
              ESCANOR
            </p>

            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              AI Builder
            </h1>

            <p className="text-neutral-500 text-sm mt-2">
              {user.email}
            </p>
          </div>

          <Link
            href="/dashboard/new"
            className="rounded-lg bg-neutral-900 text-white px-5 py-2.5 font-medium hover:bg-neutral-800 transition"
          >
            + New project
          </Link>
        </header>

        <section className="mt-10">
          <div>
            <h2 className="text-base font-medium">
              Projects
            </h2>

            <p className="text-neutral-500 text-sm mt-1">
              Your connected WordPress websites.
            </p>
          </div>

          {!projects || projects.length === 0 ? (
            <div className="mt-8 border border-dashed border-neutral-200 rounded-xl p-8 text-center">
              <p className="text-neutral-500">
                No projects yet.
              </p>

              <p className="text-neutral-500 text-sm mt-2">
                Connect your first WordPress website.
              </p>

              <Link
                href="/dashboard/new"
                className="inline-block mt-6 rounded-lg border border-neutral-200 px-5 py-2.5 text-sm hover:bg-neutral-50 hover:border-neutral-300 transition"
              >
                Connect WordPress
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mt-8">
              {projects.map((project) => {
                const wordpressSites =
                  project.wordpress_sites;

                const site = Array.isArray(wordpressSites)
                  ? wordpressSites[0]
                  : wordpressSites;

                // A project is "connected" only once a real handshake has
                // stamped last_connected_at. A row with no site, or one that
                // was never reached, is not connected.
                const connected = Boolean(site?.last_connected_at);

                return (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="group border border-neutral-200 rounded-xl bg-white p-6 hover:border-neutral-300 hover:bg-neutral-50 transition"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-neutral-400">
                          WordPress Project
                        </p>

                        <h3 className="text-base font-medium mt-2 group-hover:text-neutral-900">
                          {project.name}
                        </h3>
                      </div>

                      {connected ? (
                        <div className="flex items-center gap-2 text-xs text-green-600">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Connected
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-neutral-400">
                          <span className="w-2 h-2 rounded-full bg-neutral-300" />
                          Not connected
                        </div>
                      )}
                    </div>

                    <p className="text-neutral-500 text-sm mt-4 truncate">
                      {site?.site_url ?? "No site connected"}
                    </p>

                    <div className="border-t border-neutral-200 mt-6 pt-5 grid grid-cols-2 gap-4">
                      <ProjectMeta
                        label="WordPress"
                        value={site?.wp_version}
                      />

                      <ProjectMeta
                        label="Bridge"
                        value={site?.bridge_version}
                      />

                      <ProjectMeta
                        label="Theme"
                        value={site?.theme_name}
                      />

                      <ProjectMeta
                        label="Plugin"
                        value={site?.plugin_name ?? "None"}
                      />
                    </div>

                    <div className="mt-6 flex items-center justify-between">
                      <span className="text-xs text-neutral-500">
                        Project workspace
                      </span>

                      <span className="text-neutral-500 group-hover:text-neutral-900 transition">
                        →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ProjectMeta({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </p>

      <p className="text-sm mt-1 truncate">
        {value ?? "Unknown"}
      </p>
    </div>
  );
}
