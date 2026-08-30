/**
 * The canonical public address of this deployment.
 *
 * Meikero answers on more than one hostname — meikero.com plus the legacy
 * builder.escanor.lt that already-installed plugins still call — so canonical
 * URLs, sitemaps and OG tags must name one of them explicitly rather than
 * inferring it from whichever host a request happened to arrive on.
 *
 * NEXT_PUBLIC_SITE_URL lets preview deployments point at themselves.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://meikero.com"
).replace(/\/$/, "");
