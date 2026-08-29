import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";

/**
 * The build-files generation core, shared by the synchronous route
 * (app/api/agent/build-files) and the async job route (build-files-start).
 * Generates a batch of theme files from the blueprint and maps them onto the
 * exact requested paths.
 */

const INSTRUCTIONS = `Build files for a CUSTOM classic PHP WordPress theme. Express the blueprint's design.style and each section's "look" boldly: dramatic clamp() type scale, generous whitespace, varied section layouts. It must not look like a default template.

Glue rules (other files are generated in separate calls):
1. Templates: get_header()/get_footer(); sections via get_template_part('template-parts/section','<slug>') in blueprint order; escaped output (esc_html, esc_url, esc_attr).
2. A section renders <section class="section section-<slug>">. assets/css/main.css: :root tokens from the palette/fonts, base typography, .container, .btn/.btn--primary/.btn--ghost, header + mobile nav, footer, and one .section-<slug> block per blueprint section. Mobile-first, no horizontal overflow, nothing hidden waiting for JS.
3. header.php: doctype, wp_head(), body_class(), wp_body_open(); <header class="site-header" data-header> with the site title/logo, <nav class="site-nav" data-nav> holding wp_nav_menu( array('theme_location'=>'primary','menu_class'=>'site-nav__menu','container'=>false) ), <button class="site-header__toggle" data-nav-toggle>; open <main>. footer.php: close </main>, footer, wp_footer(), </body></html>.
4. functions.php: title-tag, post-thumbnails, custom-logo, html5; register_nav_menus 'primary'; enqueue the fonts googleUrl, style.css, main.css, main.js (footer). No JS libraries.
5. assets/js/main.js: vanilla only — nav toggle (.is-open on [data-nav], .nav-open on body) and .is-scrolled on [data-header] on scroll.
6. style.css: WordPress theme header comment (Theme Name from blueprint) + minimal base.
7. Real on-topic copy, never lorem ipsum. Photos: <img src="https://loremflickr.com/<w>/<h>/<keywords>?lock=<n>" width height alt loading="lazy">.
8. No PHP that executes code or touches the filesystem/network (eval, exec, system, file_get_contents, fopen, unlink, curl_exec, wp_remote_*, base64_decode, call_user_func, preg_replace_callback or similar).

Output each requested path, in order:
===WPAB_FILE:<path>===
<complete raw contents>
===WPAB_END===
Your reply starts at the first marker and ends at the last ===WPAB_END===; paths copied exactly; no other text, no fences.`;

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

const PORT_INSTRUCTIONS = `You are porting an APPROVED homepage design mockup into classic PHP WordPress theme files. The design is FINAL — reproduce it faithfully; adapt to WordPress, never redesign.

1. assets/css/main.css: start from the MOCKUP CSS essentially verbatim — keep its selectors, tokens and values. Add only what is missing: the mobile nav open/close states (.site-nav.is-open, .site-header.is-scrolled, body.nav-open) and styles for files that have no mockup fragment, written in the same design system.
2. A file that has a FRAGMENT below: convert that fragment to PHP keeping its markup, classes, copy and images EXACTLY. Replace the brand name with bloginfo('name') where natural and internal links with esc_url(home_url('/<slug>')). Keep <img> placeholder URLs as-is.
3. header.php: the header fragment plus the WordPress head — <!DOCTYPE html>, wp_head(), body_class(), wp_body_open(). Give the header element data-header, replace the mockup's nav list with wp_nav_menu( array('theme_location'=>'primary','menu_class'=>'site-nav__menu','container'=>false,'fallback_cb'=>false) ) inside <nav class="site-nav" data-nav>, give the hamburger button data-nav-toggle and aria-expanded="false"; then open <main>. footer.php: close </main>, the footer fragment, wp_footer(), </body></html>.
4. Files WITHOUT a fragment (inner page templates, index/single/404/searchform, extra sections): build them in the mockup's design system — reuse its classes, tokens, spacing and rhythm so they look like the same site.
5. Templates start with get_header() and end with get_footer(); pages include sections with get_template_part('template-parts/section','<slug>') in the blueprint order; escape output (esc_html, esc_url, esc_attr). functions.php: title-tag, post-thumbnails, custom-logo, html5; register_nav_menus 'primary'; enqueue the GOOGLE FONTS URLS listed below, get_stylesheet_uri(), assets/css/main.css and assets/js/main.js (footer) with filemtime() cache-busting; no external JS libraries; prefix functions with the textDomain. assets/js/main.js: vanilla only — the nav toggle (.is-open on [data-nav], aria-expanded on [data-nav-toggle], .nav-open on body) and .is-scrolled on [data-header] on scroll. style.css: the WordPress theme header comment (Theme Name from blueprint.theme.name) + minimal base.
6. No PHP that executes code or touches the filesystem/network (eval, exec, system, file_get_contents, fopen, unlink, curl_exec, wp_remote_*, base64_decode, call_user_func, preg_replace_callback or similar).

Output each requested path, in order:
===WPAB_FILE:<path>===
<complete raw contents>
===WPAB_END===
Your reply starts at the first marker and ends at the last ===WPAB_END===; paths copied exactly; no other text, no fences.`;

