import Link from "next/link";
import type { Metadata } from "next";

import MarketingShell from "@/components/marketing-shell";
import { MossClubPreview } from "@/components/showcase-preview";

export const metadata: Metadata = {
  title: "Meikero — AI that writes real WordPress themes",
  description:
    "Describe the site you want. Meikero writes a custom WordPress theme — real PHP files, on your own hosting, editable in Gutenberg and by chat.",
};

const PROMPT_LINES = [
  "A bold, editorial site for a subscription service",
  "delivering miniature self-sustaining forest",
  "ecosystems. Deep natural tones, macro",
  "photography, atmospheric motion.",
];

/** Each prompt line lands a beat after the one above it. */
const PROMPT_STEP = 0.13;
const PROMPT_START = 0.35;
const PREVIEW_AT = PROMPT_START + PROMPT_LINES.length * PROMPT_STEP + 0.25;

function delay(seconds: number): React.CSSProperties {
  return { "--mk-delay": `${seconds.toFixed(2)}s` } as React.CSSProperties;
}

const STEPS = [
  {
    n: "01",
    title: "Install the bridge plugin",
    body: "One plugin on your own WordPress. It connects your site to Meikero and gives you the AI Editor inside wp-admin — no new dashboard to learn, nothing leaves your hosting.",
    link: { href: "/docs/install", label: "Read the install guide" },
  },
  {
    n: "02",
    title: "Describe the site",
    body: "Say what it is for, the mood, the pages you need. Meikero designs the homepage first and shows it to you as a mockup — you approve a direction before a single file is written.",
  },
  {
    n: "03",
    title: "It builds the theme",
    body: "A complete classic PHP theme: one file per section, one stylesheet per section, page templates, real page content as Gutenberg blocks. Then it reviews its own work and fixes what it finds.",
  },
];

const TRUTHS = [
  {
    title: "Real theme files, not a page builder",
    body: "You get front-page.php, template-parts, per-section CSS, functions.php. Open them, edit them, hand them to another developer. Nothing is locked inside a plugin's database.",
  },
  {
    title: "Your hosting, your WordPress",
    body: "The site runs where it always did. Meikero writes files over an authenticated bridge and never becomes a dependency for your visitors — if you cancel, the site keeps running.",
  },
  {
    title: "Content as native Gutenberg blocks",
    body: "Page copy lands as real heading, paragraph, list, image and button blocks — editable in the block editor, visible to Yoast, to search, to RSS. Not one opaque HTML blob.",
  },
  {
    title: "Change it by asking",
    body: "Click any element in the live preview and say what should be different. Every edit is a reviewed file write with one-click undo, so experimenting is cheap.",
  },
];

const FAQ = [
  {
    q: "Is this a page builder like Elementor or Divi?",
    a: "No — and that is the point. Page builders store your layout in their own database format, so leaving one means rebuilding the site. Meikero writes ordinary theme files to your server. If you stop paying, the theme stays exactly where it is and keeps working.",
  },
  {
    q: "Do I need my own hosting?",
    a: "Yes. Meikero works on a WordPress site you already run — any host. It is not a website host, it is the thing that builds the theme on the one you have.",
  },
  {
    q: "Can I edit what it makes?",
    a: "In three ways: in the block editor for page content, in the AI Editor by describing the change, or directly in the theme files over FTP or your host's file manager. They are just PHP and CSS.",
  },
  {
    q: "What happens to my existing site?",
    a: "Nothing until you activate the generated theme. Meikero creates a new theme alongside what you have; your current theme and content are untouched, and switching back is one click in Appearance.",
  },
  {
    q: "Which WordPress versions work?",
    a: "WordPress 6.2 or newer, PHP 7.4 or newer. The generated themes are classic PHP themes, so they work with the block editor and with classic plugins alike.",
  },
];

