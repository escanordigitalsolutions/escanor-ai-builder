/**
 * The art direction: a design decision in a shape code can check.
 *
 * The old concept step was told, in its own prompt, not to prescribe colours,
 * fonts, sections or layout — so it returned adjectives, and the designer was
 * then told the concept was "inspiration, not a specification". We paid for a
 * direction and instructed the model to ignore it.
 *
 * This module is the other half of the fix. The direction now commits to exact
 * values, and those values become CSS custom properties that the designer must
 * paste verbatim. That single move turns "did it follow the brief?" — a
 * question only a human could answer — into string comparison.
 *
 * Everything here is defensive. A model returning slightly wrong JSON must
 * degrade to a usable direction rather than failing the whole generation, so
 * every field is normalised and only a genuinely unusable object returns null.
 */

export type DesignShape = "editorial" | "immersive" | "systematic" | "expressive";

/**
 * The four shapes are STRUCTURES, not adjectives. "Bold" and "minimal" name a
 * mood every model already averages into the same page; these name different
 * arrangements of the page itself, which is a thing a design can actually be.
 */
export const SHAPES: Record<DesignShape, string> = {
  editorial:
    "type-led, asymmetric, few or no photographs, generous margins, the page reads like a printed spread",
  immersive:
    "image-led, full-bleed, large scale, text sitting over and against imagery",
  systematic:
    "the grid is visible and deliberate, information-forward, dense, precise",
  expressive:
    "CSS-led decoration — shapes, colour and type doing the work photographs usually do",
};

/** Old wizard values, so a plugin that has not been updated keeps working. */
const SHAPE_ALIASES: Record<string, DesignShape> = {
  concept: "expressive",
  minimal: "editorial",
  bold: "immersive",
  business: "systematic",
};

export function resolveShape(value: unknown): DesignShape {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw in SHAPES) return raw as DesignShape;
  if (raw in SHAPE_ALIASES) return SHAPE_ALIASES[raw];
  return "editorial";
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type DesignTokens = {
  color: Record<string, string>;
  font: { display: string; text: string; mono?: string };
  size: string[];
  space: string[];
  radius: string[];
  motion: { duration: string; easing: string };
};

/** The colour roles a page needs. A palette is roles, not a pile of swatches. */
export const COLOR_ROLES = [
  "ground",
  "surface",
  "ink",
  "ink-2",
  "muted",
  "line",
  "accent",
  "accent-ink",
] as const;

const FALLBACK_TOKENS: DesignTokens = {
  color: {
    ground: "#ffffff",
    surface: "#f6f6f7",
    ink: "#121316",
    "ink-2": "#3c3f47",
    muted: "#6b6f7a",
    line: "#e2e4e9",
    accent: "#1c4fd8",
    "accent-ink": "#ffffff",
  },
  font: { display: "Fraunces", text: "Karla" },
  size: [
    "0.82rem",
    "0.95rem",
    "1.05rem",
    "1.35rem",
    "clamp(1.6rem, 3vw, 2.1rem)",
    "clamp(2.2rem, 5vw, 3.4rem)",
    "clamp(3rem, 9vw, 6.5rem)",
  ],
  space: ["4px", "8px", "16px", "24px", "40px", "72px", "120px"],
  radius: ["0px", "4px", "14px"],
  motion: { duration: "240ms", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * One canonical form for every colour.
 *
 * Shorthand is expanded on the way in rather than tolerated everywhere after:
 * these values are compared against generated CSS, written into it, and fed to
 * a contrast calculation, and three spellings of white would mean three places
 * that each have to remember to handle it.
 */
function hex(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!HEX.test(raw)) return fallback;

  return raw.length === 4
    ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
    : raw;
}

function str(value: unknown, fallback = "", max = 600): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : fallback;
}

function strList(value: unknown, max: number, itemMax = 300): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim().slice(0, itemMax) : ""))
    .filter(Boolean)
    .slice(0, max);
}

/** A scale must have the exact number of steps the CSS names, or it is unusable. */
function scale(value: unknown, want: number, fallback: string[]): string[] {
  const list = strList(value, want, 60);
  if (list.length === want) return list;
  // Partial scales are padded from the fallback rather than rejected: a model
  // that returned 6 of 7 sizes still made 6 real decisions worth keeping.
  return Array.from({ length: want }, (_, i) => list[i] ?? fallback[i]);
}

