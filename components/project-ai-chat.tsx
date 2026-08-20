"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ActivityItem = {
  tool: string;
  scope?: "theme" | "plugin";
  paths?: string[];
};

type Message = {
  role: "user" | "assistant";
  content: string;
  activity?: ActivityItem[];
};

export default function ProjectAIChat({
  projectId,
}: {
  projectId: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    await submitMessage(input);
  }

  async function submitMessage(rawMessage: string) {
    const message = rawMessage.trim();

    if (!message || loading) {
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
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "AI request failed.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          activity: Array.isArray(data.activity) ? data.activity : [],
        },
      ]);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800">
      <div className="border-b border-neutral-800 p-5">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-green-400" />

          <div>
            <h2 className="font-medium">AI Workspace</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Read-only project analysis
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-[350px] max-h-[650px] space-y-5 overflow-y-auto p-6">
        {messages.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-neutral-400">
              Ask about this WordPress project.
            </p>

            <p className="mt-2 text-sm text-neutral-600">
              The AI can inspect the theme and companion plugin.
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Suggestion
                onClick={() => submitMessage("Analyze the project structure")}
              >
                Analyze the project structure
              </Suggestion>

              <Suggestion
                onClick={() => submitMessage("How is the homepage built?")}
              >
                How is the homepage built?
              </Suggestion>

              <Suggestion
                onClick={() => submitMessage("Explain the theme architecture")}
              >
                Explain the theme architecture
              </Suggestion>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
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
                  ? "rounded-xl bg-white px-4 py-3 text-black"
                  : "rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4"
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
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-500">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              Inspecting project files...
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="flex gap-3 border-t border-neutral-800 p-4"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask AI about this project..."
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-neutral-500"
        />

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-white px-6 font-medium text-black disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-neutral-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 text-2xl font-semibold text-white first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 text-xl font-semibold text-white first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 text-lg font-semibold text-white first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="whitespace-normal text-neutral-300">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-neutral-300">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-neutral-300">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);

            if (!isBlock) {
              return (
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-[0.92em] text-neutral-100">
                  {children}
                </code>
              );
            }

            return (
              <code className={`${className ?? ""} text-sm`}>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm leading-6 text-neutral-200">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-neutral-700 pl-4 text-neutral-400">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-neutral-600 underline-offset-4 hover:text-white"
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
            <th className="border border-neutral-700 bg-neutral-800 px-3 py-2 font-medium text-white">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-neutral-800 px-3 py-2 text-neutral-300">
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
    <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-4 py-3">
      <summary className="cursor-pointer select-none text-xs font-medium text-neutral-500">
        AI activity · {items.length} steps
      </summary>

      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex items-start gap-2 text-xs text-neutral-500"
          >
            <span className="mt-[2px] text-green-400">✓</span>
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
      className="rounded-full border border-neutral-800 px-4 py-2 text-xs text-neutral-500 transition hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-300"
    >
      {children}
    </button>
  );
}
