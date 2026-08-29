import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { pickModel } from "@/lib/ai/resolve";
import { generateText } from "@/lib/ai/provider";

// Blueprint generation can take minutes on some models; don't let Vercel's
// plan-default duration kill the function mid-generation.
export const maxDuration = 300;

/**
 * WordPress -> SaaS : theme BLUEPRINT.
 *
 * From the wizard brief (a free-text description + optional name) this returns a
 * JSON blueprint for a brand-new, ultra-modern, professional CLASSIC PHP theme:
 * design tokens, motion, CDN libraries (GSAP/ScrollTrigger and friends), menu,
 * pages (each with its own template) and the complete file list the batch
 * generator (build-files) fills in. Nothing is written here.
 */

const INSTRUCTIONS = `You are a senior web designer + creative front-end architect. From the brief, produce a BLUEPRINT for a brand-new, ULTRA-MODERN, highly professional CLASSIC PHP WordPress theme (NOT a block theme).

READ THE BRIEF FIRST. The brief is mostly a free-text description in "prompt" (plus an optional "name"). Infer everything you need from it:
- theme name: use brief.name if given, otherwise invent a fitting, brandable name from the prompt.
- the business/site type, the target audience, and the tone of voice.
- the pages the site needs, the sections on each, the colour direction and the overall style.
Honour anything the brief states explicitly (a colour, a page, a library, a vibe, a language) EXACTLY. Where the brief is silent, make confident, tasteful, opinionated decisions — never leave it generic.

=== ART DIRECTION FIRST (this is what stops themes looking generic) ===
Before anything else, COMMIT to a distinctive art-direction CONCEPT that fits THIS brief — then let fonts, colour, layout, imagery and motion all flow from it. Do NOT default to the same clean tech-SaaS look every time. Pick the archetype that suits the business (a bakery, a law firm, a skate brand and a fintech must look nothing alike):
- editorial — magazine feel: oversized serif/display headlines, asymmetric columns, ruled lines, restrained palette, huge whitespace. Fonts like Fraunces, Playfair Display, Libre Caslon Text, Newsreader.
- brutalist / mono — raw grid, hard 1-2px borders, NO shadows, high contrast, one loud accent, monospace accents. Fonts like Space Mono, Archivo, JetBrains Mono, Space Grotesk.
- luxury — dark or ivory, gold/muted accent, generous spacing, small caps, slow elegant motion. Fonts like Cormorant Garamond, Marcellus, Italiana, Cormorant.
- warm / organic — cream + earth tones, big rounded shapes, blobs, photography-led, friendly. Fonts like Bricolage Grotesque, Gambetta, DM Serif Display, Fraunces.
- techno / cyber — dark, neon or electric accent, grid/scanlines, glow, kinetic. Fonts like Chakra Petch, Rajdhani, Space Grotesk + mono.
- swiss / modernist — strict grid, Helvetica-like sans, black/red/white, function-first, confident type scale. Fonts like Inter, Archivo, Manrope, Sora.
- maximalist / playful — bright multi-colour, sticker energy, big rounded type, motion everywhere. Fonts like Poppins, Bricolage, Clash-style, Baloo.
This can be ONE archetype or a considered blend. AIM HIGH — Awwwards-level craft: a strong signature idea, dramatic type scale, asymmetry, full-bleed imagery, generous negative space. AVOID the safe defaults (centered 3-column card grids, the navy/indigo SaaS palette, a right-side hero "card") unless the brief truly calls for them. Every theme must have ONE signature device it is built around.

DESIGN BAR — express the concept with real craft:
- Typography that MATCHES the concept, with a dramatic scale (display headlines can be genuinely large) and clear hierarchy — not the same safe sans every time.
- A distinctive colour system true to the concept (a signature gradient only where it fits — brutalist/editorial concepts may use none), real contrast, depth via considered shadows or hard edges per the archetype.
- Ambitious, mobile-first responsive layout: asymmetry, full-bleed sections, overlap and off-grid moments where the concept supports them — not everything boxed and centered.
- Signature motion to plan for: scroll-triggered staggered reveals, parallax depth, an ANIMATED hero background, a sticky header that shrinks on scroll, a scroll-progress indicator, count-up stats, and modern interactive buttons. Elegant and intentional, tuned to the concept (a luxury site moves slowly; a techno site is sharp), always mindful of prefers-reduced-motion.

MOTION — NO external JS libraries or frameworks. All motion is modern CSS plus small, dependency-free vanilla JS: IntersectionObserver scroll reveals, a scroll listener for a sticky/shrinking header and a scroll-progress bar, requestAnimationFrame count-ups, a tiny scroll transform for parallax, and CSS scroll-snap for any carousel/slider. Animated backgrounds are pure CSS. Do NOT plan for GSAP, Swiper, tsParticles, GLightbox, Typed, AOS, Alpine or any CDN library — the theme is self-contained. (Google Fonts and real placeholder images are fine and expected.)

IMAGERY — real photos matter; plan where the theme uses them so it never looks empty. Based on the brief, decide which sections carry PHOTOGRAPHIC imagery (typically: a hero image or side visual, a gallery/portfolio grid, an about/team portrait, feature/service cards with photos, testimonial avatars) versus SVG icons/illustrations (best for small feature icons and abstract accents). Note the intent in the relevant section's "layout" or "copy" (e.g. "split with photo", "photo gallery grid", "cards with photos"). Most sites need photos in at least the hero and one or two content sections. The engineer renders these as real on-topic placeholder images.

ANIMATED BACKGROUNDS — plan at least one signature animated background for the hero (and optionally one deeper section). Pick a PURE-CSS effect: animated gradient/mesh, floating SVG/CSS blobs, an aurora glow, or a moving grid/dot field. Encode the choice in design.motion.heroBackground and in the relevant section's "background".

STRUCTURE (classic PHP theme):
- Real .php templates using get_header()/get_footer(), the WordPress loop, get_template_part(), wp_head()/wp_footer().
- Front page = front-page.php; every other content page = page-{slug}.php.
- Reusable sections live in template-parts/section-{slug}.php; each page lists its section slugs in order.
- SIZE ADAPTS TO THE BRIEF — do not force a fixed count. Match the number of pages and sections to what the site actually needs: a simple landing page or small brochure site gets fewer; a rich, feature-heavy or multi-service brief gets more. Reuse sections across pages instead of inventing near-duplicates, and never pad with filler. As a rough guide 3-7 pages and 5-12 unique sections. HARD LIMIT: the "files" array must contain AT MOST 22 entries — count them before answering; a longer list gets trimmed and breaks the theme.
- The files list MUST include: style.css, functions.php, header.php, footer.php, index.php, page.php, single.php, 404.php, searchform.php, front-page.php, one page-{slug}.php per non-front page, one template-parts/section-{slug}.php per unique section, assets/css/main.css, assets/js/main.js.
- The front page opens with a striking hero (with its animated background) and follows an opinionated order, e.g. hero -> logos/social-proof -> features/benefits -> showcase/gallery -> testimonials -> CTA. VARY the background and layout of adjacent sections so no two in a row look the same.

SECTIONS — the top-level "sections" array describes every UNIQUE section as an object:
- slug: kebab-case, unique (matches template-parts/section-{slug}.php and the .section-{slug} CSS class).
- type: one of hero | logos | features | feature-split | stats | gallery | testimonials | pricing | faq | steps | team | cta | contact | content | statement | marquee | oversized-quote | index-list | process | full-bleed-image | split-editorial | showcase. Use the expressive types (statement, marquee, oversized-quote, index-list, full-bleed-image, split-editorial) to break the generic rhythm — at least ONE section should be a distinctive, non-standard "signature" moment that embodies the concept.
- layout: a short hint, e.g. "split-left-image", "3-col-cards", "centered", "alternating-rows", "masonry", "logo-marquee", "two-col".
- background: one of base | surface | gradient | dark | animated-mesh | animated-blobs | animated-aurora | animated-grid.
- animation: a short hint, e.g. "stagger-reveal", "parallax", "count-up", "slider" (CSS scroll-snap), "sticky-reveal".
- copy: ONE sentence of real, on-topic copy direction for this section (never lorem ipsum).

COLOUR + TYPE:
- Choose a coherent, modern palette (hex) with real contrast: accent must be readable on bg, and fg/bg >= 4.5:1. Provide a signature CSS gradient string in design.gradient.
- Pick a strong Google-Fonts pairing that matches the style/voice. design.fonts.googleUrl MUST be a valid https://fonts.googleapis.com/css2 URL listing the EXACT weights used, with display=swap.

Output rules:
- Respond with ONLY valid JSON. No markdown, no code fences, no commentary.
- STRICT: the very first character of your reply is { and the very last is }. Do not write anything before or after the JSON.

JSON schema (use EXACTLY these keys):
{
  "theme": { "name": string, "description": string, "textDomain": string },
  "concept": {
    "archetype": string,
    "mood": string,
    "signature": string,
    "typeConcept": string,
    "colorConcept": string,
    "layoutConcept": string
  },
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

  let modelConfig: unknown = {};
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("projects")
      .select("model_config")
      .eq("id", auth.context.projectId)
      .single();
    modelConfig = data?.model_config ?? {};
  } catch {
    modelConfig = {};
  }

  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const gen = await generateText({
      model: pickModel(modelConfig, "build"),
      system: INSTRUCTIONS,
      input: `Brief:\n${JSON.stringify(brief, null, 2)}`,
      maxTokens: 12000,
    });
    text = gen.text;
    usage = gen.usage;
  } catch (error) {
    console.error("build-plan generate error:", error);
    return NextResponse.json(
      { success: false, error: "The theme planner could not be reached. Try again." },
      { status: 502 }
    );
  }

  const blueprint = extractJson(text);

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

  clampBlueprint(blueprint);

  return NextResponse.json({ success: true, blueprint, usage });
}

/**
 * Enforce the size limit some models ignore. Keeps the core theme files plus
 * the first pages/sections (in blueprint order) that fit, then drops orphaned
 * sections, page references and menu entries so what remains is coherent.
 * Mutates the blueprint in place.
 */
const MAX_BLUEPRINT_FILES = 26;
const CORE_FILES = new Set([
  "style.css",
  "functions.php",
  "header.php",
  "footer.php",
  "index.php",
  "page.php",
  "single.php",
  "404.php",
  "searchform.php",
  "front-page.php",
  "assets/css/main.css",
  "assets/js/main.js",
]);

function clampBlueprint(blueprint: Json): void {
  const raw = (blueprint.files as unknown[]).filter(
    (f): f is string => typeof f === "string" && f.trim().length > 0
  );
  const deduped = [...new Set(raw.map((f) => f.trim()))];
  if (deduped.length <= MAX_BLUEPRINT_FILES) {
    blueprint.files = deduped;
    return;
  }

  const core = deduped.filter((f) => CORE_FILES.has(f));
  const rest = deduped.filter((f) => !CORE_FILES.has(f));
  const files = core.concat(rest).slice(0, MAX_BLUEPRINT_FILES);
  console.warn(
    `build-plan: blueprint had ${deduped.length} files, clamped to ${files.length}`
  );
  blueprint.files = files;

  const kept = new Set(files);
  const sectionSlugs = new Set(
    files
      .filter((f) => f.startsWith("template-parts/section-") && f.endsWith(".php"))
      .map((f) => f.slice("template-parts/section-".length, -".php".length))
  );

  if (Array.isArray(blueprint.sections)) {
    blueprint.sections = (blueprint.sections as unknown[]).filter(
      (s) =>
        s &&
        typeof s === "object" &&
        sectionSlugs.has(String((s as { slug?: unknown }).slug ?? ""))
    );
  }

  const front = typeof blueprint.frontPage === "string" ? blueprint.frontPage : "";
  const pageSlugs = new Set<string>();
  if (Array.isArray(blueprint.pages)) {
    blueprint.pages = (blueprint.pages as unknown[]).filter((p) => {
      if (!p || typeof p !== "object") return false;
      const pg = p as { slug?: unknown; template?: unknown; sections?: unknown };
      const slug = String(pg.slug ?? "");
      const isFront = slug === front || pg.template === "front-page.php";
      if (!isFront && !kept.has(`page-${slug}.php`)) return false;
      if (Array.isArray(pg.sections)) {
        pg.sections = pg.sections.filter(
          (s: unknown) => typeof s === "string" && sectionSlugs.has(s)
        );
      }
      pageSlugs.add(slug);
      return true;
    });
  }

  if (Array.isArray(blueprint.menu)) {
    blueprint.menu = (blueprint.menu as unknown[]).filter(
      (m) =>
        m &&
        typeof m === "object" &&
        pageSlugs.has(String((m as { slug?: unknown }).slug ?? ""))
    );
  }
}
