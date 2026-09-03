import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";

/**
 * The one-shot experiment: three pages from one prompt.
 *
 * The staged pipeline decides a direction, draws a homepage, and derives the
 * other pages from it — consistency by inheritance. This path tests the other
 * hypothesis: consistency by simultaneity. One call holds all three pages in
 * its head at once, so nothing is inherited and nothing can drift; whatever
 * cohesion the model has is what the site gets.
 *
 * It deliberately skips everything the staged path earns its keep with — no
 * art direction, no token validation, no gutter check, no retry. That is the
 * point: the comparison is only honest if this path is what one prompt alone
 * produces.
 */

const ONESHOT_RULES = `You are a senior web designer building a small website as THREE complete pages: the homepage, one inner page whose subject you choose from the brief (services, product, menu — whatever this business leads with), and a contact page. Decide the whole visual system yourself — typefaces from Google Fonts, palette, grid, voice — and hold it identical across all three. Fully written, in the brief's language.

THE THREE FILES SHARE ONE SYSTEM
- The SAME :root custom-property block (colours, fonts, sizes, spacing) opens the stylesheet of every file, character for character.
- The SAME header and footer markup appears verbatim in every file. The header nav links to the three pages as root-relative paths: /, /<inner-slug>, /contact.
- A card, a button, a heading treatment looks the same on every page.

TECHNICAL CONTRACT, per file — the splitter is automatic and deviations break the build
- A complete HTML document. All CSS in a single <style> block in <head>, opening with the shared :root. Google Fonts loaded with <link> tags.
- At most one inline <script>: vanilla — the mobile menu toggle, an IntersectionObserver adding .in-view to [data-reveal] (everything stays visible without JS), .is-scrolled on the header.
- The homepage <body>: <header data-part="header">, then 4-7 top-level <section data-section="<kebab-slug>">, then <footer data-part="footer">.
- The other two pages: the same header verbatim; <section data-part="page-hero">; <main data-part="page-body">; the same footer verbatim.
- Every internal link is a real root-relative path; never href="#". No <img> unless a url was supplied.

OUTPUT — exactly three blocks, nothing outside them:

===WPAB_FILE:index.html===
<!DOCTYPE html>...
===WPAB_END===
===WPAB_FILE:<inner-slug>.html===
<!DOCTYPE html>...
===WPAB_END===
===WPAB_FILE:contact.html===
<!DOCTYPE html>...
===WPAB_END===`;

export type OneshotPage = { slug: string; html: string };

export type OneshotResult = {
  pages: OneshotPage[];
  truncated: boolean;
  usage: Usage;
  model: string;
};

/**
 * The three documents out of the model's reply.
 *
 * The last block of a truncated reply is cut mid-file, so a block only counts
 * when its closing marker was seen. "index.html" maps to the slug "home" the
 * rest of the system already speaks.
 */
export function parseOneshot(text: string): OneshotPage[] {
  const pages: OneshotPage[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(
    /===WPAB_FILE:([\w.-]+)===\s*([\s\S]*?)===WPAB_END===/g
  )) {
    const name = match[1].trim().toLowerCase().replace(/\.html?$/, "");
    const slug = name === "index" || name === "home" ? "home" : name;
    const html = match[2].trim();

    if (!slug || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) continue;
    if (seen.has(slug) || !/<html/i.test(html) || !/<\/html>/i.test(html)) continue;

    seen.add(slug);
    pages.push({ slug, html });
  }

  return pages;
}

export async function generateOneshot(
  modelConfig: unknown,
  brief: unknown,
  timeoutMs?: number
): Promise<OneshotResult> {
  const model = pickModel(modelConfig, "design");

  const gen = await generateText({
    model,
    system: ONESHOT_RULES,
    // Three complete pages. The homepage alone is allowed 64k; three share it,
    // which is itself part of the experiment — a system held in one head
    // should also be more economical than three drawn separately.
    maxTokens: 64000,
    timeoutMs,
    input: `BRIEF\n${JSON.stringify(brief, null, 2)}\n\nReturn the three files.`,
  });

  return {
    pages: parseOneshot(gen.text),
    truncated: gen.truncated,
    usage: gen.usage,
    model,
  };
}
