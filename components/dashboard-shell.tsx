import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/sign-out-button";

/**
 * Chrome for the signed-in app.
 *
 * The Admin link only exists for accounts flagged is_admin — the internal
 * workspace (model tiers, ops log, raw token counts) is a tool for running
 * Meikero, not a feature customers are meant to see.
 */
export default async function DashboardShell({
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
    .select("full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin = Boolean(profile?.is_admin);

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="border-b border-neutral-900/[0.07] bg-white/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-7">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#141312] text-[13px] font-semibold text-white"
              >
                M
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-neutral-900">
                Meikero
              </span>
            </Link>

            <nav className="hidden items-center gap-6 sm:flex">
              <Link
                href="/dashboard"
                className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
              >
                Sites
              </Link>
              <Link
                href="/dashboard/settings"
                className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
              >
                Settings
              </Link>
              {isAdmin ? (
                <Link
                  href="/admin"
                  className="text-sm font-medium text-[#6366f1] transition-opacity hover:opacity-75"
                >
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-neutral-500 md:block">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
