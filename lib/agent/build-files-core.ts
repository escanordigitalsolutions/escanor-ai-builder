import { pickModel } from "@/lib/ai/resolve";
import { generateText, type Usage } from "@/lib/ai/provider";

/**
 * The build-files generation core, shared by the synchronous route
 * (app/api/agent/build-files) and the async job route (build-files-start).
 * Generates a batch of theme files from the blueprint and maps them onto the
 * exact requested paths.
 */

const INSTRUCTIONS = `You are a WordPress theme developer. Generate the requested files for a classic PHP theme, consistent with the blueprint (palette, fonts, pages, sections). Other files are generated in separate calls, so follow these conventions exactly so everything fits together.

- Classic theme conventions: templates start with get_header() and end with get_footer(); pages include their sections with get_template_part('template-parts/section', '<slug>') in the blueprint order; use the loop; escape output (esc_html, esc_url, esc_attr).
- Each section file renders <section class="section section-<slug>"> and assets/css/main.css has a matching .section-<slug> block for EVERY section in the blueprint. Shared classes: .container, .btn, .btn--primary, .btn--ghost.
- header.php: <!DOCTYPE html>, wp_head(), body_class(), wp_body_open(); a sticky <header class="site-header" data-header> with the custom logo or site title, <nav class="site-nav" data-nav> containing wp_nav_menu( array( 'theme_location' => 'primary', 'menu_class' => 'site-nav__menu', 'container' => false, 'fallback_cb' => false ) ), and a mobile <button class="site-header__toggle" data-nav-toggle aria-expanded="false">. Then open <main>.
- footer.php: close </main>, a simple footer, wp_footer(), </body></html>.
- functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5, register_nav_menus with 'primary'); enqueue design.fonts.googleUrl, get_stylesheet_uri(), assets/css/main.css and assets/js/main.js (in the footer) with filemtime() cache-busting. NO external JS libraries. Prefix function names with the theme textDomain (underscores).
- assets/css/main.css: :root tokens from the blueprint palette and fonts, base typography, header + mobile nav (open/closed states), buttons, footer, and one block per blueprint section. Mobile-first and responsive, no horizontal overflow. Never hide content with opacity/visibility/display in a way that needs JS to show it.
- assets/js/main.js: small vanilla JS only — the mobile nav toggle (toggles .is-open on [data-nav], aria-expanded on [data-nav-toggle], .nav-open on body) and .is-scrolled on [data-header] when scrollY > 8. Nothing else is required.
- style.css: the standard WordPress theme header comment (Theme Name from blueprint.theme.name) plus minimal base styles — the real CSS lives in assets/css/main.css.
- Real, on-topic copy guided by each section's "copy" (never lorem ipsum). Where a section calls for a photo, use <img src="https://loremflickr.com/<w>/<h>/<keywords>?lock=<n>"> with width, height, a descriptive alt, loading="lazy".
- PHP must NEVER use: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backticks. (filemtime() is fine.)

OUTPUT FORMAT — for EACH requested path output exactly, in order:
===WPAB_FILE:<path>===
<the complete raw file contents>
===WPAB_END===
STRICT: your reply STARTS with the first ===WPAB_FILE: marker and ENDS with the last ===WPAB_END===. No introduction, no commentary, no code fences. Copy each requested path into its marker EXACTLY as given, character for character.`;

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

export type BuildFilesResult = {
  files: { path: string; contents: string }[];
  truncated: boolean;
  usage: Usage;
  model: string;
};

export async function generateBuildFiles(
  modelConfig: unknown,
  blueprint: unknown,
  paths: string[]
): Promise<BuildFilesResult> {
  const model = pickModel(modelConfig, "build");

  const gen = await generateText({
    model,
    system: INSTRUCTIONS,
    maxTokens: 32000,
    input:
      `Blueprint:\n${JSON.stringify(blueprint)}\n\n` +
      `Generate the complete contents of these files, in this order:\n` +
      paths.map((p) => `- ${p}`).join("\n"),
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
