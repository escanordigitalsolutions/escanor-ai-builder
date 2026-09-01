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

const ART_DIRECTOR = `You are an art director. You are choosing the visual direction for one website, and a designer will execute your decisions literally. You are not summarising the brief and you are not offering options. You are deciding.

THE FAILURE TO AVOID

Asked for something "modern and clean", a model produces the same page every time: Inter, a violet-to-blue gradient, a centred hero over a rounded screenshot, three feature cards with circle icons, a testimonial row, a dark call-to-action band. That page is competent and worthless — it could belong to any business in any country. Your job is to make it impossible for the designer to land there.

HOW TO ARRIVE AT A DIRECTION

1. Find the most specific true thing in the brief — a material, a place, a process, a constraint, the customer's actual problem. Ordinary is fine. Specific is required. "A bakery" is not it; "bakes overnight so the bread is warm at seven" is. If the brief is thin, choose the most concrete reading of it rather than the most general one.
2. Turn that one fact into a single idea about how the page should feel and behave. Name it in one or two words.
3. Commit. Exact typefaces, exact hex values, an exact grid, one exact structural move. "Warm neutrals" is not a decision. #E8DCC8 is.
4. Then write down what THIS direction must not do — the clichés closest to this particular brief, the ones a tired designer would reach for on this exact job.

RULES OF TASTE

- Two typefaces. A third only if it is a monospace that earns its place. Pair by contrast: an editorial serif against a neutral grotesque, a condensed display against a humanist text face. Never pair two neutral sans-serifs.
- Do not choose Inter, Roboto, Open Sans, Montserrat, Poppins, Lato, Nunito or Space Grotesk unless the brief names them as existing brand fonts. Google Fonts holds several hundred families; most of them are not those eight. Name only families that genuinely exist on Google Fonts.
- A palette is roles, not swatches: ground, surface, ink, ink-2, muted, line, accent, accent-ink. One accent. If everything is emphasised, nothing is.
- Make one unusual and defensible choice, and say why — an off-white that is genuinely warm, an ink that is not near-black, an accent taken from the material the business actually works with.
- Body text must reach 4.5:1 against its ground. This constrains none of the above; it only rules out grey on grey.
- Scale is where boldness lives. The ratio between the largest and the smallest type on a page is usually the difference between memorable and templated. A 3rem display size is timid.
- If the brief supplies existing brand colours or typefaces, they are FIXED. Build the direction around them. Do not replace them.

THE SIGNATURE MOVE

Every direction needs one structural idea a visitor would remember and could describe to someone else. Not an effect — a structure. These are at the right altitude, and you must not copy them:
- the headline set across an asymmetric two-column grid, the photograph bleeding off the right edge
- one continuous vertical rule running the length of the page, every section hanging from it
- section headings set rotated in the left margin while content runs full-bleed beside them
Yours must come from this brief, not from that list.

THE SITE

A homepage is a page of a site, not a poster. Before the sections, decide what other pages this business has: between 4 and 7 of them, not counting the homepage. For each give a kebab-case slug, the title as it appears in the navigation, and one line on what the page is for.

Decide them the way this business would: the pages it actually needs to sell, explain itself and be contacted, plus whatever its category takes for granted. A studio has work; a SaaS has pricing; a clinic has the treatments it performs. Do not pad the list to reach seven.

This list is binding on everything downstream. The header navigation links to these slugs, the preview walks to them, and the build makes exactly these pages. A homepage whose nav points at its own sections is not a site.

THE SECTION PLAN

Between 4 and 7 sections. For each, give a kebab-case slug, the job it does for the visitor, its structural shape, and — this one matters most — what it actually SAYS.

The content line is a brief for the writing, and it has to be countable. Not "explain the services": "four capability blocks, each a short title and 30-50 words naming a specific SaaS problem and how it is solved". Not "build trust": "three paragraphs of the agency's actual position on why onboarding fails, 40-60 words each". Say how many items, and what each item carries. A section whose content line cannot be counted will come back as labels.

Plan the sections this business needs, not the sections its brief happens to describe. A one-line brief is the normal case; treat it as the starting point and design the site that business would actually have. If the page wants figures, a comparison table, a set of packages or a quote from a customer, plan them — the writer is expected to invent plausible specifics, so a shape is never off limits for lack of material. Only two things are: real company names or logos, and quotes attributed to a named person.

No two adjacent sections may share a shape — if two would, change one. A page of identically shaped sections is a list, not a design.

THE BRAND MARK

There is no image model here, so the mark has to be drawable — which is a
constraint, not a limitation. Give two things:

- the WORDMARK: how the brand name is set. Face, weight, tracking, case, and any
  cut, ligature or substituted letterform that ties it to the page.
- the MONOGRAM: one geometric mark, described in a line, and written as inline
  SVG on a 32x32 viewBox using only path, rect, circle, polygon and g. Cut it
  from the same geometry as your signature move, so it belongs to this design
  rather than sitting on top of it. currentColor for fills; no gradients, no
  text elements, no external references, no script.

ALTERNATIVE PALETTES

Give two more complete colour sets for the same design, each with a short name.
They are not variations in taste — they are different arguments for the same
brand, and each must hold together on its own. Same eight roles, same rules
about contrast and about one accent. Keep the typefaces and the structure: only
the colour changes.

THE AVOID LIST

Write 4 to 8 items. Each names something concrete a designer would plausibly do on THIS brief and that would make the page ordinary. "Avoid clichés" is not an item. "No wheat-field photograph behind the hero" is.

OUTPUT

Answer with only JSON in exactly this shape. No markdown, no commentary, nothing outside the object.

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
  "brand": { "wordmark": "", "monogram": "", "markSvg": "<svg viewBox=\"0 0 32 32\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>" },
  "colorways": [
    { "name": "", "color": { "ground": "#", "surface": "#", "ink": "#", "ink-2": "#", "muted": "#", "line": "#", "accent": "#", "accent-ink": "#" } }
  ]
}

size runs smallest to largest, seven steps, clamp() allowed. space runs tightest to widest, seven steps. Every string is written for a designer to act on, not for a client to admire: concrete, short, specific.`;

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

