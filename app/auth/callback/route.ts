import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * The single landing point for every emailed auth link — signup confirmation,
 * password recovery, and any OAuth provider added later.
 *
 * Supabase sends the user here with a one-time `code`; exchanging it is what
 * actually writes the session cookie. Without this route the links in those
 * emails lead nowhere, which is why signup and reset cannot work before it
 * exists.
 */

/**
 * Build an absolute URL on the host the visitor actually used.
 *
 * This matters more than usual here: the app answers on both meikero.com and
 * the legacy builder.escanor.lt alias, and behind Vercel's proxy `request.url`
 * carries the internal host, not the one in the address bar. Redirecting to
 * the wrong one would drop the session cookie that was just set.
 */
function appUrl(request: NextRequest, path: string): string {
  const { origin } = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");

  if (process.env.NODE_ENV === "development" || !forwardedHost) {
    return `${origin}${path}`;
  }

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}${path}`;
}

function loginWithError(request: NextRequest, message: string) {
  return NextResponse.redirect(
    appUrl(request, `/login?error=${encodeURIComponent(message)}`)
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Supabase reports link problems (expired, already used, cancelled consent)
  // on the query string rather than by failing the request.
  const linkError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (linkError) {
    return loginWithError(request, linkError);
  }

  const code = searchParams.get("code");

  if (!code) {
    return loginWithError(
      request,
      "That link is not valid. Please request a new one."
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return loginWithError(request, error.message);
  }

  // `next` arrives from the URL, so it is only ever followed as an in-app
  // path — an absolute value here would be an open redirect.
  const next = searchParams.get("next");
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return NextResponse.redirect(appUrl(request, target));
}
