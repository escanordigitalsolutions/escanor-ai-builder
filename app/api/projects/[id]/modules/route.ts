import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MODULE_KEYS,
  resolveModules,
  resolvePlan,
  type Modules,
} from "@/lib/entitlements";

/**
 * Per-project module entitlements — the manual licensing surface.
 *
 * GET returns the project's current modules + plan. PATCH updates them. Both
 * are owner-gated the same way the site-key routes are: the browser session
 * must own the project (RLS-scoped select), and the write goes through the
 * service client.
 *
 * The wp-admin plugin reads these through the site-key session handshake and
 * locks the modules a project is not entitled to.
 */

type Params = {
  params: Promise<{ id: string }>;
};

async function requireProjectOwner(projectId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return { ok: false as const, status: 404, error: "Project not found." };
  }

  return { ok: true as const, user, project };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const owner = await requireProjectOwner(id);

  if (!owner.ok) {
    return NextResponse.json(
      { success: false, error: owner.error },
      { status: owner.status }
    );
  }

  const service = createServiceClient();

  let modules = resolveModules(null);
  let plan = resolvePlan(null);

  try {
    const { data, error } = await service
      .from("projects")
      .select("modules, plan")
      .eq("id", id)
      .maybeSingle();

    if (!error) {
      modules = resolveModules(data?.modules);
      plan = resolvePlan(data?.plan);
    }
  } catch {
    // Column may not exist yet (migration pending) — fall back to defaults.
  }

  return NextResponse.json({ success: true, modules, plan, keys: MODULE_KEYS });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const owner = await requireProjectOwner(id);

  if (!owner.ok) {
    return NextResponse.json(
      { success: false, error: owner.error },
      { status: owner.status }
    );
  }

  let body: { modules?: unknown; plan?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Merge the requested changes onto whatever is currently stored so a partial
  // payload never drops the other modules.
  let current: Modules = resolveModules(null);
  let currentPlan = resolvePlan(null);

  try {
    const { data } = await service
      .from("projects")
      .select("modules, plan")
      .eq("id", id)
      .maybeSingle();

    current = resolveModules(data?.modules);
    currentPlan = resolvePlan(data?.plan);
  } catch {
    // Defaults already assigned.
  }

  const nextModules: Modules = { ...current };

  if (body.modules && typeof body.modules === "object" && !Array.isArray(body.modules)) {
    const incoming = body.modules as Record<string, unknown>;

    for (const key of MODULE_KEYS) {
      if (typeof incoming[key] === "boolean") {
        nextModules[key] = incoming[key] as boolean;
      }
    }
  }

  nextModules.content = true; // base module never locks

  let nextPlan = currentPlan;

  if (typeof body.plan === "string" && body.plan.trim()) {
    nextPlan = body.plan.trim().slice(0, 40);
  }

  const { error } = await service
    .from("projects")
    .update({ modules: nextModules, plan: nextPlan })
    .eq("id", id);

  if (error) {
    console.error("Update project modules error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          "Could not save module settings. Make sure the project_modules migration has been applied.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    modules: nextModules,
    plan: nextPlan,
  });
}
