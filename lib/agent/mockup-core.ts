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

const MOCKUP_INSTRUCTIONS = `Create a concept-driven digital experience as ONE self-contained HTML file. Transform the brand's subject, product or process into the visual language of the website itself. Experiment freely with layout, scale, typography, rhythm, image cropping and CSS-generated forms. Every section should feel like a new scene within one coherent world.

Avoid familiar landing-page formulas, predictable split heroes, standard card grids and recycled "premium" aesthetics. Prioritize originality, visual storytelling and memorable art direction while keeping the page usable and responsive.

STRUCTURE (the page is split automatically — follow it exactly)
- Start with <!DOCTYPE html>. Load Google Fonts via <link> tags in <head>. Put all CSS in ONE <style> block in <head>.
- <body> starts with <header data-part="header"> containing the brand name, the navigation and the primary action.
- Add exactly 4 top-level sections using: <section data-section="<kebab-slug>" class="section section-<slug>">
- NEVER nest a <section> inside another section.
- End with <footer data-part="footer">.
- JavaScript is allowed only as one tiny inline <script> for the mobile menu.

IMAGES
Use ONLY the URLs provided under PEXELS IMAGES — never invent or modify image URLs.
Every image must follow this format: <img src="<url>" width="<w>" height="<h>" alt="...">
If no image URLs are provided, design purely with typography and CSS, with no <img> elements.

OUTPUT ONLY the complete HTML document. Start with <!DOCTYPE html> and end with </html>. No Markdown, explanations or questions.`;

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

  const gen = await generateText({
    model,
    system: MOCKUP_INSTRUCTIONS,
    maxTokens: 32000,
    input:
      `Brief:\n${JSON.stringify(brief, null, 2)}` +
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
