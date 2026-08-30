import {
  COLOR_ROLES,
  readRootTokens,
  serialiseTokens,
  type ArtDirection,
  type DesignTokens,
} from "./art-direction";

/**
 * Did the designer actually follow the direction?
 *
 * Seven bugs in this product shipped past `tsc`, because a type checker checks
 * shape and not behaviour. The same hole existed in the design pipeline, one
 * level up: nothing checked whether an expensive model had done what it was
 * told, so "the design looks generic" could only ever be caught by a person
 * looking at it.
 *
 * Now that the direction commits to exact values, most of that question is
 * string comparison, and string comparison costs nothing. What remains — is the
 * signature move any good, is the page beautiful — is left to the human, which
 * is the right division of labour.
 *
 * Fatal failures are worth one retry. Soft ones are recorded for the ops log
 * and nothing more: they mark a page that is worse than it should be, not one
 * that is broken.
 */

export type Failure = { code: string; detail: string; fatal: boolean };

export type ValidationResult = {
  ok: boolean;
  failures: Failure[];
};

/** Families a model reaches for when it is not really choosing. */
const TIRED_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Lato",
  "Space Grotesk",
  "Nunito",
];

const PLACEHOLDER = /lorem ipsum|your headline here|your text here|placeholder text|dolor sit amet/i;

