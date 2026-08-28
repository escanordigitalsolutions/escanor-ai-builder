import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";

/**
 * WordPress -> SaaS : theme BLUEPRINT.
 *
 * From the wizard brief (a free-text description + optional name) this returns a
 * JSON blueprint for a brand-new, ultra-modern, professional CLASSIC PHP theme:
 * design tokens, motion, CDN libraries (GSAP/ScrollTrigger and friends), menu,
 * pages (each with its own template) and the complete file list the batch
 * generator (build-files) fills in. Nothing is written here.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are a senior web designer + creative front-end architect. From the brief, produce a BLUEPRINT for a brand-new, ULTRA-MODERN, highly professional CLASSIC PHP WordPress theme (NOT a block theme).

READ THE BRIEF FIRST. The brief is mostly a free-text description in "prompt" (plus an optional "name"). Infer everything you need from it:
- theme name: use brief.name if given, otherwise invent a fitting, brandable name from the prompt.
- the business/site type, the target audience, and the tone of voice.
- the pages the site needs, the sections on each, the colour direction and the overall style.
Honour anything the brief states explicitly (a colour, a page, a library, a vibe, a language) EXACTLY. Where the brief is silent, make confident, tasteful, opinionated decisions — never leave it generic.

DESIGN BAR — this must feel like an award-winning custom site (Awwwards / Linear / Stripe / Vercel / Framer), never a template:
- Confident fluid typography, generous whitespace, a refined colour system with a signature gradient, depth from soft shadows, rounded corners, and smooth, tasteful motion.
- Mobile-first and fully responsive.
- Signature motion + effects to plan for: scroll-triggered staggered reveals, parallax depth, an ANIMATED hero background, a sticky header that shrinks on scroll, a scroll-progress indicator, count-up stats, and modern interactive buttons (gradient / shine / magnetic hover). Elegant, never gaudy, and always mindful of prefers-reduced-motion.

MOTION + JS LIBRARIES — these are loaded by functions.php and MUST come from cdnjs ONLY (https://cdnjs.cloudflare.com/ajax/libs/...). Use EXACT version URLs. Choose 2-5 that the sections actually use:
- GSAP core — gsap/3.12.5/gsap.min.js — and ScrollTrigger — gsap/3.12.5/ScrollTrigger.min.js. This is the animation backbone: reveals, parallax, pinned sections, hero motion. Include it in almost every theme for a premium feel.
- Swiper — swiper/11.1.14/swiper-bundle.min.js (+ css) — testimonial/logo/gallery sliders.
- GLightbox — glightbox/3.3.0/js/glightbox.min.js (+ css) — image/video lightboxes.
- tsParticles — tsparticles/2.12.0/tsparticles.bundle.min.js — particle / constellation backgrounds.
- typed.js — typed.js/2.1.0/typed.umd.js — typing headline effect.
- Splitting — splitting/1.0.6/splitting.min.js (+ css) — per-character/word text animation.
- Rellax — rellax/1.12.1/rellax.min.js — lightweight parallax (if not using GSAP for it).
- vanilla-tilt — vanilla-tilt/1.8.1/vanilla-tilt.min.js — 3D card tilt on hover.
- AOS — aos/2.3.4/aos.min.js (+ css) — simple scroll reveals (use only when NOT using GSAP).
- Alpine.js — alpinejs/3.14.1/cdn.min.js — small stateful UI (tabs, accordions, mobile menu).
Only include what the design needs, but favour a signature stack of GSAP + ScrollTrigger plus 1-2 others.

LIBRARY COVERAGE (required — no orphan effects): every animation you assign to any section MUST have its library present in libraries[]. Mapping: any "typed-headline" animation -> include typed.js; "tilt-cards" -> include vanilla-tilt; any gallery/lightbox -> include GLightbox; "slider" (testimonials/logos/gallery carousels) -> include Swiper; a section background of "animated-particles" -> include tsParticles; scroll reveals/parallax/count-up/pin-scroll -> covered by GSAP + ScrollTrigger. If a library is NOT in libraries[], do NOT assign an animation that needs it. Conversely, do not list a library that no section uses.

ANIMATED BACKGROUNDS — plan at least one signature animated background for the hero (and optionally one deeper section). Pick from: animated SVG gradient/mesh, floating SVG blobs, an SVG/CSS aurora glow, a moving grid/dot field, or a tsParticles constellation. Encode the choice in design.motion.heroBackground and in the relevant section's "background".

STRUCTURE (classic PHP theme):
- Real .php templates using get_header()/get_footer(), the WordPress loop, get_template_part(), wp_head()/wp_footer().
- Front page = front-page.php; every other content page = page-{slug}.php.
- Reusable sections live in template-parts/section-{slug}.php; each page lists its section slugs in order.
- Keep it LEAN so it generates fast: 4-6 pages, 6-10 unique sections, reuse sections across pages instead of inventing new ones. Do NOT exceed ~18 files total.
- The files list MUST include: style.css, functions.php, header.php, footer.php, index.php, page.php, single.php, 404.php, searchform.php, front-page.php, one page-{slug}.php per non-front page, one template-parts/section-{slug}.php per unique section, assets/css/main.css, assets/js/main.js.
- The front page opens with a striking hero (with its animated background) and follows an opinionated order, e.g. hero -> logos/social-proof -> features/benefits -> showcase/gallery -> testimonials -> CTA. VARY the background and layout of adjacent sections so no two in a row look the same.

SECTIONS — the top-level "sections" array describes every UNIQUE section as an object:
- slug: kebab-case, unique (matches template-parts/section-{slug}.php and the .section-{slug} CSS class).
- type: one of hero | logos | features | feature-split | stats | gallery | testimonials | pricing | faq | steps | team | cta | contact | content.
- layout: a short hint, e.g. "split-left-image", "3-col-cards", "centered", "alternating-rows", "masonry", "logo-marquee", "two-col".
- background: one of base | surface | gradient | dark | animated-mesh | animated-blobs | animated-aurora | animated-grid | animated-particles.
- animation: a short hint, e.g. "stagger-reveal", "parallax", "count-up", "slider", "typed-headline", "tilt-cards", "pin-scroll".
- copy: ONE sentence of real, on-topic copy direction for this section (never lorem ipsum).

COLOUR + TYPE:
- Choose a coherent, modern palette (hex) with real contrast: accent must be readable on bg, and fg/bg >= 4.5:1. Provide a signature CSS gradient string in design.gradient.
- Pick a strong Google-Fonts pairing that matches the style/voice. design.fonts.googleUrl MUST be a valid https://fonts.googleapis.com/css2 URL listing the EXACT weights used, with display=swap.

Output rules:
- Respond with ONLY valid JSON. No markdown, no code fences, no commentary.

JSON schema (use EXACTLY these keys):
{
  "theme": { "name": string, "description": string, "textDomain": string },
  "design": {
    "palette": { "bg": hex, "surface": hex, "fg": hex, "muted": hex, "border": hex, "accent": hex, "accent2": hex },
    "gradient": string,
    "fonts": { "heading": string, "body": string, "googleUrl": string },
    "radius": string,
    "container": string,
    "dark": boolean,
    "style": string,
    "motion": { "level": "subtle" | "balanced" | "bold", "heroBackground": string, "buttons": string }
  },
  "libraries": [ { "handle": string, "css": string | null, "js": string | null, "footer": boolean } ],
  "menu": [ { "title": string, "slug": string } ],
  "frontPage": string,
  "pages": [ { "slug": string, "title": string, "template": string, "sections": [string], "purpose": string, "headline": string } ],
  "sections": [ { "slug": string, "type": string, "layout": string, "background": string, "animation": string, "copy": string } ],
  "files": [string]
}`;

type Json = Record<string, unknown>;

function extractJson(text: string): Json | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    t = fence[1].trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Json) : null;
  } catch {
    return null;
  }
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

  const brief = body.brief ?? {};

  let response;
  try {
    response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input: `Brief:\n${JSON.stringify(brief, null, 2)}`,
    });
  } catch (error) {
    console.error("build-plan OpenAI error:", error);
    return NextResponse.json(
      { success: false, error: "The theme planner could not be reached. Try again." },
      { status: 502 }
    );
  }

  const blueprint = extractJson(response.output_text || "");

  if (
    !blueprint ||
    !Array.isArray((blueprint as { files?: unknown }).files) ||
    ((blueprint as { files: unknown[] }).files.length === 0)
  ) {
    return NextResponse.json(
      { success: false, error: "The planner did not return a valid blueprint." },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, blueprint });
}
