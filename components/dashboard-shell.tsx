import Link from "next/link";
import Image from "next/image";
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
            <Link href="/dashboard" className="flex items-center" aria-label="Meikero">
              <Image
                src="/brand/wordmark-dark.png"
                alt="Meikero"
                width={2835}
                height={1000}
                priority
                className="h-6 w-auto"
              />
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
                  className="text-sm font-medium text-brand transition-opacity hover:opacity-75"
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
