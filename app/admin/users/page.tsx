import { createServiceClient } from "@/lib/supabase/service";
import AdminUsers, { type AdminUserRow } from "@/components/admin-users";

export const dynamic = "force-dynamic";

/**
 * Every account, and the two things an operator actually needs to change
 * about one: how many credits it has, and what plan it is on.
 *
 * The is_admin gate lives in app/admin/layout.tsx; the mutations behind the
 * buttons check it again for themselves, because an API route is not inside
 * a layout.
 */
export default async function AdminUsersPage() {
  const { data, error } = await createServiceClient().rpc("admin_user_overview");

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-[1.6rem] font-semibold tracking-tight text-neutral-900">
          Accounts
        </h1>
        <div className="glass-card mt-6 p-6">
          <p className="text-sm text-red-700">Could not load accounts.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-900/70">
            {error.message}
            {error.message.includes("admin_user_overview")
              ? "\n\nThe migration 20260830_admin_overview_v4c.sql has not been run yet."
              : ""}
          </pre>
        </div>
      </div>
    );
  }

  const users = (data ?? []) as AdminUserRow[];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-[1.6rem] font-semibold tracking-tight text-neutral-900">
        Accounts
      </h1>
      <p className="mt-1.5 text-sm text-neutral-500">
        {users.length} {users.length === 1 ? "account" : "accounts"} ·{" "}
        {users.filter((u) => u.plan_key && u.status === "active").length} on a
        paid plan
      </p>

      <div className="mt-7">
        <AdminUsers users={users} />
      </div>
    </div>
  );
}
