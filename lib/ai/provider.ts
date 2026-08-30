import OpenAI from "openai";

/**
 * Provider-agnostic text generation, over streaming connections.
 *
 * A model id decides the provider: ids beginning with "claude" (or "anthropic")
 * go to Anthropic's Messages API, everything else to OpenAI's Responses API.
 *
 * Both are streamed, and that is not about showing progress.
 *
 * The non-streaming version of this file failed every long generation at almost
 * exactly 300 seconds with a bare "fetch failed". Node's fetch is undici, whose
 * default body timeout is 300 000 ms: on a non-streamed request no byte of the
 * response arrives until the model has finished writing all of it, so a call
 * that takes longer than five minutes is killed by the HTTP client before the
 * model ever answers. Writing a homepage takes twenty-odd thousand tokens and
 * routinely runs past that.
 *
 * Streaming removes the failure rather than working around it: tokens arrive
 * continuously, so no idle timeout has anything to fire on. It also makes a
 * genuinely stalled connection detectable, which a single long silence never
 * was — see stallMs.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function isAnthropic(model: string): boolean {
  return /^(claude|anthropic)/i.test(model.trim());
}

export type Usage = { inputTokens: number; outputTokens: number };

type GenResult = { text: string; truncated: boolean; usage: Usage };

/** Called on every chunk, so the caller can reset its stall timer. */
type OnChunk = () => void;

export const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export function anthropicHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
  };
}

/* -------------------------------------------------------------------------
 * Anthropic
 * ---------------------------------------------------------------------- */

/**
 * How much output a model will accept differs by model and changes over time.
 *
 * Asking for more than the maximum is rejected outright with a 400 — the run
 * dies in seconds having produced nothing, for a number that was only ever
 * meant as headroom. The API names the real limit in that message, so the
 * honest response is to take it and go again rather than to hard-code a
 * ceiling here that will be wrong after the next model.
 */
function allowedMaxTokens(detail: string): number | null {
  const match = detail.match(/max_tokens:\s*\d+\s*>\s*(\d+)/i);
  const allowed = match ? Number.parseInt(match[1], 10) : NaN;

  return Number.isFinite(allowed) && allowed > 0 ? allowed : null;
}

async function anthropicGenerate(
  model: string,
  system: string,
  input: string,
  maxTokens: number,
  signal?: AbortSignal,
  onChunk?: OnChunk,
  retried = false
): Promise<GenResult> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: anthropicHeaders(),
    signal,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      stream: true,
      messages: [{ role: "user", content: input }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");

    if (res.status === 400 && !retried) {
      const allowed = allowedMaxTokens(detail);

      if (allowed && allowed < maxTokens) {
        console.warn(
          `[ai] ${model} caps output at ${allowed}; asked for ${maxTokens}. Retrying at the cap.`
        );

        return anthropicGenerate(model, system, input, allowed, signal, onChunk, true);
      }
    }

    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  if (!res.body) {
    throw new Error("Anthropic API returned no response body.");
  }

  let text = "";
  let stopReason = "";
  let finished = false;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  await readServerSentEvents(res.body, signal, onChunk, (event) => {
    const type = String(event.type ?? "");

    if (type === "error") {
      const error = (event.error ?? {}) as { type?: string; message?: string };
      throw new Error(
        `Anthropic stream error: ${error.type ?? "unknown"} ${error.message ?? ""}`.trim()
      );
    }

    if (type === "message_start") {
      const message = (event.message ?? {}) as { usage?: { input_tokens?: number } };
      usage.inputTokens = message.usage?.input_tokens ?? 0;
      return;
    }

    if (type === "content_block_delta") {
      const delta = (event.delta ?? {}) as { type?: string; text?: string };
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        text += delta.text;
      }
      return;
    }

    if (type === "message_delta") {
      const delta = (event.delta ?? {}) as { stop_reason?: string };
      const counted = (event.usage ?? {}) as { output_tokens?: number };

      if (delta.stop_reason) stopReason = delta.stop_reason;
      if (typeof counted.output_tokens === "number") usage.outputTokens = counted.output_tokens;
      return;
    }

    if (type === "message_stop") {
      finished = true;
    }
  });

  // A stream that ends without its closing event was cut off mid-sentence. The
  // text so far looks like a real answer and is not one — half a homepage would
  // pass straight into the splitter and fail there, confusingly. Say what
  // happened here instead.
  if (!finished && !stopReason) {
    throw new Error(
      `The connection to the model closed after ${text.length} characters, before the response was complete.`
    );
  }

  return { text, truncated: stopReason === "max_tokens", usage };
}

/**
 * Read an SSE body, handing each parsed event to the caller.
 *
 * Exported for its tests. Chunk boundaries fall wherever the network puts them
 * — mid-event, mid-JSON, mid-character — and every one of those is a way to
 * lose text without raising anything.
 *
 * Events are separated by a blank line and a single event may carry several
 * `data:` lines; splitting on anything less than that loses deltas at chunk
 * boundaries, which shows up as text with holes in it rather than as an error.
 */
