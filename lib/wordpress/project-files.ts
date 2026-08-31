import { createHash } from "node:crypto";

import {
  listProjectFiles,
  readProjectFiles,
  type ProjectScope,
} from "./bridge";

/**
 * Reading the theme WITHOUT needing to reach the site.
 *
 * The bridge was built as a pull: the SaaS called back into the customer's
 * WordPress over HTTP whenever the agent wanted a file. That works only when
 * the site is publicly reachable from Vercel within ten seconds, which a large
 * share of real WordPress installs are not — behind Cloudflare, behind HTTP
 * auth, on a host that blocks datacentre IPs, or simply slow. Theme generation
 * never noticed, because it is a pure push: wp-admin sends the brief and writes
 * the returned files itself. Chat and edits died on the pull.
 *
 * So the plugin now sends the theme with the request. This module turns that
 * pushed snapshot into the same list/read interface the agent routes already
 * used, and keeps the HTTP pull as a fallback for callers that send nothing
 * (the browser dashboard) or a snapshot the plugin had to cut short.
 */

export const SNAPSHOT_LIMITS = {
  /** Files in one snapshot. A generated theme is ~30. */
  maxFiles: 400,
  /** Per file. Matches the bridge's own read limit. */
  maxFileBytes: 200_000,
  /**
   * Whole snapshot. Above this the plugin truncates and we fall back.
   *
   * Bounded by Vercel's 4.5 MB request body limit, which this shares with a
   * chat message's optional 3 MB screenshot. Must match
   * WPAB_Files::SNAPSHOT_MAX_TOTAL_BYTES in the plugin.
   */
  maxTotalBytes: 800_000,
  maxPathLength: 200,
  /** What a single read hands the model, matching the bridge's behaviour. */
  maxReadChars: 60_000,
} as const;

export type ProjectSnapshot = {
  scope: ProjectScope;
  files: Map<string, string>;
  /** The plugin stopped early: absent paths may still exist on disk. */
  truncated: boolean;
  /** Files the plugin refused to send (binary, too large, unreadable). */
  skipped: number;
};

/** A path is only ever a relative path inside the theme. */
function isSafePath(path: string): boolean {
  if (!path || path.length > SNAPSHOT_LIMITS.maxPathLength) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || path.startsWith(".")) return false;
  return !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

/**
 * Validate a snapshot pushed by the plugin.
 *
 * Everything here arrives from a site we authenticated but do not control, so
 * it is treated as hostile input: unknown shapes, unsafe paths and oversized
 * payloads are dropped rather than trusted, and a snapshot that loses files
 * this way is marked truncated so the caller can still fall back to the pull.
 */
export function parseProjectSnapshot(input: unknown): ProjectSnapshot | null {
  if (!input || typeof input !== "object") return null;

  const raw = input as Record<string, unknown>;

  if (raw.scope !== "theme") return null;
  if (!raw.files || typeof raw.files !== "object" || Array.isArray(raw.files)) {
    return null;
  }

  const files = new Map<string, string>();
  let truncated = raw.truncated === true;
  let total = 0;

  for (const [path, content] of Object.entries(raw.files as Record<string, unknown>)) {
    if (files.size >= SNAPSHOT_LIMITS.maxFiles) {
      truncated = true;
      break;
    }

    if (typeof content !== "string" || !isSafePath(path)) {
      truncated = true;
      continue;
    }

    const bytes = Buffer.byteLength(content, "utf8");

    if (bytes > SNAPSHOT_LIMITS.maxFileBytes) {
      truncated = true;
      continue;
    }

    if (total + bytes > SNAPSHOT_LIMITS.maxTotalBytes) {
      truncated = true;
      break;
    }

    total += bytes;
    files.set(path, content);
  }

  if (files.size === 0) return null;

  const skipped = typeof raw.skipped === "number" && raw.skipped > 0 ? Math.floor(raw.skipped) : 0;

  return { scope: "theme", files, truncated, skipped };
}

function describeFile(path: string, content: string) {
  const dot = path.lastIndexOf(".");

  return {
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    extension: dot > 0 ? path.slice(dot + 1).toLowerCase() : "",
  };
}

function readFromSnapshot(scope: ProjectScope, path: string, content: string) {
  const oversized = content.length > SNAPSHOT_LIMITS.maxReadChars;

  return {
    success: true,
    scope,
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content).digest("hex"),
    extension: describeFile(path, content).extension,
    content: oversized ? content.slice(0, SNAPSHOT_LIMITS.maxReadChars) : content,
    ...(oversized ? { truncated: true, original_chars: content.length } : {}),
  };
}

export type ProjectFileReader = {
  /** Where the files came from — surfaced in the ops log, not to the model. */
  source: "site" | "bridge";
  list(scope: ProjectScope): Promise<unknown>;
  read(scope: ProjectScope, paths: string[]): Promise<unknown>;
};

/**
 * The list/read pair the agent routes call, served from the pushed snapshot
 * when there is one and from the HTTP bridge when there is not.
 */
export function createProjectFileReader(options: {
  snapshot: ProjectSnapshot | null;
  siteUrl: string;
  token: string;
}): ProjectFileReader {
  const { snapshot, siteUrl, token } = options;

  const usable = (scope: ProjectScope) => (snapshot && snapshot.scope === scope ? snapshot : null);

  return {
    source: snapshot ? "site" : "bridge",

    async list(scope) {
      const shot = usable(scope);

      if (!shot) return listProjectFiles(siteUrl, token, scope);

      const files = [...shot.files.entries()].map(([path, content]) =>
        describeFile(path, content)
      );

      files.sort((a, b) => a.path.localeCompare(b.path));

      return {
        success: true,
        scope,
        count: files.length,
        total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        truncated: shot.truncated,
        skipped: shot.skipped,
        files,
      };
    },

    async read(scope, paths) {
      const shot = usable(scope);

      if (!shot) return readProjectFiles(siteUrl, token, scope, paths);

      const found = paths.filter((path) => shot.files.has(path));
      const missing = paths.filter((path) => !shot.files.has(path));

      // A complete snapshot is the whole truth: a path that is not in it does
      // not exist, and calling the site to confirm that would reintroduce
      // exactly the dependency this module removes. Only a snapshot the plugin
      // had to cut short is worth a trip to the bridge.
      let pulled: Record<string, unknown>[] = [];

      if (missing.length > 0 && shot.truncated) {
        try {
          const result = await readProjectFiles(siteUrl, token, scope, missing.slice(0, 8));
          const list = (result as { files?: unknown }).files;
          if (Array.isArray(list)) pulled = list as Record<string, unknown>[];
        } catch {
          // The site is unreachable — the usual case. Report the paths as
          // unavailable instead of failing the whole conversation.
          pulled = [];
        }
      }

      const pulledPaths = new Set(
        pulled
          .map((file) => (typeof file.path === "string" ? file.path : ""))
          .filter(Boolean)
      );

      const files = [
        ...found.map((path) => readFromSnapshot(scope, path, shot.files.get(path) as string)),
        ...pulled,
        ...missing
          .filter((path) => !pulledPaths.has(path))
          .map((path) => ({
            success: false,
            scope,
            path,
            error: "That file is not part of this theme.",
          })),
      ];

      return { scope, count: files.length, files };
    },
  };
}
