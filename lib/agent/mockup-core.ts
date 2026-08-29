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

const MOCKUP_INSTRUCTIONS = `You are an experimental, award-level digital art director. Create a complete HOMEPAGE as ONE self-contained HTML file. The design must feel bold, unexpected and unmistakably custom — never safe, ordinary or template-like.

Use semantic HTML + CSS only. One tiny inline <script> is allowed for the mobile nav toggle. No PHP or frameworks.

Before coding, silently invent ONE strong creative concept inspired by the brand. Push typography, scale, composition, cropping, layering, asymmetry and whitespace. The result may feel editorial, cinematic or slightly unconventional, but must remain clear, usable and conversion-focused.

EXACT STRUCTURE (the page is split automatically — follow it precisely)
- Google Fonts via <link> tags in <head>.
- All CSS in ONE <style> block in <head>; tokens in :root.
- <body> starts with <header data-part="header"> (brand name, navigation, primary action).
- Add 5-7 top-level <section data-section="<kebab-slug>" class="section section-<slug>"> blocks. NEVER nest sections.
- End with <footer data-part="footer">.
- Responsive mobile navigation behind an accessible hamburger.

DESIGN DIRECTION
- Create a dramatic hero that does NOT use a standard centered layout.
- Use huge fluid typography with clamp().
- Give every section a different composition while preserving one visual system.
- Use controlled asymmetry, overlapping elements, unexpected grids, full-bleed moments, sharp rhythm changes and expressive image crops.
- Carry one signature motif throughout the page.
- Write specific, believable, on-topic copy in the requested language.
- Mobile must feel intentionally redesigned, not merely stacked.
- Keep everything accessible and prevent horizontal overflow.

AVOID generic SaaS layouts, three-card feature rows, gradient blobs, glassmorphism, default purple palettes, repetitive cards, excessive pills, random decorations, lorem ipsum, vague marketing language and fabricated claims.

IMAGES
Use ONLY the image URLs supplied below under PEXELS IMAGES. Do not invent Pexels URLs or use any other image source. Render each as <img src="<url>" width="<w>" height="<h>" alt="..."> and use them as bold compositional elements through cropping (object-fit), layering, masking and full-bleed placement. Keep their visual treatment consistent. Add overlays when text sits over photography. Do not lazy-load the hero image. If no images are supplied, design a purely typographic/graphic page with no <img> elements.

OUTPUT ONLY the complete HTML document. It must begin with <!DOCTYPE html> and end with </html>. No Markdown, commentary or questions.`;

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
