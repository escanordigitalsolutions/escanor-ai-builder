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

const SHARED_RULES = `TECHNICAL: all CSS in one <style> block in <head>; load 1-2 Google Fonts via <link> tags in <head>; <body> begins with <header data-part="header">, followed by 4-6 top-level <section data-section="<kebab-slug>"> elements, never nested, and ends with <footer data-part="footer">. JavaScript is allowed only as one tiny inline <script> for the mobile menu. Use only supplied PEXELS IMAGES URLs as <img src="<url>" width="<w>" height="<h>" alt="...">; if none are provided, design purely with typography and CSS.

THE HERO must be unconventional: never a centered headline block and never a symmetric text-left / image-right split. Use asymmetry, oversized or fragmented typography, layering, rotation, an unexpected focal point, or composition that bleeds off the edges.

NO HORIZONTAL OVERFLOW at any width: clip decorative absolutely-positioned elements (overflow-x:clip on body and overflow:hidden on sections that contain them), never use fixed-width background patterns wider than the viewport, and make sure the layout holds at 390px.

Output only the complete HTML document from <!DOCTYPE html> to </html>. No Markdown, explanations or questions.`;

/**
 * Four selectable design styles — the wizard lets the user pick one before
 * generation. Each is a different creative brief; SHARED_RULES is appended to
 * every one so the page always splits and ports cleanly.
 */
const STYLE_PROMPTS = {
  concept: {
    seed: true,
    body: `Create an original digital experience as ONE self-contained HTML file.

Before coding, silently imagine three visual concepts for the brand, reject the two most obvious, and build the most surprising usable direction. Transform the brand's subject or process into the page's structure — not merely its colors, fonts or decorations.

Avoid default website composition: no predictable split hero, equal card grid, repeated rectangular panels or centered CTA block. Give information unexpected hierarchy, scale and placement. Use custom CSS composition, expressive typography, unusual image crops and one brand-specific visual rule that evolves throughout the page. Each section must have a distinct spatial idea while remaining part of one coherent system.

The result should feel art-directed, intentional and difficult to reproduce with a template, while remaining readable, responsive and conversion-focused.`,
  },
  minimal: {
    seed: false,
    body: `Design a refined editorial homepage as ONE self-contained HTML file, in the spirit of a luxury print magazine.

Vast whitespace, one exceptional display typeface paired with a quiet text face, and a restrained near-monochrome palette with a single precious accent. Few elements, each placed with intent — let emptiness carry the brand. Treat images as art plates: generous margins, thin rules, small captions, numbered figures.

Pace the page slowly. Hierarchy comes from scale and space, never from boxes, borders or shadows. The result should feel expensive, calm and precise — closer to a gallery catalogue than a website.`,
  },
  bold: {
    seed: true,
    body: `Design ONE self-contained HTML homepage like an award-chasing digital artist with no client to please.

Extreme scale contrast, fragmented or overlapping typography, clashing but controlled color, rotation, layering, CSS-drawn shapes and patterns, and an unexpected rhythm from section to section. Let elements collide, crop and bleed off the edges. Every section is a new scene in the same strange world.

Take real risks — push the composition until it almost breaks, then keep it readable and usable. Nothing on the page may look like it came from a component library.`,
  },
  business: {
    seed: false,
    body: `Design a polished, credible business homepage as ONE self-contained HTML file.

Clear hierarchy, comfortable spacing, a professional palette derived from the brand, and a strong conversion path: benefit-led copy, visible calls to action, trust signals. Familiar patterns are allowed where they serve clarity — but execute them with distinctive typography, considered detail and one memorable visual idea, so the page never reads as a template.

Accessible contrast, impeccable alignment and a confident, professional voice throughout.`,
  },
} as const;

export type DesignStyle = keyof typeof STYLE_PROMPTS;

/**
 * Stage 1 (cheap model): a compact creative concept the strong model then
 * executes. Small output, big effect — the design stops being a single-shot
 * guess and starts from an approved direction.
 */
