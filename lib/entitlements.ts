/**
 * Module entitlements.
 *
 * ESCANOR is a suite of independent modules. A project is licensed for some
 * subset of them; the wp-admin plugin locks the rest. This file is the single
 * source of truth for what the module keys are, how a stored (possibly partial
 * or absent) config resolves to a full boolean map, and how a route asserts a
 * module before doing work.
 *
 * Design notes:
 *  - "content" is the base module. It is always on and can never be locked.
 *  - An unconfigured project (NULL `modules`) resolves to the permissive
 *    default so nothing that works today breaks. Locking is opt-in, set per
 *    project from the dashboard.
 *  - The lookup never throws: a database error (e.g. the migration has not run
 *    yet) falls back to defaults and logs, so the handshake keeps working.
 */

export type ModuleKey = "content" | "seo" | "health" | "build";

export type Modules = Record<ModuleKey, boolean>;

export const MODULE_KEYS: ModuleKey[] = ["content", "seo", "health", "build"];

/**
 * Permissive default: everything on. Existing projects keep working exactly as
 * before until someone deliberately locks a module for them.
 */
export const DEFAULT_MODULES: Modules = {
  content: true,
  seo: true,
  health: true,
  build: true,
};

export const DEFAULT_PLAN = "free";

/**
 * Coerce whatever is stored (null, partial object, junk) into a full map.
 * `content` is forced on regardless of what is stored.
 */
export function resolveModules(raw: unknown): Modules {
  const out: Modules = { ...DEFAULT_MODULES };

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;

    for (const key of MODULE_KEYS) {
      if (typeof obj[key] === "boolean") {
        out[key] = obj[key] as boolean;
      }
    }
  }

  out.content = true; // base module never locks

  return out;
}

export function resolvePlan(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_PLAN;
}

export function moduleEnabled(modules: Modules, key: ModuleKey): boolean {
  return Boolean(modules[key]);
}

export type Entitlements = {
  modules: Modules;
  plan: string;
};

export function defaultEntitlements(): Entitlements {
  return { modules: { ...DEFAULT_MODULES }, plan: DEFAULT_PLAN };
}
