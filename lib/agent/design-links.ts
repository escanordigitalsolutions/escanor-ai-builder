import { DESIGN_PAGES, type DesignPage } from "./design-pages";

/**
 * Where a link inside a generated design leads.
 *
 * A design preview used to swallow every click, which stopped a dead link from
 * navigating a preview iframe to nowhere and, in the same move, made the design
 * feel like a screenshot. Routing the click instead lets the whole thing be
 * walked: the nav, the footer, a card, a "read more".
 *
 * The mapping rests on one fact about the theme this design becomes: the inner
 * page is the TEMPLATE every content page uses. So an ordinary internal link
 * does not lead nowhere — it leads to exactly what a visitor would get.
 */
export function screenForHref(href: string, host = ""): DesignPage | null {
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

  if (!path || path === "/" || /^\/?(home|index)(\.html?)?\/?$/.test(path)) return "home";
  if (/(blog|news|journal|notes|articles|insights|posts|stories|updates)/.test(path)) return "archive";
  if (/(404|not-?found)/.test(path)) return "notfound";
  if (/(brand|identity|logo)/.test(path)) return "brand";
  if (/(component|style-?guide|pattern|ui-?kit)/.test(path)) return "components";

  return "inner";
}

/**
 * The same answer, narrowed to what this run actually produced.
 *
 * A generation short of time makes fewer screens. Sending a click to a screen
 * that does not exist would do nothing, and doing nothing reads as broken — so
 * it falls back to the inner page, and then to the homepage.
 */
export function resolveTarget(
  href: string,
  available: readonly DesignPage[],
  host = ""
): DesignPage | null {
  const target = screenForHref(href, host);

  if (!target) return null;
  if (available.includes(target)) return target;
  if (target !== "home" && available.includes("inner")) return "inner";

  return available.includes("home") ? "home" : (DESIGN_PAGES.find((p) => available.includes(p)) ?? null);
}