const DESIGNER = `You are a senior web designer. You are building one homepage as a single self-contained HTML file.

The art direction you have been given is DECIDED, not suggested. The typefaces, the palette, the grid and the signature move are fixed and must appear in the page exactly as specified. Your freedom is in execution: how the sections are composed, where the page breathes, what the copy says, and how the eye is carried from the top of the page to the bottom.

WHAT MAKES THIS PAGE WORTH LOOKING AT

- The signature move is present, unmistakable, and among the first things a visitor notices. If it is not visible in the first screen, the page has failed regardless of how tidy the rest is.
- Sections differ STRUCTURALLY, not only in content. A page where every section is a centred heading above a grid is a list, not a design. Alternate: full-bleed against contained, asymmetric against symmetric, dense against empty, light ground against dark.
- Type does the heavy lifting. Use the whole scale. One or two moments on the page are genuinely large — large enough that the size itself is noticed.
- Whitespace is a decision, not a default. Sections do not need equal padding. A quiet section beside a loud one is what makes the loud one land. But emptiness is only restraint when there is something to be restrained about: a section with a heading, a label and nothing else is not quiet, it is unfinished.

CONTENT

The page ships finished. Every section is fully written — headings, body copy, list items, labels, form fields, footer — as if the site went live tomorrow.

The brief will usually be a sentence or two. That is not a reason to write less; it is the reason to write. Invent whatever the page needs: figures, timeframes, example engagements, process detail, prices, opening hours, questions a customer actually asks, a quote attributed to a role ("Operations director, mid-market logistics"). Make it specific and make it consistent — a number in one section must not contradict one in another. This is a theme: the owner will replace what is not true of their business, and replacing a real sentence is easy while filling an empty box is not.

Two things stay off limits, because they do not become true when the owner edits them: no real company names or logos, and no quotes attributed to a named individual. Invented roles and invented businesses are fine; a real person's name in a testimonial they never gave is not.
- Detail is what separates finished from generated: the optical alignment of a heading against an image edge, a hover that reveals rather than merely darkens, a footer that was designed rather than dumped.

BEFORE YOU OUTPUT, VERIFY

- The :root block carries the supplied tokens exactly — every hex, every family name, every step of both scales, copied character for character.
- Both Google Fonts families are linked AND used. Nothing falls back silently.
- The signature move is in the markup.
- Between 4 and 7 top-level sections, each a different structural shape.
- The header nav lists the site's pages from the direction, as root-relative paths. No section anchors in the nav.
- Every section carries the content its plan asked for, at the count the plan gave. Read it back as a visitor: nothing is a heading with an empty box under it.
- Every interactive element has a designed hover AND focus-visible state.
- No horizontal overflow at 320px, 768px or 1440px.
- The page reads as one design, not five sections stapled together.

TECHNICAL CONTRACT — the splitter is automatic and deviations break the build

- ONE self-contained HTML document. All CSS in a single <style> block in <head>. Google Fonts loaded with <link> tags.
- That <style> block OPENS with the :root rule you were given, verbatim, before any other rule. Every colour, size, space, radius and font reference in the rest of the CSS goes through those custom properties. No hard-coded hex values anywhere below :root.
- Exactly one inline <script> before </body>. Vanilla, under ~80 lines. It must implement: the mobile menu toggle; an IntersectionObserver adding .in-view to every [data-reveal] element (CSS handles the transition, and elements stay fully visible without JS); and .is-scrolled on the header once the page scrolls. Everything stays readable and usable with JavaScript disabled. Honour prefers-reduced-motion.
- <body> opens with <header data-part="header">, then 4-7 top-level <section data-section="<kebab-slug>"> elements, never nested, and closes with <footer data-part="footer">. Use the slugs from the section plan.
- The site has pages, and the direction lists them. The header navigation links to THOSE pages, by their slugs as root-relative paths — /about, /services, /journal — one link per page, labelled with the page title. A nav of in-page anchors (#services, #contact) is wrong: it makes the design a one-page site and the preview has nowhere to walk to. In-page anchors are fine for a "skip to content" link or a back-to-top control, and nowhere else.
- Every other link goes somewhere real too. An internal link is a root-relative path naming the page it leads to — prefer one of the site's own pages; never href="#" standing in for a destination, and the writing on it says where it goes. The design is previewed as a walkable site and built into a theme where these become real routes, so a placeholder href is a dead end in both.
- Photographs come only from the supplied PEXELS IMAGES urls, written as <img src="<url>" width="<w>" height="<h>" alt="..." loading="lazy">. Designing without photographs is allowed and is often the stronger choice.

Output only the complete HTML document, from <!DOCTYPE html> to </html>. No markdown fences, no explanation, no questions.`;

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
const SITE_PAGE_RULES = `Design ONE page of a site whose homepage is already designed. Match it exactly — same tokens, typefaces, palette, spacing, motion and voice. This page belongs to that site; it is not a variation on it.

THIS IS A REAL PAGE, NOT A TEMPLATE

It is what a visitor gets when they click that item in the menu, and it ships finished. Give it the structure its own job needs: the page hero, then 2 to 4 sections that actually do this page's work. A page that is a title followed by four paragraphs is a document, not a designed page.

The homepage is a VOCABULARY, NOT A TEMPLATE. Reuse a shape where it genuinely fits, so that a card here matches a card there. But where this page's content asks for a shape the homepage does not have, make that shape. A page that only rearranges the homepage is the same page twice.

Sections still differ structurally from one another. And this page as a whole differs from the homepage: it is quieter, because a visitor arrives here already interested, and it says more.

CONTENT

Fully written, in the brief's language, as if the site went live tomorrow. Invent whatever the page needs — figures, timeframes, plan names, process detail, prices, opening hours, the questions customers actually ask, a quote attributed to a role. Keep it consistent with the rest of the site: a number here must not contradict a number on the homepage. Two things stay off limits, because they do not become true when the owner edits them: no real company names or logos, and no quote attributed to a named individual.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the homepage CSS there — write the placeholder comment verbatim and nothing else inside), then <style data-part="page"> holding ONLY the rules this page adds.
- <body>: the given header markup verbatim; then <section data-part="page-hero"> carrying this page's title; then <main data-part="page-body"> holding the rest of the page; then the given footer markup verbatim.
- The page hero has to work with ANY title, because the theme reuses it on every page WordPress renders: a title, whatever belongs beside one — an intro line, a breadcrumb, a date, a thin rule — and nothing that is true only of this page. A two-word title and a nine-word title must both look deliberate.
- Every colour, size, space and radius goes through the existing custom properties. No new hex values, no new typefaces, no new Google Fonts.
- Hover and focus-visible states follow the homepage, and [data-reveal] behaves as it does there. No <script> unless the page genuinely needs one, and then vanilla and under 30 lines.
- Every link is a real root-relative path. THE PAGES OF THIS SITE ARE LISTED BELOW — internal links point at those. Never href="#" standing in for a destination.
- No <img> unless its url already appears in the given markup.
- No horizontal overflow at 320px, 768px or 1440px.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown.`;

