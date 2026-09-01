import { FIXED_PAGES, isPageSlug, type DesignPage } from "./design-pages";

/**
 * Where a link inside a generated design leads.
 *
 * A design preview used to swallow every click, which stopped a dead link from
 * navigating a preview iframe to nowhere and, in the same move, made the design
 * feel like a screenshot. Routing the click instead lets the whole thing be
 * walked: the nav, the footer, a card, a "read more".
 *
 * The mapping used to rest on a fact that is no longer true — that one inner
 * page was the template every content page shared, so any internal link could
 * be answered with it. Every page is really designed now, so a link is matched
 * against the pages this design actually holds and answered with the page
 * itself. Guessing is left for the two screens a visitor reaches by accident
 * rather than by name.
 */

/** Slugs a blog listing plausibly lives at, plus our own reserved name. */
const BLOGISH = /^(archive|blog|news|journal|notes|articles|insights|posts|stories|updates)$/;

/** The first path segment: /services/detail -> "services". */
function firstSegment(href: string, host = ""): string | null {
  const raw = String(href ?? "").trim();

  // An in-page anchor is the page's own business, and scrolls where it points.
  if (!raw || raw.startsWith("#")) return null;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return null;

  // A real outbound link stays outbound.
  if (/^https?:\/\//i.test(raw) && (!host || !raw.includes(host))) return null;

  const path = raw
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("#")[0]
    .toLowerCase();

  if (!path || path === "/" || /^\/?(home|index)(\.html?)?\/?$/.test(path)) return "";

  return path.replace(/^\/+|\/+$/g, "").split("/")[0].replace(/\.html?$/, "");
}

/**
 * The page a link leads to, given the pages this design holds.
 *
 * `available` is the design's own list, so a match is exact: /services leads to
 * the Services page that was designed, not to a stand-in. Only when nothing
 * matches does the shape of the path decide, and then only for the blog and the
 * 404 — the two screens nobody navigates to by name.
 */
export function resolveTarget(
  href: string,
  available: readonly DesignPage[],
  host = ""
): DesignPage | null {
  const segment = firstSegment(href, host);

  if (segment === null) return null;

  const has = (slug: string) => available.includes(slug);
  const home = has("home") ? "home" : (available[0] ?? null);

  if (segment === "") return home;
  if (!isPageSlug(segment)) return home;

  const path = String(href ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+|\/+$/g, "");
  const deep = path.includes("/");

  // Something under the blog — /journal/why-onboarding-fails — is one post, and
  // that has to be decided before the blog's own page matches the first
  // segment. Otherwise every post link stops at the listing it came from.
  if (deep && BLOGISH.test(segment) && has("post")) return "post";

  // The page itself, when the design has it. This is the ordinary case now.
  if (has(segment)) return segment;

  if (deep && has("post")) return "post";

  if (/^(404|not-?found)$/.test(segment) && has("notfound")) return "notfound";

  if (BLOGISH.test(segment) && has("archive")) return "archive";

  // A link to a page this design does not have is what a visitor would meet as
  // a missing page, and the theme has one designed for exactly that. Falling
  // back to the homepage instead would quietly pretend the link worked.
  if (has("notfound")) return "notfound";

  return home;
}

/** Retained for callers that only want the shape of the path. */
export function screenForHref(href: string, host = ""): DesignPage | null {
  const segment = firstSegment(href, host);

  if (segment === null) return null;
  if (segment === "") return "home";
  if (/^(404|not-?found)$/.test(segment)) return "notfound";
  if (BLOGISH.test(segment)) return "archive";

  return isPageSlug(segment) && !(FIXED_PAGES as readonly string[]).includes(segment)
    ? segment
    : "home";
}
