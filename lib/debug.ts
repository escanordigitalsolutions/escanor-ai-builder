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

/**
 * A readable one-liner for any thrown value, cause chain included.
 *
 * Node's fetch throws `TypeError: fetch failed` and puts the real reason in
 * `cause` — so a stored `error.message` reads "fetch failed" and says nothing.
 * That cost an hour of investigation for a failure whose cause was
 * `UND_ERR_BODY_TIMEOUT`, a name that would have identified it instantly.
 *
 * The chain is walked, not just the first link: undici nests the code one level
 * below the message, and a transport error usually carries `code`, `errno` or
 * `syscall` that name the failure far better than any prose.
 */
export function describeError(error: unknown, depth = 3): string {
  if (error instanceof Error) {
    const extra = errorCode(error);
    const head = `${error.name}: ${error.message}${extra ? ` [${extra}]` : ""}`;

    if (depth > 0 && error.cause !== undefined && error.cause !== null) {
      return `${head} <- ${describeError(error.cause, depth - 1)}`;
    }

    return head;
  }

  if (typeof error === "string") return error;

  try {
    // JSON.stringify returns undefined — not a string — for undefined, a
    // function and a symbol. This function's whole job is producing something
    // storable that says what went wrong, so handing back undefined turns a
    // failure into a blank record. Found by a test the runner could not run.
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The machine-readable part of a transport error, when there is one. */
function errorCode(error: Error): string {
  const row = error as unknown as Record<string, unknown>;

  return ["code", "errno", "syscall"]
    .map((key) => (typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : ""))
    .filter(Boolean)
    .join(" ");
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
