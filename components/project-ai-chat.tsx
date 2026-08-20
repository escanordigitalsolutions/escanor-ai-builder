"use client";

import {
  FormEvent,
  useState,
} from "react";

type Message = {
  role:
    | "user"
    | "assistant";

  content: string;
};

export default function ProjectAIChat({
  projectId,
}: {
  projectId: string;
}) {
  const [input, setInput] =
    useState("");

  const [
    messages,
    setMessages,
  ] =
    useState<Message[]>([]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  async function sendMessage(
    event: FormEvent
  ) {
    event.preventDefault();

    const message =
      input.trim();

    if (
      !message ||
      loading
    ) {
      return;
    }

    setMessages(
      (current) => [
        ...current,

        {
          role: "user",
          content: message,
        },
      ]
    );

    setInput("");
    setError("");
    setLoading(true);

    try {
      const response =
        await fetch(
          `/api/projects/${projectId}/chat`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                message,
              }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ??
            "AI request failed."
        );
      }

      setMessages(
        (current) => [
          ...current,

          {
            role:
              "assistant",

            content:
              data.answer,
          },
        ]
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-neutral-800 rounded-xl overflow-hidden">
      <div className="border-b border-neutral-800 p-5">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400" />

          <div>
            <h2 className="font-medium">
              AI Workspace
            </h2>

            <p className="text-xs text-neutral-500 mt-1">
              Read-only project analysis
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-[350px] max-h-[600px] overflow-y-auto p-6 space-y-5">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-neutral-400">
              Ask about this WordPress project.
            </p>

            <p className="text-neutral-600 text-sm mt-2">
              The AI can inspect the theme and companion plugin.
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Suggestion>
                Analyze the project structure
              </Suggestion>

              <Suggestion>
                How is the homepage built?
              </Suggestion>

              <Suggestion>
                Explain the theme architecture
              </Suggestion>
            </div>
          </div>
        )}

        {messages.map(
          (message, index) => (
            <div
              key={index}
              className={
                message.role ===
                "user"
                  ? "ml-auto max-w-[80%]"
                  : "mr-auto max-w-[90%]"
              }
            >
              <p className="text-xs text-neutral-600 mb-2">
                {message.role ===
                "user"
                  ? "You"
                  : "AI Builder"}
              </p>

              <div
                className={
                  message.role ===
                  "user"
                    ? "bg-white text-black rounded-xl px-4 py-3 whitespace-pre-wrap"
                    : "bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 whitespace-pre-wrap"
                }
              >
                {message.content}
              </div>
            </div>
          )
        )}

        {loading && (
          <div className="text-neutral-500 text-sm">
            Inspecting project...
          </div>
        )}

        {error && (
          <div className="border border-red-900 bg-red-950/30 text-red-400 rounded-lg p-4 text-sm">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="border-t border-neutral-800 p-4 flex gap-3"
      >
        <input
          value={input}
          onChange={(event) =>
            setInput(
              event.target.value
            )
          }
          placeholder="Ask AI about this project..."
          className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 outline-none"
        />

        <button
          type="submit"
          disabled={
            loading ||
            !input.trim()
          }
          className="bg-white text-black rounded-lg px-6 font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function Suggestion({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <span className="border border-neutral-800 rounded-full px-4 py-2 text-xs text-neutral-500">
      {children}
    </span>
  );
}
