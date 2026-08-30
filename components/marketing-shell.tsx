import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";
import { RELEASE, showsStageChip } from "@/lib/release";

/**
 * Frame for every public page.
 *
 * The marketing site is deliberately quiet — off-white ground, near-black
 * type, one indigo accent. The only loud thing on any page is a site Meikero
 * generated. That is the whole argument: if the chrome competed with the work,
 * the work would be harder to judge.
 */

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs/install", label: "Docs" },
];

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Meikero">
      <Image
        src="/brand/wordmark-dark.png"
        alt="Meikero"
        width={2835}
        height={1000}
        priority
        className="h-6 w-auto"
      />
      {showsStageChip() ? (
        <span
          title={RELEASE.note}
          className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand"
        >
          {RELEASE.label}
        </span>
      ) : null}
    </Link>
  );
}

async function Nav() {
  // A signed-in visitor gets a way back into the app instead of being told to
  // sign in again — the marketing site is not walled off from the product.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-900/[0.07] bg-[#f6f5f3]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <Wordmark />

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-[10px] bg-[#141312] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm text-neutral-600 transition-colors hover:text-neutral-900 sm:block"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-[10px] bg-[#141312] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-neutral-900/[0.07]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              AI that writes real WordPress themes — on your hosting, in your
              WordPress, as files you own.
            </p>
          </div>

          <div className="flex gap-14 text-sm">
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                Product
              </p>
              <Link href="/#how" className="text-neutral-600 hover:text-neutral-900">
                How it works
              </Link>
              <Link href="/pricing" className="text-neutral-600 hover:text-neutral-900">
                Pricing
              </Link>
              <Link
                href="/docs/install"
                className="text-neutral-600 hover:text-neutral-900"
              >
                Install guide
              </Link>
            </div>

            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                Legal
              </p>
              <Link
                href="/legal/terms"
                className="text-neutral-600 hover:text-neutral-900"
              >
                Terms
              </Link>
              <Link
                href="/legal/privacy"
                className="text-neutral-600 hover:text-neutral-900"
              >
                Privacy
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-10 border-t border-neutral-900/[0.06] pt-6 text-xs text-neutral-400">
          © {new Date().getFullYear()} ESCANOR Digital Solutions. Meikero is not
          affiliated with the WordPress Foundation.
        </p>
      </div>
    </footer>
  );
}

export default function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f5f3]">
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
