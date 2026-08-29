import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";
import { replacePlaceholderImages, fetchBriefImages } from "./pexels";

/**
 * Design-first pipeline, step 1: the HOMEPAGE MOCKUP.
 *
 * One strong-model call composes the entire homepage as a single self-contained
 * HTML file — the model sees the whole design at once, which is what makes the
 * result look bespoke instead of assembled. The wizard previews it in an iframe
 * and the user approves it BEFORE anything touches WordPress. splitMockup()
 * then cuts the approved page into deterministic pieces (CSS, header, footer,
 * one fragment per section) that the cheap build model PORTS to PHP files.
 */

const SHARED_RULES = `Design a modern, visually distinctive homepage that feels specifically created for this brand. Interpret the brief freely and make your own decisions about layout, typography, color, imagery, scale, rhythm and composition. Aim for a coherent, memorable experience rather than a recognizable website template. Keep it readable, responsive and useful, but do not default to conventional SaaS sections or component-library patterns.

You have full creative authority over layout, typography, palette, imagery, section count and order, scale, rhythm and composition. The concept notes and style direction are inspiration, not a specification. CSS shapes, gradients, masks, pseudo-elements and inline SVG decoration are welcome. The supplied photos are optional — use only the ones that serve the design, or build typography- and CSS-led sections without images. Use a consistent spacing scale, give images a deliberate treatment (crop, radius, duotone, frame — your call), and make every word of microcopy real and on-voice.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE self-contained HTML document; all CSS in one <style> block in <head>; Google Fonts may be loaded via <link> tags.
- JavaScript: exactly one inline <script> before </body>, vanilla only, under ~80 lines. It MUST implement: the mobile menu toggle; a scroll-reveal — an IntersectionObserver that adds .in-view to every [data-reveal] element (CSS handles the transition; elements stay fully visible without JS); and .is-scrolled on the header when scrolled. Accordions or tabs are welcome where the content genuinely calls for them. Everything must stay readable and usable with JavaScript disabled.
- Interactive elements (links, buttons, cards, form fields) have designed hover AND focus-visible states; motion is subtle and purposeful, never decorative for its own sake.
- <body> starts with <header data-part="header">, then 4-7 top-level <section data-section="<kebab-slug>"> elements (never nested), and ends with <footer data-part="footer">.
- Any photos must come from the supplied PEXELS IMAGES URLs, written as <img src="<url>" width="<w>" height="<h>" alt="...">.
- No horizontal overflow at any width.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown, explanations or questions.`;

/**
 * Four selectable design styles — the wizard lets the user pick one before
 * generation. Each is a different creative brief; SHARED_RULES is appended to
 * every one so the page always splits and ports cleanly.
 */
const STYLE_PROMPTS = {
  concept: {
    seed: false,
    body: `Take a bold conceptual angle: let what this brand actually is shape how the page feels. Prefer the surprising over the expected — ambition over safety.`,
  },
  minimal: {
    seed: false,
    body: `Calm, restrained and precise. Confidence through space, proportion and typography; luxury through what is left out.`,
  },
  bold: {
    seed: false,
    body: `Loud, energetic and expressive. Strong presence, fearless contrast, personality over politeness.`,
  },
  business: {
    seed: false,
    body: `Credible, clear and professional, with one memorable idea. Trust first — but never generic.`,
  },
} as const;

export type DesignStyle = keyof typeof STYLE_PROMPTS;

/**
 * Stage 1 (cheap model): a compact creative concept the strong model then
 * executes. Small output, big effect — the design stops being a single-shot
 * guess and starts from an approved direction.
 */
const CONCEPT_INSTRUCTIONS = `You are a creative director. From the brief, define a loose creative starting point for a homepage design. Answer with ONLY this JSON (no markdown, no text outside it):
{"concept":"short name","idea":"1-2 sentences: the central idea","principles":["2-4 abstract visual principles"],"tone":"copy voice in a few words","imageQueries":["1-3 short photo search queries that fit the concept"]}
Do not prescribe colors, fonts, sections, headlines or layout — the designer decides those.`;

