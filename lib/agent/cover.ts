import type { ArtDirection } from "./art-direction";

/**
 * The design's cover: a painted moodboard of its vibe, not a picture of it.
 *
 * The thumbnail answers "what does this page look like" and has to be a
 * truthful screenshot. The cover answers a different question — "what does this
 * design feel like" — and for that an image model is the right tool, because
 * the answer is atmosphere, not layout. It hangs on the Wizard's library cards
 * the way album art hangs on a record: identification by mood.
 *
 * Non-fatal end to end, like the thumbnail: a design without a cover is a
 * design, and every reader falls back to the screenshot or to nothing.
 */

export type Cover = {
  /** base64 PNG/WebP as returned by the model, no data: prefix. */
  image: string;
  mime: string;
  version: number;
};

const COVER_MODEL = process.env.MODEL_COVER?.trim() || "gpt-image-1";

/** What the painter is told. Colours as hex, mood as words, no UI. */
export function coverPrompt(direction: ArtDirection, brandName: string): string {
  const c = direction.tokens.color;
  const palette = [c.ground, c.surface, c.ink, c.accent].filter(Boolean).join(", ");

  return (
    `An abstract editorial moodboard painting for a brand called "${brandName}". ` +
    `Concept: ${direction.concept.name} — ${direction.concept.thesis} ` +
    `Palette, used faithfully: ${palette}. ` +
    `Typography mood: ${direction.typography.pairing || direction.tokens.font.display}. ` +
    `Overall feel: ${direction.voice.tone || "confident, considered"}. ` +
    `Layered paper textures, colour fields, a few large abstract shapes echoing this structure: ${direction.signatureMove || "a strong vertical rhythm"}. ` +
    `No text, no letters, no words, no logos, no user interface, no screenshots, no devices. ` +
    `Flat, printable, gallery-quality composition.`
  );
}

/**
 * Paint the cover. Uses the OpenAI images API on the key the text tiers
 * already run on — no new credential. Returns null on any failure.
 */
export async function renderCover(
  direction: ArtDirection | null,
  brandName: string,
  timeoutMs = 90_000
): Promise<Cover | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!direction || !apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COVER_MODEL,
        prompt: coverPrompt(direction, brandName),
        n: 1,
        size: "1536x1024",
        quality: "medium",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`cover generation refused: ${response.status} ${await response.text().then((t) => t.slice(0, 200))}`);
      return null;
    }

    const data = (await response.json()) as {
      data?: { b64_json?: string }[];
    };
    const image = data.data?.[0]?.b64_json;

    if (!image) return null;

    return { image, mime: "image/png", version: Date.now() };
  } catch (error) {
    console.error("cover generation failed (design keeps no cover):", error);
    return null;
  }
}
