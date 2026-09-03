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
  version: "1.44.0",
  file: "/plugin/meikero-bridge.zip",
  released: "2026-09-01",
  requiresWordPress: "6.2",
  requiresPhp: "7.4",
  testedWordPress: "6.9",
  changelog:
    "<h4>1.44.0</h4><ul>" +
    "<li>Opening a design from the library is a review now, not a purchase: walk it, change it, pick its pages \u2014 and Build is a button you press on purpose. Back to studio takes you out without touching anything.</li>" +
    "<li>Every library card shows its picture \u2014 designs from before pictures existed get one on first sight, and a card that truly has none shows a quiet pattern instead of blank white.</li>" +
    "</ul>" +
    "<h4>1.43.0</h4><ul>" +
    "<li>The Wizard is a full-width studio now: the brief on the left, your design library as a cover grid on the right, and the review stage taking the whole floor when a design is open.</li>" +
    "<li>One-shot, an experiment you can toggle on: a single prompt designs three pages at once \u2014 home, an inner page it chooses, contact \u2014 to test how consistent one head is against the staged pipeline.</li>" +
    "<li>Design covers are modern flat-geometric posters now instead of abstract paintings \u2014 same real palette, sharper look.</li>" +
    "<li>The dashboard no longer lists designs at all; they live in the Wizard.</li>" +
    "</ul>" +
    "<h4>1.42.0</h4><ul>" +
    "<li>The dashboard archive no longer loads any design's page. Every card is a cached picture; a design from before pictures existed gets one the first time its card is shown, automatically.</li>" +
    "</ul>" +
    "<h4>1.41.0</h4><ul>" +
    "<li>Experiment: the art director and homepage designer now run on bare-minimum prompts \u2014 the JSON schema, the technical contract, and nothing else. Compare a few generations against the archive.</li>" +
    "<li>Every design list \u2014 wp-admin and meikero.com \u2014 now shows the one-time preview picture instead of loading pages.</li>" +
    "<li>Each new design gets a painted moodboard cover \u2014 its palette, its mood, no fake UI \u2014 shown as the card art in the Wizard's library.</li>" +
    "</ul>" +
    "<h4>1.40.0</h4><ul>" +
    "<li>Every design now gets a real preview picture, taken from the finished homepage right after it is designed. The dashboard and the Wizard show the picture instead of loading each design's whole page \u2014 the archive opens instantly.</li>" +
    "<li>Editing a design retakes its picture, so the archive always shows the design as it is now.</li>" +
    "<li>New theme is called the Wizard everywhere, which is what everyone called it anyway.</li>" +
    "</ul>" +
    "<h4>1.39.0</h4><ul>" +
    "<li>The design studio: a Meikero-branded wizard with your design library right in it \u2014 any saved design is one click from being previewed, edited or built.</li>" +
    "<li>You choose which pages get designed. After approving the homepage, the planned pages appear as toggles \u2014 leave out the blog, keep the pricing page, your call.</li>" +
    "<li>The style cards now say what each direction actually produces, and one-click chips add the things worth having in a brief: colours, pages, audience, voice, language.</li>" +
    "<li>Fixed: with only the homepage designed, the preview rendered inside the hidden page rail's narrow column.</li>" +
    "<li>The design prompts were cut to the bare minimum \u2014 the JSON schema, the technical contract, and the rules with measured evidence behind them. Roughly half the total prompt volume, and over 80% of the instructional prose, is gone.</li>" +
    "</ul>" +
    "<h4>1.38.0</h4><ul>" +
    "<li>Designing a theme now has its own page \u2014 Meikero \u2192 New theme. The AI Editor is for editing a theme that exists, and no longer opens a wizard over a chat you cannot use yet.</li>" +
    "<li>The homepage arrives on its own, in about a minute, and stops there. You decide what happens next: design the rest of the site, change something, rewrite the brief, or take a different direction. Nothing else is spent until you do.</li>" +
    "<li>Because the pages are drawn after that, a change you make to the homepage now reaches every page \u2014 previously they had already been drawn from the version you were replacing.</li>" +
    "</ul>" +
    "<h4>1.37.0</h4><ul>" +
    "<li>Pages now keep the site's own left edge. A page that set its own margins used to start in a different place from the homepage \u2014 on one generation, four pages out of seven did, and one ran to the window edge. Every page is checked against the homepage now and redrawn once if it drifted.</li>" +
    "<li>A page that comes back too thin \u2014 headings with empty boxes under them \u2014 is redrawn rather than shipped.</li>" +
    "<li>If a page still does not match after the second attempt it is kept, and the preview says which one, instead of leaving you to find it.</li>" +
    "</ul>" +
    "<h4>1.36.0</h4><ul>" +
    "<li>A design is now a whole site you can walk through: the homepage, every page in the menu, the blog, a blog post and the 404 are each really designed, and clicking a link in the preview takes you to that page.</li>" +
    "<li>The preview lists the pages down the left, by name and by file, instead of a row of tabs.</li>" +
    "<li>The component sheet and the brand sheet are gone. Neither was a page anybody could reach, and the real pages now carry what they used to supply.</li>" +
    "<li>Pages are drawn at the same time rather than one after another, so a whole site takes about as long as one page used to — and a slow homepage no longer costs you the blog.</li>" +
    "</ul>" +
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
