import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";

/**
 * WordPress -> SaaS : generate a BATCH of theme files in one call.
 *
 * Given the blueprint and a list of paths, returns each file's raw contents.
 * Batching cuts the number of generation round-trips (fewer wizard steps).
 * Files are returned in a delimiter format (not JSON) so code never has to be
 * JSON-escaped. The WordPress side collects everything and hands the whole set
 * to the create-only WPAB_Theme_Writer, which re-validates every file.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are a senior front-end engineer generating files for a MODERN, professional WordPress CLASSIC PHP theme, exactly consistent with the provided blueprint.

Design + quality bar:
- Premium, contemporary look (think Linear / Stripe / Vercel / Framer): confident type scale using clamp() for fluid sizing, generous spacing, a refined palette from the blueprint tokens, rounded corners per the blueprint radius, subtle shadows, smooth transitions and tasteful micro-interactions.
- MOBILE-FIRST and fully responsive: CSS Grid + Flexbox, sensible breakpoints, a working mobile nav (hamburger toggle), fluid images, no horizontal overflow.
- Accessible: semantic HTML5, alt text, visible :focus-visible states, aria where needed, and respect @media (prefers-reduced-motion: reduce).
- Use the blueprint's CDN libraries when present (they are enqueued by functions.php) — e.g. AOS for scroll reveal (add data-aos attributes), Swiper for testimonial/logo sliders, GLightbox for galleries. If no library fits, use small vanilla JS in assets/js/main.js (IntersectionObserver for reveals, a menu toggle, smooth scroll).
- Write real, on-topic copy for the site's purpose (never lorem ipsum) unless the brief says otherwise.

Theme conventions (classic PHP):
- Templates start with get_header() and end with get_footer(); include sections with get_template_part('template-parts/section', '<slug>') in the order the blueprint's page lists them.
- header.php: <!DOCTYPE html>, <html <?php language_attributes(); ?>>, <head> with charset + viewport + <?php wp_head(); ?>; then <body <?php body_class(); ?>>, <?php wp_body_open(); ?>, a sticky site header with the logo/site-title, wp_nav_menu( array( 'theme_location' => 'primary', ... ) ) and a mobile menu toggle button; then open <main>.
- footer.php: close </main>, a rich footer, <?php wp_footer(); ?>, </body></html>.
- functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5, register_nav_menus with 'primary'); wp_enqueue_scripts that (1) enqueues the blueprint fonts.googleUrl if present, (2) enqueues each blueprint library's css/js (respect its 'footer' flag), (3) enqueues get_stylesheet_uri() + assets/css/main.css + assets/js/main.js. Prefix all function names with the theme textDomain (underscores). Register a nav menu.
- style.css: MUST begin with the standard theme header comment for the theme name, then only minimal base CSS (the real design system goes in assets/css/main.css).
- assets/css/main.css: the FULL modern design system — CSS custom properties for the palette + fonts, base/reset, fluid typography, layout utilities (.container, grid helpers), the sticky header + mobile nav, buttons, cards, and every .section-<slug> style. Make it genuinely polished and responsive.
- assets/js/main.js: mobile menu toggle, scroll-reveal (or AOS.init() if AOS is loaded), smooth scrolling, and any slider/lightbox init for the libraries used.
- template-parts/section-<slug>.php: self-contained, semantic markup wrapped in <section class="section-<slug>">…</section>, with real copy and, where useful, AOS data attributes.
- Escape output: the_content(), the_title(), the_permalink(), the_excerpt(), bloginfo(), esc_url(), esc_html(), esc_attr(), get_template_directory_uri().

Security — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. (Enqueuing a remote CSS/JS URL with wp_enqueue_style/script is fine.)

OUTPUT FORMAT — for EACH requested path output exactly, in order:
===WPAB_FILE:<path>===
<the complete raw file contents>
===WPAB_END===
Output nothing before, between (other than the markers) or after. Do not wrap contents in code fences.`;

type Json = Record<string, unknown>;

function parseFiles(text: string): { path: string; contents: string }[] {
  const out: { path: string; contents: string }[] = [];
  const re = /===WPAB_FILE:([^\n=]+)===\n?([\s\S]*?)\n?===WPAB_END===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim();
    let contents = m[2];
    // Trim one leading/trailing blank line, keep internal formatting.
    contents = contents.replace(/^﻿/, "");
    if (path) {
      out.push({ path, contents: contents.replace(/\s+$/, "") + "\n" });
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const blueprint = body.blueprint;
  const rawPaths = Array.isArray(body.paths) ? (body.paths as unknown[]) : [];
  const paths = rawPaths
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 12);

  if (!blueprint || typeof blueprint !== "object") {
    return NextResponse.json(
      { success: false, error: "A blueprint is required." },
      { status: 400 }
    );
  }
  if (paths.length === 0) {
    return NextResponse.json(
      { success: false, error: "At least one path is required." },
      { status: 400 }
    );
  }

  let response;
  try {
    response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      max_output_tokens: 16000,
      input:
        `Blueprint:\n${JSON.stringify(blueprint)}\n\n` +
        `Generate the complete contents of these files, in this order:\n` +
        paths.map((p) => `- ${p}`).join("\n"),
    });
  } catch (error) {
    console.error("build-files OpenAI error:", error);
    return NextResponse.json(
      { success: false, error: "The file generator could not be reached. Try again." },
      { status: 502 }
    );
  }

  const files = parseFiles(response.output_text || "");

  if (files.length === 0) {
    return NextResponse.json(
      { success: false, error: "The generator returned no files for this batch." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, files });
}
