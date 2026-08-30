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

Between 4 and 7 sections. For each, give a kebab-case slug, the job it does for the visitor, and its structural shape. No two adjacent sections may share a shape — if two would, change one. A page of identically shaped sections is a list, not a design.

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
    "sections": [ { "slug": "", "job": "", "shape": "" } ]
  },
  "imagery": { "strategy": "photography|typographic|css-illustration|mixed", "treatment": "", "queries": [] },
  "motion": "",
  "voice": { "tone": "", "sample": { "h1": "", "sub": "", "cta": "" } },
  "avoid": []
}

size runs smallest to largest, seven steps, clamp() allowed. space runs tightest to widest, seven steps. Every string is written for a designer to act on, not for a client to admire: concrete, short, specific.`;

export type StageResult<T> = { data: T; usage: Usage; model: string };

export async function generateArtDirection(
  modelConfig: unknown,
  brief: unknown,
  shape: DesignShape,
  language?: string
): Promise<StageResult<ArtDirection | null>> {
  const model = pickModel(modelConfig, "cheap");

  const gen = await generateText({
    model,
    system: ART_DIRECTOR,
    maxTokens: 4000,
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
- Whitespace is a decision, not a default. Sections do not need equal padding. A quiet section beside a loud one is what makes the loud one land.
- Every word is real, specific to this business, and in the brief's language. No lorem. No "Your headline here". No "Elevate your business to the next level". No invented statistics, no fabricated client logos, and no testimonials attributed to invented named people — if the brief gives you none, design a section that does not need them.
- Detail is what separates finished from generated: the optical alignment of a heading against an image edge, a hover that reveals rather than merely darkens, a footer that was designed rather than dumped.

BEFORE YOU OUTPUT, VERIFY

- The :root block carries the supplied tokens exactly — every hex, every family name, every step of both scales, copied character for character.
- Both Google Fonts families are linked AND used. Nothing falls back silently.
- The signature move is in the markup.
- Between 4 and 7 top-level sections, each a different structural shape.
- Every interactive element has a designed hover AND focus-visible state.
- No horizontal overflow at 320px, 768px or 1440px.
- The page reads as one design, not five sections stapled together.

TECHNICAL CONTRACT — the splitter is automatic and deviations break the build

- ONE self-contained HTML document. All CSS in a single <style> block in <head>. Google Fonts loaded with <link> tags.
- That <style> block OPENS with the :root rule you were given, verbatim, before any other rule. Every colour, size, space, radius and font reference in the rest of the CSS goes through those custom properties. No hard-coded hex values anywhere below :root.
- Exactly one inline <script> before </body>. Vanilla, under ~80 lines. It must implement: the mobile menu toggle; an IntersectionObserver adding .in-view to every [data-reveal] element (CSS handles the transition, and elements stay fully visible without JS); and .is-scrolled on the header once the page scrolls. Everything stays readable and usable with JavaScript disabled. Honour prefers-reduced-motion.
- <body> opens with <header data-part="header">, then 4-7 top-level <section data-section="<kebab-slug>"> elements, never nested, and closes with <footer data-part="footer">. Use the slugs from the section plan.
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
  const model = pickModel(modelConfig, "plan");
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
    maxTokens: 32000,
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

const INNER_RULES = `Design ONE representative INNER PAGE (an About-style content page) for the same site, matching the approved homepage exactly — same tokens, typography, palette, spacing, motion and voice.

You are given the homepage's design tokens, its Google Fonts links, its header and footer markup, and the class names its stylesheet already defines. Reuse those classes wherever they fit. The header and footer markup must be copied VERBATIM. Do not restyle anything the homepage already defines, and write only the additional rules this page needs.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the homepage CSS there — write the placeholder comment verbatim, nothing else inside), then <style data-part="inner"> containing ONLY the additional rules this page needs, written against the same custom properties.
- <body>: the given header markup verbatim; then <section data-part="page-hero"> — the designed page-title area (title, optional intro line or breadcrumb) — reused on EVERY inner page, so keep it content-agnostic; then <article><div class="entry container"> demonstrating WordPress content typography (h2, h3, paragraphs, a list, a blockquote, a link — realistic on-brand copy); then ONE <section data-part="components"> block; then the given footer markup verbatim.
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