export type MockupCtx = {
  css?: string;
  fonts?: string[];
  fragments?: Record<string, string>;
};

export type BuildFilesResult = {
  files: { path: string; contents: string }[];
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateBuildFiles(
  modelConfig: unknown,
  blueprint: unknown,
  paths: string[],
  mockup?: MockupCtx | null
): Promise<BuildFilesResult> {
  const model = pickModel(modelConfig, "build");

  let input = `Blueprint:\n${JSON.stringify(blueprint)}\n\n`;
  if (mockup) {
    if (mockup.fonts && mockup.fonts.length) {
      input += `GOOGLE FONTS URLS:\n${mockup.fonts.join("\n")}\n\n`;
    }
    if (mockup.css && paths.includes("assets/css/main.css")) {
      input += `MOCKUP CSS:\n${mockup.css}\n\n`;
    }
    if (mockup.fragments) {
      for (const p of paths) {
        const frag = mockup.fragments[p];
        if (typeof frag === "string" && frag) {
          input += `FRAGMENT for ${p}:\n${frag}\n\n`;
        }
      }
    }
  }
  input +=
    `Generate the complete contents of these files, in this order:\n` +
    paths.map((p) => `- ${p}`).join("\n");

  const gen = await generateText({
    model,
    system: mockup ? PORT_INSTRUCTIONS : INSTRUCTIONS,
    maxTokens: 32000,
    input,
  });

  const parsed = parseFiles(gen.text);

  // Map the generated files back onto the EXACT requested paths. Some models
  // (Claude especially) decorate the path in the marker — a leading ./ or /,
  // stray whitespace, different case — which would otherwise make the WordPress
  // side think the file is "missing" and retry forever. Match by normalized
  // path first, then positionally (the model is told to output in order).
  const normPath = (p: string) =>
    p.replace(/\\/g, "/").replace(/^\.?\/+/, "").trim().toLowerCase();
  const wantByNorm = new Map<string, string>();
  for (const p of paths) {
    wantByNorm.set(normPath(p), p);
  }
  const usedReq = new Set<string>();
  const matched: { path: string; contents: string }[] = [];
  const leftovers: { path: string; contents: string }[] = [];
  for (const f of parsed) {
    const req = wantByNorm.get(normPath(f.path));
    if (req && !usedReq.has(req)) {
      matched.push({ path: req, contents: f.contents });
      usedReq.add(req);
    } else {
      leftovers.push(f);
    }
  }
  const unmatchedReq = paths.filter((p) => !usedReq.has(p));
  for (let i = 0; i < unmatchedReq.length && i < leftovers.length; i++) {
    matched.push({ path: unmatchedReq[i], contents: leftovers[i].contents });
  }
  const files = matched.length ? matched : parsed;

  console.log(
    `build-files model=${model} requested=${paths.length} parsed=${parsed.length} ` +
      `matched=${matched.length} truncated=${gen.truncated} chars=${gen.text.length}`
  );

  return { files, truncated: gen.truncated, usage: gen.usage, model };
}

/** Validate/trim a mockup context arriving from the WordPress side. */
export function readMockupCtx(value: unknown): MockupCtx | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const v = value as Record<string, unknown>;
  const out: MockupCtx = {};
  if (typeof v.css === "string" && v.css.length <= 300000) {
    out.css = v.css;
  }
  if (Array.isArray(v.fonts)) {
    out.fonts = v.fonts
      .filter(
        (f): f is string =>
          typeof f === "string" && f.startsWith("https://fonts.googleapis.com/")
      )
      .slice(0, 4);
  }
  if (v.fragments && typeof v.fragments === "object") {
    const frags: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.fragments as Record<string, unknown>)) {
      if (typeof val === "string" && val.length <= 150000 && Object.keys(frags).length < 15) {
        frags[k] = val;
      }
    }
    out.fragments = frags;
  }
  return out.css ||
    (out.fragments && Object.keys(out.fragments).length) ||
    (out.fonts && out.fonts.length)
    ? out
    : null;
}
