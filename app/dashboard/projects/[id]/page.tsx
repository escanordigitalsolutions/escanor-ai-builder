import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/dashboard-shell";
import ProjectConnectionPanel from "@/components/project-connection-panel";
import ProjectSiteKeys from "@/components/project-site-keys";
import ProjectDesignsPanel from "@/components/project-designs-panel";
import ProjectDanger from "@/components/project-danger";

/**
 * A customer's view of one connected site.
 *
 * Deliberately narrower than the internal workspace: no model tiers, no ops
 * log, no raw token counts. Those are instruments for running the service, and
 * putting them in front of a customer makes the product look like a machine
 * they have to operate. They live under /admin instead.
 */

type Props = { params: Promise<{ id: string }> };

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: project } = await supabase
    .from("projects")
    .select(
      `id, name, created_at,
       wordpress_sites ( site_url, bridge_version, wp_version, php_version, theme_name, last_connected_at )`
    )
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const sites = project.wordpress_sites;
  const site = Array.isArray(sites) ? sites[0] : sites;

  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/dashboard"
          className="text-sm text-neutral-500 transition-colors hover:text-neutral-900"
        >
          ← Your sites
        </Link>

        <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              WordPress site
            </p>
            <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-neutral-900">
              {project.name}
            </h1>
            {site?.site_url ? (
              <a
                href={site.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-sm text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline"
              >
                {site.site_url}
              </a>
            ) : (
              <p className="mt-1.5 text-sm text-neutral-500">
                No WordPress site connected yet
              </p>
            )}
          </div>

          {site?.site_url ? (
            <a
              href={`${site.site_url.replace(/\/$/, "")}/wp-admin/admin.php?page=wp-ai-builder-editor`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-accent px-4 py-2.5 text-sm font-medium"
            >
              Open AI Editor →
            </a>
          ) : null}
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Info label="WordPress" value={site?.wp_version} />
          <Info label="PHP" value={site?.php_version} />
          <Info label="Active theme" value={site?.theme_name} />
          <Info label="Plugin" value={site?.bridge_version} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ProjectConnectionPanel
            projectId={project.id}
            siteUrl={site?.site_url}
            lastConnectedAt={site?.last_connected_at}
          />

          <ProjectSiteKeys projectId={project.id} />
        </div>

        <div className="mt-4">
          <ProjectDesignsPanel projectId={project.id} />
        </div>

        <section className="glass-card mt-4 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-[1.02rem] font-semibold tracking-tight text-neutral-900">
              The bridge plugin
            </h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-neutral-600">
              Already installed sites update themselves from your Plugins
              screen. This copy is here for reinstalling, or for connecting the
              same key on another WordPress.
            </p>
          </div>
          <a
            href="/plugin/meikero-bridge.zip"
            download
            className="btn-ghost shrink-0 px-4 py-2.5 text-sm font-medium"
          >
            Download the plugin
          </a>
        </section>

        <ProjectDanger projectId={project.id} projectName={project.name} />
      </div>
    </DashboardShell>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="glass-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-2 truncate text-sm text-neutral-900">
        {value ?? "Unknown"}
      </p>
    </div>
  );
}
