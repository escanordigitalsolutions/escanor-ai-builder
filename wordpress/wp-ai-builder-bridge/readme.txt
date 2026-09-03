=== WP AI Builder Bridge ===
Contributors: escanor
Tags: ai, rest-api, developer, inspection
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.44.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects a WordPress site to the AI Builder for read-only inspection: the AI Editor can look at the active theme and the site's content and answer questions about it.

== Description ==

The bridge gives the AI Builder a narrow, auditable, read-only door into this site. It powers the in-admin AI Editor: a full-screen live preview plus a chat that can inspect the theme and content and answer questions.

**What it can do**

* List and read files in the active theme.
* Return a manifest (path + SHA-256 for every file) so the AI always reasons about real, current code.
* Read the site's native content — pages, posts, custom post types, WooCommerce products, menus and media.

**What it can never do**

* Modify, create, delete or rename any file.
* Touch anything outside the active theme.
* Read wp-config.php, .env, .htaccess, uploads, vendor, node_modules or .git.
* Execute anything it received over the network.

**How safety is enforced**

* Every request needs the bridge token. Only its SHA-256 is stored; failed attempts are throttled per IP.
* Every path is validated for traversal, denied directories, denied filenames and denied extensions, then re-checked against the theme root after symlink resolution.
* The REST surface is read-only — there are no write endpoints.

== Installation ==

1. Upload the plugin and activate it.
2. Go to **ESCANOR → Bridge settings** and press **Generate token**. Copy the token — it is shown once.
3. In the AI Builder dashboard, open your site's WordPress connection and paste the site URL plus the token.
4. Optional: go to **ESCANOR → Cloud connection** and paste a site key (`esk_live_...`) so the wp-admin AI Editor can talk to the builder directly.

== Changelog ==

= 0.62.0 =
* Clean base: read-only bridge. Removed the write/deploy/rollback pipeline, theme generation and the setup wizard. The AI Editor is now a lean shell — live preview, theme recognition and read-only chat — to be built on fresh.
