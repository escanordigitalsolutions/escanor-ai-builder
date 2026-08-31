import { type ZipEntry } from "@/lib/zip";
import {
  DESIGN_PAGES,
  PAGE_LABEL,
  applyColorway,
  colorwayCss,
  pickPage,
} from "@/lib/agent/design-pages";

/**
 * An archived design, packed as a folder somebody can open.
 *
 * Kept out of the route so it can be tested without a database: the value of
 * this feature is entirely in what ends up inside the zip, and a route handler
 * is the one place that cannot be checked cheaply.
 */

/** A filename that survives every operating system. */
function slug(value: string, fallback: string): string {
  const cleaned = value
    // Fold accents to their base letter first. Dropping them instead turns
    // "Ąžuolas" into "uolas" and "Café" into "caf" — a filename that no longer
    // says which design it is.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return cleaned || fallback;
}

const FILE_NAME: Record<(typeof DESIGN_PAGES)[number], string> = {
  home: "home.html",
  inner: "inner-page.html",
  components: "components.html",
  archive: "blog-archive.html",
  notfound: "404.html",
  brand: "brand-sheet.html",
};

export type DesignRecord = {
  id: string;
  created_at: string;
  html: string | null;
  inner_html: string | null;
  pages: Record<string, unknown> | null;
  direction: unknown;
  validation: unknown;
  critique: string | null;
  concept: string | null;
  shape: string | null;
  brief: unknown;
  model: string | null;
  project_id: string | null;
};

function readme(design: DesignRecord, screens: string[], ways: string[]): string {
  const direction = (design.direction ?? {}) as {
    tokens?: { font?: Record<string, string>; color?: Record<string, string> };
    signatureMove?: string;
    brandName?: string;
  };

  const fonts = direction.tokens?.font ?? {};
  const colors = direction.tokens?.color ?? {};

  const lines = [
    `# ${design.concept ?? "Untitled design"}`,
    "",
    `Generated ${design.created_at} · shape: ${design.shape ?? "unknown"} · model: ${design.model ?? "unknown"}`,
    "",
  ];

  if (direction.signatureMove) {
    lines.push("## The signature move", "", direction.signatureMove, "");
  }

  if (design.critique) {
    lines.push("## What the critique said", "", design.critique, "");
  }

  lines.push("## Type and colour", "");

  for (const [role, value] of Object.entries(fonts)) {
    lines.push(`- font ${role}: ${value}`);
  }

  for (const [role, value] of Object.entries(colors)) {
    lines.push(`- colour ${role}: ${value}`);
  }

  lines.push(
    "",
    "## What is in here",
    "",
    "- `screens/` — every screen this design produced, each a standalone page you can open in a browser.",
    ...(ways.length
      ? [
          `- \`colorways/\` — the same homepage in ${ways.length} alternative palette${
            ways.length === 1 ? "" : "s"
          }: ${ways.join(", ")}.`,
        ]
      : []),
    "- `design.json` — the art direction, the brief, the validation report and the critique, as data.",
    "",
    `Screens included: ${screens.join(", ")}.`,
    ""
  );

  return lines.join("\n");
}


/** Every file the pack contains, in the order they are written. */
export function buildDesignPack(design: DesignRecord): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const screens: string[] = [];

  for (const page of DESIGN_PAGES) {
    const html = pickPage(design, page);

    if (!html) continue;

    entries.push({ name: `screens/${FILE_NAME[page]}`, data: html });
    screens.push(PAGE_LABEL[page]);
  }

  // No screens, no pack. A design row with nothing in it is a failed run, and
  // an archive containing only a README would say nothing about it.
  if (entries.length === 0) return [];

  // The alternative palettes as whole pages rather than loose CSS: the point of
  // a colourway is what it looks like, and a :root block on its own shows
  // nobody anything. The CSS goes in too, for anyone who wants to lift it.
  //
  // Wrapped, because serialising a palette assumes a complete token set and an
  // older or half-written direction may not have one. Losing the colourways is
  // a smaller loss than losing the download: the screens are the thing.
  const home = pickPage(design, "home");
  let ways: { name: string; rootCss: string }[] = [];

  try {
    ways = colorwayCss(design.direction);
  } catch (error) {
    console.error("design pack: could not build the colourways", error);
    ways = [];
  }

  for (const way of ways) {
    const name = slug(way.name, "colourway");

    if (home) {
      entries.push({ name: `colorways/${name}.html`, data: applyColorway(home, way.rootCss) });
    }

    entries.push({ name: `colorways/${name}.css`, data: way.rootCss });
  }

  entries.push({
    name: "design.json",
    data: JSON.stringify(
      {
        id: design.id,
        createdAt: design.created_at,
        concept: design.concept,
        shape: design.shape,
        model: design.model,
        projectId: design.project_id,
        brief: design.brief,
        direction: design.direction,
        validation: design.validation,
        critique: design.critique,
        screens,
      },
      null,
      2
    ),
  });

  entries.push({
    name: "README.md",
    data: readme(
      design,
      screens,
      ways.map((way) => way.name)
    ),
  });

  return entries;
}

/** What the browser saves it as. */
export function packFileName(design: DesignRecord): string {
  const date = (design.created_at || "").slice(0, 10) || "undated";

  return `meikero-${slug(design.concept ?? "design", "design")}-${date}.zip`;
}