export async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onChunk: OnChunk | undefined,
  handle: (event: Record<string, unknown>) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      onChunk?.();
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf("\n\n");

      while (split !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            handle(JSON.parse(payload) as Record<string, unknown>);
          } catch (parseError) {
            // A malformed frame is worth knowing about but not worth losing a
            // finished generation over.
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }

        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releasing matters on the abort path: without it the connection is held
    // until garbage collection, and a killed generation keeps a socket open.
    reader.releaseLock();

    if (signal?.aborted) {
      await body.cancel().catch(() => {});
    }
  }
}

/* -------------------------------------------------------------------------
 * OpenAI
 * ---------------------------------------------------------------------- */

async function openaiGenerate(
  model: string,
  system: string,
  input: string,
  maxTokens: number,
  signal?: AbortSignal,
  onChunk?: OnChunk
): Promise<GenResult> {
  // Streamed for the same reason as Anthropic: the SDK is fetch underneath, so
  // it inherits the same idle timeout on a long single response.
  const stream = await openai.responses.create(
    {
      model,
      instructions: system,
      input,
      max_output_tokens: maxTokens,
      stream: true,
    },
    { signal }
  );

  let text = "";
  let truncated = false;
  let finished = false;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  for await (const event of stream) {
    onChunk?.();

    const type = (event as { type?: string }).type ?? "";

    if (type === "response.output_text.delta") {
      const delta = (event as { delta?: unknown }).delta;
      if (typeof delta === "string") text += delta;
      continue;
    }

    if (type === "response.completed" || type === "response.incomplete") {
      const response = (event as { response?: Record<string, unknown> }).response ?? {};
      const counted = (response.usage ?? {}) as {
        input_tokens?: number;
        output_tokens?: number;
      };
      const incomplete = (response.incomplete_details ?? {}) as { reason?: string };

      usage.inputTokens = counted.input_tokens ?? 0;
      usage.outputTokens = counted.output_tokens ?? 0;

      truncated =
        response.status === "incomplete" &&
        (incomplete.reason === "max_output_tokens" || !incomplete.reason);

      finished = true;
      continue;
    }

    if (type === "error") {
      const message = (event as { message?: unknown }).message;
      throw new Error(`OpenAI stream error: ${String(message ?? "unknown")}`);
    }
  }

  if (!finished) {
    throw new Error(
      `The connection to the model closed after ${text.length} characters, before the response was complete.`
    );
  }

  return { text, truncated, usage };
}

/* -------------------------------------------------------------------------
 * The one entry point
 * ---------------------------------------------------------------------- */

export async function generateText(opts: {
  model: string;
  system: string;
  input: string;
  maxTokens?: number;
  /**
   * Give up after this long in total.
   *
   * Without it a model call cannot be interrupted at all: it holds the process
   * until it answers, and if that is longer than the platform allows, the
   * function is killed mid-call — no error, no catch block, no row written, and
   * a job left running forever. A deadline turns that silent death into an
   * ordinary thrown error the caller can handle and refund.
   */
  timeoutMs?: number;
  /**
   * Give up after this long with no bytes at all. Defaults to two minutes.
   *
   * The overall deadline is necessarily generous — a homepage legitimately
   * takes minutes — so on its own it cannot tell a working generation from a
   * dead connection. Silence can, now that the response arrives continuously.
   */
  stallMs?: number;
}): Promise<GenResult> {
  const maxTokens = opts.maxTokens ?? 16000;
  const stallMs = opts.stallMs ?? 120_000;
  const started = Date.now();

  const controller = new AbortController();
  let reason: "deadline" | "stall" | null = null;

  const deadline = opts.timeoutMs
    ? setTimeout(() => {
        reason = "deadline";
        controller.abort();
      }, opts.timeoutMs)
    : null;

  let stall: ReturnType<typeof setTimeout> | null = null;

  const armStall = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => {
      reason = "stall";
      controller.abort();
    }, stallMs);
  };

  armStall();

  try {
    const result = isAnthropic(opts.model)
      ? await anthropicGenerate(
          opts.model,
          opts.system,
          opts.input,
          maxTokens,
          controller.signal,
          armStall
        )
      : await openaiGenerate(
          opts.model,
          opts.system,
          opts.input,
          maxTokens,
          controller.signal,
          armStall
        );

    console.log(
      `[ai] generate model=${opts.model} in=${result.usage.inputTokens} ` +
        `out=${result.usage.outputTokens} chars=${result.text.length} ` +
        `ms=${Date.now() - started} truncated=${result.truncated}`
    );

    return result;
  } catch (error) {
    const ms = Date.now() - started;

    if (reason) {
      console.error(`[ai] generate model=${opts.model} ABORTED (${reason}) after ${ms}ms`);

      throw new Error(
        reason === "stall"
          ? `The model sent nothing for ${Math.round(stallMs / 1000)}s and the connection was dropped.`
          : `The model did not finish within ${Math.round((opts.timeoutMs ?? 0) / 1000)}s.`
      );
    }

    console.error(`[ai] generate model=${opts.model} FAILED after ${ms}ms:`, error);

    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (stall) clearTimeout(stall);
  }
}
