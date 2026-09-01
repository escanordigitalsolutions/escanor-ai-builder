import { serialiseTokens, type DesignTokens } from "./art-direction";

/**
 * Which screens a stored design has, and how to ask for one.
 *
 * This used to be a fixed list of six: home, inner, components, archive,
 * notfound, brand. Two of those were never pages — the component sheet and the
 * brand sheet are documents for whoever is building the theme, and no visitor
 * can reach either — and one, "inner", was a template standing in for every
 * content page at once. So the preview offered six tabs of which three were
 * real destinations, while the design's own navigation pointed at four or five
 * pages that had no tab at all. The strip and the menu described two different
 * sites.
 *
 * Now a design holds the pages the site actually has. The art director decides
 * them, the homepage's header links to them, each one is really designed, and
 * this module just reads whatever is stored rather than asserting in advance
 * what the list may contain.
 */

/** A page slug: kebab-case, or one of the reserved names below. */
export type DesignPage = string;

/**
 * Screens every WordPress theme needs, whatever business it is for.
 *
 * They are reserved so a business page can never collide with them, and so the
 * order below is the order the preview lists them in — after the content pages,
 * because that is where they sit in a visitor's attention.
 */
export const FIXED_PAGES = ["archive", "post", "notfound"] as const;

export type FixedPage = (typeof FIXED_PAGES)[number];

export const FIXED_LABEL: Record<FixedPage, string> = {
  archive: "Blog",
  post: "Blog post",
  notfound: "404",
};

/**
 * Screens older designs hold that are no longer produced.
 *
 * Kept readable — someone's archive still contains them and looking at a design
 * you paid for should not break — but never generated again, and listed last.
 */
export const LEGACY_LABEL: Record<string, string> = {
  inner: "Inner page",
  components: "Components",
  brand: "Brand sheet",
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A slug is safe to store and to ask for; anything else is not a page. */
export function isPageSlug(value: unknown): boolean {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "home" || SLUG.test(raw);
}

export function resolvePage(value: unknown): DesignPage {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isPageSlug(raw) ? raw : "home";
}

type DesignRow = {
  html?: unknown;
  inner_html?: unknown;
  pages?: unknown;
  direction?: unknown;
};

function pageMap(row: DesignRow): Record<string, string> {
  const pages = (row.pages ?? null) as Record<string, unknown> | null;
  const out: Record<string, string> = {};

  if (!pages || typeof pages !== "object") return out;

  for (const [key, value] of Object.entries(pages)) {
    if (isPageSlug(key) && typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }

  return out;
}

/** The site's own pages, as the art director named them. */
function directionPages(row: DesignRow): { slug: string; title: string }[] {
  const raw = (row.direction as Record<string, unknown> | null)?.pages;
  if (!Array.isArray(raw)) return [];

  const out: { slug: string; title: string }[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const page = item as Record<string, unknown>;
    const slug = String(page.slug ?? "").trim().toLowerCase();
    if (!isPageSlug(slug) || slug === "home") continue;
    out.push({ slug, title: String(page.title ?? slug).trim() || slug });
  }

  return out;
}

export type PageEntry = { slug: string; label: string };

/**
 * Every screen this design has, in the order a person should meet them:
 * the homepage, then the site's own pages in the order its menu lists them,
 * then the blog screens and the 404, then anything an older design left behind.
 */
export function availablePages(row: DesignRow): PageEntry[] {
  const map = pageMap(row);
  const out: PageEntry[] = [];
  const taken = new Set<string>();

  const push = (slug: string, label: string) => {
    if (taken.has(slug)) return;
    taken.add(slug);
    out.push({ slug, label });
  };

  if (typeof row.html === "string" && row.html.length > 0) push("home", "Homepage");

  // The menu's order, so walking the rail and walking the header agree.
  for (const page of directionPages(row)) {
    if (map[page.slug]) push(page.slug, page.title);
  }

  // Any page stored without a matching direction entry (an older run, or a
  // direction that was never parsed) still deserves a way in.
  for (const slug of Object.keys(map)) {
    if (taken.has(slug)) continue;
    if ((FIXED_PAGES as readonly string[]).includes(slug)) continue;
    if (slug in LEGACY_LABEL) continue;
    push(slug, titleFromSlug(slug));
  }

  for (const slug of FIXED_PAGES) {
    if (map[slug]) push(slug, FIXED_LABEL[slug]);
  }

  if (typeof row.inner_html === "string" && row.inner_html.length > 0) {
    push("inner", LEGACY_LABEL.inner);
  }

  for (const [slug, label] of Object.entries(LEGACY_LABEL)) {
    if (map[slug]) push(slug, label);
  }

  return out;
}

/**
 * Just the slugs, from either shape.
 *
 * `available` used to be a list of strings and is now a list of {slug,label} —
 * but a plugin that has not been updated still sends the old shape, and a
 * stored job result still holds one. Both answer here.
 */
export function pageSlugs(pages: unknown): string[] {
  if (!Array.isArray(pages)) return [];

  const out: string[] = [];

  for (const item of pages) {
    const slug =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? String((item as Record<string, unknown>).slug ?? "")
          : "";

    if (isPageSlug(slug)) out.push(slug.toLowerCase());
  }

  return out;
}

/** "case-studies" -> "Case studies", for a page stored without a title. */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/** One screen's markup, or an empty string when this design does not have it. */
export function pickPage(row: DesignRow, page: DesignPage): string {
  if (page === "home") return typeof row.html === "string" ? row.html : "";

  const map = pageMap(row);
  if (map[page]) return map[page];

  // The single post is where the inner-page template ended up, so a design made
  // before that move still answers a request for it.
  if (page === "post" || page === "inner") {
    return typeof row.inner_html === "string" ? row.inner_html : "";
  }

  return "";
}

/** Said the same way everywhere, so a missing screen never reads like a bug. */
export function missingMessage(page: DesignPage): string {
  const label =
    (FIXED_LABEL as Record<string, string>)[page] ??
    LEGACY_LABEL[page] ??
    titleFromSlug(page);

  return (
    `This design has no ${label.toLowerCase()} page — it was generated before that ` +
    `stage existed, or the stage was skipped because the generation was running out of time.`
  );
}

/**
 * The alternative palettes, as CSS ready to swap in.
 *
 * Naming a colourway is not offering one. Because the validator forces every
 * rule below :root through a custom property, replacing that one block re-skins
 * the whole document — so the useful form of a colourway is the block itself,
 * computed once here rather than rebuilt in each client that wants to show it.
 */
export type ColorwayCss = { name: string; rootCss: string };

export function colorwayCss(direction: unknown): ColorwayCss[] {
  const dir = (direction ?? null) as {
    tokens?: DesignTokens;
    colorways?: { name?: unknown; color?: Record<string, string> }[];
  } | null;

  if (!dir?.tokens || !Array.isArray(dir.colorways)) return [];

  return dir.colorways
    .filter((way) => way && typeof way.name === "string" && way.color)
    .map((way) => ({
      name: String(way.name),
      rootCss: serialiseTokens({ ...dir.tokens!, color: way.color! }),
    }));
}

/** Swap a document's :root block for another one. */
export function applyColorway(html: string, rootCss: string): string {
  return html.replace(/:root\s*\{[\s\S]*?\}/i, () => rootCss);
}
