import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Removing everything attached to one project.
 *
 * This lived inline in the project DELETE route until account deletion needed
 * exactly the same cascade. Two copies of a list of child tables is a bug
 * waiting for the next table to be added: whoever adds it will update one
 * copy, and the other will start leaving orphans behind quietly. One list.
 *
 * Deletion is deliberately forgiving. A table that does not exist in this
 * database, or one the service role cannot reach, is recorded as a warning
 * and the purge continues — a person asking to be forgotten must not be
 * blocked by a table nobody uses any more.
 */

/** Children reachable straight from the project. */
const PROJECT_CHILDREN = [
  "ai_conversations",
  "ai_proposals",
  "ai_apply_runs",
  "ai_jobs",
  "ai_usage",
  "ai_designs",
  "ai_live_steps",
  "site_api_keys",
  "wordpress_sites",
] as const;

export async function purgeProjectData(
  service: SupabaseClient,
  projectId: string
): Promise<string[]> {
  const warnings: string[] = [];

  // Grandchildren first: they hang off conversations and proposals, so
  // removing their parents first would leave rows nothing can reach.
  const { data: conversations } = await service
    .from("ai_conversations")
    .select("id")
    .eq("project_id", projectId);

  const conversationIds = (conversations ?? []).map((row) => String(row.id));

  if (conversationIds.length) {
    await note(warnings, "ai_messages", () =>
      service.from("ai_messages").delete().in("conversation_id", conversationIds)
    );
    await note(warnings, "ai_runs", () =>
      service.from("ai_runs").delete().in("conversation_id", conversationIds)
    );
  }

  const { data: proposals } = await service
    .from("ai_proposals")
    .select("id")
    .eq("project_id", projectId);

  const proposalIds = (proposals ?? []).map((row) => String(row.id));

  if (proposalIds.length) {
    await note(warnings, "ai_proposal_files", () =>
      service.from("ai_proposal_files").delete().in("proposal_id", proposalIds)
    );
  }

  for (const table of PROJECT_CHILDREN) {
    await note(warnings, table, () =>
      service.from(table).delete().eq("project_id", projectId)
    );
  }

  return warnings;
}

/** Run one delete, and turn its error into a warning rather than a throw. */
async function note(
  warnings: string[],
  table: string,
  run: () => PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  try {
    const { error } = await run();

    if (error) {
      warnings.push(`${table}: ${error.message}`);
    }
  } catch (error) {
    warnings.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
