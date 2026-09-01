/**
 * Whether a derived page still belongs to the site it was drawn for.
 *
 * The homepage is checked hard — every token, every font, the section count —
 * and until now nothing checked the pages that come after it. That gap had a
 * precise cost, measured on a real generation: of seven derived pages, four
 * put their content on a different left edge from the homepage. One of them
 * put it at the window edge.
 *
 * The mechanism is worth stating, because it is not obvious and it is the same
 * every time. The homepage sets the site's horizontal gutter on the bare
 * element:
 *
 *     section { padding: var(--space-5) max(24px, calc((100vw - 1296px) / 2)) }
 *
 * A derived page then writes `.service-detail { padding: var(--space-5) 0 }`
 * for its own vertical rhythm. The shorthand carries a horizontal value, so it
 * overrides the gutter with zero and that page's text runs to the edge of the
 * window. Nothing errors. The page validates as HTML, uses the right tokens,
 * says the right things — and reads as broken, because walking the site moves
 * the left margin under the visitor's eye.
 *
 * Every check here was written against that generation and agrees with what a
 * browser measured on it, page for page.
 */

export type PageFailure = { code: string; detail: string; fatal: boolean };

const RULES = /([^{}]+)\{([^{}]*)\}/g;
const CLASS_IN_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * The class the homepage uses to hold a section's content.
 *
 * Found rather than assumed: the designer names it, and it has been
 * `.section-inner`, `.container` and `.wrap` on different runs. A page that
 * wraps its content in something else gets a different width and a different
 * edge, however carefully it copies the tokens.
 */
export function detectContainer(html: string, css: string): string | null {
  const styled = new Set<string>();

  for (const rule of css.matchAll(RULES)) {
    if (!/max-width\s*:/i.test(rule[2])) continue;
    for (const m of rule[1].matchAll(CLASS_IN_SELECTOR)) styled.add(m[1]);
  }

  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);
  const count = new Map<string, number>();

  for (const sec of body.matchAll(
    /<section\b[^>]*>\s*<(?:div|header)\b[^>]*class=["']([^"']+)["']/gi
  )) {
    for (const cls of sec[1].split(/\s+/)) {
      if (styled.has(cls)) count.set(cls, (count.get(cls) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let hits = 0;

  for (const [cls, n] of count) {
    if (n > hits) {
      best = cls;
      hits = n;
    }
  }

  // Once is a coincidence — a hero that happens to have a wrapper. Twice is the
  // page's own convention, which is what a derived page has to follow.
  return hits >= 2 ? best : null;
}

/** The classes this page puts on a `<section>`. */
export function sectionClasses(body: string): Set<string> {
  const out = new Set<string>();

  for (const m of body.matchAll(/<section\b[^>]*class=["']([^"']+)["']/gi)) {
    for (const cls of m[1].split(/\s+/)) if (cls) out.add(cls);
  }

  return out;
}

const HORIZONTAL =
  /(^|;)\s*(padding-(left|right|inline)|margin-(left|right|inline)|max-width|width)\s*:/i;

/**
 * Whether a `padding` shorthand carries a horizontal value.
 *
 * `padding: 4rem` sets all four sides from one value and leaves the gutter
 * expression intact in spirit — but `padding: 4rem 0` replaces it. Counting
 * top-level values is the difference, and it has to ignore spaces inside
 * `calc()`, `max()` and `var()`, which is where the gutter lives.
 */
function shorthandHasHorizontal(declarations: string): boolean {
  const match = declarations.match(/(^|;)\s*padding\s*:\s*([^;]+)/i);

  if (!match) return false;

  let depth = 0;
  let parts = 1;

  for (const ch of match[2].trim()) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === " " && depth === 0) parts += 1;
  }

  return parts >= 2;
}

export type PageToCheck = { slug: string; body: string; css: string };

export type PageRules = {
  /** The homepage's content wrapper, or null when it has no convention. */
  container: string | null;
  /** Below this the page is a heading with an empty box under it. */
  minWords: number;
};

export function validateSitePage(page: PageToCheck, rules: PageRules): PageFailure[] {
  const failures: PageFailure[] = [];
  const fail = (code: string, detail: string, fatal = true) =>
    failures.push({ code, detail, fatal });

  if (!page.body) {
    fail(
      "page.body",
      'The page has no <main data-part="page-body">, so nothing can be read out of it.'
    );
    return failures;
  }

  const words = page.body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;

  if (words < rules.minWords) {
    fail(
      "page.thin",
      `The page carries ${words} words. A finished page needs at least ${rules.minWords} — this one is headings with empty boxes under them.`
    );
  }

  const sections = (page.body.match(/<section\b/gi) || []).length;

  if (sections < 2) {
    fail("page.sections", `The page has ${sections} sections; it needs at least 2.`, false);
  }

  if (
    rules.container &&
    !new RegExp(`class=["'][^"']*\\b${rules.container}\\b`).test(page.body)
  ) {
    fail(
      "page.container",
      `Section content is not wrapped in .${rules.container}, which is what holds the page to the site's width.`
    );
  }

  const onSections = sectionClasses(page.body);

  for (const rule of page.css.matchAll(RULES)) {
    const selector = rule[1].trim();
    const declarations = rule[2];

    // Only the classes a selector actually targets — `.a .b` styles .b, and
    // flagging it because .a sits on a section would reject correct pages.
    const targets = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)\s*(?=[,{]|$)/g)].map(
      (m) => m[1]
    );
    const touchesASection =
      targets.some((cls) => onSections.has(cls)) || /(^|,)\s*section\s*(,|$)/i.test(selector);

    if (!touchesASection) continue;

    if (HORIZONTAL.test(declarations) || shorthandHasHorizontal(declarations)) {
      fail(
        "page.gutter",
        `"${selector.replace(/\s+/g, " ").slice(0, 48)}" sets a horizontal padding, margin or width on a section. ` +
          `The site's left edge is set once on the homepage, and a rule here moves it on this page only.`
      );
    }
  }

  return failures;
}

/**
 * What to tell the model on the second attempt.
 *
 * Only what went wrong, appended to the original request — the same shape the
 * homepage retry uses. Re-explaining the whole brief invites a different page
 * rather than this page fixed.
 */
export function pageRetryNote(failures: PageFailure[], container: string | null): string {
  const fatal = failures.filter((f) => f.fatal);

  if (!fatal.length) return "";

  return (
    `THE PREVIOUS ATTEMPT WAS REJECTED. Produce the same page again, with these faults fixed and nothing else changed:\n` +
    fatal.map((f) => `- ${f.detail}`).join("\n") +
    (container
      ? `\n\nThe page's horizontal edges come from the homepage. Wrap every section's content in <div class="${container}">, ` +
        `and set vertical rhythm with padding-block — never a padding shorthand with two values, which deletes the site's gutter.`
      : "")
  );
}
