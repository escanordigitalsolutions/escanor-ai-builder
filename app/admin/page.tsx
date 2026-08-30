import Link from "next/link";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Every project on the platform, not just the admin's own.
 *
 * Uses the service client on purpose: row-level security scopes the ordinary
 * client to the signed-in owner, which is right for the app and useless for
 * operating it. The is_admin check in the layout above is what makes this safe.
 */

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  created_at: string;
  owner_id: string;
  wordpress_sites: { site_url: string | null; last_connected_at: string | null }[] | null;
};

export default async function AdminIndexPage() {
  const db = createServiceClient();

  const [{ data: projects }, { count: userCount }] = await Promise.all([
    db
      .from("projects")
      .select("id, name, created_at, owner_id, wordpress_sites ( site_url, last_connected_at )")
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  const rows = (projects ?? []) as unknown as Row[];

  // One query for the owners on this page rather than one per row.
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id).filter(Boolean)));
  const { data: owners } = ownerIds.length
    ? await db.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] };

  const emailFor = new Map(
    (owners ?? []).map((o) => [String(o.id), String(o.email ?? "")])
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-[1.6rem] font-semibold tracking-tight text-neutral-900">
        All projects
      </h1>
      <p className="mt-1.5 text-sm text-neutral-500">
        {rows.length} shown · {userCount ?? 0} accounts
      </p>

      <div className="mt-7 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              {["Project", "Owner", "Site", "Last seen", "Created"].map((h) => (
                <th
                  key={h}
                  className="border-b border-neutral-900/15 py-2 pr-5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const site = Array.isArray(row.wordpress_sites)
                ? row.wordpress_sites[0]
                : null;
              return (
                <tr key={row.id}>
                  <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5">
                    <Link
                      href={`/admin/projects/${row.id}`}
                      className="font-medium text-neutral-900 underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 text-neutral-600">
                    {emailFor.get(row.owner_id) ?? "—"}
                  </td>
                  <td className="max-w-[220px] truncate border-b border-neutral-900/[0.07] py-2.5 pr-5 text-neutral-600">
                    {site?.site_url ?? "—"}
                  </td>
                  <td className="border-b border-neutral-900/[0.07] py-2.5 pr-5 tabular-nums text-neutral-600">
                    {site?.last_connected_at
                      ? new Date(site.last_connected_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="border-b border-neutral-900/[0.07] py-2.5 tabular-nums text-neutral-600">
                    {new Date(row.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
