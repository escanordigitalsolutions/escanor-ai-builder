import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Session refresh plus an optimistic auth gate.
 *
 * "Optimistic" is the operative word: this runs on every request, including
 * prefetches, so it only reads the session cookie. Real authorization — does
 * this user own this project, is this user an admin — belongs in the page or
 * route handler, which can afford a database call.
 */

/** Areas that require a signed-in user. */
const PROTECTED = ["/dashboard", "/admin"];

/**
 * Screens a signed-in user has no reason to see.
 *
 * /reset-password is deliberately absent: arriving there means a recovery link
 * has just signed the user in, so bouncing them to the dashboard would make
 * the password reset impossible to finish.
 */
const AUTH_ONLY = ["/login", "/signup", "/forgot-password"];

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * A redirect response built from scratch would drop the refreshed auth cookies
 * that updateSession just wrote, quietly signing the user out on the way to
 * the login screen. Carry them across.
 */
function redirectWithSession(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);

  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  return redirect;
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const path = request.nextUrl.pathname;

  if (!userId && PROTECTED.some((base) => isUnder(path, base))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Send them back where they were headed once they are signed in.
    url.searchParams.set("next", path);
    return redirectWithSession(url, response);
  }

  if (userId && AUTH_ONLY.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithSession(url, response);
  }

  return response;
}

export const config = {
  matcher: [
    // api/billing/webhook is excluded on purpose: Stripe calls it server to
    // server with no cookies, and it must read the raw request body to verify
    // the signature — a session refresh here is pure latency.
    "/((?!_next/static|_next/image|favicon.ico|api/billing/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