export default function HomePage() {
  return (
    <MarketingShell>
      {/* ---------------------------------------------------------------- */}
      {/* Hero — the prompt on one side, what it produced on the other.    */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
        <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            <p
              className="mk-rise text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6366f1]"
              style={delay(0)}
            >
              AI website builder for WordPress
            </p>

            <h1 className="mk-rise mt-4 text-balance text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.03em] text-neutral-900 sm:text-[3.4rem]" style={delay(0.08)}>
              Describe your site. Get a real WordPress theme.
            </h1>

            <p
              className="mk-rise mt-5 max-w-xl text-[1.05rem] leading-relaxed text-neutral-600"
              style={delay(0.16)}
            >
              Not a template you fill in. Not a builder that owns your layout.
              Meikero writes a custom PHP theme — section by section, stylesheet
              by stylesheet — straight into the WordPress you already run.
            </p>

            <div
              className="mk-rise mt-8 flex flex-wrap items-center gap-3"
              style={delay(0.24)}
            >
              <Link
                href="/signup"
                className="rounded-[11px] bg-[#141312] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-black"
              >
                Start free — 50 credits
              </Link>
              <Link
                href="#how"
                className="rounded-[11px] border border-neutral-900/15 bg-white/60 px-5 py-3 text-sm font-medium text-neutral-800 transition-colors hover:bg-white"
              >
                See how it works
              </Link>
            </div>

            <p className="mk-rise mt-4 text-xs text-neutral-500" style={delay(0.32)}>
              No card required. Works on any WordPress 6.2+ site.
            </p>
          </div>

          {/* The prompt, in mono, because it is input — next to its output. */}
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-neutral-900/[0.08] bg-white/70 p-5 shadow-[0_1px_2px_rgba(20,18,16,0.04)]">
              <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                What was asked for
              </p>
              <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-neutral-700">
                {PROMPT_LINES.map((line, i) => (
                  <span
                    key={line}
                    className="mk-rise block"
                    style={delay(PROMPT_START + i * PROMPT_STEP)}
                  >
                    {line}
                    {i === PROMPT_LINES.length - 1 ? (
                      <span
                        aria-hidden
                        className="mk-caret ml-0.5 bg-[#6366f1] align-middle"
                        style={{
                          ...delay(PROMPT_START + PROMPT_LINES.length * PROMPT_STEP),
                          height: "1em",
                        }}
                      />
                    ) : null}
                  </span>
                ))}
              </pre>
            </div>

            <div
              className="mk-rise flex items-center gap-3 px-1"
              style={delay(PREVIEW_AT - 0.12)}
            >
              <span className="h-px flex-1 bg-neutral-900/10" />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                What came back
              </span>
              <span className="h-px flex-1 bg-neutral-900/10" />
            </div>

            <div className="mk-preview" style={delay(PREVIEW_AT)}>
              <MossClubPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Receipts — what that one prompt actually produced.               */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-y border-neutral-900/[0.07] bg-white/45">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["8", "homepage sections, each its own PHP file"],
              ["11", "stylesheets, one per section plus the base"],
              ["5", "pages with real copy, written as Gutenberg blocks"],
              ["1", "prompt, plus a mockup you approve before the build"],
            ].map(([figure, label], i) => (
              <div key={label} className="mk-rise" style={delay(PREVIEW_AT + 0.2 + i * 0.08)}>
                <p className="font-mono text-[2rem] font-medium leading-none tabular-nums text-[#6366f1]">
                  {figure}
                </p>
                <p className="mt-2 text-sm leading-snug text-neutral-600">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
        <h2 className="max-w-2xl text-balance text-[2rem] font-semibold tracking-[-0.025em] text-neutral-900">
          Three steps, and the third one is not yours
        </h2>
        <p className="mt-3 max-w-xl text-neutral-600">
          The whole job is describing what you want well. Everything after that
          is the build.
        </p>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-neutral-900/[0.08] bg-neutral-900/[0.07] md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="flex flex-col bg-[#faf9f7] p-7">
              <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-[#6366f1]">
                {step.n}
              </span>
              <h3 className="mt-4 text-[1.05rem] font-semibold tracking-tight text-neutral-900">
                {step.title}
              </h3>
              <p className="mt-2.5 flex-1 text-[0.92rem] leading-relaxed text-neutral-600">
                {step.body}
              </p>
              {step.link ? (
                <Link
                  href={step.link.href}
                  className="mt-4 text-[0.87rem] font-medium text-[#6366f1] underline-offset-4 hover:underline"
                >
                  {step.link.label} →
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* What you actually get                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="border-t border-neutral-900/[0.07] bg-white/45">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="max-w-2xl text-balance text-[2rem] font-semibold tracking-[-0.025em] text-neutral-900">
            What you actually own at the end
          </h2>
          <p className="mt-3 max-w-xl text-neutral-600">
            Most AI site tools rent you a website. This one hands you a theme.
          </p>

          <div className="mt-12 grid gap-x-14 gap-y-10 sm:grid-cols-2">
            {TRUTHS.map((item) => (
              <div key={item.title} className="border-t border-neutral-900/10 pt-5">
                <h3 className="text-[1.02rem] font-semibold tracking-tight text-neutral-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-[0.92rem] leading-relaxed text-neutral-600">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* FAQ                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-3xl px-6 py-24">
        <h2 className="text-[2rem] font-semibold tracking-[-0.025em] text-neutral-900">
          Questions worth asking first
        </h2>

        <dl className="mt-10 flex flex-col">
          {FAQ.map((item) => (
            <div key={item.q} className="border-t border-neutral-900/10 py-6">
              <dt className="text-[1rem] font-semibold text-neutral-900">{item.q}</dt>
              <dd className="mt-2 text-[0.94rem] leading-relaxed text-neutral-600">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Close                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div className="rounded-3xl bg-[#141312] px-8 py-16 text-center sm:px-16">
          <h2 className="mx-auto max-w-xl text-balance text-[2rem] font-semibold leading-tight tracking-[-0.025em] text-white">
            Bring a prompt. Leave with a theme.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[0.98rem] leading-relaxed text-neutral-400">
            Fifty credits, no card. Enough to design a homepage, build the
            theme and see it live on your own site.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-[11px] bg-white px-6 py-3 text-sm font-medium text-neutral-900 transition-opacity hover:opacity-90"
          >
            Create your account
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
