import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

import { SITE_URL } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Used only by the showcase preview, which reproduces a generated theme in
// that theme's own typeface. One weight, so it costs almost nothing.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Meikero — AI that writes real WordPress themes",
    template: "%s",
  },
  description:
    "Describe the site you want. Meikero writes a custom WordPress theme — real PHP files, on your own hosting, editable in Gutenberg and by chat.",
  applicationName: "Meikero",
  openGraph: {
    type: "website",
    siteName: "Meikero",
    url: SITE_URL,
    title: "Meikero — AI that writes real WordPress themes",
    description:
      "Describe the site you want. Meikero writes a custom WordPress theme — real PHP files, on your own hosting.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Meikero — AI that writes real WordPress themes",
    description:
      "Describe the site you want. Meikero writes a custom WordPress theme — real PHP files, on your own hosting.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f6f5f3] text-neutral-900">
        {children}
      </body>
    </html>
  );
}
