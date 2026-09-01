import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";
import { replacePlaceholderImages, fetchBriefImages } from "./pexels";
import {
  SHAPES,
  parseArtDirection,
  resolveShape,
  serialiseTokens,
  type ArtDirection,
  type DesignShape,
} from "./art-direction";

/**
 * Design-first pipeline: an art direction, then a homepage that executes it.
 *
 * The old shape of this file had a problem it could not see. A cheap model was
 * asked for a "creative concept" and explicitly forbidden to prescribe colours,
 * fonts, sections or layout — so it returned adjectives. The strong model was
 * then told those notes were "inspiration, not a specification". We were paying
 * for a direction and instructing the designer to ignore it, which is why every
 * result drifted back toward the same average page.
 *
 * Now the first call DECIDES — exact typefaces, exact hex values, a grid, one
 * structural move, and a list of clichés specific to this brief — and the second
 * call executes those decisions literally. The decisions travel as CSS custom
 * properties, which means a validator can check whether they were honoured
 * without asking a model's opinion.
 */

// ---------------------------------------------------------------------------
// Stage 1 — the art director
// ---------------------------------------------------------------------------

const ART_DIRECTOR = `You are an art director. Decide the visual direction for one website; a designer will execute your decisions literally. Decide — exact typefaces, exact hex values, an exact grid. Never options, never vague adjectives: "warm neutrals" is not a decision, #E8DCC8 is.

RULES

- Root the direction in the most specific true thing in the brief, and name the concept in a word or two. If the brief is thin, take its most concrete reading, not its most general.
- One structural SIGNATURE MOVE a visitor could describe to someone else afterwards. A structure, not an effect.
- Two Google Fonts families, paired by contrast. Never Inter, Roboto, Open Sans, Montserrat, Poppins, Lato, Nunito or Space Grotesk unless the brief names them as existing brand fonts. Name only families that exist on Google Fonts.
- The palette is roles, with ONE accent. Body text reaches 4.5:1 against its ground. Brand colours or typefaces given in the brief are fixed.
- PAGES: 4 to 7 the business actually needs, kebab-case slugs with a title and a one-line purpose each. Binding: the header links to them, the preview walks to them, the theme builds exactly these.
- SECTIONS: 4 to 7 for the homepage. Each gets a slug, its job, its structural shape, and a COUNTABLE content line — "four capability blocks, each a title and 30-50 words" — never "explain the services". No two adjacent sections share a shape. The writer will invent plausible specifics, so plan figures, tables and quotes freely; only real company names and quotes attributed to a named person are off limits.
- Two more complete colourways for the same design, same roles, each holding together on its own.
- avoid: 4 to 8 concrete moves a tired designer would plausibly make on THIS brief.

Answer with only JSON in exactly this shape. No markdown, nothing outside the object.

{
  "concept": { "name": "", "thesis": "", "rootedIn": "" },
  "signatureMove": "",
  "tokens": {
    "color": { "ground": "#", "surface": "#", "ink": "#", "ink-2": "#", "muted": "#", "line": "#", "accent": "#", "accent-ink": "#" },
    "font": { "display": "", "text": "" },
    "size": ["", "", "", "", "", "", ""],
    "space": ["", "", "", "", "", "", ""],
    "radius": ["", "", ""],
    "motion": { "duration": "", "easing": "" }
  },
  "typography": {
    "display": { "family": "", "url": "https://fonts.googleapis.com/css2?family=...&display=swap", "weights": [] },
    "text": { "family": "", "url": "https://fonts.googleapis.com/css2?family=...&display=swap", "weights": [] },
    "pairing": ""
  },
  "palette": { "rationale": "", "unusualChoice": "" },
  "pages": [ { "slug": "", "title": "", "purpose": "" } ],
  "layout": {
    "grid": "",
    "rhythm": "",
    "sections": [ { "slug": "", "job": "", "shape": "", "content": "" } ]
  },
  "imagery": { "strategy": "photography|typographic|css-illustration|mixed", "treatment": "", "queries": [] },
  "motion": "",
  "voice": { "tone": "", "sample": { "h1": "", "sub": "", "cta": "" } },
  "avoid": [],
  "colorways": [
    { "name": "", "color": { "ground": "#", "surface": "#", "ink": "#", "ink-2": "#", "muted": "#", "line": "#", "accent": "#", "accent-ink": "#" } }
  ]
}

size runs smallest to largest, seven steps, clamp() allowed. space runs tightest to widest.`;

