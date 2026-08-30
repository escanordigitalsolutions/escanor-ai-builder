import { describe, it, expect } from "vitest";

import { readServerSentEvents } from "@/lib/ai/provider";
import { describeError } from "@/lib/debug";

/**
 * The streaming parser, and the error reporting that failed to explain why
 * streaming was needed in the first place.
 *
 * Both exist because of one incident: every long generation died at almost
 * exactly 300 seconds with a stored error reading "fetch failed". The cause was
 * undici's default body timeout on a non-streamed response — a name that was
 * present in `error.cause` and thrown away before anything recorded it.
 *
 * Chunk boundaries are where a stream parser goes wrong, and it goes wrong
 * quietly: text with holes in it rather than an exception. So the boundaries
 * are tested at every size down to a single byte.
 */

type Delta = { type: string; delta?: { type?: string; text?: string } };

function streamOf(body: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body);
  let cursor = 0;

  return new ReadableStream({
    pull(controller) {
      if (cursor >= bytes.length) {
        controller.close();
        return;
      }

      controller.enqueue(bytes.slice(cursor, cursor + chunkSize));
      cursor += chunkSize;
    },
  });
}

// Lithuanian and typographic characters on purpose: they are multi-byte, so a
// split inside one is a real possibility rather than a theoretical one.
const EXPECTED = '<!DOCTYPE html>Sveiki — kepėjas “ąčęėįšųū”</html>';

const BODY =
  [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1234}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0}',
    'event: ping\ndata: {"type":"ping"}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<!DOCTYPE html>"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Sveiki — kepėjas “ąčęėįšųū”"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"</html>"}}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4321}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ].join("\n\n") + "\n\n";

async function collect(chunkSize: number) {
  let text = "";
  let stop = "";
  let input = 0;
  let output = 0;
  let chunks = 0;

  await readServerSentEvents(
    streamOf(BODY, chunkSize),
    undefined,
    () => {
      chunks += 1;
    },
    (event) => {
      const e = event as Delta & {
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        delta?: { stop_reason?: string; type?: string; text?: string };
      };

      if (e.type === "message_start") input = e.message?.usage?.input_tokens ?? 0;

      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        text += e.delta.text ?? "";
      }

      if (e.type === "message_delta") {
        stop = e.delta?.stop_reason ?? "";
        output = e.usage?.output_tokens ?? 0;
      }
    }
  );

  return { text, stop, input, output, chunks };
}

describe("readServerSentEvents", () => {
  it("reads a whole body arriving at once", async () => {
    const result = await collect(1_000_000);

    expect(result.text).toBe(EXPECTED);
    expect(result.input).toBe(1234);
    expect(result.output).toBe(4321);
    expect(result.stop).toBe("end_turn");
  });

  it.each([1, 2, 3, 7, 13, 64, 257])(
    "produces identical text when the body arrives in %i-byte chunks",
    async (size) => {
      const result = await collect(size);
      expect(result.text).toBe(EXPECTED);
    }
  );

  it("keeps multi-byte characters whole across a one-byte split", async () => {
    const result = await collect(1);

    expect(result.text).toBe(EXPECTED);
    expect(result.text).toContain("kepėjas");
    expect(result.chunks).toBeGreaterThan(50);
  });

  it("skips a malformed frame without losing the rest", async () => {
    const broken =
      'event: a\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"before"}}\n\n' +
      "event: b\ndata: {not json at all\n\n" +
      'event: c\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"after"}}\n\n';

    let text = "";

    await readServerSentEvents(streamOf(broken, 5), undefined, undefined, (event) => {
      const e = event as Delta;
      if (e.type === "content_block_delta") text += e.delta?.text ?? "";
    });

    expect(text).toBe("beforeafter");
  });

  it("lets the handler stop the read by throwing", async () => {
    const body =
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n';

    await expect(
      readServerSentEvents(streamOf(body, 4), undefined, undefined, (event) => {
        const e = event as { type: string; error?: { type?: string } };
        if (e.type === "error") throw new Error(`Anthropic stream error: ${e.error?.type}`);
      })
    ).rejects.toThrow(/overloaded_error/);
  });

  it("ignores the [DONE] sentinel", async () => {
    let seen = 0;

    await readServerSentEvents(
      streamOf("data: [DONE]\n\n", 3),
      undefined,
      undefined,
      () => {
        seen += 1;
      }
    );

    expect(seen).toBe(0);
  });
});

describe("describeError", () => {
  it("walks the cause chain instead of stopping at the surface", () => {
    const inner = Object.assign(new Error("Body Timeout Error"), {
      code: "UND_ERR_BODY_TIMEOUT",
    });
    const outer = new TypeError("fetch failed", { cause: inner });

    const described = describeError(outer);

    // The whole point: "fetch failed" alone explained nothing for an hour.
    expect(described).toContain("fetch failed");
    expect(described).toContain("UND_ERR_BODY_TIMEOUT");
  });

  it("includes transport codes when there is no message worth reading", () => {
    const error = Object.assign(new Error(""), { code: "ECONNRESET", syscall: "read" });

    expect(describeError(error)).toContain("ECONNRESET");
    expect(describeError(error)).toContain("read");
  });

  it("stops rather than following a cycle forever", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;

    expect(() => describeError(a)).not.toThrow();
  });

  it("handles values that are not errors at all", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError({ nope: 1 })).toContain("nope");
    expect(describeError(undefined)).toBeTypeOf("string");
  });
});
