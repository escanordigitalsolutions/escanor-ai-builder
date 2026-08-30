import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export type SessionResult = {
  /** Carries the refreshed auth cookies — must be the response that is returned. */
  response: NextResponse;
  /** The signed-in user's id, or null. Read from the session cookie only. */
  userId: string | null;
};

/**
 * Refresh the Supabase session on every request and report who is signed in.
 *
 * The user id is returned alongside the response so `proxy.ts` can make its
 * redirect decision without a second round trip. It comes from the session
 * cookie's claims — deliberately not from a database lookup, because this runs
 * on every route including prefetches.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;

  return { response, userId: typeof sub === "string" ? sub : null };
}
