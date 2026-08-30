import type { Metadata } from "next";

import MarketingShell from "@/components/marketing-shell";
import LegalPage, { Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Meikero",
  description:
    "What Meikero stores, who processes it, how long it is kept, and the rights you have over it.",
};

const SUBPROCESSORS = [
  ["Vercel", "Application hosting and delivery", "USA / EU"],
  ["Supabase", "Database, authentication, file storage", "EU"],
  ["OpenAI", "Model calls that generate themes and copy", "USA"],
  ["Anthropic", "Model calls that generate themes and copy", "USA"],
  ["Stripe", "Payments, invoicing and tax", "USA / EU"],
  ["Resend", "Transactional email (confirmations, resets)", "USA / EU"],
  ["Pexels", "Stock photography used in generated themes", "USA"],
];

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <LegalPage
        title="Privacy Policy"
        updated="30 August 2026"
        intro="Meikero is operated by ESCANOR Digital Solutions, based in Lithuania. This policy explains what we store about you and your sites, who else touches it, and what you can ask us to do with it."
      >
        <Section title="Who is responsible">
          <p>
            The data controller is ESCANOR Digital Solutions, Lithuania. For any
            question about this policy or about your data, write to{" "}
            <a
              href="mailto:privacy@meikero.com"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              privacy@meikero.com
            </a>
            .
          </p>
        </Section>

        <Section title="What we collect">
          <p>
            <strong className="font-semibold text-neutral-800">Account data.</strong>{" "}
            Your email address, the name and company you enter at signup, and a
            hashed password. We never see your password in readable form.
          </p>
          <p>
            <strong className="font-semibold text-neutral-800">Site connection data.</strong>{" "}
            For each WordPress site you connect: its address, the WordPress and
            PHP versions it reports, the active theme name, and a hash of the
            site key. The key itself is stored only as a SHA-256 hash — we
            cannot recover it, which is why a lost key must be replaced rather
            than looked up.
          </p>
          <p>
            <strong className="font-semibold text-neutral-800">What you ask the AI.</strong>{" "}
            The prompts you write, the theme files the AI reads and writes, the
            generated designs, and the chat history in the AI Editor.
          </p>
          <p>
            <strong className="font-semibold text-neutral-800">Usage records.</strong>{" "}
            For each AI call: which model ran, how many tokens it used, which
            stage it belonged to, and when. This is how credits are counted and
            how your dashboard shows what you spent.
          </p>
          <p>
            <strong className="font-semibold text-neutral-800">Billing data.</strong>{" "}
            Handled by Stripe. We store your Stripe customer identifier and your
            subscription state. We never receive or store your card number.
          </p>
        </Section>

        <Section title="What we do not collect">
          <p>
            We do not use advertising trackers or third-party analytics
            cookies. The only cookies Meikero sets are the ones that keep you
            signed in.
          </p>
          <p>
            We do not read your WordPress database. The bridge plugin exposes
            theme files and page content to the AI Editor while you are using
            it — it does not export your posts, users, orders or comments.
          </p>
        </Section>

        <Section title="Why we are allowed to hold it">
          <p>
            Account, site and AI data are processed to <em>perform the contract</em>{" "}
            you entered when you created an account — without them the product
            cannot function. Billing records are kept to{" "}
            <em>comply with a legal obligation</em> under accounting and tax
            law. Security logs rest on our <em>legitimate interest</em> in
            keeping the service safe from abuse.
          </p>
        </Section>

        <Section title="Who else processes it">
          <p>
            Meikero runs on infrastructure operated by others. Each of these is
            a processor bound by a data processing agreement, and transfers
            outside the EU rely on the European Commission's standard
            contractual clauses.
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[0.88rem]">
              <thead>
                <tr>
                  <th className="border-b border-neutral-900/15 py-2 pr-4 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                    Processor
                  </th>
                  <th className="border-b border-neutral-900/15 py-2 pr-4 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                    Purpose
                  </th>
                  <th className="border-b border-neutral-900/15 py-2 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                    Region
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map(([name, purpose, region]) => (
                  <tr key={name}>
                    <td className="border-b border-neutral-900/[0.07] py-2.5 pr-4 font-medium text-neutral-800">
                      {name}
                    </td>
                    <td className="border-b border-neutral-900/[0.07] py-2.5 pr-4 text-neutral-600">
                      {purpose}
                    </td>
                    <td className="border-b border-neutral-900/[0.07] py-2.5 text-neutral-600">
                      {region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[0.88rem] text-neutral-500">
            We do not sell personal data, and we do not share it for
            advertising.
          </p>
        </Section>

        <Section title="AI providers and your content">
          <p>
            Generating a theme means sending your prompt and the relevant theme
            files to OpenAI or Anthropic. We use their business APIs, under
            terms that do not permit your content to be used for training their
            models.
          </p>
          <p>
            Do not paste passwords, keys or personal data about other people
            into prompts — they travel to the model provider like any other
            part of the request.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Account, site and AI data live for as long as your account exists.
            Delete a project and its designs, chat history and usage records go
            with it. Delete your account and we remove everything within 30
            days, except billing records, which accounting law requires us to
            keep for ten years.
          </p>
          <p>
            Themes already written to your own server are yours and are not
            affected — we cannot remove them, and deleting your account does not
            touch your WordPress site.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under the GDPR you may ask for a copy of your data, correct it,
            have it deleted, restrict or object to processing, or receive it in
            a portable format. Write to{" "}
            <a
              href="mailto:privacy@meikero.com"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              privacy@meikero.com
            </a>{" "}
            and we will answer within one month.
          </p>
          <p>
            If you believe we have handled your data badly, you may complain to
            the Lithuanian State Data Protection Inspectorate (Valstybinė duomenų
            apsaugos inspekcija) or to the authority where you live.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Traffic runs over HTTPS. Site keys are stored only as hashes.
            Database access is restricted per user by row-level security, and
            the bridge token that lets Meikero reach your WordPress is
            encrypted at rest.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes in a way that matters, we will email you
            before it takes effect. The date at the top always reflects the
            current version.
          </p>
        </Section>
      </LegalPage>
    </MarketingShell>
  );
}
