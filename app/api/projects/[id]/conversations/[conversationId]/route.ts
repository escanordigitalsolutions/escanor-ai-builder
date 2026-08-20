import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function getOwnedConversation(projectId: string, conversationId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      conversation: null,
      errorResponse: NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  const { data: conversation, error } = await supabase
    .from("ai_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .single();

  if (error || !conversation) {
    return {
      supabase,
      conversation: null,
      errorResponse: NextResponse.json(
        { success: false, error: "Conversation not found." },
        { status: 404 }
      ),
    };
  }

  return {
    supabase,
    conversation,
    errorResponse: null,
  };
}

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
  const { supabase, conversation, errorResponse } =
    await getOwnedConversation(id, conversationId);

  if (errorResponse || !conversation) {
    return errorResponse;
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

export async function PATCH(
  request: NextRequest,
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
  const { supabase, conversation, errorResponse } =
    await getOwnedConversation(id, conversationId);

  if (errorResponse || !conversation) {
    return errorResponse;
  }

  const body = await request.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!title || title.length > 120) {
    return NextResponse.json(
      {
        success: false,
        error: "Chat title must be between 1 and 120 characters.",
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("ai_conversations")
    .update({
      title,
      updated_at: now,
    })
    .eq("id", conversation.id)
    .select("id, title, created_at, updated_at")
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { success: false, error: "Could not rename conversation." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    conversation: {
      id: updated.id,
      title: updated.title,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    },
  });
}

export async function DELETE(
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
  const { supabase, conversation, errorResponse } =
    await getOwnedConversation(id, conversationId);

  if (errorResponse || !conversation) {
    return errorResponse;
  }

  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversation.id);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Could not delete conversation." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    deletedId: conversation.id,
  });
}
