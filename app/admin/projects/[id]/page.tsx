import { notFound } from "next/navigation";
import Link from "next/link";

import { createServiceClient } from "@/lib/supabase/service";
import ProjectConnectionPanel from "@/components/project-connection-panel";
import ProjectSiteKeys from "@/components/project-site-keys";
import ProjectModelPanel from "@/components/project-model-panel";
import ProjectUsagePanel from "@/components/project-usage-panel";
import ProjectDesignsPanel from "@/components/project-designs-panel";
import ProjectOpsPanel from "@/components/project-ops-panel";
import ProjectDanger from "@/components/project-danger";
import { TIER_DEFAULTS } from "@/lib/ai/resolve";

/**
 * The internal workspace for one project — what /dashboard/projects/[id] used
 * to be before it became a customer-facing page.
 *
 * Everything an operator needs and a customer should not have to think about:
 * which model runs at each tier, the raw token ledger, the operations log.
 * Reads through the service client so any project is inspectable, not only the
 * admin's own; the is_admin gate lives in the layout.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminProjectPage({ params }: Props) {
  const { id } = await params;

  const db = createServiceClient();

  const { data: project } = await db
    .from("projects")
    .select(
      `id, name, created_at, owner_id, model_config,
       wordpress_sites ( site_url, bridge_version, wp_version, php_version, theme_name, last_connected_at )`
    )
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: owner } = await db
    .from("profiles")
    .select("email")
    .eq("id", project.owner_id)
    .maybeSingle();

  const sites = project.wordpress_sites;
  const site = Array.isArray(sites) ? sites[0] : sites;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 text-neutral-900">
      <Link
        href="/admin"
        className="text-sm text-neutral-500 transition-colors hover:text-neutral-900"
      >
        ← All projects
      </Link>

      <div className="mt-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]">
          Internal workspace
        </p>
        <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-neutral-900">
          {project.name}
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          {site?.site_url ?? "No site"} · owner {owner?.email ?? project.owner_id}
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Info label="WordPress" value={site?.wp_version} />
        <Info label="PHP" value={site?.php_version} />
        <Info label="Theme" value={site?.theme_name} />
        <Info label="Bridge" value={site?.bridge_version} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProjectConnectionPanel
          projectId={project.id}
          siteUrl={site?.site_url}
          lastConnectedAt={site?.last_connected_at}
        />

        <ProjectSiteKeys projectId={project.id} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ProjectModelPanel
          projectId={project.id}
          initial={
            (project as { model_config?: Record<string, string> }).model_config ?? {}
          }
          defaults={TIER_DEFAULTS}
        />

        <ProjectUsagePanel projectId={project.id} />
      </div>

      <div className="mt-4">
        <ProjectOpsPanel projectId={project.id} />
      </div>

      <div className="mt-4">
        <ProjectDesignsPanel projectId={project.id} />
      </div>

      <ProjectDanger projectId={project.id} projectName={project.name} />
    </div>
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
