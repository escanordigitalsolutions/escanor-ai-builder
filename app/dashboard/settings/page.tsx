import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/dashboard-shell";
import SettingsForms from "@/components/settings-forms";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, company")
    .eq("id", user.id)
    .maybeSingle();

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
      </div>
    </DashboardShell>
  );
}
