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
- Every section carries the content its plan asked for, at the count the plan gave. Read it back as a visitor: nothing is a heading with an empty box under it.
- Every interactive element has a designed hover AND focus-visible state.
- No horizontal overflow at 320px, 768px or 1440px.
- The page reads as one design, not five sections stapled together.

TECHNICAL CONTRACT — the splitter is automatic and deviations break the build

- ONE self-contained HTML document. All CSS in a single <style> block in <head>. Google Fonts loaded with <link> tags.
- That <style> block OPENS with the :root rule you were given, verbatim, before any other rule. Every colour, size, space, radius and font reference in the rest of the CSS goes through those custom properties. No hard-coded hex values anywhere below :root.
- Exactly one inline <script> before </body>. Vanilla, under ~80 lines. It must implement: the mobile menu toggle; an IntersectionObserver adding .in-view to every [data-reveal] element (CSS handles the transition, and elements stay fully visible without JS); and .is-scrolled on the header once the page scrolls. Everything stays readable and usable with JavaScript disabled. Honour prefers-reduced-motion.
- <body> opens with <header data-part="header">, then 4-7 top-level <section data-section="<kebab-slug>"> elements, never nested, and closes with <footer data-part="footer">. Use the slugs from the section plan.
- Every link goes somewhere real. An internal link is a root-relative path naming the page it leads to — /about, /services, /journal, /contact — never href="#" standing in for a destination, and the writing on it says where it goes. The design is previewed as a walkable site and built into a theme where these become real routes, so a placeholder href is a dead end in both.
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

// ---------------------------------------------------------------------------
// Stage 4 — one inner page, in the same design
// ---------------------------------------------------------------------------

const INNER_RULES = `Design the INNER PAGE TEMPLATE for a site whose homepage is already designed. Match it exactly — same tokens, typography, palette, spacing, motion and voice.

This is not one page. It is the shape every page that is not the homepage will take: About, Services, a single blog post, a legal page. It has to look right with any title and any length of body, because WordPress will pour real content through it. Design it as the site's inner pages should look, not as a bespoke page about one subject.

Two parts do the work:

- THE PAGE HERO. The title area every inner page opens with: the title, and whatever belongs beside it — an intro line, a breadcrumb, a date, a thin rule. Content-agnostic, so a two-word title and a nine-word title both look deliberate. This is the piece the theme reuses everywhere, so it carries the design.
- THE CONTENT AREA. WordPress body typography, styled and demonstrated: h2, h3, paragraphs, an unordered and an ordered list, a blockquote with attribution, an inline link, an image with a caption. Write it as a real page of this business, fully — not three sentences to show the styling.

You are given the homepage's design tokens, its Google Fonts links, its header and footer markup, and the class names its stylesheet already defines. Reuse those classes wherever they fit. The header and footer are copied VERBATIM. Do not restyle anything the homepage already defines; write only the rules this page adds.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the homepage CSS there — write the placeholder comment verbatim, nothing else inside), then <style data-part="inner"> containing ONLY the additional rules this page needs, written against the same custom properties.
- <body>: the given header markup verbatim; then <section data-part="page-hero">; then <article><div class="entry container"> with the content; then the given footer markup verbatim. Nothing else — no extra marketing sections, no component showcase. An inner page that ends in a call-to-action band is a landing page, not a template.
- Hover and focus states and the [data-reveal] pattern follow the homepage. One tiny vanilla script only if the homepage has one.
- No new Google Fonts, no new colour literals, no <img> unless its url already appears in the given markup. No horizontal overflow.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown.`;

export type InnerResult = {
  html: string;
  css: string;
  pageHero: string;
  truncated: boolean;
  usage: Usage;
  model: string;
};

/**
 * The class names a stylesheet defines, without the rules.
 *
 * The inner page needs to know that `.container` and `.btn--primary` exist; it
 * does not need to read their declarations. Sending the whole homepage
 * stylesheet as input — often ten thousand tokens — only to instruct the model
 * not to repeat it was the most expensive redundancy in the pipeline.
 */
export function classInventory(css: string, limit = 120): string[] {
  const names = new Set<string>();

  for (const m of css.matchAll(/\.(-?[_a-z][\w-]*)/gi)) {
    names.add(m[1]);
    if (names.size >= limit) break;
  }

  return [...names];
}

