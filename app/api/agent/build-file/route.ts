import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { SMART_MODEL } from "@/lib/ai/models";

/**
 * WordPress -> SaaS : generate ONE theme file (Phase C).
 *
 * Given the blueprint and a target path, returns the exact raw contents of that
 * one file, consistent with the blueprint's design tokens and section/class
 * conventions. The WordPress side collects each file and hands the whole set to
 * the create-only WPAB_Theme_Writer, which re-validates every file before it is
 * written. Nothing is written here.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INSTRUCTIONS = `You are generating ONE file of a WordPress CLASSIC PHP theme, exactly consistent with the provided blueprint.

Output rules:
- Respond with ONLY the raw file contents. No markdown, no code fences, no commentary, no explanation.

Theme conventions (classic PHP theme):
- Templates start with get_header() and end with get_footer().
- Include reusable sections with get_template_part('template-parts/section', '<slug>') in the order the blueprint's page lists them.
- header.php: <!DOCTYPE html>, <html <?php language_attributes(); ?>>, <head> with charset + viewport + wp_head(); then <body <?php body_class(); ?>>, wp_body_open(), the site header with the logo/site-title and wp_nav_menu( array( 'theme_location' => 'primary', ... ) ), then open <main>.
- footer.php: close </main>, the site footer, wp_footer(), </body></html>.
- functions.php: after_setup_theme (title-tag, post-thumbnails, custom-logo, html5, register_nav_menus with 'primary'); wp_enqueue_scripts enqueuing get_stylesheet_uri() + assets/css/main.css + assets/js/main.js. Prefix all function names with the theme textDomain (underscores).
- style.css: MUST begin with the standard theme header comment block for the theme name, then minimal base CSS.
- assets/css/main.css: ALL layout and section styles, using CSS custom properties for the palette. Class names MUST match what header/footer/templates/sections output: .container, .site-header, .site-nav, .hero, .btn, .section-<slug>, etc.
- template-parts/section-<slug>.php: self-contained markup for that section, wrapped in <section class="section-<slug>">…</section>, using real placeholder copy relevant to the page purpose.
- Use WordPress functions and escape output: the_content(), the_title(), the_permalink(), the_excerpt(), bloginfo(), esc_url(), esc_html(), esc_attr(), get_template_directory_uri().

Security — NEVER use any of these in PHP: eval, assert, create_function, shell_exec, exec, system, passthru, proc_open, popen, base64_decode, gzinflate, call_user_func, preg_replace_callback, file_get_contents, file_put_contents, fopen, fwrite, unlink, curl_exec, wp_remote_get, wp_remote_post, or backtick shell execution. Use only standard theme/template functions.

Make it modern, fully responsive and accessible.`;

type Json = Record<string, unknown>;

function stripFences(text: string): string {
  let t = text.replace(/^﻿/, "");
  const fence = t.match(/^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) {
    t = fence[1];
  }
  return t.replace(/\s+$/, "") + "\n";
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
  const path = typeof body.path === "string" ? body.path.trim() : "";

  if (!blueprint || typeof blueprint !== "object") {
    return NextResponse.json(
      { success: false, error: "A blueprint is required." },
      { status: 400 }
    );
  }

  if (!path) {
    return NextResponse.json(
      { success: false, error: "A file path is required." },
      { status: 400 }
    );
  }

  let response;
  try {
    response = await openai.responses.create({
      model: SMART_MODEL,
      instructions: INSTRUCTIONS,
      input: `Blueprint:\n${JSON.stringify(blueprint)}\n\nGenerate the complete contents of this one file: ${path}`,
    });
  } catch (error) {
    console.error("build-file OpenAI error:", error);
    return NextResponse.json(
      { success: false, error: "The file generator could not be reached. Try again." },
      { status: 502 }
    );
  }

  const contents = stripFences(response.output_text || "");

  if (!contents.trim()) {
    return NextResponse.json(
      { success: false, error: `The generator returned nothing for ${path}.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, path, contents });
}
