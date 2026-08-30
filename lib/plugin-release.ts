/**
 * The currently published plugin build.
 *
 * Two things must move together when the plugin changes: the zip in
 * public/plugin/, and this version. If they drift, every installation either
 * offers an update that installs the same code, or never hears about a fix.
 * Keeping them one edit apart is the point of this file.
 *
 * The filename deliberately never changes — WordPress follows download_url
 * from the manifest, so a stable path means old manifests cannot point at a
 * zip that has been renamed away.
 */
export const PLUGIN_RELEASE = {
  version: "1.16.0",
  file: "/plugin/meikero-bridge.zip",
  released: "2026-08-30",
  requiresWordPress: "6.2",
  requiresPhp: "7.4",
  testedWordPress: "6.9",
  changelog:
    "<h4>1.16.0</h4><ul>" +
    "<li>Connecting a site now takes one key: the plugin registers itself with Meikero and hands over its own bridge token.</li>" +
    "<li>The plugin now offers its own updates, so fixes arrive like any other plugin.</li>" +
    "<li>Bridge errors report the real HTTP status and reason instead of a generic failure.</li>" +
    "</ul>",
} as const;
