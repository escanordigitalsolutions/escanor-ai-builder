import {
  getSiteContentItem,
  listSiteContent,
  listSiteContentTypes,
} from "./bridge";

/**
 * The site's CONTENT, sent with the request instead of fetched from the site.
 *
 * The sibling of project-files.ts, for the other half of what the chat can
 * look at. Theme files were the easy half — a fixed, small set. Content is
 * open-ended, so the plugin sends it in three layers, cheapest first: every
 * content type with a count, then the most recently modified items per type,
 * then the actual text of as many of those items as its budget allows, pages
 * before posts. Anything the plugin could not fit is marked, and only then is
 * the old HTTP pull worth one attempt.
 */

export const CONTENT_SNAPSHOT_LIMITS = {
  maxTypes: 50,
  maxListings: 20,
  maxItemsPerType: 100,
  maxBodies: 60,
  /** Guards the whole snapshot, measured as encoded JSON. */
  maxTotalBytes: 600_000,
} as const;

export type ContentSnapshot = {
  types: unknown | null;
  /** type key -> the items the plugin listed for it. */
  listings: Map<string, unknown[]>;
  /** "page:12" -> the full item. */
  bodies: Map<string, unknown>;
  /** The plugin could not fit everything; a miss may still exist on the site. */
  truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A content type key: short, lowercase-ish, no separators to smuggle. */
function isTypeKey(value: string): boolean {
  return /^[a-z0-9_-]{1,40}$/i.test(value);
}

/**
 * Validate a content snapshot pushed by the plugin. Hostile input, same as the
 * theme snapshot: anything unexpected is dropped and the result marked
 * truncated rather than trusted.
 */
export function parseContentSnapshot(input: unknown): ContentSnapshot | null {
  if (!isRecord(input)) return null;

  let truncated = input.truncated === true;

  const types = isRecord(input.types) ? input.types : null;
  const listings = new Map<string, unknown[]>();
  const bodies = new Map<string, unknown>();

  if (types && Array.isArray(types.types) && types.types.length > CONTENT_SNAPSHOT_LIMITS.maxTypes) {
    types.types = types.types.slice(0, CONTENT_SNAPSHOT_LIMITS.maxTypes);
    truncated = true;
  }

  if (isRecord(input.listings)) {
    for (const [key, items] of Object.entries(input.listings)) {
      if (listings.size >= CONTENT_SNAPSHOT_LIMITS.maxListings) {
        truncated = true;
        break;
      }

      if (!isTypeKey(key) || !Array.isArray(items)) {
        truncated = true;
        continue;
      }

      if (items.length > CONTENT_SNAPSHOT_LIMITS.maxItemsPerType) {
        truncated = true;
      }

      listings.set(key, items.slice(0, CONTENT_SNAPSHOT_LIMITS.maxItemsPerType));
    }
  }

  if (isRecord(input.bodies)) {
    for (const [key, item] of Object.entries(input.bodies)) {
      if (bodies.size >= CONTENT_SNAPSHOT_LIMITS.maxBodies) {
        truncated = true;
        break;
      }

      const [type, id] = key.split(":");

      if (!type || !isTypeKey(type) || !/^[0-9]{1,12}$/.test(id ?? "") || !isRecord(item)) {
        truncated = true;
        continue;
      }

      bodies.set(`${type}:${Number(id)}`, item);
    }
  }

  if (!types && listings.size === 0 && bodies.size === 0) return null;

  // A snapshot that arrives oversized is not trusted to be well-formed either.
  const encoded = JSON.stringify({
    types,
    listings: [...listings],
    bodies: [...bodies],
  });

  if (Buffer.byteLength(encoded, "utf8") > CONTENT_SNAPSHOT_LIMITS.maxTotalBytes) {
    return null;
  }

  return { types, listings, bodies, truncated };
}

export type ContentReader = {
  source: "site" | "bridge";
  types(): Promise<unknown>;
  list(type: string): Promise<unknown>;
  item(type: string, id: number): Promise<unknown>;
};

/** What the site could not tell us, phrased for the model rather than a stack trace. */
function unavailable(what: string) {
  return {
    success: false,
    error:
      `${what} was not included with this request and this site cannot be reached from ` +
      `Meikero right now. Answer from what you do have, and say plainly that you could not read it.`,
  };
}

export function createContentReader(options: {
  snapshot: ContentSnapshot | null;
  siteUrl: string;
  token: string;
}): ContentReader {
  const { snapshot, siteUrl, token } = options;

  /** One attempt at the old pull, only when the snapshot admits it is partial. */
  async function pull<T>(run: () => Promise<T>, what: string): Promise<unknown> {
    if (!snapshot?.truncated) return unavailable(what);

    try {
      return await run();
    } catch {
      return unavailable(what);
    }
  }

  return {
    source: snapshot ? "site" : "bridge",

    async types() {
      if (snapshot?.types) return snapshot.types;

      return snapshot
        ? pull(() => listSiteContentTypes(siteUrl, token), "The list of content types")
        : listSiteContentTypes(siteUrl, token);
    },

    async list(type) {
      if (!snapshot) return listSiteContent(siteUrl, token, type);

      const items = snapshot.listings.get(type);

      if (items) return { success: true, type, items };

      // A type the snapshot knows about but did not list has nothing in it —
      // the plugin skips empty types. Anything else is a genuine miss.
      const known = isRecord(snapshot.types) && Array.isArray(snapshot.types.types)
        ? snapshot.types.types.some(
            (entry) => isRecord(entry) && entry.key === type && !entry.count
          )
        : false;

      if (known) return { success: true, type, items: [] };

      return pull(() => listSiteContent(siteUrl, token, type), `The ${type} list`);
    },

    async item(type, id) {
      if (!snapshot) return getSiteContentItem(siteUrl, token, type, id);

      const body = snapshot.bodies.get(`${type}:${id}`);

      if (body) return body;

      return pull(() => getSiteContentItem(siteUrl, token, type, id), `${type} #${id}`);
    },
  };
}
