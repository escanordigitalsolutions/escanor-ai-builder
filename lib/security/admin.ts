import { createClient } from "@/lib/supabase/server";

/**
 * The admin check for API routes.
 *
 * app/admin/layout.tsx guards the *pages*, and a layout guards nothing else —
 * an API route under /api is not inside it. Every admin endpoint has to ask
 * this question for itself, because these routes hand out credits and change
 * what people are entitled to.
 */

export type AdminResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; error: string };

export async function requireAdmin(): Promise<AdminResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, error: "Sign in to continue." };
  }

  // Read through the caller's own session, not the service client: the row
  // returned is then the one row RLS lets them see, which is their own.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    return { ok: false, status: 403, error: "Admins only." };
  }

  return { ok: true, userId: user.id, email: user.email ?? "" };
}
