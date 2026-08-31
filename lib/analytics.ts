/**
 * Google Analytics.
 *
 * The measurement id is a public value — it ships in the page either way — so
 * it is a plain default rather than a required environment variable: a tag
 * nobody remembered to configure is a tag that silently never fires.
 * NEXT_PUBLIC_GA_ID overrides it, and setting that to an empty string on a
 * preview deployment keeps preview traffic out of the production property.
 */
const CONFIGURED = process.env.NEXT_PUBLIC_GA_ID;

export const GA_ID = (CONFIGURED === undefined ? "G-EED9ZVZD84" : CONFIGURED).trim();
