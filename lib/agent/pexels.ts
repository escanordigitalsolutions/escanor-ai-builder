/**
 * Real stock photos from Pexels.
 *
 * The design model writes placeholder image URLs in the loremflickr format
 * (keywords + a lock number). When PEXELS_API_KEY is set, this swaps every
 * placeholder for a real Pexels photo matching the keywords — the lock number
 * picks a stable photo from the search results, so regenerating the page keeps
 * the same imagery. Without a key (or on any failure) the placeholder URL is
 * left untouched, so nothing breaks.
 */

type PexelsPhoto = { id: number; src: Record<string, string> };

const SEARCH = "https://api.pexels.com/v1/search";

export async function replacePlaceholderImages(html: string): Promise<string> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return html;
  }

  const re =
    /https:\/\/(?:loremflickr\.com\/(\d+)\/(\d+)\/([^"'?\s]+)(?:\?lock=(\d+))?|picsum\.photos\/seed\/([a-zA-Z0-9-]+)\/(\d+)\/(\d+))/g;
  const matches = [...html.matchAll(re)];
  if (!matches.length) {
    return html;
  }

  const cache = new Map<string, PexelsPhoto[]>();
  const replacements = new Map<string, string>();

  for (const m of matches.slice(0, 24)) {
    const full = m[0];
    if (replacements.has(full)) {
      continue;
    }
    const w = parseInt(m[1] ?? m[6] ?? "1200", 10) || 1200;
    const h = parseInt(m[2] ?? m[7] ?? "800", 10) || 800;
    const rawQuery = m[3] ?? m[5] ?? "";
    const query =
      decodeURIComponent(rawQuery).replace(/[,+]/g, " ").trim() || "business";
    const lock = parseInt(m[4] ?? "0", 10) || 0;
    const orientation = w >= h ? "landscape" : "portrait";
    const cacheKey = `${query}|${orientation}`;

    let photos = cache.get(cacheKey);
    if (!photos) {
      try {
        const res = await fetch(
          `${SEARCH}?query=${encodeURIComponent(query)}&per_page=15&orientation=${orientation}`,
          { headers: { Authorization: key } }
        );
        if (res.ok) {
          const data = (await res.json()) as { photos?: PexelsPhoto[] };
          photos = Array.isArray(data.photos) ? data.photos : [];
        } else {
          console.error(`pexels search ${res.status} for "${query}"`);
          photos = [];
        }
      } catch (error) {
        console.error("pexels search error:", error);
        photos = [];
      }
      cache.set(cacheKey, photos);
    }

    if (!photos.length) {
      continue;
    }
    const photo = photos[lock % photos.length];
    const base = (photo.src?.original ?? "").split("?")[0];
    if (!base) {
      continue;
    }
    const pw = Math.min(w * 2, 2400);
    const ph = Math.min(h * 2, 2400);
    replacements.set(
      full,
      `${base}?auto=compress&cs=tinysrgb&w=${pw}&h=${ph}&fit=crop`
    );
  }

  let out = html;
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  console.log(
    `pexels: replaced ${replacements.size} of ${matches.length} placeholder images`
  );
  return out;
}

export type BriefImage = {
  url: string;
  w: number;
  h: number;
  alt: string;
  orientation: "landscape" | "portrait";
};

/**
 * Fetch a curated set of Pexels photos for the brief BEFORE the design call,
 * so the model composes with real image URLs instead of placeholders. Returns
 * [] without a key or on failure — the prompt then designs without photos.
 */
export async function fetchBriefImages(
  brief: unknown,
  extraQueries?: string[]
): Promise<BriefImage[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return [];
  }

  const b = (brief ?? {}) as { name?: unknown; prompt?: unknown };
  const text = [b.name, b.prompt]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join(" ");

  // Generic web/builder words that poison an image search ("underground
  // festival website" once returned a mole photo for "underground").
  const STOP = new Set([
    "website", "site", "page", "landing", "homepage", "web",
    "svetaine", "svetainė", "puslapis", "tinklalapis",
    "modern", "modernus", "moderni", "custom", "unique", "professional",
    "premium", "digital", "online", "design", "dizainas", "dizaino",
    "brand", "theme", "tema", "temos", "wordpress", "experimental",
    "creative", "elegant", "minimal", "minimalist", "stylish",
    "the", "and", "for", "with",
  ]);

  const words = text
    .replace(/https?:\S+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));

  // Concept-stage queries win when provided; otherwise derive 2-3 queries
  // from the brief for variety and better odds of on-topic photos.
  const conceptQueries = (extraQueries ?? [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 2)
    .map((q) => q.trim().slice(0, 60))
    .slice(0, 3);
  const queries = conceptQueries.length
    ? conceptQueries
    : [...new Set(
        [
          words.slice(0, 4).join(" "),
          words.slice(4, 8).join(" "),
          typeof b.name === "string" ? b.name.trim() : "",
        ].filter((q) => q.length > 2)
      )].slice(0, 3);
  if (!queries.length) {
    queries.push("business");
  }

  const out: BriefImage[] = [];
  const seen = new Set<string>();

  async function search(
    query: string,
    orientation: "landscape" | "portrait",
    count: number
  ) {
    try {
      const res = await fetch(
        `${SEARCH}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=${orientation}`,
        { headers: { Authorization: key as string } }
      );
      if (!res.ok) {
        console.error(`pexels brief search ${res.status} for "${query}"`);
        return;
      }
      const data = (await res.json()) as {
        photos?: { src?: Record<string, string>; alt?: string; width?: number; height?: number }[];
      };
      for (const ph of data.photos ?? []) {
        const base = (ph.src?.original ?? "").split("?")[0];
        if (!base || seen.has(base)) continue;
        seen.add(base);
        const w = orientation === "landscape" ? 1600 : 900;
        const h = orientation === "landscape" ? 1000 : 1200;
        out.push({
          url: `${base}?auto=compress&cs=tinysrgb&w=${w}&h=${h}&fit=crop`,
          w,
          h,
          alt: (ph.alt ?? "").slice(0, 120),
          orientation,
        });
      }
    } catch (error) {
      console.error("pexels brief search error:", error);
    }
  }

  // Primary query carries most of the set; secondary queries add range.
  const tasks: Promise<void>[] = [];
  queries.forEach((q, i) => {
    if (i === 0) {
      tasks.push(search(q, "landscape", 6), search(q, "portrait", 4));
    } else {
      tasks.push(search(q, "landscape", 4), search(q, "portrait", 2));
    }
  });
  await Promise.all(tasks);

  return out.slice(0, 18);
}
