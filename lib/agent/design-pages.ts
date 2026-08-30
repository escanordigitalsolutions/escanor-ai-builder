import { serialiseTokens, type DesignTokens } from "./art-direction";

/**
 * Which screens a stored design has, and how to ask for one.
 *
 * A design used to be one HTML document, so "preview it" needed no argument.
 * It is now up to six, produced by stages that are each allowed to be skipped
 * when the clock runs short — so the honest answer to "show me this design" has
 * to include which screens actually exist for it.
 *
 * The homepage and the inner page live in their own columns because they
 * predate the rest; everything since goes in `pages`. Keeping the reader here
 * means the three preview routes cannot drift apart about what a design holds.
 */

export const DESIGN_PAGES = [
  "home",
  "inner",
  "components",
  "archive",
  "notfound",
  "brand",
] as const;

export type DesignPage = (typeof DESIGN_PAGES)[number];

export const PAGE_LABEL: Record<DesignPage, string> = {
  home: "Homepage",
  inner: "Inner page",
  components: "Components",
  archive: "Blog archive",
  notfound: "404",
  brand: "Brand sheet",
};

export function resolvePage(value: unknown): DesignPage {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";

  return (DESIGN_PAGES as readonly string[]).includes(raw) ? (raw as DesignPage) : "home";
}

type DesignRow = {
  html?: unknown;
  inner_html?: unknown;
  pages?: unknown;
};

/** Every screen this design actually has, in a stable order. */
export function availablePages(row: DesignRow): DesignPage[] {
  const pages = (row.pages ?? null) as Record<string, unknown> | null;

  return DESIGN_PAGES.filter((page) => {
    if (page === "home") return typeof row.html === "string" && row.html.length > 0;
    if (page === "inner") return typeof row.inner_html === "string" && row.inner_html.length > 0;

    const value = pages?.[page];
    return typeof value === "string" && value.length > 0;
  });
}

/** One screen's markup, or an empty string when this design does not have it. */
export function pickPage(row: DesignRow, page: DesignPage): string {
  if (page === "home") return typeof row.html === "string" ? row.html : "";
  if (page === "inner") return typeof row.inner_html === "string" ? row.inner_html : "";

  const pages = (row.pages ?? null) as Record<string, unknown> | null;
  const value = pages?.[page];

  return typeof value === "string" ? value : "";
}

/** Said the same way everywhere, so a missing screen never reads like a bug. */
export function missingMessage(page: DesignPage): string {
  return (
    `This design has no ${PAGE_LABEL[page].toLowerCase()} — it was generated before that ` +
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
