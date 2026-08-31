import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";

/**
 * The build-files generation core, shared by the synchronous route
 * (app/api/agent/build-files) and the async job route (build-files-start).
 * Generates a batch of theme files from the blueprint and maps them onto the
 * exact requested paths.
 */

const INSTRUCTIONS = `Generate the requested files of a classic PHP WordPress theme, matching the blueprint. Other files are generated in separate calls — follow these rules so everything connects:

1. Templates start with get_header() and end with get_footer(); front-page.php includes sections with get_template_part('template-parts/section','<slug>') in the blueprint order; escape output (esc_html, esc_url, esc_attr). page.php, every page-<slug>.php and single.php are CONTENT-DRIVEN: a compact page hero (the_title()), then the loop rendering the_content() inside <div class="entry container"> — never hardcode page copy there; style .entry typography in base.css.
2. A section file renders <section class="section section-<slug>">. CSS is split per component: assets/css/base.css holds :root tokens from the blueprint palette/fonts, base typography, .container and .btn/.btn--primary/.btn--ghost; assets/css/header.css the header + mobile nav (open/closed states); assets/css/footer.css the footer; assets/css/sections/<slug>.css ONLY that section's rules. Mobile-first, no horizontal overflow, never hide content that JS must reveal.
3. header.php: doctype, wp_head(), body_class(), wp_body_open(); sticky <header class="site-header" data-header> with the site title/logo, <nav class="site-nav" data-nav> holding wp_nav_menu( array('theme_location'=>'primary','menu_class'=>'site-nav__menu','container'=>false,'fallback_cb'=>false) ), and a mobile <button class="site-header__toggle" data-nav-toggle aria-expanded="false">; then open <main>. footer.php: close </main>, a simple footer, wp_footer(), </body></html>.
4. functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5), register_nav_menus 'primary'; enqueue design.fonts.googleUrl, get_stylesheet_uri(), then EVERY stylesheet listed under CSS FILES TO ENQUEUE in that exact order, and assets/js/main.js (in the footer). No external JS libraries. Prefix functions with the textDomain. NEVER require or include any other PHP file — everything lives in functions.php (no inc/ files).
5. assets/js/main.js: vanilla JS only — the mobile nav toggle (.is-open on [data-nav], aria-expanded on [data-nav-toggle], .nav-open on body), .is-scrolled on [data-header] when scrollY > 8, and a scroll-reveal (IntersectionObserver adding .in-view to [data-reveal]; content stays visible without JS).
6. style.css: the standard WordPress theme header comment (Theme Name from blueprint.theme.name) + minimal base styles.
7. Real on-topic copy from each section's "copy" — never lorem ipsum. Photos: <img src="https://loremflickr.com/<w>/<h>/<keywords>?lock=<n>" width="" height="" alt="" loading="lazy">.
8. PHP never calls eval, exec, system, shell_exec, file_get_contents, file_put_contents, fopen, unlink, curl_exec, wp_remote_get/post, base64_decode, call_user_func, preg_replace_callback or similar code-exec, filesystem or network functions.

Output every requested path, in order, exactly:
===WPAB_FILE:<path>===
<complete raw file contents>
===WPAB_END===
The first characters of your reply are the first marker. Copy each path character-for-character. No other text, no code fences.`;

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

