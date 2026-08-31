import { NextRequest, NextResponse } from "next/server";

import { parseMemory } from "@/lib/agent/chat-memory";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";

/**
 * WordPress -> SaaS : chat archive.
 *
 * Without a conversationId: the project's recent conversations (id, title,
 * updated_at) so the editor can show a history menu. With one: that
 * conversation's messages so the editor can restore the thread after a page
 * reload — chats survive navigation instead of living only in the DOM.
 */

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

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

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId.trim() : "";

  const supabase = createServiceClient();
  const projectId = auth.context.projectId;

  if (!conversationId) {
    const { data: rows, error } = await supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { success: false, error: "Could not load conversations." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, conversations: rows ?? [] });
  }

  const { data: conversation, error: convError } = await supabase
    .from("ai_conversations")
    .select("id, title, memory")
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .single();

  if (convError || !conversation) {
    return NextResponse.json(
      { success: false, error: "Conversation not found." },
      { status: 404 }
    );
  }

  const { data: messages, error: msgError } = await supabase
    .from("ai_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(80);

  if (msgError) {
    return NextResponse.json(
      { success: false, error: "Could not load messages." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    conversation,
    // Reopening a conversation restores what it was holding, not just what was
    // said — otherwise the chips come back empty and the AI looks forgetful
    // while it is in fact remembering.
    memory: parseMemory((conversation as { memory?: unknown }).memory),
    messages: (messages ?? []).map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  });
}
