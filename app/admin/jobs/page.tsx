import AdminJobs from "@/components/admin-jobs";
import { loadJobLog, type AdminJobRow } from "@/lib/admin/jobs";

export const dynamic = "force-dynamic";

/**
 * Recent generations, and what happened to each.
 *
 * The reason this exists: diagnosing a failed generation meant reading Vercel's
 * runtime logs, which needs a browser session on the Vercel dashboard. Every
 * fact that actually gets asked for — how far the run got, what it said, how
 * long it took, what it charged and whether that came back — was already in the
 * database and simply never shown.
 */
export default async function AdminJobsPage() {
  let jobs: AdminJobRow[] = [];
  let error = "";

  try {
    jobs = await loadJobLog(60);
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : String(loadError);
  }

  const failed = jobs.filter((j) => j.status === "error").length;
  const stuck = jobs.filter((j) => j.status === "running").length;
  const unrefunded = jobs.filter(
    (j) => j.status === "error" && j.charged > 0 && j.refunded === 0
  ).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-[1.6rem] font-semibold tracking-tight text-neutral-900">
        Generations
      </h1>
      <p className="mt-1.5 text-sm text-neutral-500">
        {jobs.length} recent · {failed} failed · {stuck} still running
        {unrefunded ? ` · ${unrefunded} charged without a refund` : ""}
      </p>

      {error ? (
        <div className="glass-card mt-6 p-6">
          <p className="text-sm text-red-700">Could not load the job log.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-red-900/70">
            {error}
          </pre>
        </div>
      ) : (
        <div className="mt-7">
          <AdminJobs jobs={jobs} />
        </div>
      )}
    </div>
  );
}
