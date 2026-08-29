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
