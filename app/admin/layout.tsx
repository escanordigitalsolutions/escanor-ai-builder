import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";
import { debugErrors } from "@/lib/debug";

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
    // Bouncing silently is right in production but useless while setting up:
    // the usual cause is being signed in as a different account than the one
    // the is_admin flag was set on, and a redirect hides exactly that.
    if (debugErrors()) {
      return (
        <div className="app-shell flex min-h-screen items-center justify-center px-6">
          <div className="glass-card max-w-lg p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
              Admin access denied
            </p>
            <h1 className="mt-2 text-[1.3rem] font-semibold tracking-tight text-neutral-900">
              This account is not an admin
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600">
              Signed in as{" "}
              <strong className="font-semibold text-neutral-900">{user.email}</strong>
              {profile
                ? " — profiles.is_admin is false for this account."
                : " — there is no profiles row for this account at all."}
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-neutral-900/[0.05] px-3.5 py-3 font-mono text-[11px] leading-relaxed text-neutral-700">
{`update public.profiles
   set is_admin = true
 where email = '${user.email ?? ""}';`}
            </pre>
            <p className="mt-4 text-xs text-neutral-500">
              This explanation appears because DEBUG_ERRORS is on. With
              DEBUG_ERRORS=0 this redirects to the dashboard instead.
            </p>
            <Link
              href="/dashboard"
              className="btn-accent mt-5 inline-block px-4 py-2.5 text-sm font-medium"
            >
              Back to the dashboard
            </Link>
          </div>
        </div>
      );
    }

    redirect("/dashboard");
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="border-b border-neutral-900/[0.07] bg-[#141312]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-7">
            <Link href="/admin" className="flex items-center gap-2.5" aria-label="Meikero admin">
              <Image
                src="/brand/wordmark-light.png"
                alt="Meikero"
                width={2545}
                height={1000}
                priority
                className="h-5 w-auto"
              />
              <span className="rounded-[5px] bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-white">
                Admin
              </span>
            </Link>

            <nav className="hidden items-center gap-5 sm:flex">
              <Link
                href="/admin"
                className="text-sm text-neutral-400 transition-colors hover:text-white"
              >
                Projects
              </Link>
              <Link
                href="/admin/users"
                className="text-sm text-neutral-400 transition-colors hover:text-white"
              >
                Accounts
              </Link>
            </nav>
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
