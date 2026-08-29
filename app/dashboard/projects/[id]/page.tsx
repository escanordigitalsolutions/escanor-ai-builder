import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import ProjectConnectionPanel from "@/components/project-connection-panel";
import ProjectSiteKeys from "@/components/project-site-keys";
import ProjectModelPanel from "@/components/project-model-panel";
import ProjectUsagePanel from "@/components/project-usage-panel";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

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
      `
      id,
      name,
      created_at,
      model_config,
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
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const wordpressSites = project.wordpress_sites;
  const site = Array.isArray(wordpressSites) ? wordpressSites[0] : wordpressSites;

  return (
    <main className="app-shell p-8 text-neutral-900">
      <div className="mx-auto max-w-4xl">
        <a
          href="/dashboard"
          className="text-neutral-500 transition hover:text-neutral-900"
        >
          ← Your sites
        </a>

        <div className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]">
            WordPress site
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900">
            {project.name}
          </h1>
          <p className="mt-2 text-neutral-500">{site?.site_url}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
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

        <div className="mt-4">
          <ProjectModelPanel
            projectId={project.id}
            initial={(project as { model_config?: Record<string, string> }).model_config ?? {}}
          />
        </div>

        <div className="mt-4">
          <ProjectUsagePanel projectId={project.id} />
        </div>
      </div>
    </main>
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