const CONCEPT_INSTRUCTIONS = `You are a creative director preparing a design spec for a homepage. From the brief, invent ONE strong, unexpected creative concept for the brand and answer with ONLY this JSON (no markdown, no text outside it):
{"concept":"short evocative name","idea":"2-3 sentences on how the concept shapes the page structure and mood","palette":["#hex","#hex","#hex","#hex"],"fonts":["Display Font","Text Font"],"tone":"copy voice in a few words","sections":[{"slug":"kebab-slug","idea":"one sentence on this section's composition","headline":"working headline"}]}
Rules: 4-6 sections; both fonts must exist on Google Fonts; slugs are lowercase kebab-case; reject the most obvious concept before answering.`;

export type DesignConcept = {
  concept?: string;
  idea?: string;
  palette?: string[];
  fonts?: string[];
  tone?: string;
  sections?: { slug?: string; idea?: string; headline?: string }[];
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

/**
 * Art-direction seeds: one is picked at random for every generation, so the
 * same brief produces visibly different designs run after run. The direction
 * is a starting mood, not a cage — the prompt tells the model to adapt it.
 */
const ART_DIRECTIONS = [
  "Brutalist poster: raw modular grid, oversized type, hard 1px borders, zero rounded corners, stark contrast.",
  "Swiss editorial: strict columns, generous whitespace, precise small type against one huge headline, restrained palette.",
  "Retro print / risograph: limited ink palette, grainy overlays, slightly offset layers, print-shop charm.",
  "Technical blueprint: schematics, rulers, annotation labels, monospace data blocks, thin diagram lines.",
  "Organic naturalist: irregular hand-drawn shapes, botanical rhythm, soft earth palette, asymmetric calm.",
  "Luxury minimal: vast whitespace, serif display type, monochrome plus one precious accent, slow pacing.",
  "Neo-noir: deep blacks, one neon accent color, cinematic image treatment, dramatic scale jumps.",
  "Playful maximalist: loud clashing colors, sticker-like elements, rotation, humor, dense energetic composition.",
  "Archival museum catalogue: catalog numbers, specimen labels, figures and plates, captioned imagery.",
  "Type-led kinetic: typography IS the layout — words as structure, images small and supporting.",
  "Collage scrapbook: layered cutouts, taped and torn edges, overlapping photos, handwritten-style accents.",
  "Soft pastel editorial: muted airy palette, rounded forms, light rhythm, quiet confidence.",
  "Industrial utilitarian: stencil type, warning-stripe accents, cargo-label details, functional grid.",
  "Deco geometry: ornamental line-work, symmetry deliberately broken in one place, metallic-feeling accents.",
] as const;

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

  const images = await fetchBriefImages(brief);
  const imageBlock = images.length
    ? `\n\nPEXELS IMAGES (use ONLY these URLs):\n` +
      images
        .map(
          (im, i) =>
            `${i + 1}. ${im.url} (${im.orientation}, ${im.w}x${im.h}${im.alt ? `, "${im.alt}"` : ""})`
        )
        .join("\n")
    : `\n\nPEXELS IMAGES: none supplied — design without <img> elements.`;

  const direction =
    stylePrompt.seed && !concept
      ? `\n\nART DIRECTION FOR THIS RUN (commit to it fully, adapted to the brand's subject):\n${
          ART_DIRECTIONS[Math.floor(Math.random() * ART_DIRECTIONS.length)]
        }`
      : "";

  const conceptBlock = concept
    ? `\n\nDESIGN SPEC (prepared by the concept stage — execute this direction, refining details freely):\n${JSON.stringify(concept)}`
    : "";

  const gen = await generateText({
    model,
    system: stylePrompt.body + "\n\n" + SHARED_RULES,
    maxTokens: 32000,
    input:
      `Brief:\n${JSON.stringify(brief, null, 2)}` +
      conceptBlock +
      direction +
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