export async function generateInnerMockup(
  modelConfig: unknown,
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] }
): Promise<InnerResult> {
  const model = pickModel(modelConfig, "cheap");

  const tokenBlock = direction
    ? serialiseTokens(direction.tokens)
    : (home.css.match(/:root\s*\{[\s\S]*?\}/i) ?? [""])[0];

  const gen = await generateText({
    model,
    system: INNER_RULES,
    maxTokens: 12000,
    input:
      `BRIEF\n${JSON.stringify(brief)}` +
      (direction
        ? `\n\nCONCEPT: "${direction.concept.name}" — ${direction.concept.thesis}` +
          `\nVOICE: ${direction.voice.tone}`
        : "") +
      (home.fonts.length ? `\n\nGOOGLE FONTS (link these)\n${home.fonts.join("\n")}` : "") +
      `\n\nDESIGN TOKENS — already defined by the homepage; use them, do not redefine them\n${tokenBlock}` +
      `\n\nCLASSES THE HOMEPAGE ALREADY DEFINES — reuse where they fit\n${classInventory(home.css).join(", ")}` +
      `\n\nHEADER MARKUP (copy verbatim)\n${home.header}` +
      `\n\nFOOTER MARKUP (copy verbatim)\n${home.footer}`,
  });

  let html = gen.text.trim();

  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();

  const start = html.search(/<!DOCTYPE/i);
  if (start > 0) html = html.slice(start);

  const endIdx = html.lastIndexOf("</html>");
  if (endIdx !== -1) html = html.slice(0, endIdx + "</html>".length);

  const cssM = html.match(/<style[^>]*data-part=["']inner["'][^>]*>([\s\S]*?)<\/style>/i);
  const heroM = html.match(/<section[^>]*data-part=["']page-hero["'][\s\S]*?<\/section>/i);

  // Inject the real homepage CSS so the preview iframe renders standalone.
  if (html.includes("/*HOMEPAGE-CSS*/")) {
    html = html.replace("/*HOMEPAGE-CSS*/", () => home.css);
  } else {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n<style>${home.css}</style>`);
  }

  console.log(
    `inner-mockup model=${model} chars=${html.length} hero=${heroM ? "yes" : "MISSING"} ` +
      `css=${cssM ? cssM[1].trim().length : 0} truncated=${gen.truncated}`
  );

  return {
    html,
    css: cssM ? cssM[1].trim() : "",
    pageHero: heroM ? heroM[0] : "",
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}

/** Kept under its old name: the route and the plugin both still say "style". */
export const resolveStyle = resolveShape;

// ---------------------------------------------------------------------------
// Stage 5 — the component system, extracted from the finished page
// ---------------------------------------------------------------------------

/**
 * The order here is the whole argument.
 *
 * A component library generated FIRST and composed into pages afterwards
 * produces exactly the assembled, catalogue look this pipeline exists to avoid:
 * the model never sees a whole page, so nothing on it is composed for the page
 * it is on. Generating the page first and DERIVING the system from it keeps the
 * bespoke result and still yields a vocabulary — one that inherits the design's
 * character because it was cut from it.
 *
 * What the sheet adds is everything a WordPress theme needs and a homepage
 * happens not to contain: form fields, tables, pagination, comments, a
 * blockquote, a sidebar widget. Those are the parts that otherwise get invented
 * separately on every inner page and never match.
 */
const COMPONENTS_RULES = `You are extending a finished website design into the component set its WordPress theme needs.

You are given the design's tokens, its typefaces, its header and footer, and the class names its stylesheet already defines. Your job is NOT to redesign anything. It is to write the pieces the homepage happens not to contain, in the same visual language, so that a page built from them looks like it belongs to the same site.

Build each of these, styled and in every state a person will actually see:
- buttons: primary, secondary and quiet, each with rest, hover, focus-visible and disabled
- a form: text input, textarea, select, checkbox, radio, a validation error, and a submit
- a card, in the design's own idiom
- long-form content: h2, h3, paragraph, unordered and ordered list, blockquote with attribution, inline link, code, a horizontal rule, and a figure with a caption
- a data table with a header row
- pagination, and a breadcrumb
- a tag or badge, and a notice or callout
- a sidebar widget with a heading and a list
- a comment, with avatar placeholder, name, date and body

RULES
- Reuse the existing classes wherever one already fits. Invent a class only when nothing does.
- Every colour, size, space and radius goes through the design's custom properties. No new hex values, no new typefaces.
- Hover and focus-visible states on everything interactive, matching the homepage's behaviour.
- Real, plausible copy in the brief's language, fully written. No lorem, no "Button" as a button label. Invent whatever specifics the piece needs — names of plans, field labels, a comment, a table of real-looking rows — but no real company names or logos, and no quote attributed to a named person.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the homepage CSS there — write the placeholder comment verbatim and nothing else inside), then <style data-part="components"> holding ONLY the new rules.
- <body>: the given header markup verbatim, then one <section data-component="<kebab-slug>"> per group above, each opening with an <h2> naming it, then the given footer markup verbatim.
- No <script>. No <img> unless its url already appears in the given markup.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown.`;

export type SheetResult = {
  html: string;
  css: string;
  blocks: MockupSection[];
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateComponentSheet(
  modelConfig: unknown,
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] },
  timeoutMs?: number
): Promise<SheetResult> {
  const model = pickModel(modelConfig, "cheap");

  const gen = await generateText({
    model,
    system: COMPONENTS_RULES,
    maxTokens: 12000,
    timeoutMs,
    input: contextBlock(brief, direction, home),
  });

  const html = cleanDocument(gen.text, home.css);

  const cssMatch = html.match(
    /<style[^>]*data-part=["']components["'][^>]*>([\s\S]*?)<\/style>/i
  );

  const blocks: MockupSection[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(
    /<section[^>]*data-component=["']([a-z0-9-]+)["'][\s\S]*?<\/section>/gi
  )) {
    const slug = m[1].toLowerCase();
    if (!seen.has(slug)) {
      seen.add(slug);
      blocks.push({ slug, html: m[0] });
    }
  }

  console.log(
    `components model=${model} chars=${html.length} blocks=${blocks.length} truncated=${gen.truncated}`
  );

  return {
    html,
    css: cssMatch ? cssMatch[1].trim() : "",
    blocks,
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}

// ---------------------------------------------------------------------------
// Stage 6 — the other pages a theme needs
// ---------------------------------------------------------------------------

export type ExtraPageKind = "archive" | "notfound";

const PAGE_BRIEFS: Record<ExtraPageKind, string> = {
  archive: `Design the BLOG ARCHIVE — the page that lists posts. It needs a page heading, an optional filter or category row, a list or grid of post cards (title, date, excerpt, and a link), and pagination. This is the one remaining page whose structure is genuinely different from the homepage's, so give it a real layout decision of its own rather than a grid of identical boxes.`,
  notfound: `Design the 404 PAGE. Short, and useful: say plainly that the page is not there, give the visitor two or three real ways onward, and include the search field. Small, so make it count — a designed 404 is one of the few pages people remember.`,
};

/**
 * A page built from the system, and allowed to leave it.
 *
 * The instruction below is deliberate: given a component sheet, a model will
 * assemble pages out of it and stop designing. The sheet is a vocabulary — it
 * guarantees that a button here matches a button there — but a page that only
 * ever arranges existing parts is the catalogue look again, one level up.
 */
const EXTRA_PAGE_RULES = `Design ONE more page for a site whose design is already decided, matching it exactly — same tokens, typefaces, palette, spacing, motion and voice.

The component set you are given is a VOCABULARY, NOT A TEMPLATE. Use it wherever it fits, so that a button, a card or a form on this page is the same as everywhere else. But this page is still designed, not assembled: where its content asks for a shape the components do not have, make that shape. A page that only rearranges existing parts is a catalogue, not a design.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the existing CSS there — write the placeholder comment verbatim and nothing else inside), then <style data-part="page"> holding ONLY the rules this page adds.
- <body>: the given header markup verbatim; then <main data-part="page-body"> containing the page; then the given footer markup verbatim.
- Every colour, size, space and radius goes through the existing custom properties. No new hex values, no new typefaces, no new Google Fonts.
- Hover and focus-visible states follow the existing design. No <script> unless the page genuinely needs one, and then vanilla and under 30 lines.
- Every link is a real root-relative path — a post title leads to that post, a category to that category, the pagination to the next page. Never href="#".
- Real copy in the brief's language, and the page arrives full: every card, row, excerpt, date and label written as if the site were live. Invent the specifics — post titles, dates, categories, prices — keeping them plausible and consistent. No real company names or logos, and no quote attributed to a named person.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown.`;

export type ExtraPageResult = {
  kind: ExtraPageKind;
  html: string;
  css: string;
  body: string;
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateExtraPage(
  modelConfig: unknown,
  brief: unknown,
  direction: ArtDirection | null,
  home: { css: string; header: string; footer: string; fonts: string[] },
  kind: ExtraPageKind,
  components?: string,
  timeoutMs?: number
): Promise<ExtraPageResult> {
  const model = pickModel(modelConfig, "cheap");

  const gen = await generateText({
    model,
    system: EXTRA_PAGE_RULES,
    maxTokens: kind === "notfound" ? 6000 : 12000,
    timeoutMs,
    input:
      `${PAGE_BRIEFS[kind]}\n\n` +
      contextBlock(brief, direction, home) +
      (components
        ? `\n\nCOMPONENT CSS ALREADY AVAILABLE — reuse these classes\n${components.slice(0, 6000)}`
        : ""),
  });

  const html = cleanDocument(gen.text, home.css);

  const cssMatch = html.match(/<style[^>]*data-part=["']page["'][^>]*>([\s\S]*?)<\/style>/i);
  const bodyMatch = html.match(/<main[^>]*data-part=["']page-body["'][\s\S]*?<\/main>/i);

  console.log(
    `extra-page kind=${kind} model=${model} chars=${html.length} body=${
      bodyMatch ? "yes" : "MISSING"
    } truncated=${gen.truncated}`
  );

  return {
    kind,
    html,
    css: cssMatch ? cssMatch[1].trim() : "",
    body: bodyMatch ? bodyMatch[0] : "",
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}

/** The shared briefing every derived page and sheet is given. */
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