export type StageResult<T> = { data: T; usage: Usage; model: string };

export async function generateArtDirection(
  modelConfig: unknown,
  brief: unknown,
  shape: DesignShape,
  language?: string
): Promise<StageResult<ArtDirection | null>> {
  // The art direction is the single decision every later stage obeys: colours,
  // type, the signature move. Small output, huge leverage — it belongs on the
  // strong design model, not the cheap helper tier.
  const model = pickModel(modelConfig, "design");

  const gen = await generateText({
    model,
    system: ART_DIRECTOR,
    maxTokens: 6000,
    input:
      `BRIEF\n${JSON.stringify(brief, null, 2)}` +
      `\n\nREQUESTED SHAPE: ${shape} — ${SHAPES[shape]}` +
      (language
        ? `\n\nCOPY LANGUAGE: ${language}. Every sample string you write — the h1, the subheading, the call to action — is in this language.`
        : "") +
      `\n\nReturn the JSON.`,
  });

  return { data: parseArtDirection(gen.text), usage: gen.usage, model };
}

// ---------------------------------------------------------------------------
// Stage 2 — the designer
// ---------------------------------------------------------------------------

const DESIGNER = `You are a senior web designer building one homepage as a single self-contained HTML file. The art direction is DECIDED, not suggested: the typefaces, palette, grid, signature move and page list are fixed. Your freedom is execution — composition, rhythm, and what the copy says.

The page ships finished: every section fully written, in the brief's language, at the count its content line asked for. Invent whatever specifics the page needs — figures, prices, timeframes, process, a quote attributed to a role — and keep them consistent across the page. Never real company names or logos; never a quote attributed to a named person.

Sections differ STRUCTURALLY from one another, not only in content. Type does the heavy lifting — one or two moments genuinely large. The signature move is unmistakable and visible in the first screen.

TECHNICAL CONTRACT — the splitter is automatic and deviations break the build

- ONE HTML document. All CSS in a single <style> block in <head>, which OPENS with the supplied :root block verbatim. Every colour, size, space, radius and font below it goes through those custom properties — no hard-coded hex below :root. Google Fonts loaded with <link> tags, both families used.
- Exactly one inline <script> before </body>: vanilla, under ~80 lines — the mobile menu toggle, an IntersectionObserver adding .in-view to [data-reveal] (everything stays visible without JS), and .is-scrolled on the header. Honour prefers-reduced-motion.
- <body>: <header data-part="header">, then 4-7 top-level <section data-section="<slug>"> using the plan's slugs, never nested, then <footer data-part="footer">.
- The header nav links to the site's pages by their slugs as root-relative paths — one link per page, labelled with its title, no in-page anchors in the nav. Every other internal link is also a real root-relative path; never href="#".
- Photographs only from the supplied PEXELS urls, as <img src width height alt loading="lazy"> — or none, which is often stronger.
- No horizontal overflow at 320px, 768px or 1440px; hover and focus-visible states on everything interactive.

Output only the complete HTML document, from <!DOCTYPE html> to </html>. No markdown fences, no commentary.`;

export type MockupSection = { slug: string; html: string };

