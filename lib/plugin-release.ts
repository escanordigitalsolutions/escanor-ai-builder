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
  version: "1.21.0",
  file: "/plugin/meikero-bridge.zip",
  released: "2026-08-30",
  requiresWordPress: "6.2",
  requiresPhp: "7.4",
  testedWordPress: "6.9",
  changelog:
    "<h4>1.21.0</h4><ul>" +
    "<li>WordPress now tells you when a Meikero update is available, and a Check for updates button forces the check instead of waiting for the cache.</li>" +
    "<li>A warning appears when your credits will not cover another site generation, and again if they run out.</li>" +
    "</ul>" +
    "<h4>1.20.0</h4><ul>" +
    "<li>The design archive now shows the inner page as well as the homepage — switch between them in the preview.</li>" +
    "</ul>" +
    "<h4>1.19.0</h4><ul>" +
    "<li>Long design generations no longer report a timeout while they are still running — the editor now waits as long as the design step is allowed to take.</li>" +
    "</ul>" +
    "<h4>1.18.0</h4><ul>" +
    "<li>The credit figure in the AI Editor now refreshes on its own after the AI works, instead of only on page load.</li>" +
    "</ul>" +
    "<h4>1.17.0</h4><ul>" +
    "<li>Your credit balance now shows in the Meikero dashboard and in the AI Editor, so you can see what is left without leaving WordPress.</li>" +
    "</ul>" +
    "<h4>1.16.0</h4><ul>" +
    "<li>Connecting a site now takes one key: the plugin registers itself with Meikero and hands over its own bridge token.</li>" +
    "<li>The plugin now offers its own updates, so fixes arrive like any other plugin.</li>" +
    "<li>Bridge errors report the real HTTP status and reason instead of a generic failure.</li>" +
    "</ul>",
} as const;
