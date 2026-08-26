"use client";

import { FormEvent, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ActivityItem = {
  tool: string;
  scope?: "theme" | "plugin";
  paths?: string[];
};

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  activity?: ActivityItem[];
};

type Conversation = {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
};

export default function ProjectAIChat({
  projectId,
}: {
  projectId: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [conversationBusyId, setConversationBusyId] = useState<string | null>(
    null
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initializeHistory() {
      setHistoryLoading(true);

      try {
        const response = await fetch(
          `/api/projects/${projectId}/conversations`,
          {
            cache: "no-store",
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Could not load conversations.");
        }

        if (cancelled) {
          return;
        }

        const loadedConversations: Conversation[] = Array.isArray(
          data.conversations
        )
          ? data.conversations
          : [];

        setConversations(loadedConversations);

        const firstConversation = loadedConversations[0];

        if (!firstConversation) {
          setConversationId(null);
          setMessages([]);
          return;
        }

        const detailResponse = await fetch(
          `/api/projects/${projectId}/conversations/${firstConversation.id}`,
          {
            cache: "no-store",
          }
        );

        const detailData = await detailResponse.json();

        if (!detailResponse.ok || !detailData.success) {
          throw new Error(detailData.error ?? "Could not load conversation.");
        }

        if (cancelled) {
          return;
        }

        setConversationId(firstConversation.id);
        setMessages(normalizeMessages(detailData.messages));
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load chat history."
          );
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    void initializeHistory();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function openConversation(id: string) {
    if (loading || historyLoading || id === conversationId) {
      return;
    }

    setHistoryLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/conversations/${id}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not load conversation.");
      }

      setConversationId(id);
      setMessages(normalizeMessages(data.messages));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load conversation."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function startNewChat() {
    if (loading) {
      return;
    }

    setConversationId(null);
    setMessages([]);
    setInput("");
    setError("");
  }

  async function renameConversation(conversation: Conversation) {
    if (conversationBusyId) {
      return;
    }

    const title = window.prompt("Rename chat", conversation.title)?.trim();

    if (!title || title === conversation.title) {
      return;
    }

    setConversationBusyId(conversation.id);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not rename conversation.");
      }

      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id ? data.conversation : item
        )
      );
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Could not rename conversation."
      );
    } finally {
      setConversationBusyId(null);
    }
  }

  async function deleteConversation(conversation: Conversation) {
    if (conversationBusyId) {
      return;
    }

    const approved = window.confirm(
      `Delete "${conversation.title}" and its saved messages?`
    );

    if (!approved) {
      return;
    }

    setConversationBusyId(conversation.id);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/conversations/${conversation.id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Could not delete conversation.");
      }

      setConversations((current) =>
        current.filter((item) => item.id !== conversation.id)
      );

      if (conversationId === conversation.id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete conversation."
      );
    } finally {
      setConversationBusyId(null);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    await submitMessage(input);
  }

  async function submitMessage(rawMessage: string) {
    const message = rawMessage.trim();

    if (!message || loading || historyLoading) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: message,
      },
    ]);

    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          conversationId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "AI request failed.");
      }

      const returnedConversation: Conversation = data.conversation;

      setConversationId(returnedConversation.id);

      setConversations((current) => [
        returnedConversation,
        ...current.filter(
          (conversation) => conversation.id !== returnedConversation.id
        ),
      ]);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          activity: Array.isArray(data.activity) ? data.activity : [],
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="grid min-h-[650px] md:grid-cols-[240px_1fr]">
        <aside className="border-b border-neutral-200 bg-neutral-50 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-neutral-200 p-4">
            <div>
              <p className="text-xs font-medium text-neutral-500">Chats</p>
              <p className="mt-1 text-[11px] text-neutral-600">
                Saved per project
              </p>
            </div>

            <button
              type="button"
              onClick={startNewChat}
              disabled={loading}
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-900 disabled:opacity-40"
            >
              + New
            </button>
          </div>

          <div className="max-h-[190px] overflow-y-auto p-2 md:max-h-[590px]">
            {conversations.length === 0 && !historyLoading && (
              <p className="px-2 py-4 text-xs text-neutral-600">
                No saved chats yet.
              </p>
            )}

            {conversations.map((conversation) => {
              const active = conversation.id === conversationId;
              const busy = conversationBusyId === conversation.id;

              return (
                <div
                  key={conversation.id}
                  className={
                    active
                      ? "group mb-1 flex items-center rounded-lg bg-neutral-100"
                      : "group mb-1 flex items-center rounded-lg hover:bg-neutral-50"
                  }
                >
                  <button
                    type="button"
                    onClick={() => openConversation(conversation.id)}
                    disabled={loading || historyLoading || busy}
                    className={
                      active
                        ? "min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-neutral-900"
                        : "min-w-0 flex-1 px-3 py-2.5 text-left text-sm text-neutral-500 transition group-hover:text-neutral-700"
                    }
                  >
                    <span className="block truncate">{conversation.title}</span>
                  </button>

                  <div className="flex shrink-0 items-center pr-1 opacity-40 transition group-hover:opacity-100">
                    <button
                      type="button"
                      title="Rename chat"
                      onClick={() => renameConversation(conversation)}
                      disabled={busy}
                      className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30"
                    >
                      ✎
                    </button>

                    <button
                      type="button"
                      title="Delete chat"
                      onClick={() => deleteConversation(conversation)}
                      disabled={busy}
                      className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="border-b border-neutral-200 p-5">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-500" />

              <div className="min-w-0">
                <h2 className="font-medium text-neutral-900">AI Workspace</h2>
                <p className="mt-1 truncate text-xs text-neutral-500">
                  {conversationId
                    ? conversations.find(
                        (conversation) => conversation.id === conversationId
                      )?.title ?? "Saved conversation"
                    : "New conversation · read-only project analysis"}
                </p>
              </div>
            </div>
          </div>

          <div className="min-h-[430px] flex-1 space-y-5 overflow-y-auto p-6">
            {historyLoading && (
              <div className="py-16 text-center text-sm text-neutral-600">
                Loading chat history...
              </div>
            )}

            {!historyLoading && messages.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-neutral-500">
                  Ask about this WordPress project.
                </p>

                <p className="mt-2 text-sm text-neutral-600">
                  Conversations are saved automatically.
                </p>

                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <Suggestion
                    onClick={() =>
                      submitMessage("Analyze the project structure")
                    }
                  >
                    Analyze the project structure
                  </Suggestion>

                  <Suggestion
                    onClick={() => submitMessage("How is the homepage built?")}
                  >
                    How is the homepage built?
                  </Suggestion>

                  <Suggestion
                    onClick={() =>
                      submitMessage("Explain the theme architecture")
                    }
                  >
                    Explain the theme architecture
                  </Suggestion>
                </div>
              </div>
            )}

            {!historyLoading &&
              messages.map((message, index) => (
                <div
                  key={message.id ?? index}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[80%]"
                      : "mr-auto max-w-[92%]"
                  }
                >
                  <p className="mb-2 text-xs text-neutral-600">
                    {message.role === "user" ? "You" : "AI Builder"}
                  </p>

                  <div
                    className={
                      message.role === "user"
                        ? "rounded-xl bg-neutral-900 px-4 py-3 text-white"
                        : "rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4"
                    }
                  >
                    {message.role === "assistant" ? (
                      <MarkdownContent content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>

                  {message.role === "assistant" &&
                    message.activity &&
                    message.activity.length > 0 && (
                      <ActivityPanel activity={message.activity} />
                    )}
                </div>
              ))}

            {loading && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  Inspecting project files...
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="flex gap-3 border-t border-neutral-200 p-4"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask AI about this project..."
              disabled={historyLoading}
              className="flex-1 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={loading || historyLoading || !input.trim()}
              className="rounded-lg bg-neutral-900 px-6 font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (message) =>
        message &&
        typeof message === "object" &&
        "role" in message &&
        "content" in message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
    .map((message) => {
      const typed = message as {
        id?: string;
        role: "user" | "assistant";
        content: string;
        activity?: ActivityItem[];
      };

      return {
        id: typed.id,
        role: typed.role,
        content: typed.content,
        activity: Array.isArray(typed.activity) ? typed.activity : [],
      };
    });
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-neutral-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 text-2xl font-semibold text-neutral-900 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 text-xl font-semibold text-neutral-900 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 text-lg font-semibold text-neutral-900 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="whitespace-normal text-neutral-700">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-neutral-700">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-neutral-700">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-neutral-900">{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);

            if (!isBlock) {
              return (
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.92em] text-neutral-700">
                  {children}
                </code>
              );
            }

            return (
              <code className={`${className ?? ""} text-sm`}>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-4 text-sm leading-6 text-neutral-700">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-neutral-200 pl-4 text-neutral-500">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-neutral-600 underline-offset-4 hover:text-neutral-900"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-neutral-200 bg-neutral-100 px-3 py-2 font-medium text-neutral-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-neutral-200 px-3 py-2 text-neutral-700">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ActivityPanel({ activity }: { activity: ActivityItem[] }) {
  const items = activity.flatMap((item, index) => {
    const scopeLabel = item.scope === "plugin" ? "plugin" : "theme";

    if (item.tool === "list_project_files") {
      return [
        {
          key: `${index}-list`,
          text: `Listed ${scopeLabel} files`,
        },
      ];
    }

    if (item.tool === "read_project_files" && item.paths?.length) {
      return item.paths.map((path, pathIndex) => ({
        key: `${index}-${pathIndex}-${path}`,
        text: `Read ${scopeLabel}: ${path}`,
      }));
    }

    return [
      {
        key: `${index}-tool`,
        text: item.tool,
      },
    ];
  });

  return (
    <details className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
      <summary className="cursor-pointer select-none text-xs font-medium text-neutral-500">
        AI activity · {items.length} steps
      </summary>

      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-start gap-2 text-xs text-neutral-500"
          >
            <span className="mt-[2px] text-green-600">✓</span>
            <span className="break-all">{item.text}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function Suggestion({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-neutral-200 px-4 py-2 text-xs text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-700"
    >
      {children}
    </button>
  );
}
