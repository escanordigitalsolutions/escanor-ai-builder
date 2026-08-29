import OpenAI from "openai";

/**
 * Provider-agnostic text generation.
 *
 * A model id decides the provider: ids beginning with "claude" (or "anthropic")
 * go to Anthropic's Messages API (called over plain fetch, so no extra npm
 * dependency and it works on Vercel immediately); everything else goes to
 * OpenAI's Responses API. This lets the theme generator run on e.g. a Claude
 * Haiku model just by pointing the model env var at it.
 *
 * Single-shot TEXT generation lives here (build-plan, build-files). The
 * provider-agnostic TOOL loop for the agent routes lives in ./toolloop.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function isAnthropic(model: string): boolean {
  return /^(claude|anthropic)/i.test(model.trim());
}

export type Usage = { inputTokens: number; outputTokens: number };

type GenResult = { text: string; truncated: boolean; usage: Usage };

export const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export function anthropicHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
  };
}

function readAnthropicUsage(u: unknown): Usage {
  const usage = (u ?? {}) as { input_tokens?: number; output_tokens?: number };
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

async function anthropicGenerate(
  model: string,
  system: string,
  input: string,
  maxTokens: number
): Promise<GenResult> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: input }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: unknown;
  };

  const text = Array.isArray(data.content)
    ? data.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("")
    : "";

  return {
    text,
    truncated: data.stop_reason === "max_tokens",
    usage: readAnthropicUsage(data.usage),
  };
}

async function openaiGenerate(
  model: string,
  system: string,
  input: string,
  maxTokens: number
): Promise<GenResult> {
  const r = await openai.responses.create({
    model,
    instructions: system,
    input,
    max_output_tokens: maxTokens,
  });

  const truncated =
    r.status === "incomplete" &&
    (r.incomplete_details?.reason === "max_output_tokens" || !r.incomplete_details);

  return {
    text: r.output_text || "",
    truncated,
    usage: {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Generate text from either provider. Returns the raw text, whether the output
 * was cut off at the token limit, and the tokens the call consumed.
 */
export async function generateText(opts: {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
}): Promise<GenResult> {
  const maxTokens = opts.maxTokens ?? 16000;
  const result = isAnthropic(opts.model)
    ? await anthropicGenerate(opts.model, opts.system, opts.input, maxTokens)
    : await openaiGenerate(opts.model, opts.system, opts.input, maxTokens);
  console.log(
    `[ai] generate model=${opts.model} in=${result.usage.inputTokens} out=${result.usage.outputTokens} truncated=${result.truncated}`
  );
  return result;
}
