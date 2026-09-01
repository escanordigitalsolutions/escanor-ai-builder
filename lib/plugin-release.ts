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
  version: "1.35.0",
  file: "/plugin/meikero-bridge.zip",
  released: "2026-09-01",
  requiresWordPress: "6.2",
  requiresPhp: "7.4",
  testedWordPress: "6.9",
  changelog:
    "<h4>1.35.0</h4><ul>" +
    "<li>A design can now be changed before you build from it. Say what you want different — a darker header, more room between sections, a different tone in the hero — and the design is edited in place, keeping everything you already approved.</li>" +
    "<li>The design decides what pages the site has, and its menu links to them. Until now every generated design was a one-page site whose menu pointed at its own sections, and the theme was later built around a different set of pages.</li>" +
    "<li>Walking to a page in the preview now shows that page's title, so the preview reads as the site it is going to become.</li>" +
    "</ul>" +
    "<h4>1.34.0</h4><ul>" +
    "<li>The design preview is now a site you can walk through. Click the menu, a card, a footer link or a post title and the preview moves to that screen, so a new design can be judged the way a visitor would meet it.</li>" +
    "<li>Designs are generated with real links between their pages rather than placeholders.</li>" +
    "</ul>" +
    "<h4>1.33.0</h4><ul>" +
    "<li>The chat now remembers what a conversation has established — decisions, preferences, what you are working on — and shows it above the box, so you can see what it is carrying. Starting a new chat clears it.</li>" +
    "<li>Every answer can be unfolded to show what the AI actually looked at to reach it.</li>" +
    "<li>Chat and edits are allowed twice the work before giving up, so a question that needs real reading gets it.</li>" +
    "</ul>" +
    "<h4>1.32.0</h4><ul>" +
    "<li>The design preview now shows the screen you picked. Components, Blog archive, 404 and Brand sheet were all quietly showing the homepage instead — in the AI Editor and in the dashboard.</li>" +
    "<li>Themes can be planned larger without files being dropped, and if a plan is still too big the editor says which files were left out instead of quietly skipping them.</li>" +
    "</ul>" +
    "<h4>1.31.0</h4><ul>" +
    "<li>Every edit is now checked afterwards, and anything the check finds is shown with the Undo button instead of left for you to spot on the page.</li>" +
    "<li>Chat answers can no longer be lost to a host that cuts long requests: the work runs in the background and the editor collects the answer when it is ready.</li>" +
    "</ul>" +
    "<h4>1.30.0</h4><ul>" +
    "<li>A new Changes view in the AI Editor lists what was edited and when, shows the exact lines that moved in each file, and puts any of it back — not just the last edit.</li>" +
    "<li>Restoring is itself recorded, so changing your mind about an undo costs nothing.</li>" +
    "</ul>" +
    "<h4>1.29.0</h4><ul>" +
    "<li>Edits are now targeted: the AI replaces the lines it means to change instead of rewriting whole files, which is faster, cheaper and cannot cut a file short.</li>" +
    "<li>A file you edited yourself — by FTP, in the theme editor, or through another plugin — is marked in the theme map, and the AI is warned before it touches it.</li>" +
    "</ul>" +
    "<h4>1.28.0</h4><ul>" +
    "<li>The chat now draws tables, lists and headings instead of showing them as raw text, and gives a table or a code block the full width of the panel.</li>" +
    "<li>Your messages are Meikero blue.</li>" +
    "<li>Hovering the chat dock opens the whole conversation, so a long answer is no longer clipped to three lines.</li>" +
    "<li>Full screen closes on a click outside or Escape, and remembers whether you left it open.</li>" +
    "</ul>" +
    "<h4>1.27.0</h4><ul>" +
    "<li>An edit that the AI could not finish writing is no longer applied. Half-written stylesheets used to be saved silently and break the design; now the edit fails and says so.</li>" +
    "<li>Chat no longer gives up after a minute on questions that need a proper look at your theme.</li>" +
    "<li>Answers and edits arrive faster: the AI is given your theme's file map up front instead of asking for it first.</li>" +
    "</ul>" +
    "<h4>1.26.0</h4><ul>" +
    "<li>A new folder button in the AI Editor shows your theme as a browsable map — every file grouped by what it does, with a line explaining each one. Click a file to read it.</li>" +
    "<li>Ask the chat what your theme contains and it draws the same map instead of describing a file list.</li>" +
    "</ul>" +
    "<h4>1.25.0</h4><ul>" +
    "<li>The chat can now answer about your pages, posts and products on sites Meikero cannot reach — the plugin sends them with your message instead of being asked for them.</li>" +
    "</ul>" +
    "<h4>1.24.0</h4><ul>" +
    "<li>The AI Editor no longer needs your site to be reachable from the internet. Chat and edits used to fail with a connection error on sites behind Cloudflare, HTTP auth or a firewall; the plugin now sends the theme with each request instead of waiting to be called back.</li>" +
    "</ul>" +
    "<h4>1.23.1</h4><ul>" +
    "<li>Archived designs preview in full again — they were painting a header over an empty page.</li>" +
    "<li>Building from a saved design now opens the wizard and shows its progress instead of leaving you on a blank screen.</li>" +
    "</ul>" +
    "<h4>1.23.0</h4><ul>" +
    "<li>The dashboard now reports your usage in credits, grouped by what the work was for, instead of model names and token prices.</li>" +
    "<li>Build a theme straight from any design in your archive — it skips the design step, which is about half the cost of a generation.</li>" +
    "<li>The design archive previews every screen a design produced, not just the homepage.</li>" +
    "<li>The AI Editor opens on theme generation when the active theme is not one it can edit.</li>" +
    "</ul>" +
    "<h4>1.22.0</h4><ul>" +
    "<li>The design preview now shows every screen the generation produced — inner page, components, blog archive, 404 and the brand sheet — and lets you switch between the alternative colourways.</li>" +
    "<li>The theme build uses them: your blog listing, 404 page and component styles now come from the design you approved instead of being invented during the build.</li>" +
    "</ul>" +
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
