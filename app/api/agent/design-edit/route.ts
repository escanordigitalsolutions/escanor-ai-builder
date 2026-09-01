import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { recordUsage } from "@/lib/ai/usage";
import { errorDetail } from "@/lib/debug";
import { borrowsBaseCss, editDesign, syncBaseCss } from "@/lib/agent/design-edit";
import { splitMockup } from "@/lib/agent/mockup-core";
import { DESIGN_PAGES, PAGE_LABEL, availablePages, colorwayCss } from "@/lib/agent/design-pages";

export const maxDuration = 300;

/**
 * Adjust an approved design, before anything is built from it.
 *
 * One cheap call, applied as anchored edits to the mockup's own HTML, then the
 * new stylesheet pushed back into the screens that borrow it. Nothing here
 * generates a new design: the whole point is to keep the one that was approved
 * and change the part that was wrong.
 */

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request);

  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: Json = {};

  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const designId = typeof body.designId === "string" ? body.designId.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";

  if (!designId || !instruction) {
    return NextResponse.json(
      { success: false, error: "A design and an instruction are required." },
      { status: 400 }
    );
  }

  if (instruction.length > 2000) {
    return NextResponse.json(
      { success: false, error: "That instruction is too long." },
      { status: 400 }
    );
  }

  const db = createServiceClient();

  try {
    const { data, error } = await db
      .from("ai_designs")
      .select("id, html, inner_html, pages, assets, direction, concept")
      .eq("id", designId)
      .eq("project_id", auth.context.projectId)
      .single();

    if (error || !data || typeof data.html !== "string" || !data.html) {
      return NextResponse.json({ success: false, error: "Design not found." }, { status: 404 });
    }

    const { data: project } = await db
      .from("projects")
      .select("model_config")
      .eq("id", auth.context.projectId)
      .maybeSingle();

    const result = await editDesign({
      modelConfig: (project as { model_config?: unknown } | null)?.model_config,
      html: data.html,
      instruction,
    });

    await recordUsage(auth.context.projectId, "design", result.model, result.usage, {
      designId,
      instruction: instruction.slice(0, 400),
      summary: result.summary.slice(0, 300),
      notes: result.notes.slice(0, 4),
      changed: result.changed,
    });

    if (!result.changed) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.notes[0] ??
            (result.summary && result.summary !== "Updated the theme."
              ? result.summary
              : "That change could not be made to this design. Try describing it differently."),
        },
        { status: 422 }
      );
    }

    // The homepage carries the stylesheet every other screen borrows, so an
    // edit to it is an edit to all of them. A screen left on the old CSS is how
    // a design ends up looking changed on one page and not the others.
    const split = splitMockup(result.html);
    const pages = { ...((data.pages ?? {}) as Record<string, unknown>) };
    const untouched: string[] = [];

    const inner =
      typeof data.inner_html === "string" && data.inner_html
        ? syncBaseCss(data.inner_html, split.css)
        : data.inner_html;

    for (const page of DESIGN_PAGES) {
      if (page === "home" || page === "inner") continue;

      const html = pages[page];

      if (typeof html !== "string" || !html) continue;

      if (borrowsBaseCss(html)) {
        pages[page] = syncBaseCss(html, split.css);
      } else {
        // The brand sheet is rendered by us, not by a model, so it has no
        // borrowed stylesheet to update. Worth saying rather than pretending.
        untouched.push(PAGE_LABEL[page]);
      }
    }

    const { error: saveError } = await db
      .from("ai_designs")
      .update({
        html: result.html,
        inner_html: inner,
        pages,
        assets: { ...((data.assets ?? {}) as Record<string, unknown>), css: split.css },
      })
      .eq("id", designId);

    if (saveError) {
      console.error("design-edit save error:", saveError.message);

      return NextResponse.json(
        { success: false, error: "The change was made but could not be saved." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      summary: result.summary,
      notes: result.notes,
      untouched,
      html: result.html,
      available: availablePages({ ...data, html: result.html, inner_html: inner, pages }),
      colorways: colorwayCss(data.direction),
      usage: result.usage,
    });
  } catch (err) {
    console.error("design-edit error:", err);

    return NextResponse.json(
      {
        success: false,
        error: "The design could not be adjusted.",
        code: "design_edit_failed",
        ...errorDetail(err),
      },
      { status: 500 }
    );
  }
}
