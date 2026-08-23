import { NextRequest, NextResponse } from "next/server";

import {
  assertSafeBridgeOrigin,
  UnsafeOriginError,
} from "@/lib/security/url-guard";

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new Error("WordPress did not return JSON.");
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const siteUrl =
      typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";

    const token =
      typeof body.token === "string" ? body.token.trim() : "";

    if (!siteUrl || !token) {
      return NextResponse.json(
        {
          success: false,
          error: "siteUrl and token are required.",
        },
        { status: 400 }
      );
    }

    let origin: string;

    try {
      origin = (await assertSafeBridgeOrigin(siteUrl)).origin;
    } catch (originError) {
      if (originError instanceof UnsafeOriginError) {
        return NextResponse.json(
          {
            success: false,
            error: originError.message,
          },
          { status: originError.status }
        );
      }

      throw originError;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const requestOptions: RequestInit = {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    };

    const [statusResponse, projectResponse] = await Promise.all([
      fetch(
        `${origin}/wp-json/wp-ai-builder/v1/status`,
        requestOptions
      ),
      fetch(
        `${origin}/wp-json/wp-ai-builder/v1/project`,
        requestOptions
      ),
    ]);

    if (!statusResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Bridge status request failed with HTTP ${statusResponse.status}.`,
        },
        { status: 502 }
      );
    }

    if (!projectResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Bridge project request failed with HTTP ${projectResponse.status}.`,
        },
        { status: 502 }
      );
    }

    const status = await readJson(statusResponse);
    const project = await readJson(projectResponse);

    return NextResponse.json({
      success: true,
      wordpress: {
        origin,
        status,
        project,
      },
    });
  } catch (error) {
    console.error("WordPress Bridge connection error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not connect to WordPress Bridge.",
      },
      { status: 500 }
    );
  }
}
