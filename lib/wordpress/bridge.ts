import { assertSafeBridgeOrigin } from "@/lib/security/url-guard";

export type ProjectScope = "theme" | "plugin";
export type ProjectFileOperation = "modify" | "create";

export class WordPressBridgeError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "WordPressBridgeError";
    this.status = status;
    this.data = data;
  }
}

async function getSafeOrigin(siteUrl: string) {
  const { origin } = await assertSafeBridgeOrigin(siteUrl);

  return origin;
}

async function bridgeRequest(
  siteUrl: string,
  token: string,
  endpoint: string,
  options?: {
    method?: "GET" | "POST";
    params?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  }
) {
  const origin = await getSafeOrigin(siteUrl);
  const url = new URL(`/wp-json/wp-ai-builder/v1/${endpoint}`, origin);

  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const method = options?.method ?? "GET";

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(method === "POST"
        ? {
            "Content-Type": "application/json",
          }
        : {}),
    },
    body:
      method === "POST" && options && "body" in options
        ? JSON.stringify(options.body)
        : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(options?.timeoutMs ?? 10000),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : `WordPress Bridge returned HTTP ${response.status}.`;

    throw new WordPressBridgeError(message, response.status, data);
  }

  if (!contentType.includes("application/json")) {
    throw new WordPressBridgeError(
      "WordPress Bridge did not return JSON.",
      response.status,
      null
    );
  }

  return data;
}

export async function getBridgeStatus(siteUrl: string, token: string) {
  return bridgeRequest(siteUrl, token, "status");
}

export async function getBridgeProject(siteUrl: string, token: string) {
  return bridgeRequest(siteUrl, token, "project");
}

export async function getBridgeManifest(siteUrl: string, token: string) {
  return bridgeRequest(siteUrl, token, "manifest");
}

export async function getBridgeSnapshots(siteUrl: string, token: string) {
  return bridgeRequest(siteUrl, token, "snapshots");
}

export async function listProjectFiles(
  siteUrl: string,
  token: string,
  scope: ProjectScope
) {
  return bridgeRequest(siteUrl, token, "files", {
    params: {
      scope,
    },
  });
}

/* ---------------------------------------------------------------------------
 * Native WordPress content (Phase 1, read-only): pages, posts, custom post
 * types, WooCommerce products, menus and media. Lets the agent see the site's
 * real content — not just theme/plugin source files.
 * ------------------------------------------------------------------------ */

export async function listSiteContentTypes(siteUrl: string, token: string) {
  return bridgeRequest(siteUrl, token, "content-types");
}

export async function listSiteContent(
  siteUrl: string,
  token: string,
  type: string,
  limit = 30
) {
  return bridgeRequest(siteUrl, token, "content", {
    params: {
      type,
      limit: String(limit),
    },
  });
}

export async function getSiteContentItem(
  siteUrl: string,
  token: string,
  type: string,
  id: number
) {
  return bridgeRequest(siteUrl, token, "content-item", {
    params: {
      type,
      id: String(id),
    },
  });
}

export type ContentUpdateFields = {
  title?: string;
  content?: string;
  excerpt?: string;
  status?: string;
  product?: {
    regular_price?: string;
    sale_price?: string;
    sku?: string;
    stock_status?: string;
  };
};

export async function updateSiteContent(
  siteUrl: string,
  token: string,
  payload: {
    type: string;
    id: number;
    fields: ContentUpdateFields;
  }
) {
  return bridgeRequest(siteUrl, token, "content-update", {
    method: "POST",
    body: payload,
    timeoutMs: 30000,
  });
}

export async function readProjectFile(
  siteUrl: string,
  token: string,
  scope: ProjectScope,
  path: string
) {
  return bridgeRequest(siteUrl, token, "file", {
    params: {
      scope,
      path,
    },
  });
}

export async function readProjectFiles(
  siteUrl: string,
  token: string,
  scope: ProjectScope,
  paths: string[]
) {
  if (paths.length < 1 || paths.length > 8) {
    throw new Error("readProjectFiles requires between 1 and 8 paths.");
  }

  const files = await Promise.all(
    paths.map(async (path) => {
      const result = await readProjectFile(siteUrl, token, scope, path);

      if (
        result &&
        typeof result === "object" &&
        "content" in result &&
        typeof result.content === "string" &&
        result.content.length > 60000
      ) {
        return {
          ...result,
          content: result.content.slice(0, 60000),
          truncated: true,
          original_chars: result.content.length,
        };
      }

      return result;
    })
  );

  return {
    scope,
    count: files.length,
    files,
  };
}

export type BridgeChangePayload = {
  operation: ProjectFileOperation;
  scope: ProjectScope;
  path: string;
  expected_sha256: string | null;
  content: string;
};

export async function preflightProjectChanges(
  siteUrl: string,
  token: string,
  files: BridgeChangePayload[]
) {
  return bridgeRequest(siteUrl, token, "preflight", {
    method: "POST",
    body: {
      files,
    },
    timeoutMs: 30000,
  });
}

export async function applyProjectChanges(
  siteUrl: string,
  token: string,
  payload: {
    proposal_id: string;
    files: BridgeChangePayload[];
  }
) {
  return bridgeRequest(siteUrl, token, "apply", {
    method: "POST",
    body: payload,
    timeoutMs: 30000,
  });
}

export async function rollbackProjectSnapshot(
  siteUrl: string,
  token: string,
  snapshotId: string
) {
  return bridgeRequest(siteUrl, token, "rollback", {
    method: "POST",
    body: {
      snapshot_id: snapshotId,
    },
    timeoutMs: 30000,
  });
}
