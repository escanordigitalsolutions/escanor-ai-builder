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

const MOCKUP_INSTRUCTIONS = `Create an original digital experience as ONE self-contained HTML file.

Before coding, silently imagine three visual concepts for the brand, reject the two most obvious, and build the most surprising usable direction. Transform the brand's subject or process into the page's structure — not merely its colors, fonts or decorations.

Avoid default website composition: no predictable split hero, equal card grid, repeated rectangular panels or centered CTA block. Give information unexpected hierarchy, scale and placement. Use custom CSS composition, expressive typography, unusual image crops and one brand-specific visual rule that evolves throughout the page. Each section must have a distinct spatial idea while remaining part of one coherent system.

The result should feel art-directed, intentional and difficult to reproduce with a template, while remaining readable, responsive and conversion-focused.

TECHNICAL: all CSS in one <style> block in <head>; load 1-2 Google Fonts via <link> tags in <head>; <body> begins with <header data-part="header">, followed by 4-6 top-level <section data-section="<kebab-slug>"> elements, never nested, and ends with <footer data-part="footer">. Use only supplied PEXELS IMAGES URLs as <img src="<url>" width="<w>" height="<h>" alt="...">.

THE HERO must be unconventional: never a centered headline block and never a symmetric text-left / image-right split. Use asymmetry, oversized or fragmented typography, layering, rotation, an unexpected focal point, or composition that bleeds off the edges.

NO HORIZONTAL OVERFLOW at any width: clip decorative absolutely-positioned elements (overflow-x:clip on body and overflow:hidden on sections that contain them), never use fixed-width background patterns wider than the viewport, and make sure the layout holds at 390px.

Output only the complete HTML document from <!DOCTYPE html> to </html>.`;

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
  variation?: string
): Promise<MockupResult> {
  const model = pickModel(modelConfig, "plan");

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
    ART_DIRECTIONS[Math.floor(Math.random() * ART_DIRECTIONS.length)];

  const gen = await generateText({
    model,
    system: MOCKUP_INSTRUCTIONS,
    maxTokens: 32000,
    input:
      `Brief:\n${JSON.stringify(brief, null, 2)}` +
      `\n\nART DIRECTION FOR THIS RUN (commit to it fully, adapted to the brand's subject):\n${direction}` +
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
    `mockup model=${model} chars=${html.length} sections=[${split.sections
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
