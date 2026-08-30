import Link from "next/link";
import type { Metadata } from "next";

import MarketingShell from "@/components/marketing-shell";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pricing — Meikero",
  description:
    "Plans from €29/month with credits included. Build a full WordPress theme from a prompt, on your own hosting. Free trial, no card required.",
};

type Plan = {
  name: string;
  price: string;
  period?: string;
  blurb: string;
  sites: string;
  credits: string;
  features: string[];
  cta: string;
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "€0",
    blurb: "Enough to design a homepage and build the theme once.",
    sites: "1 site",
    credits: "50 credits, one time",
    features: [
      "Full theme generation",
      "AI Editor in wp-admin",
      "Gutenberg content",
      "No card required",
    ],
    cta: "Start free",
  },
  {
    name: "Starter",
    price: "€29",
    period: "/month",
    blurb: "For the one site you actually care about.",
    sites: "1 site",
    credits: "200 credits/month",
    features: [
      "Everything in Free",
      "Unlimited AI edits within credits",
      "Design archive and one-click undo",
      "Email support",
    ],
    cta: "Choose Starter",
  },
  {
    name: "Pro",
    price: "€79",
    period: "/month",
    blurb: "For freelancers running several client sites.",
    sites: "5 sites",
    credits: "800 credits/month",
    features: [
      "Everything in Starter",
      "Five connected WordPress sites",
      "Priority generation queue",
      "Top up credits any time",
    ],
    cta: "Choose Pro",
    featured: true,
  },
  {
    name: "Agency",
    price: "€199",
    period: "/month",
    blurb: "For studios shipping sites continuously.",
    sites: "Unlimited sites",
    credits: "2,500 credits/month",
    features: [
      "Everything in Pro",
      "Unlimited connected sites",
      "Priority support",
      "Invoicing with VAT details",
    ],
    cta: "Choose Agency",
  },
];

const CREDIT_COSTS = [
  ["Homepage design concept", "~8 credits"],
  ["Full theme build", "~45 credits"],
  ["Page content for 4 inner pages", "~6 credits"],
  ["A single AI edit", "1–4 credits"],
  ["Chat question about your site", "under 1 credit"],
];

export default async function PricingPage() {
  // Someone already signed in should land on the panel that can actually take
  // their money, not on a signup form they have no use for.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  const ctaHref = signedIn ? "/dashboard#billing" : "/signup";

  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4c6eea]">
          Pricing
        </p>
        <h1 className="mt-4 max-w-2xl text-balance text-[2.6rem] font-semibold leading-[1.06] tracking-[-0.03em] text-neutral-900">
          Pay for what the AI actually does
        </h1>
        <p className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-neutral-600">
          A monthly plan for the seat, credits for the work. Hosting stays
          yours, so there is nothing here for bandwidth, storage or visitors.
        </p>
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <div className="grid gap-5 lg:grid-cols-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={
                "flex flex-col rounded-2xl p-6 " +
                (plan.featured
                  ? "bg-[#141312] text-white ring-1 ring-[#141312]"
                  : "border border-neutral-900/[0.09] bg-white/65")
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2
                  className={
                    "text-[1.05rem] font-semibold tracking-tight " +
                    (plan.featured ? "text-white" : "text-neutral-900")
                  }
                >
                  {plan.name}
                </h2>
                {plan.featured ? (
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white">
                    Popular
                  </span>
                ) : null}
              </div>

              <p
                className={
                  "mt-1.5 text-[0.85rem] leading-snug " +
                  (plan.featured ? "text-neutral-400" : "text-neutral-500")
                }
              >
                {plan.blurb}
              </p>

              <p className="mt-5 flex items-baseline gap-1">
                <span
                  className={
                    "font-mono text-[2rem] font-medium tabular-nums leading-none " +
                    (plan.featured ? "text-white" : "text-neutral-900")
                  }
                >
                  {plan.price}
                </span>
                {plan.period ? (
                  <span
                    className={
                      "text-[0.85rem] " +
                      (plan.featured ? "text-neutral-400" : "text-neutral-500")
                    }
                  >
                    {plan.period}
                  </span>
                ) : null}
              </p>

              <div
                className={
                  "mt-5 flex flex-col gap-1 border-t pt-4 text-[0.85rem] " +
                  (plan.featured
                    ? "border-white/15 text-neutral-300"
                    : "border-neutral-900/10 text-neutral-700")
                }
              >
                <span className="font-medium">{plan.sites}</span>
                <span>{plan.credits}</span>
              </div>

              <ul
                className={
                  "mt-4 flex flex-1 flex-col gap-2 text-[0.85rem] " +
                  (plan.featured ? "text-neutral-300" : "text-neutral-600")
                }
              >
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span
                      aria-hidden
                      className={plan.featured ? "text-[#a9a9f7]" : "text-[#4c6eea]"}
                    >
                      ·
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={ctaHref}
                className={
                  "mt-6 rounded-[10px] px-4 py-2.5 text-center text-sm font-medium transition-colors " +
                  (plan.featured
                    ? "bg-white text-neutral-900 hover:opacity-90"
                    : "bg-[#141312] text-white hover:bg-black")
                }
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-neutral-500">
          Prices exclude VAT, which is calculated at checkout from your billing
          country. Cancel any time — your theme keeps running either way.
        </p>
      </section>

      {/* What a credit is */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <h2 className="text-[1.7rem] font-semibold tracking-[-0.02em] text-neutral-900">
              What a credit is
            </h2>
            <p className="mt-3 text-[0.96rem] leading-relaxed text-neutral-600">
              A credit is a unit of AI work. Designing a homepage costs more
              than moving a button, so charging a flat fee per site would mean
              overcharging careful users to subsidise heavy ones.
            </p>
            <p className="mt-3 text-[0.96rem] leading-relaxed text-neutral-600">
              Credits from your plan refresh every month and do not roll over.
              Top-ups never expire and are spent only after the monthly
              allowance runs out.
            </p>
            <p className="mt-5 rounded-xl border border-neutral-900/[0.09] bg-white/65 px-4 py-3 text-[0.88rem] text-neutral-700">
              Need more mid-month? <strong className="font-semibold">100 credits for €15</strong>,
              any time, from your dashboard.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-900/[0.09] bg-white/65 p-6">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
              Typical costs
            </p>
            <dl className="flex flex-col">
              {CREDIT_COSTS.map(([label, cost]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-6 border-t border-neutral-900/[0.07] py-3 first:border-t-0 first:pt-0"
                >
                  <dt className="text-[0.9rem] text-neutral-700">{label}</dt>
                  <dd className="shrink-0 font-mono text-[0.82rem] tabular-nums text-neutral-500">
                    {cost}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-neutral-500">
              Figures are typical, not fixed — a long, detailed prompt costs
              more than a short one. Your dashboard shows exactly what each
              action spent.
            </p>
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div className="rounded-3xl border border-neutral-900/[0.09] bg-white/65 px-8 py-14 text-center">
          <h2 className="text-[1.6rem] font-semibold tracking-[-0.02em] text-neutral-900">
            Try it before you decide
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[0.96rem] leading-relaxed text-neutral-600">
            Fifty credits, no card. That covers a homepage design and a full
            theme build on a site you already run.
          </p>
          <Link
            href={ctaHref}
            className="mt-7 inline-block rounded-[11px] bg-[#141312] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-black"
          >
            Start free
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
