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

const MOCKUP_INSTRUCTIONS = `You are an award-level digital art director and frontend designer. Create a complete, highly distinctive HOMEPAGE as ONE self-contained HTML file using semantic HTML and CSS. One tiny inline <script> is allowed only for the mobile navigation.

Before coding, silently define ONE strong creative concept derived from the brand. Express it consistently through typography, composition, image treatment, spacing and one recurring signature motif. Do not merely decorate a conventional layout.

DESIGN PRINCIPLES
- Make the page feel custom, editorial and visually confident.
- Use one dominant visual idea, not a mixture of styles.
- Create a dramatic, asymmetric hero with a clear focal point.
- Use huge fluid typography with clamp(), intentional line breaks and strong scale contrast.
- Vary the rhythm: alternate dense and spacious moments, light and dark areas, text-led and image-led compositions.
- Let selected elements break the grid through cropping, overlap, offset alignment or full-bleed placement.
- Give every section its own composition, but preserve the same typography, spacing logic, colors, edges and signature motif.
- Avoid equal card grids. Establish hierarchy using one dominant element and smaller supporting elements.
- Use whitespace deliberately. Do not fill every area.
- Redesign compositions for mobile instead of simply stacking desktop columns.
- Keep the experience clear, accessible, conversion-focused and free of horizontal overflow.

AVOID
Generic templates, centered SaaS heroes, repetitive cards, three-column feature rows, gradient blobs, glassmorphism, default purple palettes, excessive pills, random decorations, generic icons, vague copy, fabricated claims and visual effects without a purpose.

COPY
Write specific, believable, on-topic copy in the requested language. Create a clear narrative from introduction to value, proof and action. Keep headings memorable and concise.

EXACT HTML STRUCTURE (the page is split automatically — follow it precisely)
- Begin with <!DOCTYPE html>.
- Load Google Fonts using <link> tags in <head>.
- Put all CSS in ONE <style> block in <head>.
- Define colors, typography and spacing as :root tokens.
- <body> starts with <header data-part="header"> containing the brand name, the navigation and the primary action.
- Add 5-7 top-level section blocks using: <section data-section="<kebab-slug>" class="section section-<slug>">
- NEVER nest a <section> inside another section.
- End with <footer data-part="footer">.
- Include an accessible mobile hamburger navigation.
- Use no PHP, frameworks or external JavaScript libraries.

IMAGES
Use ONLY the URLs provided under PEXELS IMAGES. Never invent or modify image URLs and never use another image source.
Every image must follow this format: <img src="<url>" width="<w>" height="<h>" alt="...">
Treat images as major compositional elements using intentional crops, object-fit, layering, masks, offsets or full-bleed placement. Keep one consistent photographic treatment across the page. Add sufficient overlays where text appears over photography. Do not lazy-load the hero image.
If no image URLs are provided, create a purely typographic and CSS-based design with no <img> elements.

FINAL QUALITY CHECK
Before responding, silently verify that:
- the concept is visible beyond the hero;
- the page does not resemble a standard template;
- no repeated equal-card layouts appear;
- every section has a clear focal point;
- desktop and mobile both feel intentionally designed;
- the exact section structure is valid;
- all supplied image URLs are used correctly;
- there is no horizontal overflow.

OUTPUT ONLY the complete HTML document. Start with <!DOCTYPE html> and end with </html>. Do not include Markdown, explanations or questions.`;

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
