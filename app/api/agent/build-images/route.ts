import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { moduleEnabled } from "@/lib/entitlements";

/**
 * WordPress -> SaaS image generation (Builder, B1d).
 *
 * Generates up to 4 on-brand images from the brief and returns them as base64.
 * WordPress sideloads them into the media library and places a gallery. The
 * image model is configurable via OPENAI_IMAGE_MODEL (default gpt-image-1) so
 * the account can point at whatever image model it has access to.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateSiteRequest(request);

    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { context } = auth;

    if (!moduleEnabled(context.modules, "build")) {
      return NextResponse.json(
        { success: false, error: "The Build module is not enabled on your plan." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const brand = str(body.brand).trim().slice(0, 80) || "the brand";
    const tagline = str(body.tagline).trim().slice(0, 160);
    const siteType = str(body.siteType || body.site_type).trim().slice(0, 40) || "business";
    const style = str(body.style).trim().slice(0, 40) || "modern";

    let count = Number.parseInt(String(body.count ?? 4), 10);
    if (!Number.isInteger(count) || count < 1) count = 4;
    if (count > 4) count = 4;

    // When an index is given, generate just that one image (the plugin loops
    // per image so no single request is slow enough to time out).
    const hasIndex = body.index !== undefined && body.index !== null;
    let index = Number.parseInt(String(body.index ?? 0), 10);
    if (!Number.isInteger(index) || index < 0) index = 0;

    const noText = "No text, no words, no letters, no logos, no watermark.";

    const allPrompts: { prompt: string; alt: string }[] = [
      {
        prompt: `Professional hero photograph for a ${style} ${siteType} brand called "${brand}"${tagline ? ` (${tagline})` : ""}. Editorial quality, natural light, clean composition. ${noText}`,
        alt: `${brand} hero image`,
      },
      {
        prompt: `Photograph of a ${siteType} environment or workspace, ${style} aesthetic, warm and inviting, shallow depth of field. ${noText}`,
        alt: `${brand} environment`,
      },
      {
        prompt: `Close-up detail photograph relevant to a ${siteType}, ${style} style, high detail, tasteful. ${noText}`,
        alt: `${brand} detail`,
      },
      {
        prompt: `Abstract on-brand background texture matching a ${style} ${siteType} mood, soft gradients and subtle shapes. ${noText}`,
        alt: `${brand} background texture`,
      },
    ];

    // With an index: emit exactly that one prompt (the plugin drives the loop,
    // one HTTP request per image, so nothing is slow enough to time out).
    // Without an index: emit the first `count` prompts in a single request.
    const prompts = hasIndex
      ? [allPrompts[index % allPrompts.length]]
      : allPrompts.slice(0, count);

    const images: { b64: string; alt: string }[] = [];

    for (const p of prompts) {
      try {
        const base = { model: IMAGE_MODEL, prompt: p.prompt, size: "1024x1024" as const, n: 1 };
        const params = IMAGE_MODEL.includes("dall-e")
          ? { ...base, response_format: "b64_json" as const }
          : base;

        const result = await openai.images.generate(params);
        const b64 = result.data?.[0]?.b64_json;

        if (b64) {
          images.push({ b64, alt: p.alt });
        }
      } catch (imgError) {
        console.warn("Image generation failed for one prompt:", imgError);
      }
    }

    if (!images.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No images could be generated. Check the account has access to the image model (OPENAI_IMAGE_MODEL).",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      images,
      model: IMAGE_MODEL,
      debug: {
        model: IMAGE_MODEL,
        input: { brand, tagline, siteType, style, index: hasIndex ? index : null, count },
        prompts: prompts.map((p) => p.prompt),
      },
    });
  } catch (error) {
    console.error("Build images error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Image generation failed.",
      },
      { status: 500 }
    );
  }
}
