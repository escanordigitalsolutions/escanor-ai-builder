import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Shared frame for the four auth screens (login, signup, forgot, reset).
 *
 * Everything visual lives here so the screens stay identical to each other and
 * to the rest of the app — they use the same design-system classes as the
 * dashboard (`app-shell`, `glass-card`, `field`, `btn-accent`) rather than
 * their own one-off Tailwind.
 */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="app-shell flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="glass-card p-8">
          <div className="mb-7">
            <Image
              src="/brand/wordmark-dark.png"
              alt="Meikero"
              width={2835}
              height={1000}
              priority
              className="h-[22px] w-auto"
            />
            <h1 className="mt-4 text-[1.55rem] font-semibold tracking-tight text-neutral-900">
              {title}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>
          </div>

          {children}
        </div>

        {footer ? (
          <div className="mt-5 text-center text-sm text-neutral-500">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

export function AuthField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-neutral-700" htmlFor={props.id}>
        {label}
      </label>
      <input {...props} className="field px-4 py-3 text-[0.95rem]" />
      {hint ? <p className="mt-1.5 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export function AuthSubmit({
  loading,
  idle,
  busy,
}: {
  loading: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <button type="submit" disabled={loading} className="btn-accent w-full py-3 font-medium">
      {loading ? busy : idle}
    </button>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{children}</p>
  );
}

export function AuthNotice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
      {children}
    </p>
  );
}
