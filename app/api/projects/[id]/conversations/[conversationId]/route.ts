import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      conversationId: string;
    }>;
  }
) {
  const { id, conversationId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("ai_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", conversationId)
    .eq("project_id", id)
    .single();

  if (conversationError || !conversation) {
    return NextResponse.json(
      { success: false, error: "Conversation not found." },
      { status: 404 }
    );
  }

  const { data: messages, error: messagesError } = await supabase
    .from("ai_messages")
    .select("id, role, content, activity, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("Conversation messages error:", messagesError);

    return NextResponse.json(
      { success: false, error: "Could not load messages." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    },
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      activity: Array.isArray(message.activity) ? message.activity : [],
      createdAt: message.created_at,
    })),
  });
}