const PORT_INSTRUCTIONS = `Port the approved homepage mockup into classic PHP WordPress theme files. Do not redesign — reproduce the mockup. The theme is COMPONENTIZED: every file is small and single-purpose.

CSS is split per component:
1. assets/css/base.css: the mockup's :root tokens, resets, base typography and shared utilities (.container, buttons, generic .section spacing) — everything global. NO section-specific rules. Include .entry typography for WordPress content (headings, paragraphs, lists, links, blockquote, images) styled from the same tokens.
2. assets/css/header.css / assets/css/footer.css: only header/footer rules from the MOCKUP CSS, plus (in header.css) the mobile nav open/close states (.site-nav.is-open, .site-header.is-scrolled, body.nav-open).
3. assets/css/sections/<slug>.css: ONLY the rules that section's fragment markup actually uses, extracted from the MOCKUP CSS — keep selectors, tokens and values exactly, do not rename classes. A rule shared by several sections belongs in base.css, never duplicated.

PHP files:
4. A file with a FRAGMENT below: convert it to PHP keeping markup, classes, copy and images exactly. Brand name -> bloginfo('name') where natural; internal links -> esc_url(home_url('/<slug>')); keep <img> URLs as-is.
5. header.php: doctype, wp_head(), body_class(), wp_body_open(); the header fragment with data-header on the header element, the nav list replaced by wp_nav_menu( array('theme_location'=>'primary','menu_class'=>'site-nav__menu','container'=>false,'fallback_cb'=>false) ) inside <nav class="site-nav" data-nav>, the hamburger button with data-nav-toggle and aria-expanded="false"; then open <main>. footer.php: close </main>, the footer fragment, wp_footer(), </body></html>.
6. Templates start with get_header() and end with get_footer(); front-page.php includes the designed sections with get_template_part('template-parts/section','<slug>') in the blueprint order; escape output. page.php, every page-<slug>.php and single.php are CONTENT-DRIVEN: the page hero, then the loop rendering the_content() inside <article><div class="entry container">. When a PAGE HERO FRAGMENT is provided, convert it keeping markup and classes exactly (the heading becomes the_title(); single.php may add the date); without one, build a compact hero from the mockup's tokens. NEVER hardcode page copy in these templates — the real copy lives in WordPress and renders through the_content(). assets/css/inner.css: exactly the INNER PAGE CSS rules when provided (do not re-derive them); otherwise the page-hero + .entry rules these templates need. Files WITHOUT a fragment reuse the mockup's classes and tokens so they look like the same site.
7. functions.php: title-tag, post-thumbnails, custom-logo, html5; register_nav_menus 'primary'; enqueue the GOOGLE FONTS URLS, get_stylesheet_uri(), then EVERY stylesheet listed under CSS FILES TO ENQUEUE in that exact order (handle = file name without extension), and assets/js/main.js in the footer. Prefix functions with the textDomain; no external JS libraries. NEVER require or include any other PHP file — everything lives in functions.php (no inc/ files).
8. assets/js/main.js: vanilla JS only, no libraries — the nav toggle (.is-open on [data-nav], aria-expanded on [data-nav-toggle], .nav-open on body), .is-scrolled on [data-header], AND every behavior the mockup's inline script implements: the scroll-reveal (IntersectionObserver adding .in-view to [data-reveal]) and any accordion/tabs the mockup uses — port them exactly so the live site feels like the preview. style.css: the WordPress theme header comment (Theme Name from blueprint.theme.name) + minimal base.
9. assets/css/components.css: exactly the COMPONENT CSS when provided — the buttons, forms, tables, blockquotes, pagination and widgets the design defines. Do not re-derive or trim it; templates below depend on these classes existing.
10. archive.php (and index.php when no separate archive body is given): convert the ARCHIVE BODY fragment keeping markup and classes exactly, replacing its example posts with the WordPress loop — the_permalink(), the_title(), get_the_date(), the_excerpt(), post thumbnail where the design shows an image — and its pagination markup with the_posts_pagination() styled by the same classes. Keep the page heading; never hardcode post copy. 404.php: convert the 404 BODY fragment the same way, keeping its links and its search field as get_search_form(). assets/css/pages.css: exactly the ARCHIVE CSS and 404 CSS rules provided, concatenated, and nothing else.
11. PHP never calls eval, exec, system, file_get_contents, fopen, unlink, curl_exec, wp_remote_get/post, base64_decode, call_user_func, preg_replace_callback or similar.

Output each requested path, in order:
===WPAB_FILE:<path>===
<complete raw contents>
===WPAB_END===
Your reply starts at the first marker and ends at the last ===WPAB_END===; paths copied exactly; no other text, no fences.`;

