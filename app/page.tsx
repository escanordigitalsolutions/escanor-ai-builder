import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Root route.
 *
 * There is no public marketing page yet, so the entry point simply routes the
 * visitor to the right place: the dashboard when they already have a session,
 * the login screen otherwise. Replaces the default create-next-app template.
 */
export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
