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
 *
 * Because each batch only sees the blueprint (not the other generated files),
 * a strict CLASS + DATA-ATTRIBUTE CONTRACT (below) is what keeps the CSS, the
 * markup and the JS consistent across separate calls.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are a senior creative front-end engineer generating files for an ULTRA-MODERN, award-winning WordPress CLASSIC PHP theme, exactly consistent with the provided blueprint.

You receive the WHOLE blueprint plus a list of file paths to generate in THIS batch. Other files are generated in other batches and you cannot see them, so you MUST follow the contract below so everything fits together.

DESIGN + QUALITY BAR (Awwwards / Linear / Stripe / Vercel / Framer):
- Confident fluid type scale with clamp(), generous spacing, the blueprint palette + signature gradient, rounded corners per the blueprint radius, soft layered shadows, smooth transitions and tasteful micro-interactions.
- MOBILE-FIRST and fully responsive: CSS Grid + Flexbox, sensible breakpoints, a working mobile nav, fluid media, NO horizontal overflow.
- Accessible: semantic HTML5, alt text, visible :focus-visible, aria where needed, and honour @media (prefers-reduced-motion: reduce) — motion must degrade to no-motion gracefully and content must NEVER stay hidden if JS or GSAP fails.
- Real, on-topic copy for the site's purpose (never lorem ipsum), guided by each section's "copy". Keep headlines tight (<= ~8 words) and paragraphs to 1-3 sentences.

=== CLASS + DATA-ATTRIBUTE CONTRACT (critical — obey exactly) ===
Naming (deterministic from the blueprint, so CSS and markup agree across batches):
- Each section's root element is <section class="section section-<slug>" ...> using the section's slug EXACTLY. Child elements use BEM: .section-<slug>__<part> (e.g. __inner, __title, __grid, __card, __cta). Shared primitives use these global classes: .container, .btn, .btn--primary, .btn--ghost, .eyebrow, .section__head, .grid, .card.
- assets/css/main.css defines :root design tokens from the blueprint (colors, --grad, fonts, --radius, a spacing scale --space-1..--space-8, shadow scale --shadow-sm/md/lg, --transition) and styles every global primitive AND a .section-<slug> block for EACH section in blueprint.sections. Use tokens, not hardcoded values.

Motion is driven by data-attributes so markup and JS never need to see each other. In section markup, ADD these where the section's "animation" calls for it; in assets/js/main.js, IMPLEMENT them once (guarded, reduced-motion aware):
- data-reveal (optional value up|left|right|scale) — element animates in on scroll (GSAP + ScrollTrigger, or a small IntersectionObserver fallback if GSAP absent).
- data-reveal-group — stagger this element's direct children in.
- data-parallax="0.15" — parallax translateY by factor on scroll.
- data-count="1200" data-suffix="+" — count-up when in view.
- data-typed="Phrase one|Phrase two" — typing effect (Typed.js if enqueued).
- data-tilt — 3D tilt on hover (vanilla-tilt reads this natively).
- Sliders use the Swiper structure: .swiper > .swiper-wrapper > .swiper-slide (+ pagination/nav); main.js inits every .swiper.
- Lightbox links get class="glightbox"; main.js inits GLightbox.

Animated backgrounds — a section whose "background" starts with "animated-" MUST include, as the FIRST child of its root, <div class="section-bg" data-bg="mesh|blobs|aurora|grid|particles" aria-hidden="true"></div> matching the background name. Implement each in CSS (and JS for particles):
- animated-mesh: CSS animated multi-stop conic/linear gradient drift.
- animated-blobs: 2-3 inline SVG blobs (put the SVG inside .section-bg) with slow CSS keyframe float/scale.
- animated-aurora: large blurred gradient blobs drifting (CSS filter: blur + keyframes).
- animated-grid: a moving CSS grid/dot pattern with a subtle glow.
- animated-particles: an empty container; main.js inits tsParticles into [data-bg="particles"] (subtle, low count, respects reduced-motion).
Backgrounds must sit behind content (position:absolute; inset:0; z-index:0; content wrapper z-index:1) and never cause overflow or hurt text contrast.

Buttons: .btn is pill/rounded per radius, weighted, with a smooth transition; .btn--primary uses --grad with a hover sheen/shine (a moving highlight) and a slight lift; .btn--ghost is bordered. Optionally magnetic on pointer devices via main.js (data-magnetic), disabled on touch and reduced-motion.

=== THEME CONVENTIONS (classic PHP) ===
- Templates start with get_header() and end with get_footer(); include sections with get_template_part('template-parts/section', '<slug>') in the exact order the blueprint page lists them.
- header.php: <!DOCTYPE html>, <html <?php language_attributes(); ?>>, <head> charset + viewport + <?php wp_head(); ?>; then <body <?php body_class(); ?>>, <?php wp_body_open(); ?>. Include a scroll-progress bar element and a STICKY site header that shrinks on scroll (main.js toggles a class like .is-scrolled on the header), the logo/site-title, wp_nav_menu( array('theme_location'=>'primary', ...) ) and an accessible mobile menu toggle. Then open <main>.
- footer.php: close </main>, a rich multi-column footer, <?php wp_footer(); ?>, </body></html>.
- functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5, register_nav_menus with 'primary'); a wp_enqueue_scripts callback that (1) enqueues design.fonts.googleUrl if present, (2) enqueues EACH blueprint library's css/js with its exact cdnjs URL respecting the 'footer' flag and correct dependencies (ScrollTrigger depends on gsap), (3) enqueues get_stylesheet_uri() + assets/css/main.css + assets/js/main.js with filemtime() cache-busting and main.js in the footer with its library deps. Prefix ALL function names with the theme textDomain (underscores).
- assets/js/main.js: run after DOM ready. Feature-detect each library (if (window.gsap), if (window.Swiper), if (window.Typed), if (window.tsParticles), if (window.VanillaTilt), if (window.GLightbox)). Register GSAP ScrollTrigger when present. Add a html.has-motion class ONLY after motion is ready so CSS initial-hidden states apply solely when motion will run. Implement: sticky-header shrink, scroll-progress bar, mobile menu toggle, smooth in-page scrolling, all data-* behaviours above, slider/lightbox/particles init. Everything must be a no-op (content visible) under prefers-reduced-motion or when a library is missing.
- assets/css/main.css: the FULL design system (tokens, reset, fluid typography, .container, layout helpers, header + mobile nav, scroll-progress, buttons, cards, every .section-<slug>, and all animated-background keyframes). Initial-hidden reveal states MUST be scoped under html.has-motion and dropped under prefers-reduced-motion.
- style.css: begins with the standard WordPress theme header comment (Theme Name from blueprint.theme.name), then only minimal base CSS — the real system lives in assets/css/main.css.
- template-parts/section-<slug>.php: self-contained semantic <section class="section section-<slug>">, real copy from the section's "copy", the right data-* attributes for its "animation", and its .section-bg first child when the background is animated-*.
- Escape output: the_content(), the_title(), the_permalink(), the_excerpt(), bloginfo(), esc_url(), esc_html(), esc_attr(), get_template_directory_uri(), get_stylesheet_uri().

SECURITY — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. (filemtime() for cache-busting and enqueuing remote cdnjs CSS/JS via wp_enqueue_style/script are fine.)

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
      max_output_tokens: 24000,
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