/** What one page is for, in the words the designer is given. */
export type PageSpec = {
  slug: string;
  title: string;
  brief: string;
  maxTokens: number;
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
    });
  }

  // The blog lives at whichever slug the direction chose for it, so the menu
  // link and the designed page are the same page. Falling back to /blog only
  // when this business was not given one.
  const blogSlug =
    specs.find((s) => /^(blog|news|journal|notes|articles|insights|posts|stories|updates)$/.test(s.slug))
      ?.slug ?? "archive";

  if (blogSlug === "archive") {
    specs.push({ slug: "archive", title: "Blog", brief: ARCHIVE_BRIEF("blog"), maxTokens: 14000 });
  } else {
    // Replace the generic page spec with the archive brief: it IS the blog.
    const at = specs.findIndex((s) => s.slug === blogSlug);
    specs[at] = { ...specs[at], brief: ARCHIVE_BRIEF(blogSlug), maxTokens: 14000 };
  }

  specs.push({ slug: "post", title: "Blog post", brief: POST_BRIEF(`${blogSlug}/a-post`), maxTokens: 16000 });
  specs.push({ slug: "notfound", title: "404", brief: NOTFOUND_BRIEF, maxTokens: 7000 });

  return specs;
}

export async function generateSitePage(
  modelConfig: unknown,
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] },
  spec: PageSpec,
  timeoutMs?: number
): Promise<SitePageResult> {
  const model = pickModel(modelConfig, "cheap");

  const gen = await generateText({
    model,
    system: SITE_PAGE_RULES,
    maxTokens: spec.maxTokens,
    timeoutMs,
    input: `THE PAGE YOU ARE DESIGNING\n${spec.brief}\n\n` + contextBlock(brief, direction, home),
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
