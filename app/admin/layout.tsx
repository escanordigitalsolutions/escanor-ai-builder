import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * The internal workspace.
 *
 * proxy.ts only checks that *somebody* is signed in — it reads the session
 * cookie and must stay cheap, because it runs on every request. The real
 * authorization is here, where a database read is affordable: anyone without
 * profiles.is_admin is sent back to their own dashboard.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect("/dashboard");
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="border-b border-neutral-900/[0.07] bg-[#141312]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-white"
            >
              Meikero
              <span className="rounded-[5px] bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-white">
                Admin
              </span>
            </Link>
          </div>

          <Link
            href="/dashboard"
            className="text-sm text-neutral-400 transition-colors hover:text-white"
          >
            Back to the app →
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
