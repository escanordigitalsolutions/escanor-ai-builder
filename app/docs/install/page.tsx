import Link from "next/link";
import type { Metadata } from "next";

import MarketingShell from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Install the Meikero plugin — Docs",
  description:
    "Connect your WordPress site to Meikero in about three minutes: download the bridge plugin, install it, paste your site key.",
};

type Step = {
  n: string;
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "Create your Meikero account",
    body: (
      <>
        <p>
          Sign up and confirm your email. You land on your dashboard with no
          sites connected yet — that is expected.
        </p>
        <p>
          <Link href="/signup" className="font-medium text-[#4c6eea] underline-offset-4 hover:underline">
            Create an account →
          </Link>
        </p>
      </>
    ),
  },
  {
    n: "02",
    title: "Add your site and copy the key",
    body: (
      <>
        <p>
          On the dashboard choose <strong>New site</strong>, give it a name and
          enter the address of the WordPress site you want to build on. Meikero
          shows you a <em>site key</em> that starts with{" "}
          <code className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[0.85em]">
            esk_live_
          </code>
          .
        </p>
        <p className="rounded-xl border border-amber-900/15 bg-amber-50/70 px-4 py-3 text-[0.88rem] text-amber-900">
          The key is shown once and never again. Copy it before you leave the
          page — if you lose it, revoke it and make a new one, which takes a
          few seconds.
        </p>
      </>
    ),
  },
  {
    n: "03",
    title: "Install the bridge plugin",
    body: (
      <>
        <p>
          Download the plugin zip from your dashboard, then in your WordPress
          admin go to <strong>Plugins → Add New → Upload Plugin</strong>, choose
          the zip and activate it.
        </p>
        <p>
          A <strong>Meikero</strong> item appears in your admin sidebar. Nothing
          on your site changes yet — the plugin only reads until you tell it to
          build.
        </p>
      </>
    ),
  },
  {
    n: "04",
    title: "Paste the key into Cloud connection",
    body: (
      <>
        <p>
          Go to <strong>Meikero → Cloud connection</strong>, paste the site key
          and save. The plugin calls Meikero once to introduce itself; when it
          succeeds, your dashboard flips that site to{" "}
          <strong>Connected</strong>.
        </p>
      </>
    ),
  },
  {
    n: "05",
    title: "Open the AI Editor and describe your site",
    body: (
      <>
        <p>
          <strong>Meikero → AI Editor</strong> is where the work happens. Say
          what the site is for, the mood you want and the pages you need.
          Meikero designs a homepage and shows it to you before writing
          anything — approve the direction, and it builds the theme.
        </p>
        <p>
          Your existing theme stays installed and untouched the whole time.
        </p>
      </>
    ),
  },
];

const TROUBLE = [
  {
    q: "“This site is not connected to the Meikero cloud yet.”",
    a: "The site key was never saved, or it was revoked. Open Meikero → Cloud connection and paste a fresh key from your dashboard.",
  },
  {
    q: "“Invalid or revoked site API key.”",
    a: "The key belongs to a project that was deleted, or you revoked it. Generate a new key on the dashboard for the site you want and paste that one.",
  },
  {
    q: "A redirect error mentioning another domain",
    a: "Your WordPress is reaching Meikero through an address that redirects. This is almost always a DNS or hosting redirect in front of your own site; contact us with the exact message and we will point you at the fix.",
  },
  {
    q: "The plugin will not upload",
    a: "Some hosts cap upload size below the plugin's few hundred kilobytes, or disable plugin installation entirely. Ask your host to raise upload_max_filesize, or upload the unzipped folder to wp-content/plugins over SFTP.",
  },
  {
    q: "Edits do not seem to show up",
    a: "A caching plugin or your host's page cache is serving an old copy. Meikero clears the common caches after every write, but if yours is unusual, purge it manually and reload.",
  },
];

export default function InstallDocsPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-16 sm:pt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4c6eea]">
          Docs
        </p>
        <h1 className="mt-4 text-balance text-[2.4rem] font-semibold leading-[1.06] tracking-[-0.03em] text-neutral-900">
          Connect your WordPress site
        </h1>
        <p className="mt-4 text-[1.02rem] leading-relaxed text-neutral-600">
          About three minutes, most of it waiting for WordPress to install a
          plugin. You will need admin access to the site and somewhere to paste
          a key.
        </p>

        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-neutral-900/[0.09] bg-white/65 px-5 py-4 text-[0.88rem] text-neutral-700">
          <span>
            <strong className="font-semibold">WordPress</strong> 6.2 or newer
          </span>
          <span>
            <strong className="font-semibold">PHP</strong> 7.4 or newer
          </span>
          <span>
            <strong className="font-semibold">Access</strong> an administrator
            account
          </span>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <ol className="flex flex-col">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 border-t border-neutral-900/10 py-8"
            >
              <span className="font-mono text-[13px] font-medium text-[#4c6eea]">
                {step.n}
              </span>
              <div>
                <h2 className="text-[1.15rem] font-semibold tracking-tight text-neutral-900">
                  {step.title}
                </h2>
                <div className="mt-3 flex flex-col gap-3 text-[0.94rem] leading-relaxed text-neutral-600">
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-neutral-900/[0.07] bg-white/45">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-[1.7rem] font-semibold tracking-[-0.02em] text-neutral-900">
            If something goes wrong
          </h2>
          <p className="mt-3 text-[0.96rem] text-neutral-600">
            The plugin reports the real reason rather than a generic failure —
            these are the messages you are most likely to meet.
          </p>

          <dl className="mt-9 flex flex-col">
            {TROUBLE.map((item) => (
              <div key={item.q} className="border-t border-neutral-900/10 py-5">
                <dt className="text-[0.97rem] font-semibold text-neutral-900">
                  {item.q}
                </dt>
                <dd className="mt-1.5 text-[0.92rem] leading-relaxed text-neutral-600">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-[0.92rem] text-neutral-600">
            Still stuck? Email{" "}
            <a
              href="mailto:hello@meikero.com"
              className="font-medium text-[#4c6eea] underline-offset-4 hover:underline"
            >
              hello@meikero.com
            </a>{" "}
            with the exact message from{" "}
            <strong className="font-semibold">Meikero → Activity log</strong> and
            we will take it from there.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
