import { NextRequest, NextResponse } from "next/server";

function getAllowedHosts() {
  return new Set(
    (process.env.WP_BRIDGE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

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

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(siteUrl);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid WordPress URL.",
        },
        { status: 400 }
      );
    }

    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        {
          success: false,
          error: "WordPress site must use HTTPS.",
        },
        { status: 400 }
      );
    }

    if (parsedUrl.username || parsedUrl.password) {
      return NextResponse.json(
        {
          success: false,
          error: "URLs containing credentials are not allowed.",
        },
        { status: 400 }
      );
    }

    const allowedHosts = getAllowedHosts();

    if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
      return NextResponse.json(
        {
          success: false,
          error: "This WordPress hostname is not allowed.",
        },
        { status: 403 }
      );
    }

    const origin = parsedUrl.origin;

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