export function normalizeTokens(value: unknown): DesignTokens {
  const raw = (value ?? {}) as Record<string, unknown>;
  const color = (raw.color ?? {}) as Record<string, unknown>;
  const font = (raw.font ?? {}) as Record<string, unknown>;
  const motion = (raw.motion ?? {}) as Record<string, unknown>;

  const out: DesignTokens = {
    color: {},
    font: {
      display: str(font.display, FALLBACK_TOKENS.font.display, 60),
      text: str(font.text, FALLBACK_TOKENS.font.text, 60),
    },
    size: scale(raw.size, 7, FALLBACK_TOKENS.size),
    space: scale(raw.space, 7, FALLBACK_TOKENS.space),
    radius: scale(raw.radius, 3, FALLBACK_TOKENS.radius),
    motion: {
      duration: str(motion.duration, FALLBACK_TOKENS.motion.duration, 24),
      easing: str(motion.easing, FALLBACK_TOKENS.motion.easing, 80),
    },
  };

  for (const role of COLOR_ROLES) {
    out.color[role] = hex(color[role], FALLBACK_TOKENS.color[role]);
  }

  const mono = str(font.mono, "", 60);
  if (mono) out.font.mono = mono;

  return out;
}

/**
 * The tokens as the CSS the designer must paste.
 *
 * Handing over finished CSS rather than asking the model to translate JSON into
 * custom properties removes the whole class of transcription error — and makes
 * the validator's job exact, because it is comparing against a string we wrote.
 */
export function serialiseTokens(tokens: DesignTokens): string {
  const lines: string[] = [":root {"];

  for (const role of COLOR_ROLES) {
    lines.push(`  --color-${role}: ${tokens.color[role]};`);
  }

  lines.push(`  --font-display: "${tokens.font.display}";`);
  lines.push(`  --font-text: "${tokens.font.text}";`);
  if (tokens.font.mono) lines.push(`  --font-mono: "${tokens.font.mono}";`);

  tokens.size.forEach((v, i) => lines.push(`  --size-${i}: ${v};`));
  tokens.space.forEach((v, i) => lines.push(`  --space-${i}: ${v};`));
  tokens.radius.forEach((v, i) => lines.push(`  --radius-${i}: ${v};`));

  lines.push(`  --motion-duration: ${tokens.motion.duration};`);
  lines.push(`  --motion-easing: ${tokens.motion.easing};`);
  lines.push("}");

  return lines.join("\n");
}

/** Read the custom properties back out of a generated stylesheet. */
export function readRootTokens(css: string): Record<string, string> {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/i);
  if (!block) return {};

  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrast, fixed by arithmetic rather than by asking again
// ---------------------------------------------------------------------------

