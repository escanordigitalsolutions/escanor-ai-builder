export type ProjectScope =
  | "theme"
  | "plugin";

function getAllowedHosts() {
  return new Set(
    (
      process.env.WP_BRIDGE_ALLOWED_HOSTS ?? ""
    )
      .split(",")
      .map((host) =>
        host.trim().toLowerCase()
      )
      .filter(Boolean)
  );
}

function getSafeOrigin(siteUrl: string) {
  const url = new URL(siteUrl);

  if (url.protocol !== "https:") {
    throw new Error(
      "WordPress site must use HTTPS."
    );
  }

  const hostname =
    url.hostname.toLowerCase();

  if (!getAllowedHosts().has(hostname)) {
    throw new Error(
      "WordPress hostname is not allowed."
    );
  }

  return url.origin;
}

async function bridgeRequest(
  siteUrl: string,
  token: string,
  endpoint: string,
  params?: Record<string, string>
) {
  const origin =
    getSafeOrigin(siteUrl);

  const url = new URL(
    `/wp-json/wp-ai-builder/v1/${endpoint}`,
    origin
  );

  if (params) {
    Object.entries(params).forEach(
      ([key, value]) => {
        url.searchParams.set(
          key,
          value
        );
      }
    );
  }

  const response = await fetch(
    url.toString(),
    {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${token}`,

        Accept:
          "application/json",
      },

      cache: "no-store",

      redirect: "error",

      signal:
        AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error(
      `WordPress Bridge returned HTTP ${response.status}.`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) ?? "";

  if (
    !contentType.includes(
      "application/json"
    )
  ) {
    throw new Error(
      "WordPress Bridge did not return JSON."
    );
  }

  return response.json();
}

export async function listProjectFiles(
  siteUrl: string,
  token: string,
  scope: ProjectScope
) {
  return bridgeRequest(
    siteUrl,
    token,
    "files",
    {
      scope,
    }
  );
}

export async function readProjectFile(
  siteUrl: string,
  token: string,
  scope: ProjectScope,
  path: string
) {
  return bridgeRequest(
    siteUrl,
    token,
    "file",
    {
      scope,
      path,
    }
  );
}
