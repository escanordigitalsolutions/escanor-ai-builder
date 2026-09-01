import { createServiceClient } from "@/lib/supabase/service";

/**
 * Every design ever generated, across every account.
 *
 * This exists because prompt work was unmeasurable. A design lived in a job row
 * that was swept after a day, so two runs a week apart could not be compared,
 * and there was no way to answer "did that change make the output better" with
 * anything but memory.
 *
 * The big columns are dropped before returning: thirty rows of homepage HTML is
 * a megabyte of payload for a list nobody reads that way, so markup is fetched
 * only when a row is actually opened.
 *
 * It lives here rather than in the route so the admin page can call it in
 * process. A server component fetching its own API over HTTP has to rebuild the
 * request, forward the cookie, and guess its own hostname — three things that
 * can each break in a deployment while working perfectly in development.
 */

export type AdminDesignRow = {
  id: string;
  createdAt: string;
  project: string;
  projectId: string;
  owner: string;
  model: string;
  status: string;
  concept: string | null;
  shape: string | null;
  retried: boolean;
  critique: string | null;
  signatureMove: string | null;
  fonts: string;
  accent: string;
  /** Cache-buster for the preview picture; 0 = none, show the accent square. */
  thumb: number;
  failures: number;
  fatal: number;
  hasInner: boolean;
  chars: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export async function loadDesignArchive(limit = 60): Promise<AdminDesignRow[]> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("ai_designs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));

  if (error) throw error;

  // Cast once: this table is not in a generated schema type, so without it
  // every field access below is an error against supabase-js's fallback type.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // Names for the project ids, in one query rather than one per row.
  const projectIds = [...new Set(rows.map((r) => String(r.project_id)).filter(Boolean))];

  const { data: projectRows } = projectIds.length
    ? await db.from("projects").select("id, name, owner_id").in("id", projectIds)
    : { data: [] };

  const projects = (projectRows ?? []) as unknown as Record<string, unknown>[];

  const ownerIds = [...new Set(projects.map((p) => String(p.owner_id)).filter(Boolean))];

  const { data: ownerRows } = ownerIds.length
    ? await db.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] };

  const owners = (ownerRows ?? []) as unknown as Record<string, unknown>[];

  const projectById = new Map(projects.map((p) => [String(p.id), p]));
  const emailById = new Map(owners.map((o) => [String(o.id), String(o.email ?? "")]));

  return rows.map((row) => {
    const project = projectById.get(String(row.project_id));
    const direction = (row.direction ?? null) as Record<string, unknown> | null;
    const failures = Array.isArray(row.validation) ? row.validation : [];

    return {
      id: String(row.id),
      createdAt: String(row.created_at ?? ""),
      project: String(project?.name ?? "(deleted site)"),
      projectId: String(row.project_id ?? ""),
      owner: project ? (emailById.get(String(project.owner_id)) ?? "") : "",
      model: String(row.model ?? ""),
      status: String(row.status ?? ""),
      concept: (row.concept as string | null) ?? null,
      shape: (row.shape as string | null) ?? null,
      retried: Boolean(row.retried),
      critique: (row.critique as string | null) ?? null,
      signatureMove:
        direction && typeof direction.signatureMove === "string"
          ? direction.signatureMove
          : null,
      fonts: readFonts(direction),
      accent: readAccent(direction),
      thumb:
        typeof ((row.assets as Record<string, unknown> | null)?.thumb as { version?: unknown } | undefined)
          ?.version === "number"
          ? (((row.assets as Record<string, unknown>).thumb as { version: number }).version)
          : 0,
      failures: failures.length,
      fatal: failures.filter((f: unknown) => (f as { fatal?: boolean })?.fatal).length,
      // Flags, not payloads: the list must stay small.
      hasInner: Boolean(row.inner_html),
      chars: typeof row.html === "string" ? row.html.length : 0,
      inputTokens: (row.input_tokens as number | null) ?? null,
      outputTokens: (row.output_tokens as number | null) ?? null,
    };
  });
}

function readFonts(direction: Record<string, unknown> | null): string {
  const typography = (direction?.typography ?? null) as Record<string, unknown> | null;

  if (!typography) return "";

  const display = (typography.display ?? {}) as { family?: unknown };
  const text = (typography.text ?? {}) as { family?: unknown };

  return [display.family, text.family].filter((f) => typeof f === "string").join(" \u00b7 ");
}

function readAccent(direction: Record<string, unknown> | null): string {
  const tokens = (direction?.tokens ?? null) as Record<string, unknown> | null;
  const color = (tokens?.color ?? null) as Record<string, unknown> | null;

  return typeof color?.accent === "string" ? color.accent : "";
}
