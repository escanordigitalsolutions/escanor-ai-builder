import { COLOR_ROLES, serialiseTokens, type ArtDirection } from "./art-direction";

/**
 * The brand sheet: a page the client keeps.
 *
 * Assembled in code, with no model call at all. Everything on it — the palette
 * and its roles, the typefaces, the scales, the mark, the alternative
 * colourways — was already decided by the art director; producing a document
 * from decisions already made is a rendering problem, not a generation one.
 *
 * That matters beyond cost. A page assembled deterministically cannot drift
 * from the design it documents: the swatches ARE the tokens the theme ships
 * with, not a model's recollection of them.
 */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A readable label for a token role. */
const ROLE_NOTE: Record<string, string> = {
  ground: "Page background",
  surface: "Cards and raised surfaces",
  ink: "Body text",
  "ink-2": "Secondary text",
  muted: "Labels and captions",
  line: "Rules and borders",
  accent: "The one accent",
  "accent-ink": "Text on the accent",
};

export function renderBrandSheet(direction: ArtDirection, brandName: string): string {
  const t = direction.tokens;
  const name = esc(brandName || direction.concept.name || "Brand");

  const swatches = COLOR_ROLES.map(
    (role) => `
      <div class="sw">
        <div class="chip" style="background:${t.color[role]}"></div>
        <div class="meta">
          <b>${esc(role)}</b>
          <code>${t.color[role]}</code>
          <span>${esc(ROLE_NOTE[role] ?? "")}</span>
        </div>
      </div>`
  ).join("");

  const ways = direction.colorways
    .map(
      (way) => `
      <div class="way">
        <h4>${esc(way.name)}</h4>
        <div class="ribbon">
          ${COLOR_ROLES.map(
            (role) =>
              `<span title="${esc(role)} ${way.color[role]}" style="background:${way.color[role]}"></span>`
          ).join("")}
        </div>
        <div class="proof" style="background:${way.color.ground};color:${way.color.ink};border-color:${way.color.line}">
          <span style="color:${way.color.muted}">${esc(direction.voice.tone || "Sample")}</span>
          <strong>${esc(direction.voice.sample.h1 || name)}</strong>
          <em style="background:${way.color.accent};color:${way.color["accent-ink"]}">${esc(
            direction.voice.sample.cta || "Get started"
          )}</em>
        </div>
      </div>`
    )
    .join("");

  const scale = t.size
    .map(
      (size, i) =>
        `<div class="row"><code>--size-${i}</code><span class="spec" style="font-size:${size}">${name}</span><code class="v">${esc(
          size
        )}</code></div>`
    )
    .reverse()
    .join("");

  const spacing = t.space
    .map(
      (space, i) =>
        `<div class="row"><code>--space-${i}</code><span class="bar" style="width:${space}"></span><code class="v">${esc(
          space
        )}</code></div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — brand sheet</title>
<link rel="stylesheet" href="${esc(direction.typography.display.url)}">
<link rel="stylesheet" href="${esc(direction.typography.text.url)}">
<style>
${serialiseTokens(t)}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--color-ground);
  color: var(--color-ink-2);
  font-family: var(--font-text), system-ui, sans-serif;
  font-size: var(--size-2);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1000px; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-6); }

h1, h2, h3, h4 { font-family: var(--font-display), serif; color: var(--color-ink); margin: 0; font-weight: 600; }
h1 { font-size: var(--size-5); line-height: 1.02; letter-spacing: -0.02em; }
h2 { font-size: var(--size-4); margin-bottom: var(--space-2); letter-spacing: -0.015em; }
h4 { font-size: var(--size-2); margin-bottom: var(--space-1); }

.eyebrow {
  font-family: var(--font-text), sans-serif;
  font-size: var(--size-0);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 var(--space-2);
}
p { margin: 0 0 var(--space-2); max-width: 62ch; }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.8em; color: var(--color-muted); }

section { padding-top: var(--space-5); }
.lede { color: var(--color-ink-2); max-width: 58ch; }

/* mark */
.lockup { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-3); }
.mark { width: 64px; height: 64px; color: var(--color-accent); flex: none; }
.mark svg { width: 100%; height: 100%; display: block; }
.wordmark { font-family: var(--font-display), serif; font-size: var(--size-5); color: var(--color-ink); line-height: 1; }
.on-dark { background: var(--color-ink); color: var(--color-ground); padding: var(--space-3); border-radius: var(--radius-1); }
.on-dark .wordmark { color: var(--color-ground); }
.on-dark .mark { color: var(--color-accent); }

/* palette */
.swatches { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.sw { display: flex; gap: var(--space-2); align-items: center; background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-1); padding: var(--space-2); }
.chip { width: 46px; height: 46px; border-radius: var(--radius-0); border: 1px solid var(--color-line); flex: none; }
.meta { display: flex; flex-direction: column; min-width: 0; }
.meta b { color: var(--color-ink); font-weight: 600; font-size: var(--size-1); }
.meta span { color: var(--color-muted); font-size: var(--size-0); }

/* colourways */
.ways { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.ribbon { display: flex; height: 26px; border-radius: var(--radius-0); overflow: hidden; border: 1px solid var(--color-line); }
.ribbon span { flex: 1; }
.proof { margin-top: var(--space-2); padding: var(--space-3); border: 1px solid; border-radius: var(--radius-1); display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.proof span { font-size: var(--size-0); text-transform: uppercase; letter-spacing: 0.1em; }
.proof strong { font-family: var(--font-display), serif; font-size: var(--size-3); font-weight: 600; }
.proof em { font-style: normal; font-size: var(--size-0); font-weight: 600; padding: 5px 10px; border-radius: var(--radius-1); }

/* scales */
.row { display: grid; grid-template-columns: 90px 1fr 90px; gap: var(--space-2); align-items: center; padding: var(--space-1) 0; border-top: 1px solid var(--color-line); }
.row .v { text-align: right; }
.spec { color: var(--color-ink); font-family: var(--font-display), serif; line-height: 1.05; overflow: hidden; white-space: nowrap; }
.bar { height: 12px; background: var(--color-accent); border-radius: var(--radius-0); display: block; }

.pair { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.card { background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-1); padding: var(--space-3); }
.card .sample-d { font-family: var(--font-display), serif; font-size: var(--size-4); color: var(--color-ink); line-height: 1.05; }
.card .sample-t { margin-top: var(--space-2); font-size: var(--size-2); }

footer { margin-top: var(--space-6); padding-top: var(--space-3); border-top: 1px solid var(--color-line); font-size: var(--size-0); color: var(--color-muted); }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <p class="eyebrow">Brand sheet</p>
    <h1>${name}</h1>
    <p class="lede" style="margin-top:var(--space-2)">
      <strong style="color:var(--color-ink)">${esc(direction.concept.name)}</strong> — ${esc(
        direction.concept.thesis
      )}
    </p>
    ${direction.concept.rootedIn ? `<p class="lede"><code>Rooted in: ${esc(direction.concept.rootedIn)}</code></p>` : ""}
  </header>

  <section>
    <h2>The mark</h2>
    ${direction.brand.wordmark ? `<p>${esc(direction.brand.wordmark)}</p>` : ""}
    ${direction.brand.monogram ? `<p><code>${esc(direction.brand.monogram)}</code></p>` : ""}
    <div class="lockup">
      ${direction.brand.markSvg ? `<div class="mark">${direction.brand.markSvg}</div>` : ""}
      <div class="wordmark">${name}</div>
    </div>
    <div class="lockup on-dark" style="margin-top:var(--space-3)">
      ${direction.brand.markSvg ? `<div class="mark">${direction.brand.markSvg}</div>` : ""}
      <div class="wordmark">${name}</div>
    </div>
  </section>

  <section>
    <h2>Palette</h2>
    <p>${esc(direction.palette.rationale)}</p>
    ${direction.palette.unusualChoice ? `<p><code>${esc(direction.palette.unusualChoice)}</code></p>` : ""}
    <div class="swatches">${swatches}</div>
  </section>

  ${
    direction.colorways.length
      ? `<section>
    <h2>Alternative colourways</h2>
    <p>The same design, argued three ways. Every rule in the stylesheet goes through the tokens, so switching is a change of eight values — not a new design.</p>
    <div class="ways">${ways}</div>
  </section>`
      : ""
  }

  <section>
    <h2>Typography</h2>
    <p>${esc(direction.typography.pairing)}</p>
    <div class="pair">
      <div class="card">
        <div class="eyebrow">Display — ${esc(direction.typography.display.family)}</div>
        <div class="sample-d">${name}</div>
        <div class="sample-d" style="font-size:var(--size-3)">Handgloves 0123</div>
      </div>
      <div class="card">
        <div class="eyebrow">Text — ${esc(direction.typography.text.family)}</div>
        <div class="sample-t">${esc(
          direction.voice.sample.sub ||
            "The quick brown fox jumps over the lazy dog, and keeps its counter shapes open at small sizes."
        )}</div>
      </div>
    </div>
    <div style="margin-top:var(--space-3)">${scale}</div>
  </section>

  <section>
    <h2>Space and shape</h2>
    <p>Grid: ${esc(direction.layout.grid)}</p>
    <p>Rhythm: ${esc(direction.layout.rhythm)}</p>
    ${spacing}
    <div class="lockup" style="margin-top:var(--space-3)">
      ${t.radius
        .map(
          (r) =>
            `<div style="width:72px;height:52px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:${r};display:flex;align-items:center;justify-content:center"><code>${esc(
              r
            )}</code></div>`
        )
        .join("")}
    </div>
  </section>

  <section>
    <h2>The signature move</h2>
    <p>${esc(direction.signatureMove)}</p>
  </section>

  ${
    direction.avoid.length
      ? `<section>
    <h2>Not this</h2>
    <p>Decided against for this brand specifically.</p>
    <ul style="padding-left:1.1rem;color:var(--color-muted)">
      ${direction.avoid.map((a) => `<li>${esc(a)}</li>`).join("")}
    </ul>
  </section>`
      : ""
  }

  <footer>Generated by Meikero · ${esc(direction.concept.name)}</footer>
</div>
</body>
</html>`;
}
