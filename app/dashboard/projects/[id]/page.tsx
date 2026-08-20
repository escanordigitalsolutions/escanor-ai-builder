import {
  notFound,
  redirect,
} from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import ProjectAIChat from "@/components/project-ai-chat";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProjectPage({
  params,
}: Props) {
  const { id } =
    await params;

  const supabase =
    await createClient();

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const {
    data: project,
  } =
    await supabase
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

  const wordpressSites =
    project.wordpress_sites;

  const site =
    Array.isArray(
      wordpressSites
    )
      ? wordpressSites[0]
      : wordpressSites;

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-10">
      <div className="max-w-6xl mx-auto">
        <a
          href="/dashboard"
          className="text-neutral-500 hover:text-white transition"
        >
          ← Projects
        </a>

        <div className="mt-8">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 bg-green-400 rounded-full" />

            <p className="text-sm text-neutral-500">
              WORDPRESS PROJECT
            </p>
          </div>

          <h1 className="text-4xl font-semibold mt-3">
            {project.name}
          </h1>

          <p className="text-neutral-400 mt-2">
            {site?.site_url}
          </p>
        </div>

        <div className="grid md:grid-cols-5 gap-4 mt-10">
          <Info
            label="WordPress"
            value={
              site?.wp_version
            }
          />

          <Info
            label="PHP"
            value={
              site?.php_version
            }
          />

          <Info
            label="Theme"
            value={
              site?.theme_name
            }
          />

          <Info
            label="Plugin"
            value={
              site?.plugin_name ??
              "None"
            }
          />

          <Info
            label="Bridge"
            value={
              site?.bridge_version
            }
          />
        </div>

        <div className="mt-8">
          <ProjectAIChat
            projectId={
              project.id
            }
          />
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
  value?:
    | string
    | null;
}) {
  return (
    <div className="border border-neutral-800 rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-neutral-600">
        {label}
      </p>

      <p className="mt-2 text-sm truncate">
        {value ??
          "Unknown"}
      </p>
    </div>
  );
}
