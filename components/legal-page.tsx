import type { ReactNode } from "react";

/**
 * Shared frame for the legal pages.
 *
 * The draft notice is deliberately impossible to miss and sits above the
 * content rather than in a footnote: these documents were drafted from the
 * product's actual data flows, but they have not been reviewed by a lawyer,
 * and shipping them as if they had would be the more dangerous mistake.
 */
export default function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 pb-24 pt-16 sm:pt-20">
      <div className="rounded-xl border border-amber-900/20 bg-amber-50/70 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-900">
          Draft — not yet reviewed by a lawyer
        </p>
        <p className="mt-1.5 text-[0.88rem] leading-relaxed text-amber-900/90">
          This document was drafted to match how Meikero actually handles data
          and payments, but it has not been checked by a qualified lawyer and
          is not legal advice. It must be reviewed before Meikero accepts paid
          customers.
        </p>
      </div>

      <h1 className="mt-10 text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-neutral-900">
        {title}
      </h1>

      <p className="mt-2 font-mono text-[12px] text-neutral-500">
        Last updated {updated}
      </p>

      <p className="mt-6 text-[1.02rem] leading-relaxed text-neutral-700">{intro}</p>

      <div className="legal-body mt-10">{children}</div>
    </article>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-neutral-900/10 py-7">
      <h2 className="text-[1.15rem] font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[0.94rem] leading-relaxed text-neutral-600">
        {children}
      </div>
    </section>
  );
}