export type MockupResult = {
  html: string;
  css: string;
  header: string;
  footer: string;
  fonts: string[];
  sections: MockupSection[];
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateMockup(
  modelConfig: unknown,
  brief: unknown,
  variation?: string,
  shape?: unknown,
  direction?: ArtDirection | null,
  retry?: string,
  timeoutMs?: number
): Promise<MockupResult> {
  // The homepage designer — the screen the customer judges the product by.
  const model = pickModel(modelConfig, "design");
  const shapeKey = resolveShape(shape);

  // A typographic direction wants no photographs at all, so fetching them is
  // both wasted work and a temptation the designer does not need.
  const images =
    direction?.imagery.strategy === "typographic"
      ? []
      : await fetchBriefImages(brief, direction?.imagery.queries);

  const imageBlock = images.length
    ? `\n\nPEXELS IMAGES (use ONLY these urls, or none)\n` +
      images
        .map(
          (im, i) =>
            `${i + 1}. ${im.url} (${im.orientation}, ${im.w}x${im.h}${im.alt ? `, "${im.alt}"` : ""})`
        )
        .join("\n")
    : `\n\nPEXELS IMAGES: none supplied — design without <img> elements.`;

  const directionBlock = direction
    ? `\n\nART DIRECTION — binding\n${JSON.stringify(directionForModel(direction), null, 2)}` +
      `\n\n:ROOT TOKENS — paste this block verbatim as the first rule of your stylesheet\n${serialiseTokens(direction.tokens)}` +
      `\n\nGOOGLE FONTS — link both of these\n${direction.typography.display.url}\n${direction.typography.text.url}` +
      (direction.avoid.length
        ? `\n\nDO NOT DO, on this brief specifically:\n${direction.avoid.map((a) => `- ${a}`).join("\n")}`
        : "")
    : `\n\nNo art direction was produced for this brief. Make the decisions yourself, and make them specific: exact typefaces from Google Fonts, an exact palette, one structural idea a visitor would remember.`;

  const gen = await generateText({
    model,
    system: DESIGNER,
    // 64k because a complete bespoke homepage did not fit in 32k: the measured
    // run stopped at exactly the ceiling, mid-sentence, and was thrown away.
    // The cap is headroom, not a target — cost follows what the model actually
    // writes, and the prompt still asks for a finished page over an elaborate
    // one. Providers disagree about the maximum, so a cap this model will not
    // accept is stepped down automatically rather than failing the run.
    maxTokens: 64000,
    timeoutMs,
    input:
      `BRIEF — for content and voice\n${JSON.stringify(brief, null, 2)}` +
      `\n\nREQUESTED SHAPE: ${shapeKey} — ${SHAPES[shapeKey]}` +
      directionBlock +
      imageBlock +
      (variation ? `\n\n${variation}` : "") +
      (retry ? `\n\n${retry}` : ""),
  });

  let html = gen.text.trim();

  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) {
    html = fence[1].trim();
  }

  const start = html.search(/<!DOCTYPE/i);
  if (start > 0) {
    html = html.slice(start);
  }

  const endIdx = html.lastIndexOf("</html>");
  if (endIdx !== -1) {
    html = html.slice(0, endIdx + "</html>".length);
  }

  // Swap keyword placeholders for real Pexels photos (no-op without a key).
  html = await replacePlaceholderImages(html);

  const split = splitMockup(html);

  console.log(
    `mockup model=${model} shape=${shapeKey} concept=${direction?.concept.name ?? "none"} ` +
      `chars=${html.length} sections=[${split.sections.map((s) => s.slug).join(", ")}] ` +
      `fonts=${split.fonts.length} truncated=${gen.truncated}${retry ? " (retry)" : ""}`
  );

  return {
    html,
    ...split,
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}

/**
 * The direction as the designer needs to read it.
 *
 * The token object is dropped: it is handed over separately as finished CSS, so
 * including the JSON as well invites the model to retype it and get a digit
 * wrong. The urls go in their own block for the same reason.
 */
function directionForModel(direction: ArtDirection): Record<string, unknown> {
  return {
    concept: direction.concept,
    signatureMove: direction.signatureMove,
    typography: {
      display: direction.typography.display.family,
      text: direction.typography.text.family,
      pairing: direction.typography.pairing,
    },
    palette: direction.palette,
    pages: direction.pages,
    layout: direction.layout,
    imagery: direction.imagery,
    motion: direction.motion,
    voice: direction.voice,
  };
}

export function splitMockup(html: string): {
  css: string;
  header: string;
  footer: string;
  fonts: string[];
  sections: MockupSection[];
} {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1].trim())
    .join("\n\n");

  const header =
    (html.match(/<header[^>]*data-part=["']header["'][\s\S]*?<\/header>/i) ||
      html.match(/<header[\s\S]*?<\/header>/i) ||
      [""])[0];

  const footer =
    (html.match(/<footer[^>]*data-part=["']footer["'][\s\S]*?<\/footer>/i) ||
      html.match(/<footer[\s\S]*?<\/footer>/i) ||
      [""])[0];

  const fonts = [
    ...html.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/css2[^"']+)["']/gi),
  ].map((m) => m[1].replace(/&amp;/g, "&"));

  const sections: MockupSection[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(
    /<section[^>]*data-section=["']([a-z0-9-]+)["'][\s\S]*?<\/section>/gi
  )) {
    const slug = m[1].toLowerCase();
    if (!seen.has(slug)) {
      seen.add(slug);
      sections.push({ slug, html: m[0] });
    }
  }

  return { css, header, footer, fonts: [...new Set(fonts)], sections };
}

// ---------------------------------------------------------------------------
// Stage 3 — the review shown to the person
// ---------------------------------------------------------------------------

export async function critiqueMockup(
  modelConfig: unknown,
  html: string,
  direction?: ArtDirection | null
): Promise<StageResult<string>> {
  const model = pickModel(modelConfig, "cheap");

  const trimmed =
    html.length > 20000 ? html.slice(0, 12000) + "\n...\n" + html.slice(-6000) : html;

  const gen = await generateText({
    model,
    system:
      "You are a candid design reviewer. In 2-3 short sentences, tell the user what stands out about this homepage and one concrete thing that could be better. " +
      "Speak about what a visitor would SEE — composition, type, colour, imagery — never about code. Address the user directly, no lists.",
    maxTokens: 300,
    input:
      (direction?.signatureMove
        ? `The design was meant to be built around this idea: ${direction.signatureMove}\nSay whether it actually landed.\n\n`
        : "") + trimmed,
  });

  return { data: gen.text.trim().slice(0, 600), usage: gen.usage, model };
}

/**
 * The class names a stylesheet defines, without the rules.
 *
 * A derived page needs to know that `.container` and `.btn--primary` exist; it
 * does not need to read their declarations. Sending the whole homepage
 * stylesheet as input — often ten thousand tokens — only to instruct the model
 * not to repeat it was the most expensive redundancy in the pipeline.
 */
export function classInventory(css: string, limit = 120): string[] {
  const names = new Set<string>();

  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    names.add(m[1]);
    if (names.size >= limit) break;
  }

  return [...names];
}

/** Kept under its old name: the route and the plugin both still say "style". */
export const resolveStyle = resolveShape;

// ---------------------------------------------------------------------------
// Stage 4 — every other page of the site
// ---------------------------------------------------------------------------

/**
 * One generator for every page that is not the homepage.
 *
 * It replaces three stages that each existed for a different reason and
 * together produced a design nobody could walk through:
 *
 *   - the INNER PAGE, a single template standing in for About, Services,
 *     Contact and everything else at once. Five menu items led to one screen
 *     with the title swapped, so the preview could be clicked but never
 *     arrived anywhere.
 *   - the COMPONENT SHEET, a catalogue of buttons and form fields no visitor
 *     could reach. It existed to guarantee that a form here matched a form
 *     there — which real pages now do by themselves, because a contact page
 *     has the form, the blog has the cards and pagination, and a post has the
 *     body typography.
 *   - the BRAND SHEET, a document about the design rather than a page of the
 *     site. Free to render, but it was a tab in a strip of pages while not
 *     being one.
 *
 * What made all three affordable to replace is that the pages are independent
 * of each other: each needs the direction and the finished homepage, and
 * nothing else. So they are generated in parallel, and a site of eight pages
 * costs about what one page used to.
 */
const SITE_PAGE_RULES = `Design ONE page of a site whose homepage is already designed — same tokens, typefaces, palette, spacing, motion and voice. It is a real, finished page: the page hero, then 2 to 4 sections doing this page's own job, fully written in the brief's language. Reuse the homepage's shapes where they fit; make a new one where the content needs it. Invent specifics, consistent with the homepage; never real company names or a quote attributed to a named person.

THE PAGE'S EDGES ARE NOT YOURS. The homepage sets the site's horizontal gutter on the bare section element, and every page inherits it. Wrap each section's content in the homepage's wrapper named below; NEVER set padding, margin, width or max-width on a <section> in a way that touches its left or right edge — "padding: 4rem 0" deletes the gutter, use "padding-block" instead. Your first line of text must start exactly where the homepage's does.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (write the placeholder comment verbatim, nothing else inside), then <style data-part="page"> holding only the rules this page adds.
- <body>: the given header markup verbatim; then <section data-part="page-hero"> that looks deliberate with ANY title, because the theme reuses it on every page; then <main data-part="page-body">; then the given footer markup verbatim.
- Existing custom properties only — no new hex values, no new typefaces, no <img> whose url is not already in the given markup.
- Internal links are root-relative paths to the pages listed below; never href="#". No <script> unless the page genuinely needs one, then vanilla under 30 lines. No horizontal overflow.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No markdown.`;

/** What one page is for, in the words the designer is given. */
export type PageSpec = {
  slug: string;
  title: string;
  brief: string;
  maxTokens: number;
  /** Below this the page is headings with empty boxes under them. */
  minWords: number;
};

export type SitePageResult = {
  slug: string;
  html: string;
  css: string;
  body: string;
  pageHero: string;
  truncated: boolean;
  usage: Usage;
  model: string;
};

const ARCHIVE_BRIEF = (slug: string) =>
  `This is the BLOG — the page that lists posts, at /${slug}. It needs a page heading, a category or filter row, a list or grid of post cards (title, date, excerpt and a link into the post), and pagination. This is the one page whose structure is genuinely unlike the homepage's, so give it a real layout decision of its own rather than a grid of identical boxes. Write six to nine plausible posts for this business, each with a real title, date and excerpt.`;

const POST_BRIEF = (slug: string) =>
  `This is ONE BLOG POST, at /${slug}. It is also the template every long piece of writing on this site will use, so the body typography IS the work: h2, h3, paragraphs, an unordered and an ordered list, a blockquote with attribution, an inline link, a figure with a caption, and a small data table — each styled and each demonstrated in the flow of a real article. Write a genuine post for this business, 600 to 900 words, with a title, a date and an author role. Wrap the article body in <article><div class="entry container"> … </div></article> inside the page body: the theme styles all WordPress content through .entry, so those two classes have to carry the typography.`;

const NOTFOUND_BRIEF =
  `This is the 404 PAGE. Short, and useful: say plainly that the page is not there, give the visitor two or three real ways onward to pages this site actually has, and include the search field. It is small, so make it count — a designed 404 is one of the few pages people remember.`;

/**
 * Every page to design after the homepage, in the order they are worth having.
 *
 * The site's own pages come first because they are what the menu points at: if
 * the clock runs out, a site missing its 404 is far less broken than a site
 * whose Services link leads nowhere.
 */
export function sitePageSpecs(direction: ArtDirection | null): PageSpec[] {
  const specs: PageSpec[] = [];
  const taken = new Set<string>(["home"]);

  for (const page of direction?.pages ?? []) {
    if (taken.has(page.slug)) continue;
    taken.add(page.slug);
    specs.push({
      slug: page.slug,
      title: page.title,
      brief:
        `This page is "${page.title}", at /${page.slug}.` +
        (page.purpose ? ` What it is for: ${page.purpose}` : "") +
        `\n\nWork out what somebody who clicked "${page.title}" came here to find, and put it in front of them — in full, not as an outline.`,
      maxTokens: 16000,
      minWords: 260,
    });
  }

  // The blog lives at whichever slug the direction chose for it, so the menu
  // link and the designed page are the same page. Falling back to /blog only
  // when this business was not given one.
  const blogSlug =
    specs.find((s) => /^(blog|news|journal|notes|articles|insights|posts|stories|updates)$/.test(s.slug))
      ?.slug ?? "archive";

  if (blogSlug === "archive") {
    specs.push({
      slug: "archive",
      title: "Blog",
      brief: ARCHIVE_BRIEF("blog"),
      maxTokens: 14000,
      minWords: 260,
    });
  } else {
    // Replace the generic page spec with the archive brief: it IS the blog.
    const at = specs.findIndex((s) => s.slug === blogSlug);
    specs[at] = { ...specs[at], brief: ARCHIVE_BRIEF(blogSlug), maxTokens: 14000, minWords: 260 };
  }

  specs.push({
    slug: "post",
    title: "Blog post",
    brief: POST_BRIEF(`${blogSlug}/a-post`),
    maxTokens: 16000,
    minWords: 450,
  });
  // A 404 is short on purpose, so it is held to a floor it can actually meet.
  specs.push({ slug: "notfound", title: "404", brief: NOTFOUND_BRIEF, maxTokens: 7000, minWords: 35 });

  return specs;
}

export async function generateSitePage(
  modelConfig: unknown,
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] },
  spec: PageSpec,
  timeoutMs?: number,
  options?: { container?: string | null; retry?: string }
): Promise<SitePageResult> {
  const model = pickModel(modelConfig, "cheap");
  const container = options?.container ?? null;

  const gen = await generateText({
    model,
    system: SITE_PAGE_RULES,
    maxTokens: spec.maxTokens,
    timeoutMs,
    input:
      `THE PAGE YOU ARE DESIGNING\n${spec.brief}\n\n` +
      contextBlock(brief, direction, home) +
      (container
        ? `\n\nTHE HOMEPAGE'S CONTENT WRAPPER — every section's content goes inside one of these, and nothing else sets the page's side margins\n<div class="${container}">`
        : "") +
      (options?.retry ? `\n\n${options.retry}` : ""),
  });

  const html = cleanDocument(gen.text, home.css);

  const cssMatch = html.match(/<style[^>]*data-part=["']page["'][^>]*>([\s\S]*?)<\/style>/i);
  const bodyMatch = html.match(/<main[^>]*data-part=["']page-body["'][\s\S]*?<\/main>/i);
  const heroMatch = html.match(/<section[^>]*data-part=["']page-hero["'][\s\S]*?<\/section>/i);

  console.log(
    `site-page slug=${spec.slug} model=${model} chars=${html.length} ` +
      `body=${bodyMatch ? "yes" : "MISSING"} hero=${heroMatch ? "yes" : "MISSING"} ` +
      `truncated=${gen.truncated}`
  );

  return {
    slug: spec.slug,
    html,
    css: cssMatch ? cssMatch[1].trim() : "",
    body: bodyMatch ? bodyMatch[0] : "",
    pageHero: heroMatch ? heroMatch[0] : "",
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}

/** The shared briefing every derived page is given. */
function contextBlock(
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] }
): string {
  const tokens = direction
    ? serialiseTokens(direction.tokens)
    : (home.css.match(/:root\s*\{[\s\S]*?\}/i) ?? [""])[0];

  return (
    `BRIEF\n${JSON.stringify(brief)}` +
    (direction
      ? `\n\nCONCEPT: "${direction.concept.name}" — ${direction.concept.thesis}` +
        `\nVOICE: ${direction.voice.tone}`
      : "") +
    (direction?.pages.length
      ? `\n\nTHE PAGES OF THIS SITE — internal links point at these, by these paths\n` +
        direction.pages.map((p) => `- /${p.slug} — ${p.title}`).join("\n")
      : "") +
    (home.fonts.length ? `\n\nGOOGLE FONTS (link these)\n${home.fonts.join("\n")}` : "") +
    `\n\nDESIGN TOKENS — already defined; use them, do not redefine them\n${tokens}` +
    `\n\nCLASSES ALREADY DEFINED — reuse where they fit\n${classInventory(home.css).join(", ")}` +
    `\n\nHEADER MARKUP (copy verbatim)\n${home.header}` +
    `\n\nFOOTER MARKUP (copy verbatim)\n${home.footer}`
  );
}

/** Strip fences, trim to the document, and inject the real CSS for preview. */
function cleanDocument(text: string, homeCss: string): string {
  let html = text.trim();

  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();

  const start = html.search(/<!DOCTYPE/i);
  if (start > 0) html = html.slice(start);

  const end = html.lastIndexOf("</html>");
  if (end !== -1) html = html.slice(0, end + "</html>".length);

  if (html.includes("/*HOMEPAGE-CSS*/")) {
    html = html.replace("/*HOMEPAGE-CSS*/", () => homeCss);
  } else {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n<style>${homeCss}</style>`);
  }

  return html;
}