/** WCAG relative luminance. */
export function luminance(hexColor: string): number {
  const h = hexColor.replace("#", "");
  const full =
    h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h.padEnd(6, "0").slice(0, 6);

  const channel = (pair: string): number => {
    const c = Number.parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(full.slice(0, 2)) +
    0.7152 * channel(full.slice(2, 4)) +
    0.0722 * channel(full.slice(4, 6))
  );
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function toRgb(hexColor: string): [number, number, number] {
  const h = hexColor.replace("#", "");
  const full =
    h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Move a colour toward black or white by a fraction, keeping its hue. */
function shift(hexColor: string, towardWhite: boolean, amount: number): string {
  const [r, g, b] = toRgb(hexColor);
  const target = towardWhite ? 255 : 0;
  return toHex([
    r + (target - r) * amount,
    g + (target - g) * amount,
    b + (target - b) * amount,
  ]);
}

/**
 * Bring a foreground colour up to a contrast ratio against its background.
 *
 * An art director asked to fix a failing ratio would guess, cost money, and
 * might guess wrong. Arithmetic cannot. The hue is preserved — only the
 * lightness moves — so the direction's palette survives the correction.
 * Returns the original when it already passes.
 */
export function ensureContrast(
  foreground: string,
  background: string,
  target = 4.5
): string {
  if (contrastRatio(foreground, background) >= target) return foreground;

  // Move away from the background: darken on a light ground, lighten on a dark one.
  const towardWhite = luminance(background) < 0.18;

  for (let step = 1; step <= 20; step += 1) {
    const candidate = shift(foreground, towardWhite, step / 20);
    if (contrastRatio(candidate, background) >= target) return candidate;
  }

  return towardWhite ? "#ffffff" : "#000000";
}

/**
 * Apply the readability floor to a whole palette.
 *
 * Body text and secondary text get the full 4.5:1. Muted text is held to 3.0:1
 * — it is used for labels and captions at larger or bolder sizes, and forcing
 * it to 4.5 would collapse the difference between it and the body colour,
 * destroying a hierarchy the direction chose on purpose.
 */
export function enforceReadability(tokens: DesignTokens): DesignTokens {
  const ground = tokens.color.ground;

  tokens.color.ink = ensureContrast(tokens.color.ink, ground, 4.5);
  tokens.color["ink-2"] = ensureContrast(tokens.color["ink-2"], ground, 4.5);
  tokens.color.muted = ensureContrast(tokens.color.muted, ground, 3);
  tokens.color["accent-ink"] = ensureContrast(
    tokens.color["accent-ink"],
    tokens.color.accent,
    4.5
  );

  return tokens;
}

// ---------------------------------------------------------------------------
// The direction itself
// ---------------------------------------------------------------------------

/**
 * A logo, in the only form we can honestly produce.
 *
 * There is no image model in this pipeline, so a brand mark has to be drawable:
 * a typographic wordmark and a geometric monogram in inline SVG. That is not a
 * consolation prize — a mark cut from the same geometry as the page's signature
 * move belongs to the design in a way a stock icon never does.
 */
export type BrandMark = {
  /** How the name is set: face, weight, tracking, case, any cut or ligature. */
  wordmark: string;
  /** What the mark is, in one line, so a person can judge it without reading SVG. */
  monogram: string;
  /** The mark itself. Sanitised: see sanitiseSvg. */
  markSvg: string;
};

/**
 * A second and third palette for the same design.
 *
 * Nearly free, and the reason it is free is the token architecture: the
 * validator makes every rule below :root go through a custom property, so
 * replacing the eight colour values re-skins the entire page with no model call
 * at all. One generation, three looks to choose between.
 */
export type Colorway = {
  name: string;
  color: Record<string, string>;
};

/**
 * Make model-authored SVG safe to put on someone else's website.
 *
 * This markup is written by a language model and ends up inline in a WordPress
 * theme, so it is untrusted by definition. Scripts, event handlers, external
 * references and foreignObject are removed rather than escaped — a logo needs
 * none of them, and anything that survives here runs on a real customer's site.
 */
export function sanitiseSvg(value: unknown, maxLength = 4000): string {
  let svg = typeof value === "string" ? value.trim() : "";

  if (!svg || !/^<svg[\s>]/i.test(svg)) return "";

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(image|use|iframe|object|embed|link|style)\b[^>]*>/gi, "")
    // on*= handlers, in either quote style or unquoted
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // javascript: and data: urls in href/xlink:href/src
    .replace(/\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match) =>
      /^\s*(?:xlink:)?href\s*=\s*["']?#/i.test(match) ? match : ""
    );

  if (!/<\/svg>\s*$/i.test(svg)) return "";

  return svg.length > maxLength ? "" : svg;
}

export type SectionPlan = { slug: string; job: string; shape: string };

export type ArtDirection = {
  concept: { name: string; thesis: string; rootedIn: string };
  signatureMove: string;
  tokens: DesignTokens;
  typography: {
    display: { family: string; url: string; weights: number[] };
    text: { family: string; url: string; weights: number[] };
    pairing: string;
  };
  palette: { rationale: string; unusualChoice: string };
  layout: { grid: string; rhythm: string; sections: SectionPlan[] };
  imagery: {
    strategy: "photography" | "typographic" | "css-illustration" | "mixed";
    treatment: string;
    queries: string[];
  };
  motion: string;
  voice: { tone: string; sample: { h1: string; sub: string; cta: string } };
  avoid: string[];
  brand: BrandMark;
  colorways: Colorway[];
};

const STRATEGIES = ["photography", "typographic", "css-illustration", "mixed"] as const;

const GOOGLE_FONTS = /^https:\/\/fonts\.googleapis\.com\/css2\?/i;

function fontFace(
  value: unknown,
  family: string
): { family: string; url: string; weights: number[] } {
  const raw = (value ?? {}) as Record<string, unknown>;
  const url = str(raw.url, "", 400);

  const weights = Array.isArray(raw.weights)
    ? raw.weights
        .map((w) => (typeof w === "number" ? Math.round(w) : Number.parseInt(String(w), 10)))
        .filter((w) => Number.isFinite(w) && w >= 100 && w <= 900)
        .slice(0, 4)
    : [];

  return {
    family: str(raw.family, family, 60),
    // A url from anywhere but Google Fonts would silently fail to load behind
    // the page's CSP, so a wrong one is dropped and rebuilt from the family.
    url: GOOGLE_FONTS.test(url) ? url : googleFontUrl(family, weights),
    weights: weights.length ? weights : [400, 600],
  };
}

/** Build a Google Fonts url when the model gave a family but no usable link. */
export function googleFontUrl(family: string, weights: number[] = [400, 600]): string {
  const name = family.trim().replace(/\s+/g, "+");
  const list = (weights.length ? weights : [400, 600]).sort((a, b) => a - b).join(";");
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${list}&display=swap`;
}

function sectionPlans(value: unknown): SectionPlan[] {
  if (!Array.isArray(value)) return [];

  const out: SectionPlan[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const row = item as Record<string, unknown>;
    const slug = str(row.slug, "", 40)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug || seen.has(slug)) continue;

    seen.add(slug);
    out.push({
      slug,
      job: str(row.job, "", 200),
      shape: str(row.shape, "", 300),
    });

    if (out.length >= 7) break;
  }

  return out;
}

/** Pull the first JSON object out of a model reply, fences and prose included. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  let t = (text || "").trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(t.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Turn a model reply into a direction, or null if there is nothing to work with.
 *
 * "Nothing to work with" is deliberately narrow: only a missing concept name.
 * Every other gap is filled, because a direction with six good decisions and
 * one default is still enormously better than the adjectives it replaces.
 */
export function parseArtDirection(text: string): ArtDirection | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;

  const concept = (raw.concept ?? {}) as Record<string, unknown>;
  const name = str(concept.name, "", 60);
  if (!name) return null;

  const tokens = enforceReadability(normalizeTokens(raw.tokens));
  const typography = (raw.typography ?? {}) as Record<string, unknown>;
  const display = fontFace(typography.display, tokens.font.display);
  const text_ = fontFace(typography.text, tokens.font.text);

  // The token block is what the designer pastes, so the families named there
  // must be the families that actually get linked.
  tokens.font.display = display.family;
  tokens.font.text = text_.family;

  const palette = (raw.palette ?? {}) as Record<string, unknown>;
  const layout = (raw.layout ?? {}) as Record<string, unknown>;
  const imagery = (raw.imagery ?? {}) as Record<string, unknown>;
  const voice = (raw.voice ?? {}) as Record<string, unknown>;
  const sample = (voice.sample ?? {}) as Record<string, unknown>;

  const strategy = str(imagery.strategy, "mixed", 30).toLowerCase();

  return {
    concept: {
      name,
      thesis: str(concept.thesis, "", 300),
      rootedIn: str(concept.rootedIn, "", 300),
    },
    signatureMove: str(raw.signatureMove, "", 600),
    tokens,
    typography: {
      display,
      text: text_,
      pairing: str(typography.pairing, "", 300),
    },
    palette: {
      rationale: str(palette.rationale, "", 300),
      unusualChoice: str(palette.unusualChoice, "", 300),
    },
    layout: {
      grid: str(layout.grid, "", 300),
      rhythm: str(layout.rhythm, "", 300),
      sections: sectionPlans(layout.sections),
    },
    imagery: {
      strategy: (STRATEGIES as readonly string[]).includes(strategy)
        ? (strategy as ArtDirection["imagery"]["strategy"])
        : "mixed",
      treatment: str(imagery.treatment, "", 300),
      queries: strList(imagery.queries, 3, 60),
    },
    motion: str(raw.motion, "", 400),
    brand: brandMark(raw.brand),
    colorways: colorways(raw.colorways, tokens),
    voice: {
      tone: str(voice.tone, "", 200),
      sample: {
        h1: str(sample.h1, "", 200),
        sub: str(sample.sub, "", 300),
        cta: str(sample.cta, "", 60),
      },
    },
    avoid: strList(raw.avoid, 8, 200),
  };
}

function brandMark(value: unknown): BrandMark {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    wordmark: str(raw.wordmark, "", 300),
    monogram: str(raw.monogram, "", 300),
    markSvg: sanitiseSvg(raw.markSvg),
  };
}

/**
 * Alternative palettes, held to the same readability floor as the first.
 *
 * A colourway that fails contrast is not a choice, it is a broken page — and
 * since the person switching between them will never check, the check happens
 * here.
 */
function colorways(value: unknown, base: DesignTokens): Colorway[] {
  if (!Array.isArray(value)) return [];

  const out: Colorway[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const row = item as Record<string, unknown>;
    const name = str(row.name, "", 40);
    const source = (row.color ?? {}) as Record<string, unknown>;

    if (!name) continue;

    const color: Record<string, string> = {};

    for (const role of COLOR_ROLES) {
      color[role] = hex(source[role], base.color[role]);
    }

    // Identical to the base palette is not an alternative.
    const same = COLOR_ROLES.every((role) => color[role] === base.color[role]);
    if (same) continue;

    const checked = enforceReadability({ ...base, color });

    out.push({ name, color: checked.color });

    if (out.length >= 2) break;
  }

  return out;
}
