import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";
import { replacePlaceholderImages } from "./pexels";

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

const MOCKUP_INSTRUCTIONS = `You are an elite web designer and art director. Create a complete, bespoke HOMEPAGE from the supplied brief as ONE self-contained HTML file.

This is a visual mockup: semantic HTML + CSS only. One tiny inline <script> is allowed only for the mobile navigation toggle. No PHP, frameworks or external JavaScript.

Before coding, silently define one clear creative direction based on the brand, audience and goal. Carry it consistently through typography, palette, imagery, shapes and layout. Do not output your reasoning.

STRUCTURE — EXACT (the page is split automatically, so follow it precisely):
- Load Google Fonts with <link> tags in <head>.
- Put all CSS in ONE <style> block in <head>. Define design tokens in :root.
- <body> starts with <header data-part="header"> containing the brand name, the navigation and the primary action. Navigation collapses behind an accessible hamburger on small screens.
- Follow with 5-7 top-level <section data-section="<kebab-slug>" class="section section-<slug>"> blocks. NEVER nest a <section> inside another.
- End with <footer data-part="footer">.

DESIGN QUALITY
The result must feel specifically designed for this brand, never like a generic template.
- Use a distinctive Google Fonts pairing and a confident, limited palette.
- Create one memorable signature visual motif and repeat it subtly.
- Use a dramatic fluid type scale with clamp().
- Make the hero composition bold, clear and visually distinctive.
- Give adjacent sections different layouts and rhythms while keeping one coherent design system.
- Mix asymmetric splits, full-bleed visuals, editorial grids, oversized statements and focused content blocks.
- Use generous whitespace, deliberate alignment and controlled content widths.
- Recompose layouts properly for mobile instead of only shrinking them.
- Keep the page conversion-focused and easy to understand.

AVOID
- Generic centered hero + three-card grid layouts
- Repetitive equal-sized cards
- Default purple gradients and gradient blobs
- Automatic dark mode, glassmorphism or excessive rounded corners
- Excessive pills, badges and floating containers
- Random decoration unrelated to the brand
- Fake dashboards unless relevant
- Lorem ipsum and vague "innovative solutions" copy
- Invented statistics, awards, ratings, clients or business claims

COPY
Write concise, believable and on-topic copy in the requested language. Clearly communicate: what the business offers, who it is for, why it is valuable, and what the visitor should do next. Use real, specific language. When facts are missing, create credible positioning without inventing proof.

IMAGES
Use relevant photos only when they improve the composition. Write every photo as <img src="https://loremflickr.com/<width>/<height>/<keywords>?lock=<n>" width="" height="" alt=""> — the keywords are searched against a real stock-photo library and the URL is replaced automatically, so:
- Use specific business-related keywords.
- Keep the photographic mood consistent.
- Give every image a unique lock number.
- Use purposeful crops with object-fit.
- Add sufficient overlays whenever text appears on a photo.
- Do not lazy-load the main hero image.

RESPONSIVE AND ACCESSIBLE
- Mobile-first, working from 320px upward. No horizontal overflow.
- Use one logical and semantic heading order.
- Include meaningful alt text and visible focus states.
- Maintain strong contrast and touch-friendly controls.
- Respect prefers-reduced-motion.
- Add appropriate aria attributes to the mobile navigation toggle.
- Keep HTML and CSS clean, valid and organized.

Before responding, silently verify that the page is distinctive, coherent, responsive, brand-specific and follows the exact splitting structure. OUTPUT ONLY the HTML document. The first characters must be <!DOCTYPE html> and the final characters must be </html>. No Markdown fences, commentary or questions.`;

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

  const gen = await generateText({
    model,
    system: MOCKUP_INSTRUCTIONS,
    maxTokens: 32000,
    input:
      `Brief:\n${JSON.stringify(brief, null, 2)}` +
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
