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
- data-reveal (optional value up|left|right|scale) — element reveals in on scroll. Implemented EXACTLY per the REVEAL MECHANISM section below (JS adds the .is-revealed class; NEVER rely on inline GSAP opacity or visibility).
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

=== IMAGERY (use REAL photos so the site never looks empty) ===
Where the blueprint calls for photographic imagery (hero visual, gallery/portfolio, about/team, feature/service cards, testimonial avatars), render real <img> elements with on-topic placeholder photos — NEVER empty boxes or icon-only sections:
- Primary source (on-topic): https://loremflickr.com/<w>/<h>/<comma-separated keywords>?lock=<n> — pick 1-3 keywords from the site's topic and the section (e.g. plumbing,pipes | restaurant,food | office,team | solar,panels), and a stable lock number per image so it doesn't change on reload. For a decorative/abstract image where topic doesn't matter, https://picsum.photos/seed/<seed>/<w>/<h> is an acceptable fallback.
- Every <img> MUST have width and height attributes matching its intended ratio (prevents layout shift), loading="lazy", decoding="async", and a descriptive alt. In CSS wrap media in an aspect-ratio box with object-fit:cover, rounded corners per the radius, and — over any hero/CTA photo used behind text — a gradient overlay so text stays readable.
- Use photos where they add credibility (hero, gallery, about, key cards); keep crisp inline SVG for small UI icons and abstract accents. Do NOT turn every section into a photo.
- Add a short PHP/HTML comment near the first placeholder image noting these are placeholders the owner can replace (e.g. with featured images / the media library).

=== REVEAL MECHANISM (exact — obey so CSS and JS can NEVER disagree) ===
The reveal is driven ONLY by toggling a class, never by inline animation opacity, so it cannot silently leave content invisible:
- CSS: under html.has-motion, hide [data-reveal] using ONLY opacity + transform (translate/scale) with a transition. NEVER use visibility:hidden or display:none for reveals — that is the exact trap that leaves content invisible when GSAP is present. Reveal with the class: html.has-motion [data-reveal].is-revealed { opacity:1; transform:none; } and html.has-motion [data-reveal-group].is-revealed > * { opacity:1; transform:none; } (stagger children with transition-delay).
- JS (main.js): reveal by ADDING the .is-revealed class when the element enters the viewport — via ScrollTrigger onEnter when GSAP is present, else IntersectionObserver, else add the class immediately. Do NOT use gsap.fromTo/gsap.to on opacity for reveals; GSAP is only for parallax, count-up easing and magnetic buttons.
- html.has-motion is added by JS after DOM ready ONLY when NOT prefers-reduced-motion. Under reduced-motion, [data-reveal] elements must be fully visible with no hidden state.

=== HEADER / NAV / FOOTER CONTRACT (exact class + data-* names — header.php, main.css AND main.js MUST all use these) ===
- Header: <header class="site-header" data-header>; scrolled state class .is-scrolled — main.js toggles it on [data-header] when scrollY > 8.
- Brand: <a class="site-header__brand" ...> with the custom logo or the site title inside.
- Nav: <nav class="site-nav" data-nav> containing wp_nav_menu( array( 'theme_location' => 'primary', 'menu_class' => 'site-nav__menu', 'container' => false, 'fallback_cb' => false ) ); mobile open state class .is-open on [data-nav].
- Toggle: <button class="site-header__toggle" data-nav-toggle aria-expanded="false" aria-controls="the nav id"> with hamburger bars. main.js listens on [data-nav-toggle], toggles aria-expanded and .is-open on [data-nav], and adds a body class .nav-open.
- main.js MUST select the data-* hooks ([data-header], [data-nav], [data-nav-toggle]) — NOT ad-hoc class names — so markup and JS cannot drift. main.css styles the classes above plus the .is-scrolled and .is-open states and the desktop-vs-mobile nav layout.
- Scroll progress: <div class="scroll-progress" aria-hidden="true"><span class="scroll-progress__bar"></span></div>; main.js sets the bar's width/scaleX from scroll position.
- Footer: <footer class="site-footer"> with a .site-footer__grid of columns; main.css styles .site-footer and .site-footer__grid.
Anything a JS behaviour targets must be reachable by one of these exact classes or a stable data-* hook.

=== THEME CONVENTIONS (classic PHP) ===
- Templates start with get_header() and end with get_footer(); include sections with get_template_part('template-parts/section', '<slug>') in the exact order the blueprint page lists them.
- header.php: <!DOCTYPE html>, <html <?php language_attributes(); ?>>, <head> charset + viewport + <?php wp_head(); ?>; then <body <?php body_class(); ?>>, <?php wp_body_open(); ?>. Include a scroll-progress bar element and a STICKY site header that shrinks on scroll (main.js toggles a class like .is-scrolled on the header), the logo/site-title, wp_nav_menu( array('theme_location'=>'primary', ...) ) and an accessible mobile menu toggle. Then open <main>.
- footer.php: close </main>, a rich multi-column footer, <?php wp_footer(); ?>, </body></html>.
- functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5, register_nav_menus with 'primary'); a wp_enqueue_scripts callback that (1) enqueues design.fonts.googleUrl if present, (2) enqueues ONLY the blueprint libraries the generated markup/JS actually uses (do not enqueue a library no section needs — e.g. no Typed unless a section has data-typed, no GLightbox unless there are .glightbox links, no tsParticles unless a section uses data-bg="particles"), each with its exact cdnjs URL respecting the 'footer' flag and correct dependencies (ScrollTrigger depends on gsap), (3) enqueues get_stylesheet_uri() + assets/css/main.css + assets/js/main.js with filemtime() cache-busting and main.js in the footer with its library deps. Prefix ALL function names with the theme textDomain (underscores).
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
  // Split on the FILE marker so a MISSING or malformed ===WPAB_END=== between
  // files can never merge them: each file's content runs until the next FILE
  // marker (or the end). A trailing ===WPAB_END=== is then stripped.
  const parts = text.split(/===\s*WPAB_FILE\s*:/);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const m = seg.match(/^\s*([^\n=]+?)\s*===\s*\r?\n?([\s\S]*)$/);
    if (!m) {
      continue;
    }
    const path = m[1].trim().replace(/^`+|`+$/g, "");
    let contents = m[2].replace(/^﻿/, "");
    // Drop a trailing WPAB_END marker (and anything after it) when present.
    contents = contents.replace(/\n?===\s*WPAB_END\s*===[\s\S]*$/, "");
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
      max_output_tokens: 32000,
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
  const truncated =
    response.status === "incomplete" &&
    (response.incomplete_details?.reason === "max_output_tokens" || !response.incomplete_details);

  // When the model runs long, the LAST file block can be cut off before its
  // ===WPAB_END=== marker. Keep every COMPLETE file we did parse and let the
  // WordPress side re-request only the missing paths, rather than failing hard.
  if (files.length > 0) {
    return NextResponse.json({ success: true, files, truncated });
  }

  return NextResponse.json(
    {
      success: false,
      error: truncated
        ? "This batch was too large to finish in one pass. Retrying with fewer files usually fixes it."
        : "The generator returned no files for this batch. Please try again.",
      truncated,
    },
    { status: 502 }
  );
}