export type MockupCtx = {
  css?: string;
  fonts?: string[];
  fragments?: Record<string, string>;
  /** Inner-page design pack: extra CSS over the mockup css, and the page-hero fragment. */
  inner?: { css?: string; pageHero?: string };
  /**
   * The design stage now produces more than a homepage, and a theme that
   * ignores the rest is a theme whose blog listing and 404 were invented by a
   * build model that never saw them designed. Each pack carries the extra CSS
   * and the body markup for one screen.
   */
  components?: { css?: string };
  archive?: { css?: string; body?: string };
  notFound?: { css?: string; body?: string };
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

  // A CSS component file needs the fragment whose styles it extracts.
  const cssFragmentKey = (path: string): string | null => {
    if (path === "assets/css/header.css") return "header.php";
    if (path === "assets/css/footer.css") return "footer.php";
    const m = path.match(/^assets\/css\/sections\/([a-z0-9-]+)\.css$/);
    if (m) return `template-parts/section-${m[1]}.php`;
    return null;
  };

  // Content templates that reuse the designed page hero + inner.css.
  const isInnerTemplate = (path: string): boolean =>
    /^page(-[a-z0-9-]+)?\.php$/.test(path) || path === "single.php";

  const wantsCss = paths.some((p) => p.endsWith(".css") && p !== "style.css");

  let input = `Blueprint:\n${JSON.stringify(blueprint)}\n\n`;

  // functions.php enqueues an explicit, server-derived stylesheet list so the
  // model never has to guess which component files exist.
  if (paths.includes("functions.php")) {
    const bp = blueprint as { sections?: { slug?: string }[] } | null;
    const slugs = Array.isArray(bp?.sections)
      ? bp!.sections!
          .map((sec) => (typeof sec?.slug === "string" ? sec.slug : ""))
          .filter(Boolean)
      : [];
    // Order matters: components before the per-screen sheets that override
    // them, and both after the tokens everything else reads.
    const enqueue = [
      "assets/css/base.css",
      "assets/css/components.css",
      "assets/css/header.css",
      ...slugs.map((sl) => `assets/css/sections/${sl}.css`),
      "assets/css/footer.css",
      "assets/css/inner.css",
      "assets/css/pages.css",
    ];
    input += `CSS FILES TO ENQUEUE (in this order):\n${enqueue.join("\n")}\n\n`;
  }

  if (mockup) {
    if (mockup.fonts && mockup.fonts.length) {
      input += `GOOGLE FONTS URLS:\n${mockup.fonts.join("\n")}\n\n`;
    }
    if (mockup.css && (wantsCss || paths.includes("assets/css/main.css"))) {
      input += `MOCKUP CSS:\n${mockup.css}\n\n`;
    }
    if (mockup.fragments) {
      const added = new Set<string>();
      for (const p of paths) {
        const frag = mockup.fragments[p];
        if (typeof frag === "string" && frag && !added.has(p)) {
          added.add(p);
          input += `FRAGMENT for ${p}:\n${frag}\n\n`;
        }
        const key = cssFragmentKey(p);
        if (key && mockup.fragments[key] && !added.has(key)) {
          added.add(key);
          input += `FRAGMENT for ${key} (extract this markup's styles for ${p}):\n${mockup.fragments[key]}\n\n`;
        }
      }
    }
    // Inner-page design pack: the page-hero fragment for content templates,
    // and the extra CSS that assets/css/inner.css ports.
    if (mockup.inner) {
      const needsInner =
        paths.includes("assets/css/inner.css") || paths.some(isInnerTemplate);
      if (needsInner && mockup.inner.pageHero) {
        input += `PAGE HERO FRAGMENT (the designed inner-page title area — reuse it in every content template, title via the_title()):\n${mockup.inner.pageHero}\n\n`;
      }
      if (needsInner && mockup.inner.css) {
        input += `INNER PAGE CSS (additional rules over MOCKUP CSS — assets/css/inner.css ports exactly these):\n${mockup.inner.css}\n\n`;
      }
    }

    if (mockup.components?.css && paths.includes("assets/css/components.css")) {
      input += `COMPONENT CSS (assets/css/components.css ports exactly these rules):\n${mockup.components.css}\n\n`;
    }

    const wantsPagesCss = paths.includes("assets/css/pages.css");

    if (mockup.archive) {
      if (mockup.archive.body && (paths.includes("archive.php") || paths.includes("index.php"))) {
        input += `ARCHIVE BODY (the designed blog listing — port it, replacing the example posts with the loop):\n${mockup.archive.body}\n\n`;
      }
      if (mockup.archive.css && wantsPagesCss) {
        input += `ARCHIVE CSS (goes into assets/css/pages.css):\n${mockup.archive.css}\n\n`;
      }
    }

    if (mockup.notFound) {
      if (mockup.notFound.body && paths.includes("404.php")) {
        input += `404 BODY (the designed not-found page — port it, its search field becomes get_search_form()):\n${mockup.notFound.body}\n\n`;
      }
      if (mockup.notFound.css && wantsPagesCss) {
        input += `404 CSS (also goes into assets/css/pages.css):\n${mockup.notFound.css}\n\n`;
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
  if (v.inner && typeof v.inner === "object") {
    const inn = v.inner as Record<string, unknown>;
    const inner: { css?: string; pageHero?: string } = {};
    if (typeof inn.css === "string" && inn.css.length <= 100000) {
      inner.css = inn.css;
    }
    if (typeof inn.pageHero === "string" && inn.pageHero.length <= 60000) {
      inner.pageHero = inn.pageHero;
    }
    if (inner.css || inner.pageHero) {
      out.inner = inner;
    }
  }
  return out.css ||
    (out.fragments && Object.keys(out.fragments).length) ||
    (out.fonts && out.fonts.length) ||
    out.inner
    ? out
    : null;
}
