import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { deleteAccount, DeletionBlocked } from "@/lib/account/delete";
import { debugErrors, errorDetail } from "@/lib/debug";

/**
 * DELETE /api/account — the person asks to be forgotten.
 *
 * Two locks, because this is the one action in the product with no undo.
 *
 * The session alone is not enough. A laptop left open in a café is a session,
 * and a session should not be able to erase a business's work. So the password
 * is asked for again and verified against Supabase.
 *
 * That verification uses a throwaway client rather than the request's own.
 * Signing in on the cookie-bound client would issue a fresh session and
 * rewrite the auth cookies mid-request; this one holds no session at all and
 * is discarded when the function returns.
 *
 * The typed email address is the second lock, and a different kind: it does
 * not prove identity, it proves attention. Nobody types their own address by
 * accident.
 */

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json(
      { success: false, error: "Sign in again to delete your account." },
      { status: 401 }
    );
  }

  let body: { password?: unknown; confirmEmail?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Missing confirmation." },
      { status: 400 }
    );
  }

  const password = typeof body.password === "string" ? body.password : "";
  const confirmEmail =
    typeof body.confirmEmail === "string" ? body.confirmEmail.trim().toLowerCase() : "";

  if (confirmEmail !== user.email.trim().toLowerCase()) {
    return NextResponse.json(
      { success: false, error: "The email address does not match this account." },
      { status: 400 }
    );
  }

  if (!password) {
    return NextResponse.json(
      { success: false, error: "Enter your password to confirm." },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Account deletion is not configured: NEXT_PUBLIC_SUPABASE_URL or " +
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.",
      },
      { status: 500 }
    );
  }

  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error: passwordError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });

  // That check minted a real session at Supabase. Drop it: on the paths where
  // deletion does not go through, an abandoned refresh token would outlive the
  // request for no reason.
  await verifier.auth.signOut().catch(() => {});

  if (passwordError) {
    return NextResponse.json(
      { success: false, error: "That password is not correct." },
      { status: 403 }
    );
  }

  try {
    const report = await deleteAccount(user.id);

    // Clear the auth cookies. The account is already gone, so failures here
    // are cosmetic — the next getUser() will reject the token regardless.
    try {
      await supabase.auth.signOut();
    } catch {
      /* nothing left to sign out of */
    }

    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    if (error instanceof DeletionBlocked) {
      // Deliberate and explained: the account is intact and the person can try
      // again. The table-level reasons go to the logs, and to the response only
      // while verbose errors are on.
      if (error.warnings.length) {
        console.error("account delete blocked:", user.id, error.warnings);
      }

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...(debugErrors() && error.warnings.length
            ? { detail: error.warnings.join("; ") }
            : {}),
        },
        { status: 409 }
      );
    }

    console.error("account delete failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not delete the account. Write to privacy@meikero.com and it will be done by hand.",
        ...errorDetail(error),
      },
      { status: 500 }
    );
  }
}
