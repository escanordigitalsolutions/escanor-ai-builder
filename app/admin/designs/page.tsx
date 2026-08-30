import AdminDesigns from "@/components/admin-designs";
import { loadDesignArchive, type AdminDesignRow } from "@/lib/admin/designs";

export const dynamic = "force-dynamic";

/**
 * Every design this product has ever generated.
 *
 * The point is comparison over time. Before this existed a design lived in a
 * job row that was swept away after a day, so the only way to judge whether a
 * prompt change had helped was to remember the last one.
 *
 * The is_admin gate is app/admin/layout.tsx, which wraps this page; the API
 * route beside it checks again for itself, because a route is not inside a
 * layout.
 */
export default async function AdminDesignsPage() {
  let designs: AdminDesignRow[] = [];
  let error = "";

  try {
    designs = await loadDesignArchive(100);
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : String(loadError);
  }

  const clean = designs.filter((d) => d.fatal === 0).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-[1.6rem] font-semibold tracking-tight text-neutral-900">
        Design archive
      </h1>
      <p className="mt-1.5 text-sm text-neutral-500">
        {designs.length} {designs.length === 1 ? "design" : "designs"} · {clean} with no
        fatal validation failure · {designs.filter((d) => d.hasInner).length} kept an
        inner page
      </p>

      {error ? (
        <div className="glass-card mt-6 p-6">
          <p className="text-sm text-red-700">Could not load the archive.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-900/70">
            {error}
            {/column|does not exist/i.test(error)
              ? "\n\nThe migration 20260830_design_archive_v4f.sql has not been run yet."
              : ""}
          </pre>
        </div>
      ) : (
        <div className="mt-7">
          <AdminDesigns designs={designs} />
        </div>
      )}
    </div>
  );
}
