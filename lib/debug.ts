/**
 * Verbose error reporting.
 *
 * While Meikero is being brought up, a generic "something went wrong" costs
 * more than it protects: every failure has to be chased through logs that are
 * awkward to reach from a WordPress admin screen. So API routes attach the
 * real message, and the UI shows it.
 *
 * ON by default. Set DEBUG_ERRORS=0 in the environment before taking real
 * customers — after that, details stay in the server logs where they belong,
 * because error text can name internal hosts, table names and configuration.
 */

export function debugErrors(): boolean {
  return process.env.DEBUG_ERRORS !== "0";
}

/** A readable one-liner for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }

  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * The `detail` field to merge into an error response — an empty object when
 * debugging is off, so the same call site works in both modes.
 */
export function errorDetail(
  error: unknown,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  if (!debugErrors()) return {};

  return {
    detail: describeError(error),
    ...(extra ?? {}),
    ...(error instanceof Error && error.stack
      ? { stack: error.stack.split("\n").slice(0, 6).join("\n") }
      : {}),
  };
}
