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
 * Only single-shot TEXT generation (no tools) is abstracted here — that covers
 * build-plan and build-files, the heart of theme generation. The tool-loop
 * routes (chat, edit, design critique, review) still use OpenAI directly.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function isAnthropic(model: string): boolean {
  return /^(claude|anthropic)/i.test(model.trim());
}

type GenResult = { text: string; truncated: boolean };

async function anthropicGenerate(
  model: string,
  system: string,
  input: string,
  maxTokens: number
): Promise<GenResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
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
  };

  const text = Array.isArray(data.content)
    ? data.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("")
    : "";

  return { text, truncated: data.stop_reason === "max_tokens" };
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

  return { text: r.output_text || "", truncated };
}

/**
 * Generate text from either provider. Returns the raw text plus whether the
 * output was cut off at the token limit (so callers can retry a smaller batch).
 */
export async function generateText(opts: {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
}): Promise<GenResult> {
  const maxTokens = opts.maxTokens ?? 16000;
  return isAnthropic(opts.model)
    ? anthropicGenerate(opts.model, opts.system, opts.input, maxTokens)
    : openaiGenerate(opts.model, opts.system, opts.input, maxTokens);
}
