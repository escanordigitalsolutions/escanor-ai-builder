import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/dashboard-shell";
import SettingsForms from "@/components/settings-forms";
import AccountDanger from "@/components/account-danger";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // All three read through the user's own session, so row-level security is
  // what scopes them — no filter here is load-bearing for privacy.
  const [{ data: profile }, { count: projects }, { data: subscription }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, company").eq("id", user.id).maybeSingle(),
      // owner_id is restated rather than left to the row policy: this number
      // is shown next to an irreversible button, and a permissive policy would
      // make it a count of other people's sites.
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id),
      supabase.from("subscriptions").select("status").eq("user_id", user.id).maybeSingle(),
    ]);

  const status = String(subscription?.status ?? "");
  const billing = status === "active" || status === "trialing" || status === "past_due";

  return (
    <DashboardShell>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-[1.7rem] font-semibold tracking-tight text-neutral-900">
          Settings
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Your details and how you sign in.
        </p>

        <SettingsForms
          email={user.email ?? ""}
          fullName={profile?.full_name ?? ""}
          company={profile?.company ?? ""}
        />

        <div className="mt-4">
          <AccountDanger
            email={user.email ?? ""}
            projects={projects ?? 0}
            hasSubscription={billing}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
