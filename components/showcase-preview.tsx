/**
 * A faithful miniature of a site Meikero generated.
 *
 * Every value here — the palette, the typefaces, the section copy — is lifted
 * from the real Moss Club theme's own files, so the preview is a reproduction
 * rather than an impression of one. It is drawn in CSS instead of shipped as a
 * screenshot: it stays sharp at any width, reflows on a phone, weighs nothing,
 * and cannot go stale against a redesign the way a PNG does.
 */

const MOSS = {
  void: "#070f0a",
  deep: "#0e2015",
  moss: "#7d9a5e",
  mossLight: "#a9c17f",
  gold: "#d7b96a",
  cream: "#f2ecd9",
  fog: "rgba(242,236,217,.62)",
} as const;

function BrowserChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-900/[0.10] shadow-[0_2px_4px_rgba(20,18,16,0.05),0_24px_60px_-20px_rgba(20,18,16,0.35)]">
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ background: MOSS.deep }}
      >
        <span className="flex gap-1.5" aria-hidden>
          {["#e5675f", "#e0b04a", "#7d9a5e"].map((c) => (
            <span
              key={c}
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: c, opacity: 0.9 }}
            />
          ))}
        </span>
        <span
          className="ml-1 truncate font-mono text-[10.5px]"
          style={{ color: MOSS.fog }}
        >
          mossclub.example
        </span>
      </div>
      {children}
    </div>
  );
}

export function MossClubPreview() {
  return (
    <figure className="m-0">
      <BrowserChrome>
        <div
          className="relative px-6 py-7 sm:px-8 sm:py-9"
          style={{ background: MOSS.void, color: MOSS.cream }}
        >
          {/* Site header */}
          <div
            className="mb-8 flex items-center justify-between border-b pb-4"
            style={{ borderColor: "rgba(242,236,217,.13)" }}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: MOSS.mossLight }}
                aria-hidden
              />
              <span
                className="font-display text-[13px] font-semibold"
                style={{ color: MOSS.cream }}
              >
                Moss Club
              </span>
            </span>
            <span
              className="hidden gap-4 text-[10px] uppercase tracking-[0.14em] sm:flex"
              style={{ color: MOSS.fog }}
            >
              <span>Collection</span>
              <span>Ritual</span>
              <span>World</span>
            </span>
            <span
              className="rounded-full px-3 py-1 text-[10px] font-semibold"
              style={{ background: MOSS.mossLight, color: MOSS.void }}
            >
              Join
            </span>
          </div>

          {/* Hero */}
          <p
            className="mb-2.5 text-[9.5px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: MOSS.mossLight }}
          >
            Seasonal moss terrarium subscription
          </p>
          <h3
            className="font-display max-w-[13ch] text-[1.85rem] font-semibold leading-[1.03] tracking-[-0.01em] sm:text-[2.3rem]"
            style={{ color: MOSS.cream }}
          >
            Bring a living miniature forest home
          </h3>
          <p
            className="mt-3 max-w-[42ch] text-[11.5px] leading-relaxed"
            style={{ color: MOSS.fog }}
          >
            Handcrafted, self-sustaining moss terrariums delivered to your door
            each season — living moss, lichen and stone, sealed into a small
            world that changes quietly over time.
          </p>

          {/* Specimen strip — stands in for the theme's macro photography. */}
          <div className="mt-7 grid grid-cols-5 gap-2">
            {[
              "linear-gradient(150deg,#2f4a24,#7d9a5e)",
              "linear-gradient(150deg,#0e2015,#33481f)",
              "linear-gradient(150deg,#7d9a5e,#d7b96a)",
              "linear-gradient(150deg,#122a1b,#4d6b33)",
              "linear-gradient(150deg,#33481f,#a9c17f)",
            ].map((bg, i) => (
              <span
                key={i}
                className="mk-drift aspect-square rounded-[10px]"
                style={
                  {
                    background: bg,
                    border: "1px solid rgba(215,185,106,.42)",
                    "--mk-delay": `${(i * 0.55).toFixed(2)}s`,
                  } as React.CSSProperties
                }
                aria-hidden
              />
            ))}
          </div>

          {/* Membership tiers — the theme's real plan names and prices. */}
          <div
            className="mt-7 grid grid-cols-3 gap-2.5 border-t pt-6"
            style={{ borderColor: "rgba(242,236,217,.13)" }}
          >
            {[
              ["Sprout", "$38"],
              ["Grove", "$96"],
              ["Canopy", "Custom"],
            ].map(([name, price], i) => (
              <div
                key={name}
                className="rounded-xl px-2.5 py-3"
                style={{
                  background: i === 1 ? "rgba(125,154,94,.16)" : "transparent",
                  border:
                    i === 1
                      ? `1px solid ${MOSS.moss}`
                      : "1px solid rgba(242,236,217,.13)",
                }}
              >
                <p
                  className="font-display text-[11.5px] font-semibold"
                  style={{ color: MOSS.cream }}
                >
                  {name}
                </p>
                <p
                  className="mt-0.5 font-mono text-[10.5px] tabular-nums"
                  style={{ color: MOSS.gold }}
                >
                  {price}
                </p>
              </div>
            ))}
          </div>
        </div>
      </BrowserChrome>

      <figcaption className="mt-3 px-1 text-[12px] leading-relaxed text-neutral-500">
        <span className="font-medium text-neutral-700">Moss Club</span> — theme
        generated by Meikero, shown with its own palette, typefaces and copy.
      </figcaption>
    </figure>
  );
}