export type DesignConcept = {
  concept?: string;
  idea?: string;
  principles?: string[];
  tone?: string;
  imageQueries?: string[];
};

export type StageResult<T> = { data: T; usage: Usage; model: string };

export async function generateConcept(
  modelConfig: unknown,
  brief: unknown,
  style: DesignStyle
): Promise<StageResult<DesignConcept | null>> {
  const model = pickModel(modelConfig, "cheap");
  const gen = await generateText({
    model,
    system: CONCEPT_INSTRUCTIONS,
    maxTokens: 2000,
    input:
      `Brief:\n${JSON.stringify(brief)}` +
      `\n\nRequested style direction: ${style} — ${STYLE_PROMPTS[style].body.split("\n")[0]}`,
  });
  let data: DesignConcept | null = null;
  try {
    let txt = gen.text.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const start = txt.indexOf("{");
    const end = txt.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(txt.slice(start, end + 1)) as DesignConcept;
      if (parsed && typeof parsed.concept === "string") data = parsed;
    }
  } catch {
    data = null;
  }
  return { data, usage: gen.usage, model };
}

/**
 * Stage 3 (cheap model): a short human-readable review shown to the user next
 * to the mockup preview. Feedback only — it never blocks the pipeline.
 */
export async function critiqueMockup(
  modelConfig: unknown,
  html: string
): Promise<StageResult<string>> {
  const model = pickModel(modelConfig, "cheap");
  const trimmed =
    html.length > 20000 ? html.slice(0, 12000) + "\n...\n" + html.slice(-6000) : html;
  const gen = await generateText({
    model,
    system:
      "You are a candid design reviewer. In 2-3 short sentences, tell the user what stands out about this homepage design and one concrete thing that could be better. Speak about what a visitor would SEE (composition, type, color, imagery) — never about code. Address the user directly, no lists.",
    maxTokens: 300,
    input: trimmed,
  });
  return { data: gen.text.trim().slice(0, 600), usage: gen.usage, model };
}

export function resolveStyle(value: unknown): DesignStyle {
  return typeof value === "string" && value in STYLE_PROMPTS
    ? (value as DesignStyle)
    : "concept";
}



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
    ...html.matchAll(
      /href=["'](https:\/\/fonts\.googleapis\.com\/css2[^"']+)["']/gi
    ),
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

/**
 * Stage 4 (cheap model): ONE representative INNER PAGE, constrained by the
 * approved homepage's CSS and chrome. The model never echoes the homepage CSS
 * back — it writes a placeholder that we replace server-side, so its output is
 * only the new markup + the few extra rules. The page-hero fragment and the
 * extra CSS feed the build (page.php / page-<slug>.php / assets/css/inner.css).
 */
const INNER_RULES = `Design ONE representative INNER PAGE (an About-style content page) for the same site, matching the approved homepage exactly — same tokens, typography, palette, spacing, motion and voice.

You are given the homepage's CSS (by reference), its Google Fonts links and its header/footer markup. The header and footer markup must be copied VERBATIM. Do not restyle anything the homepage CSS already defines, and do NOT repeat the homepage CSS.

TECHNICAL CONTRACT (required by the automatic splitter):
- ONE HTML document. In <head>: the same Google Fonts <link> tags, then EXACTLY this block: <style data-part="base">/*HOMEPAGE-CSS*/</style> (the platform injects the homepage CSS there — write the placeholder comment verbatim, nothing else inside), then <style data-part="inner"> containing ONLY the additional rules this page needs.
- <body>: the given header markup verbatim; then <section data-part="page-hero"> — the designed page-title area (title, optional intro line or breadcrumb) — this is reused on EVERY inner page, so keep it content-agnostic; then <article><div class="entry container"> demonstrating WordPress content typography (h2, h3, paragraphs, a list, a blockquote, a link — realistic on-brand copy); then ONE <section data-part="components"> block (e.g. value cards or a small grid); then the given footer markup verbatim.
- Hover/focus states and the [data-reveal] pattern follow the homepage. One tiny vanilla script only if the homepage has one.
- No new Google Fonts, no <img> unless its URL already appears in the given markup. No horizontal overflow.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown.`;

