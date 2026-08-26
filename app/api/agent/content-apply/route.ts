import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { decryptSecret } from "@/lib/security/encryption";
import {
  updateSiteContent,
  type ContentUpdateFields,
} from "@/lib/wordpress/bridge";

/**
 * WordPress -> SaaS content-edit apply (v3A, Phase 3).
 *
 * The only path that writes native content. It forwards a small, whitelisted
 * set of fields to the bridge's /content-update, which runs them through
 * wp_update_post / WooCommerce and saves a WordPress revision. Used both for
 * applying a proposal and for the editor's one-click Undo (re-applying the
 * captured "before" values).
 */

const ALLOWED_STATUSES = ["draft", "publish", "pending", "private"];

function sanitizeFields(input: unknown): ContentUpdateFields {
  const out: ContentUpdateFields = {};

  if (!input || typeof input !== "object") {
    return out;
  }

  const f = input as Record<string, unknown>;

  if (typeof f.title === "string") out.title = f.title.slice(0, 400);
  if (typeof f.content === "string") out.content = f.content.slice(0, 200000);
  if (typeof f.excerpt === "string") out.excerpt = f.excerpt.slice(0, 20000);
  if (typeof f.status === "string" && ALLOWED_STATUSES.includes(f.status)) {
    out.status = f.status;
  }

  if (f.product && typeof f.product === "object") {
    const p = f.product as Record<string, unknown>;
    const product: NonNullable<ContentUpdateFields["product"]> = {};
    if (typeof p.regular_price === "string") product.regular_price = p.regular_price;
    if (typeof p.sale_price === "string") product.sale_price = p.sale_price;
    if (typeof p.sku === "string") product.sku = p.sku.slice(0, 120);
    if (typeof p.stock_status === "string") product.stock_status = p.stock_status;
    if (Object.keys(product).length) out.product = product;
  }

  return out;
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
    const supabase = createServiceClient();

    const body = await request.json();
    const type = (typeof body.type === "string" ? body.type : "").trim().slice(0, 40);
    const id = Number.parseInt(String(body.id), 10);
    const fields = sanitizeFields(body.fields);

    if (!type || !/^[a-z0-9_-]+$/i.test(type) || type === "menu" || type === "media") {
      return NextResponse.json(
        { success: false, error: "This content type cannot be edited here." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json(
        { success: false, error: "A valid content id is required." },
        { status: 400 }
      );
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update." },
        { status: 400 }
      );
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select(`
        id,
        wordpress_sites (
          site_url,
          bridge_token_encrypted
        )
      `)
      .eq("id", context.projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      );
    }

    const wordpressSites = project.wordpress_sites;
    const site = Array.isArray(wordpressSites)
      ? wordpressSites[0]
      : wordpressSites;

    if (!site || !site.site_url || !site.bridge_token_encrypted) {
      return NextResponse.json(
        { success: false, error: "WordPress connection is missing." },
        { status: 400 }
      );
    }

    const bridgeToken = decryptSecret(site.bridge_token_encrypted);

    const result = (await updateSiteContent(site.site_url, bridgeToken, {
      type,
      id,
      fields,
    })) as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Content apply error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Content update failed.",
      },
      { status: 500 }
    );
  }
}
