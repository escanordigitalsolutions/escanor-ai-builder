/**
 * Making a blueprint internally consistent, whatever the planner returned.
 *
 * Lifted out of the route because a route file cannot export anything but its
 * handler, and the rules below are the ones most worth testing: they are the
 * difference between a theme whose header links work and one whose header
 * links are dead. Nothing here calls a model or touches the network.
 */

export type Json = Record<string, unknown>;

export const CORE_FILES = [
  "style.css",
  "functions.php",
  "header.php",
  "footer.php",
  "index.php",
  "page.php",
  "single.php",
  "404.php",
  "archive.php",
  "searchform.php",
  "front-page.php",
  "assets/css/base.css",
  // The component sheet the design stage derives from the finished homepage.
  // Without it the buttons, forms and tables on every inner page are invented
  // by the build model and match nothing.
  "assets/css/components.css",
  "assets/css/header.css",
  "assets/css/footer.css",
  "assets/css/inner.css",
  // Archive and 404 rules together: two small sheets would cost two more build
  // batches for a few dozen rules.
  "assets/css/pages.css",
  "assets/js/main.js",
];

/**
 * Make the blueprint internally consistent, whatever the model returned:
 * dedupe and cap sections/pages, keep only section references that exist,
 * keep only menu entries that point at real pages, and DERIVE the file list
 * from pages + sections. The model's own "files" (if any) are ignored, so a
 * template can never call a template-part that is missing from the build.
 */
export type SitePage = { slug: string; title: string; purpose: string };

export function normalizeBlueprint(
  bp: Json,
  mockupSections: string[] = [],
  sitePages: SitePage[] = []
): void {
  type Section = { slug: string } & Json;
  type Page = { slug: string; sections?: unknown } & Json;

  const rawSections = Array.isArray(bp.sections) ? (bp.sections as unknown[]) : [];
  const seen = new Set<string>();
  const sections: Section[] = [];
  for (const s of rawSections) {
    if (!s || typeof s !== "object") continue;
    const slug = String((s as Json).slug ?? "").trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    sections.push({ ...(s as Json), slug } as Section);
    if (sections.length >= 10) break;
  }

  // Design-first mode: the homepage mockup fixes the section universe. Every
  // mockup section exists (add a stub when the model forgot it) and nothing
  // outside the mockup survives.
  if (mockupSections.length) {
    const bySlug = new Map(sections.map((x) => [x.slug, x]));
    sections.length = 0;
    seen.clear();
    for (const slug of mockupSections) {
      seen.add(slug);
      sections.push(
        (bySlug.get(slug) as Section) ??
          ({ slug, type: "custom", layout: "", look: "", copy: "" } as Section)
      );
    }
  }

  const front = typeof bp.frontPage === "string" ? bp.frontPage : "";
  const rawPages = Array.isArray(bp.pages) ? (bp.pages as unknown[]) : [];
  const pages: Page[] = [];
  const pageSlugs = new Set<string>();
  for (const p of rawPages) {
    if (!p || typeof p !== "object") continue;
    const slug = String((p as Json).slug ?? "").trim();
    if (!slug || pageSlugs.has(slug)) continue;
    pageSlugs.add(slug);
    const secs = Array.isArray((p as Json).sections)
      ? ((p as Json).sections as unknown[])
          .filter((s): s is string => typeof s === "string" && seen.has(s))
          .slice(0, 6)
      : [];
    pages.push({ ...(p as Json), slug, sections: secs } as Page);
    if (pages.length >= 8) break;
  }

  // The design already decided what pages this site has, and its header links
  // to them. A blueprint that plans a different set makes those links dead on
  // the finished theme, so the design's list wins: every page it named exists,
  // and a page the planner invented on top of it is dropped.
  if (sitePages.length) {
    const planned = new Map(pages.map((p) => [p.slug, p]));
    const wanted = new Set<string>([front || "home", ...sitePages.map((p) => p.slug)]);
    const kept: Page[] = [];

    for (const p of pages) {
      if (wanted.has(p.slug)) kept.push(p);
    }

    for (const want of sitePages) {
      if (planned.has(want.slug)) continue;
      kept.push({
        slug: want.slug,
        title: want.title,
        template: `page-${want.slug}.php`,
        sections: [],
        headline: want.title,
      } as unknown as Page);
    }

    pages.length = 0;
    pageSlugs.clear();
    for (const p of kept.slice(0, 8)) {
      pages.push(p);
      pageSlugs.add(p.slug);
    }
  }

  if (mockupSections.length) {
    for (const p of pages) {
      const isFront =
        p.slug === front || (p as Json).template === "front-page.php";
      if (isFront) {
        (p as Json).sections = [...mockupSections];
      }
    }
  }

  // Only keep sections that some page actually uses.
  const used = new Set<string>();
  for (const p of pages) {
    for (const s of p.sections as string[]) used.add(s);
  }
  bp.sections = sections.filter((s) => used.has(s.slug));
  bp.pages = pages;

  // The menu is the design's page list, in the design's order — that is the nav
  // the person approved in the preview. Only when there is no design does the
  // planner's own menu stand, filtered to pages that exist.
  bp.menu = sitePages.length
    ? sitePages
        .filter((p) => pageSlugs.has(p.slug))
        .map((p) => ({ title: p.title, slug: p.slug }))
    : Array.isArray(bp.menu)
      ? (bp.menu as unknown[]).filter(
          (m) =>
            m &&
            typeof m === "object" &&
            pageSlugs.has(String((m as Json).slug ?? ""))
        )
      : [];

  const files = [...CORE_FILES];
  for (const p of pages) {
    if (p.slug !== front) files.push(`page-${p.slug}.php`);
  }
  for (const s of bp.sections as Section[]) {
    files.push(`template-parts/section-${s.slug}.php`);
    files.push(`assets/css/sections/${s.slug}.css`);
  }
  bp.files = files;
}