export function validateMockup(
  html: string,
  css: string,
  sections: { slug: string; html: string }[],
  direction: ArtDirection | null
): ValidationResult {
  const failures: Failure[] = [];

  const fail = (code: string, detail: string, fatal = true) =>
    failures.push({ code, detail, fatal });

  // --- structure, checkable with or without a direction ---------------------

  if (sections.length < 4 || sections.length > 7) {
    fail(
      "sections.count",
      `The page has ${sections.length} top-level sections; the contract requires 4 to 7.`
    );
  }

  // JSON-LD is markup, not behaviour: a model that adds structured data for SEO
  // has not broken the one-script rule.
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].filter(
    (m) => !/\bsrc=/i.test(m[0]) && !/application\/ld\+json/i.test(m[0])
  );

  if (scripts.length !== 1) {
    fail("js.contract", `Found ${scripts.length} inline <script> blocks; exactly 1 is required.`);
  } else if (!/IntersectionObserver/.test(html) || !/in-view/.test(html)) {
    fail(
      "js.contract",
      "The inline script must add .in-view to [data-reveal] elements with an IntersectionObserver."
    );
  }

  if (PLACEHOLDER.test(html)) {
    fail("lorem", "The page contains placeholder copy instead of real, brand-specific text.");
  }

  // --- everything below needs a direction to compare against ---------------

  if (!direction) {
    return { ok: failures.every((f) => !f.fatal), failures };
  }

  const tokens = direction.tokens;
  const root = readRootTokens(css);

  if (!Object.keys(root).length) {
    fail(
      "tokens.missing",
      "The stylesheet has no :root block. It must open with the token block exactly as supplied."
    );
  } else {
    checkTokens(root, tokens, fail);
  }

  // Fonts must be linked, or they fall back with no error anywhere.
  const faces: [string, ArtDirection["typography"]["display"]][] = [
    ["--font-display", direction.typography.display],
    ["--font-text", direction.typography.text],
  ];

  for (const [prop, face] of faces) {
    // Repaired before validation when possible, so reaching here means the
    // link could not be inserted at all.
    if (!isLinked(html, face.family)) {
      fail("font.unlinked", `"${face.family}" is never loaded from Google Fonts.`);
    }

    // Deliberately NOT looking for the family name in a font-family rule: the
    // contract requires every reference to go through the custom property, so
    // finding the literal name outside :root would mean the tokens were
    // bypassed. What must be true is that the property is actually used.
    if (!css.includes(`var(${prop})`)) {
      fail(
        "font.unused",
        `Nothing in the stylesheet references var(${prop}), so "${face.family}" is loaded and never applied.`
      );
    }
  }

  // --- soft: worse than it should be, but shippable -------------------------

  const belowRoot = css.replace(/:root\s*\{[\s\S]*?\}/i, "");
  const strayHex = [...belowRoot.matchAll(/#[0-9a-f]{3,8}\b/gi)].length;

  if (strayHex > 3) {
    fail(
      "hex.hardcoded",
      `${strayHex} colour literals appear outside :root; the palette should flow through the tokens.`,
      false
    );
  }

  const chosen = [direction.typography.display.family, direction.typography.text.family].map(
    (f) => f.toLowerCase()
  );

  for (const tired of TIRED_FONTS) {
    if (chosen.includes(tired.toLowerCase())) {
      fail("banned.font", `The direction chose ${tired}, which is the default, not a decision.`, false);
    }
  }

  if (sections.length >= 4 && looksUniform(sections)) {
    fail(
      "sections.uniform",
      "The sections are structurally near-identical; the page reads as a list rather than a design.",
      false
    );
  }

  if (direction.signatureMove && sections.length) {
    // Cannot be checked mechanically — recorded so the ops log shows what the
    // page was supposed to do, next to what it did.
  }

  return { ok: failures.every((f) => !f.fatal), failures };
}

function checkTokens(
  root: Record<string, string>,
  tokens: DesignTokens,
  fail: (code: string, detail: string, fatal?: boolean) => void
): void {
  const missing: string[] = [];
  const drifted: string[] = [];

  // Same map the repair pass uses, so the two can never disagree about what
  // the direction owns.
  for (const [name, value] of Object.entries(expected(tokens))) {
    const actual = root[name];

    if (actual === undefined) {
      missing.push(name);
      continue;
    }

    if (normalise(actual) !== normalise(value)) {
      drifted.push(`${name}: expected ${value}, found ${actual}`);
    }
  }

  if (missing.length) {
    fail("tokens.missing", `Missing custom properties: ${missing.join(", ")}.`);
  }

  // Drift is repaired deterministically before this runs (repairMockup), so
  // anything still here is recorded for the ops log and costs nothing. Paying a
  // strong model to retype a hex value it already got nearly right would be a
  // poor trade against a string replacement that is always correct.
  if (drifted.length) {
    fail("tokens.drift", drifted.slice(0, 8).join(" | "), false);
  }
}

/**
 * Compare two token values for practical equality.
 *
 * Three differences are not drift and must not be reported as such:
 * `#FFF` and `#ffffff` are the same colour; quote style is arbitrary; and a
 * font token written as `"Fraunces", serif` is the same decision as
 * `"Fraunces"` plus a fallback, which is better practice, not a deviation.
 * Treating any of these as drift would have fired on nearly every generation.
 */
function normalise(value: string): string {
  let v = value.trim().toLowerCase().replace(/['"]/g, "").replace(/\s+/g, " ");

  // Only the first family matters; anything after the comma is a fallback.
  v = v.split(",")[0].trim();

  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) {
    v = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  }

  return v;
}

/**
 * Do the sections share one shape?
 *
 * Compares the sequence of tag names in each fragment, ignoring content. Four
 * sections that are all <section><div><h2><p><div><div> are one section drawn
 * four times, whatever the words inside say.
 */
function looksUniform(sections: { slug: string; html: string }[]): boolean {
  const skeletons = sections.map((s) =>
    [...s.html.matchAll(/<([a-z][a-z0-9]*)\b/gi)]
      .map((m) => m[1].toLowerCase())
      .slice(0, 12)
      .join(">")
  );

  const unique = new Set(skeletons);
  return unique.size <= Math.ceil(sections.length / 2);
}


// ---------------------------------------------------------------------------
// Repair — what arithmetic can fix, arithmetic fixes
// ---------------------------------------------------------------------------

export type RepairResult = { html: string; repairs: string[] };
/** Is this family actually loaded by a Google Fonts <link> in the document? */
export function isLinked(html: string, family: string): boolean {
  const hrefs = [
    ...html.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/css2[^"']+)["']/gi),
  ]
    .map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&")).toLowerCase())
    .join(" ");

  const needle = family.trim().toLowerCase();

  return hrefs.includes(needle.replace(/\s+/g, "+")) || hrefs.includes(needle);
}


/**
 * Correct what does not need a model.
 *
 * The direction is the authority on the tokens and on which fonts to load, and
 * both are exact strings we generated ourselves. When the designer mistypes a
 * hex value or forgets a <link>, the honest response is to put the right one
 * back — not to spend another twenty-five thousand output tokens asking a
 * strong model to retype something we already know.
 *
 * Because every rule below :root goes through the custom properties, replacing
 * the :root block alone re-colours and re-scales the entire page.
 */
export function repairMockup(html: string, direction: ArtDirection | null): RepairResult {
  if (!direction) return { html, repairs: [] };

  const repairs: string[] = [];
  let out = html;

  // 1. The token block, restored to exactly what the direction decided.
  const rootMatch = out.match(/:root\s*\{[\s\S]*?\}/i);

  if (rootMatch) {
    const current = readRootTokens(rootMatch[0]);
    const canonical = serialiseTokens(direction.tokens);

    const drifted = Object.entries(expected(direction.tokens)).some(
      ([name, value]) =>
        current[name] !== undefined && normalise(current[name]) !== normalise(value)
    );

    if (drifted) {
      // Custom properties the designer added of its own accord are kept: they
      // are referenced elsewhere in the stylesheet and dropping them would
      // break rules that are otherwise fine.
      const extra = Object.entries(current)
        .filter(([name]) => !(name in expected(direction.tokens)))
        .map(([name, value]) => `  ${name}: ${value};`);

      const merged = extra.length
        ? canonical.replace(/\n\}$/, "\n" + extra.join("\n") + "\n}")
        : canonical;

      out = out.replace(rootMatch[0], () => merged);
      repairs.push("tokens restored to the art direction");
    }
  }

  // 2. Missing font links, added rather than regenerated.
  //
  // Only the Google Fonts hrefs are searched. Scanning the whole document
  // instead would find the family name inside the token block itself
  // (--font-text: "Karla") and conclude the face was linked when it was not,
  // which silently disabled this repair entirely.
  const links: string[] = [];

  for (const face of [direction.typography.display, direction.typography.text]) {
    if (!isLinked(out, face.family)) {
      links.push(`<link rel="stylesheet" href="${face.url}">`);
      repairs.push(`linked ${face.family}`);
    }
  }

  if (links.length && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, () => links.join("\n") + "\n</head>");
  }

  return { html: out, repairs };
}

/** The custom properties the direction owns, as name -> value. */
function expected(tokens: DesignTokens): Record<string, string> {
  const map: Record<string, string> = {};

  for (const role of COLOR_ROLES) {
    map[`--color-${role}`] = tokens.color[role];
  }

  map["--font-display"] = `"${tokens.font.display}"`;
  map["--font-text"] = `"${tokens.font.text}"`;

  tokens.size.forEach((v, i) => (map[`--size-${i}`] = v));
  tokens.space.forEach((v, i) => (map[`--space-${i}`] = v));
  tokens.radius.forEach((v, i) => (map[`--radius-${i}`] = v));

  return map;
}

/**
 * The retry message: only what went wrong, appended to the original request.
 *
 * Re-sending the whole prompt would double the cost of every correction. The
 * model still has the direction and the brief in its context; what it lacks is
 * the list of things it got wrong.
 */
export function retryNote(failures: Failure[]): string {
  const fatal = failures.filter((f) => f.fatal);

  if (!fatal.length) return "";

  return (
    "Your previous attempt broke the contract in these specific ways. " +
    "Produce the complete document again, corrected. Keep everything that was right.\n\n" +
    fatal.map((f) => `- [${f.code}] ${f.detail}`).join("\n")
  );
}
