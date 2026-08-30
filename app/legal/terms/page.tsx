import type { Metadata } from "next";

import MarketingShell from "@/components/marketing-shell";
import LegalPage, { Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Meikero",
  description:
    "The agreement between you and ESCANOR Digital Solutions for using Meikero: plans, credits, what you own, and how either side can end it.",
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <LegalPage
        title="Terms of Service"
        updated="30 August 2026"
        intro="These terms govern your use of Meikero, operated by ESCANOR Digital Solutions, Lithuania. Creating an account means you accept them."
      >
        <Section title="What Meikero does">
          <p>
            Meikero generates WordPress themes and page content using AI models,
            and writes them to a WordPress site you control through a plugin you
            install. We provide the software that builds the theme; we do not
            host your website, and we are not your web host.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You must be at least 18 and give accurate details. You are
            responsible for what happens under your account and for keeping your
            password and site keys safe. Tell us promptly at{" "}
            <a
              href="mailto:hello@meikero.com"
              className="font-medium text-[#6366f1] underline-offset-4 hover:underline"
            >
              hello@meikero.com
            </a>{" "}
            if you think either has been exposed.
          </p>
          <p>
            One account is for one customer. You may connect the number of
            WordPress sites your plan allows, including sites belonging to your
            own clients.
          </p>
        </Section>

        <Section title="Plans, credits and payment">
          <p>
            Plans are billed monthly in advance through Stripe. Prices are shown
            excluding VAT, which is added at checkout according to your billing
            country.
          </p>
          <p>
            Each plan includes a monthly allowance of credits, which is what AI
            work is measured in. Plan credits reset at the start of each billing
            period and do not carry over. Purchased top-up credits do not
            expire and are used only after the monthly allowance is exhausted.
          </p>
          <p>
            When your credits run out, AI features pause until the next period
            or until you top up. Nothing already built is removed, and your
            website keeps running.
          </p>
          <p>
            Cancel any time — your plan then runs to the end of the period you
            already paid for. We do not refund partly used periods, except where
            consumer law requires it.
          </p>
        </Section>

        <Section title="The free trial">
          <p>
            New accounts receive a one-time allowance of free credits, with no
            card required. It is offered once per customer; creating extra
            accounts to collect it again is a breach of these terms.
          </p>
        </Section>

        <Section title="What you own">
          <p>
            <strong className="font-semibold text-neutral-800">
              The theme files Meikero generates for you are yours.
            </strong>{" "}
            You may use, modify, sell and redistribute them, including on behalf
            of clients, with no further payment to us and no attribution
            required. Ending your subscription does not revoke this — the theme
            on your server stays yours.
          </p>
          <p>
            We keep ownership of Meikero itself: the platform, the plugin, our
            prompts and our infrastructure. The plugin is licensed to you for as
            long as you have an account.
          </p>
          <p>
            Generated themes may include photographs from Pexels, used under the
            Pexels licence. Generated text and layouts are produced by AI
            models, and similar output may be produced for someone else — we
            cannot promise your theme is unique, and we cannot assign copyright
            in AI-generated material we do not hold.
          </p>
        </Section>

        <Section title="How you may use it">
          <p>You agree not to use Meikero to:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li>build sites that are illegal where they operate, or that deceive people about who runs them;</li>
            <li>generate malware, phishing pages, or sites impersonating a real business or person;</li>
            <li>connect a WordPress site you are not authorised to administer;</li>
            <li>work around credit limits, resell raw access to our AI, or automate the service beyond normal use;</li>
            <li>attack, overload or probe our infrastructure.</li>
          </ul>
          <p>
            You are responsible for what you publish. We do not review the sites
            you build.
          </p>
        </Section>

        <Section title="AI output comes with no guarantee of correctness">
          <p>
            Meikero writes code and copy automatically. It can be wrong,
            inconsistent, or unsuited to your purpose, and generated text may
            state things that are not true about your business. Review what it
            produces before publishing.
          </p>
          <p>
            Always keep your own backup of a site before activating a generated
            theme. The plugin keeps a limited undo history, but it is a
            convenience, not a backup system.
          </p>
        </Section>

        <Section title="Availability">
          <p>
            We aim to keep Meikero available, but we do not promise a specific
            uptime and we depend on providers we do not control. We may take the
            service down for maintenance, and we may change or remove features —
            if a change materially reduces what you paid for, you may cancel and
            we will refund the unused part of that period.
          </p>
        </Section>

        <Section title="Liability">
          <p>
            To the extent the law allows, our total liability to you in any
            twelve-month period is capped at what you paid us in that period,
            and we are not liable for lost profit, lost data or business
            interruption.
          </p>
          <p>
            Nothing here limits liability that cannot be limited by law,
            including for death, personal injury, fraud, or the statutory rights
            of consumers in the EU.
          </p>
        </Section>

        <Section title="Ending the agreement">
          <p>
            You may close your account at any time from your dashboard. We may
            suspend or close an account that breaches these terms, that does not
            pay, or that puts the service or other customers at risk — with
            notice where it is reasonable to give it.
          </p>
          <p>
            After closure, themes already on your own server are unaffected.
            Data held by us is removed as described in the{" "}
            <a
              href="/legal/privacy"
              className="font-medium text-[#6366f1] underline-offset-4 hover:underline"
            >
              Privacy Policy
            </a>
            .
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We will email you at least 30 days before a material change takes
            effect. Continuing to use Meikero after that date means you accept
            the new terms; if you do not, cancel before it.
          </p>
        </Section>

        <Section title="Law and disputes">
          <p>
            These terms are governed by Lithuanian law, and the courts of
            Lithuania have jurisdiction. If you are a consumer in the EU, you
            keep the protection of the mandatory law of the country you live in,
            and you may use the European Commission's online dispute resolution
            platform.
          </p>
        </Section>
      </LegalPage>
    </MarketingShell>
  );
}
