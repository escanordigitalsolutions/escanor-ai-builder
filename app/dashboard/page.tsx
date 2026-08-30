import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { entitlementFor } from "@/lib/billing/credits";
import DashboardShell from "@/components/dashboard-shell";
import BillingPanel from "@/components/billing-panel";
import NewSiteForm from "@/components/new-site-form";
import DashboardCardActions from "@/components/dashboard-card-actions";

type SiteRow = {
  site_url: string | null;
  bridge_version: string | null;
  wp_version: string | null;
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

  const [{ data: projectsData }, entitlement, { data: profile }] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          `id, name, created_at,
           wordpress_sites ( site_url, bridge_version, wp_version, theme_name, last_connected_at )`
        )
        .order("created_at", { ascending: false }),
      entitlementFor(user.id),
      createServiceClient()
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

  const projects = (projectsData ?? []) as unknown as ProjectRow[];

  return (
    <DashboardShell>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.7rem] font-semibold tracking-tight text-neutral-900">
              Your sites
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Every WordPress site connected to Meikero.
            </p>
          </div>
          <NewSiteForm />
        </div>

        <div className="mt-7">
          <BillingPanel
            balance={entitlement.balance}
            planKey={entitlement.plan.key}
            planName={entitlement.plan.name}
            siteLimit={entitlement.plan.siteLimit}
            siteCount={projects.length}
            status={entitlement.subscription?.status ?? null}
            renewsAt={entitlement.subscription?.current_period_end ?? null}
            cancelAtPeriodEnd={
              entitlement.subscription?.cancel_at_period_end ?? false
            }
            canManage={Boolean(profile?.stripe_customer_id)}
          />
        </div>

        {projects.length === 0 ? (
          <Onboarding />
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const site = siteOf(project);
              // "Connected" means the bridge checked in within a day — an old
              // timestamp is reported as unverified rather than pretended over.
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
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={
                          "rounded-full px-2.5 py-1 text-[11px] font-medium " +
                          (fresh ? "pill-on" : "pill-off")
                        }
                      >
                        {label}
                      </span>
                      <DashboardCardActions
                        projectId={project.id}
                        projectName={project.name}
                      />
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                    <span>Theme: {site?.theme_name ?? "—"}</span>
                    <span>WordPress: {site?.wp_version ?? "—"}</span>
                    <span>Bridge: {site?.bridge_version ?? "—"}</span>
                    <span>Last seen {fmtDate(site?.last_connected_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/**
 * What a brand-new account sees.
 *
 * This is the moment most signups are lost: the person has an account and
 * nothing to look at, and the next step happens somewhere else entirely — in
 * their own WordPress admin. Spelling it out here is worth more than any
 * feature on this page.
 */
function Onboarding() {
  const steps = [
    {
      n: "01",
      title: "Add your site",
      body: "Use “New site” above and give it a name. Meikero shows you one site key, starting with esk_live_ — copy it, it is shown only once.",
    },
    {
      n: "02",
      title: "Install the plugin",
      body: "Download it below, then in your WordPress admin: Plugins → Add New → Upload Plugin. Activate it.",
    },
    {
      n: "03",
      title: "Paste the key, once",
      body: "In WordPress go to Meikero → Cloud connection, paste the key and save. The plugin introduces itself and the site appears here as connected — there is nothing to copy back.",
    },
  ];

  return (
    <div className="glass-card mt-4 p-8">
      <h2 className="text-[1.15rem] font-semibold tracking-tight text-neutral-900">
        Connect your first WordPress site
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-600">
        Meikero builds into a WordPress site you already run. Three steps, about
        three minutes.
      </p>

      <ol className="mt-7 grid gap-6 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.n}>
            <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-brand">
              {step.n}
            </span>
            <h3 className="mt-2.5 text-[0.95rem] font-semibold text-neutral-900">
              {step.title}
            </h3>
            <p className="mt-1.5 text-[0.88rem] leading-relaxed text-neutral-600">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <a
          href="/plugin/meikero-bridge.zip"
          download
          className="btn-accent px-4 py-2.5 text-sm font-medium"
        >
          Download the plugin
        </a>
        <Link
          href="/docs/install"
          className="text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          Read the full install guide →
        </Link>
      </div>
    </div>
  );
}
