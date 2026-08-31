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
  maxGroups: 12,
  maxFilesPerGroup: 200,
  maxRoleChars: 200,
  /** What a single read hands the model, matching the bridge's behaviour. */
  maxReadChars: 60_000,
} as const;

/** The theme grouped by what each file is for, as the plugin classified it. */
export type ThemeStructure = {
  scope: string;
  theme: string;
  count: number;
  bytes: number;
  groups: {
    key: string;
    label: string;
    files: {
      path: string;
      bytes: number;
      role: string;
      /** Someone edited this file outside Meikero since we last wrote it. */
      drifted?: boolean;
    }[];
  }[];
};

export type ProjectSnapshot = {
  scope: ProjectScope;
  files: Map<string, string>;
  /** The plugin's own map of the theme. Null when it did not send one. */
  structure: ThemeStructure | null;
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
 * Validate the grouped structure the plugin sent.
 *
 * It is rendered as text in two places and shown to a model in a third, so
 * every string is bounded and every path is checked the same way the file map's
 * keys are. A structure that does not survive this is simply absent — the tool
 * then falls back to the flat listing, which is worse but never wrong.
 */
function parseThemeStructure(input: unknown): ThemeStructure | null {
  if (!input || typeof input !== "object") return null;

  const raw = input as Record<string, unknown>;

  if (!Array.isArray(raw.groups)) return null;

  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.slice(0, max) : "";

  const groups: ThemeStructure["groups"] = [];

  for (const entry of raw.groups.slice(0, SNAPSHOT_LIMITS.maxGroups)) {
    if (!entry || typeof entry !== "object") continue;

    const group = entry as Record<string, unknown>;

    if (!Array.isArray(group.files)) continue;

    const files = group.files
      .slice(0, SNAPSHOT_LIMITS.maxFilesPerGroup)
      .map((file) => {
        if (!file || typeof file !== "object") return null;

        const row = file as Record<string, unknown>;
        const path = typeof row.path === "string" ? row.path : "";

        if (!isSafePath(path)) return null;

        return {
          path,
          bytes: typeof row.bytes === "number" && row.bytes >= 0 ? Math.floor(row.bytes) : 0,
          role: text(row.role, SNAPSHOT_LIMITS.maxRoleChars),
          ...(row.drifted === true ? { drifted: true } : {}),
        };
      })
      .filter((file): file is ThemeStructure["groups"][number]["files"][number] => file !== null);

    if (files.length === 0) continue;

    groups.push({
      key: text(group.key, 40),
      label: text(group.label, 60),
      files,
    });
  }

  if (groups.length === 0) return null;

  return {
    scope: text(raw.scope, 40) || "theme",
    theme: text(raw.theme, 120),
    count: groups.reduce((sum, group) => sum + group.files.length, 0),
    bytes: groups.reduce(
      (sum, group) => sum + group.files.reduce((n, file) => n + file.bytes, 0),
      0
    ),
    groups,
  };
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

  return {
    scope: "theme",
    files,
    structure: parseThemeStructure(raw.structure),
    truncated,
    skipped,
  };
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

/**
 * The theme map as compact text for a prompt.
 *
 * JSON would cost two to three times the tokens for the same facts, on every
 * turn, to say something a model reads better as a list. Roles are dropped —
 * they exist to explain WordPress to a person, and the model already knows
 * what header.php is.
 */
export function renderStructureForPrompt(structure: ThemeStructure): string {
  const drifted: string[] = [];

  const groups = structure.groups.map((group) => {
    const files = group.files
      .map((file) => {
        if (file.drifted) drifted.push(file.path);

        return `  ${file.path} (${Math.round(file.bytes / 100) / 10}KB)${
          file.drifted ? " [EDITED OUTSIDE MEIKERO]" : ""
        }`;
      })
      .join("\n");

    return `${group.label}:\n${files}`;
  });

  // A file somebody changed by hand is the one place a whole-file rewrite does
  // real damage, so the model is told before it plans, not after.
  const warning = drifted.length
    ? [
        "",
        `WARNING: ${drifted.join(", ")} ${
          drifted.length === 1 ? "has" : "have"
        } been changed outside Meikero since this theme was last written. Read ${
          drifted.length === 1 ? "it" : "them"
        } before changing anything there, and prefer a targeted edit over rewriting the file.`,
      ]
    : [];

  return [
    `Active theme: ${structure.theme || "unknown"} — ${structure.count} files.`,
    ...groups,
    ...warning,
  ].join("\n");
}

export type ProjectFileReader = {
  /** Where the files came from — surfaced in the ops log, not to the model. */
  source: "site" | "bridge";
  list(scope: ProjectScope): Promise<unknown>;
  read(scope: ProjectScope, paths: string[]): Promise<unknown>;
  /** The grouped map, or a flat listing when the plugin sent no structure. */
  structure(scope: ProjectScope): Promise<unknown>;
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

    async structure(scope) {
      const shot = usable(scope);

      if (shot?.structure) return shot.structure;

      // An older plugin, or the browser dashboard. The flat list still answers
      // the question, so say what is missing rather than failing.
      return {
        grouped: false,
        note: "This site did not send a grouped theme map, so this is the flat file list.",
        listing: await this.list(scope),
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
