import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client, for requests that have no browser session.
 *
 * WordPress authenticates as a *site*, not as a Supabase user, so RLS
 * policies keyed on auth.uid() cannot apply. This client bypasses RLS
 * entirely — every query made with it MUST scope by project_id explicitly.
 *
 * Never import this from a Client Component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is missing.");
  }

  return createSupabaseClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
