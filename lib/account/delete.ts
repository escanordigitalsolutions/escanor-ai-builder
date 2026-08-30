import type Stripe from "stripe";

import { createServiceClient } from "@/lib/supabase/service";
import { stripe, stripeConfigured } from "@/lib/billing/stripe";
import { purgeProjectData } from "./purge";

/**
 * Erasing an account, in the order that cannot leave the person worse off.
 *
 * The privacy policy promises removal within thirty days. It also promises
 * that billing records survive, because accounting law requires ten years of
 * them — those live at Stripe, which keeps invoices independently of the
 * customer object, so nothing here has to preserve them by hand.
 *
 * Three rules decide the shape of this function.
 *
 * 1. Cancel the subscription FIRST, and abort if that fails. A deleted account
 *    whose card is still charged every month is the worst outcome available
 *    here — far worse than a failed delete the person can retry.
 *
 * 2. Cancel by CUSTOMER, not by the subscription id we mirrored. Our
 *    subscriptions table holds one row per user, so a second live
 *    subscription — bought from the pricing page instead of the portal, or
 *    created by a webhook that never arrived — is invisible to us. It would
 *    keep billing a card belonging to a person whose account no longer exists,
 *    with no profile left to map the customer back to. Asking Stripe what it
 *    actually has is the only way to be sure.
 *
 * 3. Delete the sign-in record LAST, and only if every data delete succeeded.
 *    While the account exists the person can sign in and ask again; once it is
 *    gone, leftover rows are unreachable by them and nearly unfindable by us.
 *    A delete that failed halfway must therefore say so and stop, not carry on
 *    and report success.
 */

export type DeletionReport = {
  projects: number;
  subscriptionsCanceled: number;
};

export class DeletionBlocked extends Error {
  /** Table-level failures, when the block happened during the data purge. */
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = "DeletionBlocked";
    this.warnings = warnings;
  }
}

/** Stripe states in which there is nothing left to cancel. */
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