export type InnerResult = {
  html: string;
  css: string;
  pageHero: string;
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateInnerMockup(
  modelConfig: unknown,
  brief: unknown,
  concept: DesignConcept | null,
  home: { css: string; header: string; footer: string; fonts: string[] }
): Promise<InnerResult> {
  const model = pickModel(modelConfig, "cheap");
  const gen = await generateText({
    model,
    system: INNER_RULES,
    maxTokens: 12000,
    input:
      `Brief:\n${JSON.stringify(brief)}` +
      (concept ? `\n\nCONCEPT NOTES:\n${JSON.stringify(concept)}` : "") +
      (home.fonts.length ? `\n\nGOOGLE FONTS URLS (link these):\n${home.fonts.join("\n")}` : "") +
      `\n\nHOMEPAGE CSS (reference only — do NOT repeat it; the placeholder block stands in for it):\n${home.css}` +
      `\n\nHEADER MARKUP (copy verbatim):\n${home.header}` +
      `\n\nFOOTER MARKUP (copy verbatim):\n${home.footer}`,
  });

  let html = gen.text.trim();
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const start = html.search(/<!DOCTYPE/i);
  if (start > 0) html = html.slice(start);
  const endIdx = html.lastIndexOf("</html>");
  if (endIdx !== -1) html = html.slice(0, endIdx + "</html>".length);

  const cssM = html.match(
    /<style[^>]*data-part=["']inner["'][^>]*>([\s\S]*?)<\/style>/i
  );
  const heroM = html.match(
    /<section[^>]*data-part=["']page-hero["'][\s\S]*?<\/section>/i
  );

  // Inject the real homepage CSS so the preview iframe renders standalone.
  if (html.includes("/*HOMEPAGE-CSS*/")) {
    html = html.replace("/*HOMEPAGE-CSS*/", () => home.css);
  } else {
    // Placeholder missing — prepend the homepage CSS so the preview still looks right.
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n<style>${home.css}</style>`);
  }

  console.log(
    `inner-mockup model=${model} chars=${html.length} hero=${heroM ? "yes" : "MISSING"} css=${cssM ? cssM[1].trim().length : 0} truncated=${gen.truncated}`
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

export async function generateMockup(
  modelConfig: unknown,
  brief: unknown,
  variation?: string,
  style?: unknown,
  concept?: DesignConcept | null
): Promise<MockupResult> {
  const model = pickModel(modelConfig, "plan");
  const styleKey = resolveStyle(style);
  const stylePrompt = STYLE_PROMPTS[styleKey];

  const images = await fetchBriefImages(brief, concept?.imageQueries);
  const imageBlock = images.length
    ? `\n\nPEXELS IMAGES (use ONLY these URLs):\n` +
      images
        .map(
          (im, i) =>
            `${i + 1}. ${im.url} (${im.orientation}, ${im.w}x${im.h}${im.alt ? `, "${im.alt}"` : ""})`
        )
        .join("\n")
    : `\n\nPEXELS IMAGES: none supplied — design without <img> elements.`;

  const conceptBlock = concept
    ? `\n\nCONCEPT NOTES (inspiration, not a specification):\n${JSON.stringify(concept)}`
    : "";

  const gen = await generateText({
    model,
    system: stylePrompt.body + "\n\n" + SHARED_RULES,
    maxTokens: 32000,
    input:
      `Brief:\n${JSON.stringify(brief, null, 2)}` +
      conceptBlock +
      imageBlock +
      (variation ? `\n\n${variation}` : ""),
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
    `mockup model=${model} style=${styleKey} chars=${html.length} sections=[${split.sections
      .map((s) => s.slug)
      .join(", ")}] fonts=${split.fonts.length} truncated=${gen.truncated}`
  );

  return {
    html,
    ...split,
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}
