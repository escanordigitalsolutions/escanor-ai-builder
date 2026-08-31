import { generateText } from "@/lib/ai/provider";
import { pickModel } from "@/lib/ai/resolve";

/**
 * What a conversation is holding on to.
 *
 * The chat replays recent messages, which works until it does not: past the
 * replay window the model forgets that the brand colour was decided four turns
 * ago, or that the footer is not to be touched. This is the small set of
 * standing facts that outlives the window — and, because it is shown in the
 * editor as chips, the person can see exactly what the AI still believes.
 *
 * Deliberately short. A memory that accumulates everything is a transcript with
 * extra steps, and it stops being something anybody reads.
 */

export const MEMORY_MAX_ITEMS = 8;
export const MEMORY_MAX_CHARS = 120;

const INSTRUCTIONS = `You keep the short memory of one conversation between a website owner and an AI that edits their WordPress theme.

You are given the memory so far and the newest exchange. Return the updated memory.

What belongs in it:
- decisions the person made ("the accent is #3d64f2", "keep the footer as it is")
- what they are working on ("rewriting the pricing page")
- standing preferences ("shorter headlines", "no stock photos")
- constraints they stated ("must work on mobile first")

What does not:
- anything the AI said about itself, or what it did
- one-off questions already answered
- pleasantries, and anything that will not matter in ten minutes

Rules:
- At most ${MEMORY_MAX_ITEMS} items, newest and most important first. If a new item arrives and the list is full, drop the least useful one.
- Each item is one short phrase under ${MEMORY_MAX_CHARS} characters, in the person's own words where possible, and in their language.
- A later decision REPLACES an earlier one about the same thing rather than sitting beside it.
- If the exchange added nothing worth keeping, return the memory unchanged.

Reply with ONLY a JSON array of strings. Nothing else.`;

export function parseMemory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;

    const text = item.trim().slice(0, MEMORY_MAX_CHARS);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    out.push(text);

    if (out.length >= MEMORY_MAX_ITEMS) break;
  }

  return out;
}

/** The memory as the model reads it at the top of a turn. */
export function memoryBlock(memory: string[]): string {
  if (memory.length === 0) return "";

  return (
    `\n\nWHAT THIS CONVERSATION HAS ESTABLISHED (carry it; do not ask again):\n` +
    memory.map((item) => `- ${item}`).join("\n")
  );
}

export async function updateMemory(options: {
  modelConfig: unknown;
  memory: string[];
  message: string;
  answer: string;
}): Promise<string[]> {
  const { modelConfig, memory, message, answer } = options;

  try {
    const out = await generateText({
      model: pickModel(modelConfig, "cheap"),
      system: INSTRUCTIONS,
      maxTokens: 700,
      timeoutMs: 30_000,
      input:
        `MEMORY SO FAR\n${JSON.stringify(memory)}\n\n` +
        `THEY SAID\n${message.slice(0, 1500)}\n\n` +
        `THE AI ANSWERED\n${answer.slice(0, 1500)}`,
    });

    const text = out.text.trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");

    if (start === -1 || end <= start) return memory;

    const parsed = parseMemory(JSON.parse(text.slice(start, end + 1)));

    // An empty result from a conversation that had memory is far more likely to
    // be a model that lost the plot than a person who retracted everything.
    return parsed.length === 0 && memory.length > 0 ? memory : parsed;
  } catch {
    // Memory is an improvement, not a dependency. A turn that could not update
    // it keeps the memory it had.
    return memory;
  }
}