export async function deleteAccount(userId: string): Promise<DeletionReport> {
  const service = createServiceClient();

  // --- 1. Money first -------------------------------------------------------

  const [{ data: profile }, { data: subscription }] = await Promise.all([
    service.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle(),
    service
      .from("subscriptions")
      .select("stripe_subscription_id, status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const customerId = String(profile?.stripe_customer_id ?? "");
  const mirroredId = String(subscription?.stripe_subscription_id ?? "");
  const mirroredStatus = String(subscription?.status ?? "");

  const subscriptionsCanceled = await cancelEverythingAtStripe(
    customerId,
    mirroredId,
    mirroredStatus
  );

  // Mark the customer so a deleted account is obvious in the Stripe dashboard.
  // The customer object itself stays: the invoices attached to it are the
  // records accounting law requires us to keep. Cosmetic, so failures here are
  // ignored rather than allowed to block an erasure request.
  if (customerId && stripeConfigured()) {
    try {
      await stripe().customers.update(customerId, {
        metadata: {
          meikero_account_deleted_at: new Date().toISOString(),
          meikero_user_id: userId,
        },
      });
    } catch {
      /* the dashboard note is not worth failing over */
    }
  }

  // --- 2. Product data ------------------------------------------------------

  const warnings: string[] = [];

  const { data: projects, error: listError } = await service
    .from("projects")
    .select("id")
    .eq("owner_id", userId);

  if (listError) {
    throw new DeletionBlocked(
      "Your sites could not be read, so nothing was deleted. " +
        "The subscription has been cancelled. Try again, or write to privacy@meikero.com.",
      [`projects (read): ${listError.message}`]
    );
  }

  const projectIds = (projects ?? []).map((row) => String(row.id));

  for (const projectId of projectIds) {
    warnings.push(...(await purgeProjectData(service, projectId)));
  }

  if (projectIds.length) {
    const { error } = await service.from("projects").delete().in("id", projectIds);

    if (error) {
      warnings.push(`projects: ${error.message}`);
    }
  }

  // Explicit rather than trusting the cascade from auth.users. These three do
  // cascade today, but a cascade quietly dropped in a future migration would
  // leave a person's data behind with no error to notice.
  for (const table of ["credit_ledger", "subscriptions", "profiles"] as const) {
    const column = table === "profiles" ? "id" : "user_id";
    const { error } = await service.from(table).delete().eq(column, userId);

    if (error) {
      warnings.push(`${table}: ${error.message}`);
    }
  }

  // --- 3. The account itself ------------------------------------------------

  // The stop that makes the rest honest. If any table refused — a missing
  // DELETE grant is the usual reason — the account stays, the person can still
  // reach it, and nobody is told their data is gone while it is not.
  if (warnings.length) {
    throw new DeletionBlocked(
      "Some of your data could not be deleted, so your account was kept rather than " +
        "leaving that data unreachable. Nothing further will be charged — any " +
        "subscription has been cancelled. Write to privacy@meikero.com and it will be " +
        "finished by hand.",
      warnings
    );
  }

  const { error: authError } = await service.auth.admin.deleteUser(userId);

  if (authError) {
    throw new DeletionBlocked(
      "Your data was deleted, but the sign-in record itself could not be removed: " +
        authError.message +
        " — write to privacy@meikero.com and it will be finished by hand."
    );
  }

  return { projects: projectIds.length, subscriptionsCanceled };
}

/**
 * Cancel every subscription this person could still be billed for.
 *
 * Asking Stripe for the customer's own list is what makes this reliable; the
 * mirrored id is only a fallback for the case where the profile has no
 * customer id but a subscription row exists anyway.
 */
async function cancelEverythingAtStripe(
  customerId: string,
  mirroredId: string,
  mirroredStatus: string
): Promise<number> {
  // "manual:..." ids are plans granted from the admin screen: there is nothing
  // at Stripe and no card behind them.
  const mirroredIsReal = mirroredId.length > 0 && !mirroredId.startsWith("manual:");
  const anythingToDo = customerId.length > 0 || mirroredIsReal;

  if (!anythingToDo) {
    return 0;
  }

  if (!stripeConfigured()) {
    // Only a hard stop if there is genuinely a card to stop charging.
    if (mirroredIsReal && !TERMINAL.has(mirroredStatus)) {
      throw new DeletionBlocked(
        "This account has a live Stripe subscription but STRIPE_SECRET_KEY is not " +
          "configured, so it cannot be cancelled. Deleting now would leave the card " +
          "being charged."
      );
    }

    return 0;
  }

  const ids = new Set<string>();

  if (customerId) {
    try {
      const list = await stripe().subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });

      for (const sub of list.data) {
        if (!TERMINAL.has(sub.status)) {
          ids.add(sub.id);
        }
      }
    } catch (error) {
      if (!isMissingAtStripe(error)) {
        throw new DeletionBlocked(
          "Could not read your subscriptions from Stripe, so the account was not " +
            "deleted — otherwise a card could keep being charged. " +
            describe(error)
        );
      }
      // A customer id that no longer exists at Stripe cannot be billing anyone.
    }
  }

  if (mirroredIsReal && !TERMINAL.has(mirroredStatus)) {
    ids.add(mirroredId);
  }

  let canceled = 0;

  for (const id of ids) {
    try {
      await stripe().subscriptions.cancel(id);
      canceled += 1;
    } catch (error) {
      if (isMissingAtStripe(error) || isAlreadyCanceled(error)) {
        continue;
      }

      throw new DeletionBlocked(
        `Could not cancel subscription ${id}, so the account was not deleted — ` +
          "otherwise the card would keep being charged. " +
          describe(error)
      );
    }
  }

  return canceled;
}

/** Stripe's way of saying the object is not there. */
function isMissingAtStripe(error: unknown): boolean {
  const err = error as Partial<Stripe.StripeRawError> | null;
  return err?.code === "resource_missing" || err?.statusCode === 404;
}

/**
 * Stripe rejects cancelling an already-cancelled subscription with a plain
 * invalid_request_error, not a distinct code. Without this, every person who
 * had ever cancelled a plan would be permanently unable to delete their
 * account — the mirrored row keeps the real id and Stripe keeps refusing.
 */
function isAlreadyCanceled(error: unknown): boolean {
  const err = error as Partial<Stripe.StripeRawError> | null;
  const message = String(err?.message ?? "").toLowerCase();

  return (
    err?.type === "invalid_request_error" &&
    (message.includes("canceled") || message.includes("cancelled"))
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
