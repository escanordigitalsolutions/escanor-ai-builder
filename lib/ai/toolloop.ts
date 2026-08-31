import OpenAI from "openai";

import {
  isAnthropic,
  ANTHROPIC_API,
  anthropicHeaders,
  type Usage,
} from "./provider";

/**
 * Provider-agnostic TOOL loop.
 *
 * The agent routes (edit-theme, chat, design-plan, review-theme) all follow the
 * same shape: a system prompt, a conversation, a small set of read-only tools,
 * rounds of tool calls, then a final text answer. This runs that loop on either
 * provider — OpenAI's Responses API or Anthropic's Messages API — chosen by the
 * model id, so the per-project model config works for every tier.
 *
 * The handler executes one tool call and returns a JSON-serialisable result.
 * Anything it THROWS propagates out of the loop (each route decides whether to
 * catch inside the handler or let it fail the request, same as before).
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ToolDef = {
  name: string;
  description: string;
  // JSON schema: { type: "object", properties, required, additionalProperties:false }
  parameters: Record<string, unknown>;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** Optional attached image as a data: URL (png/jpeg/webp/gif) — user turns only. */
  image?: string;
};

/** Split a data: URL into media type + base64 payload (null when malformed). */
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

export type ToolLoopResult = {
  text: string;
  toolCalls: number;
  usage: Usage & { totalTokens: number };
  /** true when the round budget ran out before the model gave a final answer */
  exhausted: boolean;
  /**
   * true when the model stopped because it hit the output-token ceiling.
   *
   * This is not a detail. A theme edit answers with whole file contents, so a
   * reply cut off at the ceiling ends mid-file — and without this flag that
   * looks exactly like a finished answer. The edit routes then write half a
   * stylesheet over a working one. Both providers report it; neither did so
   * through this function until now.
   */
  truncated: boolean;
};

export type ToolLoopOpts = {
  model: string;
  system: string;
  messages: ChatTurn[];
  tools: ToolDef[];
  handler: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxTokens?: number;
  maxRounds?: number;
  maxToolCalls?: number;
};

export async function runToolLoop(opts: ToolLoopOpts): Promise<ToolLoopResult> {
  const result = isAnthropic(opts.model)
    ? await anthropicLoop(opts)
    : await openaiLoop(opts);
  console.log(
    `[ai] toolloop model=${opts.model} calls=${result.toolCalls} in=${result.usage.inputTokens} out=${result.usage.outputTokens} exhausted=${result.exhausted} truncated=${result.truncated}`
  );
  return result;
}

function emptyUsage(): Usage & { totalTokens: number } {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/* ------------------------------- OpenAI ---------------------------------- */

async function openaiLoop(opts: ToolLoopOpts): Promise<ToolLoopResult> {
  const maxRounds = opts.maxRounds ?? 6;
  const maxToolCalls = opts.maxToolCalls ?? 40;
  const usage = emptyUsage();
  let toolCalls = 0;

  const tools = opts.tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    strict: true,
    parameters: t.parameters,
  }));

  const addUsage = (u: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null | undefined) => {
    if (!u) return;
    usage.inputTokens += u.input_tokens ?? 0;
    usage.outputTokens += u.output_tokens ?? 0;
    usage.totalTokens += u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  };

  const input = opts.messages.map((m) =>
    m.image && m.role === "user" && parseDataUrl(m.image)
      ? {
          role: m.role,
          content: [
            { type: "input_image" as const, image_url: m.image, detail: "auto" as const },
            { type: "input_text" as const, text: m.content },
          ],
        }
      : { role: m.role, content: m.content }
  ) as OpenAI.Responses.ResponseInput;

  let response = await openai.responses.create({
    model: opts.model,
    instructions: opts.system,
    input,
    tools,
    tool_choice: "auto",
    parallel_tool_calls: true,
    ...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
  });
  addUsage(response.usage);

  for (let round = 0; round < maxRounds; round++) {
    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      return {
        text: response.output_text || "",
        toolCalls,
        usage,
        exhausted: false,
        truncated: hitOutputCeiling(response),
      };
    }

    toolCalls += calls.length;
    if (toolCalls > maxToolCalls) {
      throw new Error("Tool-call limit exceeded. Ask a narrower question.");
    }

    const outputs = await Promise.all(
      calls.map(async (call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await opts.handler(call.name, args);
        return {
          type: "function_call_output" as const,
          call_id: call.call_id,
          output: JSON.stringify(result),
        };
      })
    );

    response = await openai.responses.create({
      model: opts.model,
      instructions: opts.system,
      previous_response_id: response.id,
      input: outputs,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      ...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
    });
    addUsage(response.usage);
  }

  return {
    text: response.output_text || "",
    toolCalls,
    usage,
    exhausted: true,
    truncated: hitOutputCeiling(response),
  };
}

/**
 * Did this Responses call stop at max_output_tokens?
 *
 * The SDK reports it as status "incomplete" with a reason; the field is read
 * defensively because a provider that stops naming it must not silently start
 * reporting every reply as complete.
 */
export function hitOutputCeiling(response: {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
}): boolean {
  if (response.status !== "incomplete") return false;

  const reason = response.incomplete_details?.reason;

  return !reason || reason === "max_output_tokens";
}

/* ------------------------------ Anthropic --------------------------------- */

type AnthropicBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | unknown[];
};

async function anthropicLoop(opts: ToolLoopOpts): Promise<ToolLoopResult> {
  const maxRounds = opts.maxRounds ?? 6;
  const maxToolCalls = opts.maxToolCalls ?? 40;
  const usage = emptyUsage();
  let toolCalls = 0;

  const tools = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const messages: AnthropicMessage[] = opts.messages.map((m) => {
    const img = m.image && m.role === "user" ? parseDataUrl(m.image) : null;
    return img
      ? {
          role: m.role,
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            },
            { type: "text", text: m.content },
          ],
        }
      : { role: m.role, content: m.content };
  });

  let lastText = "";

  for (let round = 0; round <= maxRounds; round++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: anthropicHeaders(),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages,
        tools,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content?: AnthropicBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    usage.inputTokens += data.usage?.input_tokens ?? 0;
    usage.outputTokens += data.usage?.output_tokens ?? 0;
    usage.totalTokens = usage.inputTokens + usage.outputTokens;

    const content = Array.isArray(data.content) ? data.content : [];
    lastText = content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");

    const toolUses = content.filter((b) => b.type === "tool_use" && b.id && b.name);

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      return {
        text: lastText,
        toolCalls,
        usage,
        exhausted: false,
        truncated: data.stop_reason === "max_tokens",
      };
    }

    toolCalls += toolUses.length;
    if (toolCalls > maxToolCalls) {
      throw new Error("Tool-call limit exceeded. Ask a narrower question.");
    }

    messages.push({ role: "assistant", content });

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const args =
          tu.input && typeof tu.input === "object"
            ? (tu.input as Record<string, unknown>)
            : {};
        const result = await opts.handler(tu.name as string, args);
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push({ role: "user", content: results });
  }

  return { text: lastText, toolCalls, usage, exhausted: true, truncated: false };
}
