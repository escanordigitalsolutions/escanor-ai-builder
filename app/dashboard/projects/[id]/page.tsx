import {
  notFound,
  redirect,
} from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import ProjectAIChat from "@/components/project-ai-chat";
import ProjectConnectionPanel from "@/components/project-connection-panel";
import ProjectUsageSummary from "@/components/project-usage-summary";
import ProjectSiteKeys from "@/components/project-site-keys";
import ProjectModules from "@/components/project-modules";
import ProjectProposalEngine from "@/components/project-proposal-engine";
import ProjectDeploymentControl from "@/components/project-deployment-control";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProjectPage({
  params,
}: Props) {
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
    .select(`
      id,
      name,
      created_at,
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
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const wordpressSites = project.wordpress_sites;

  const site = Array.isArray(wordpressSites)
    ? wordpressSites[0]
    : wordpressSites;

  return (
    <main className="min-h-screen bg-[#f5f6f7] p-8 text-neutral-900">
      <div className="mx-auto max-w-6xl">
        <a
          href="/dashboard"
          className="text-neutral-500 transition hover:text-neutral-900"
        >
          ← Projects
        </a>

        <div className="mt-8">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-neutral-300" />

            <p className="text-[11px] uppercase tracking-wide text-neutral-400">
              WORDPRESS PROJECT
            </p>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900">
            {project.name}
          </h1>

          <p className="mt-2 text-neutral-500">
            {site?.site_url}
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-5">
          <Info label="WordPress" value={site?.wp_version} />
          <Info label="PHP" value={site?.php_version} />
          <Info label="Theme" value={site?.theme_name} />
          <Info label="Plugin" value={site?.plugin_name ?? "None"} />
          <Info label="Bridge" value={site?.bridge_version} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ProjectConnectionPanel
            projectId={project.id}
            siteUrl={site?.site_url}
            lastConnectedAt={site?.last_connected_at}
          />

          <ProjectUsageSummary projectId={project.id} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ProjectSiteKeys projectId={project.id} />

          <ProjectModules projectId={project.id} />
        </div>

        <div className="mt-8">
          <ProjectProposalEngine projectId={project.id} />
        </div>

        <div className="mt-8">
          <ProjectDeploymentControl projectId={project.id} />
        </div>

        <div className="mt-8">
          <ProjectAIChat projectId={project.id} />
        </div>
      </div>
    </main>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">
        {label}
      </p>

      <p className="mt-2 truncate text-sm text-neutral-900">
        {value ?? "Unknown"}
      </p>
    </div>
  );
}
