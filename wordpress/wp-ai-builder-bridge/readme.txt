=== WP AI Builder Bridge ===
Contributors: escanor
Tags: ai, deployment, developer, rollback, rest-api
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.6.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects a WordPress site to the ESCANOR AI Builder: project inspection, SHA-verified deployments, snapshots and one-click rollback.

== Description ==

The bridge gives the AI Builder a narrow, auditable door into this site.

**What it can do**

* List and read files in the active theme and one companion plugin you approve.
* Return a manifest (path + SHA-256 for every file) so the builder always plans against real, current code.
* Preflight a proposed change set: path allowlist, SHA state, PHP parse check, size limits.
* Apply a reviewed change set: snapshot first, atomic writes, then a health check.
* Roll back a deployment, restoring modified files and removing created ones.

**What it can never do**

* Delete or rename existing files.
* Touch anything outside the active theme and the approved companion plugin.
* Read or write wp-config.php, .env, .htaccess, uploads, vendor, node_modules or .git.
* Execute anything it received over the network.

**How safety is enforced**

* Every request needs the bridge token. Only its SHA-256 is stored; failed attempts are throttled per IP.
* Every path is validated for traversal, denied directories, denied filenames and denied extensions, then re-checked against the scope root after symlink resolution.
* A modify only proceeds if the file still hashes to the SHA-256 the builder planned against, so concurrent edits can never be silently overwritten.
* A create only proceeds if the path does not exist.
* PHP is parsed (never executed) before it is written. A syntax error fails preflight.
* Writes go through a temp file plus rename, so no request ever reads a half-written file.
* After a deployment the front page and REST root are fetched back. A 5xx or a visible PHP fatal triggers an automatic rollback before the request returns.

== Installation ==

1. Upload the plugin and activate it.
2. Go to **AI Builder → Bridge** and press **Generate token**. Copy the token — it is shown once.
3. In the AI Builder dashboard, open your project's WordPress connection and paste the site URL plus the token.
4. Optional: choose a **Companion plugin** so the builder can own business logic separately from the theme.
5. Optional: go to **AI Builder → Cloud connection** and paste a site key (`esk_live_...`) so the wp-admin editor can talk to the builder directly.

If authentication fails on a shared host, the `Authorization` header is probably being stripped. Either add

    SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1

to `.htaccess`, or have the builder send the token in `X-WPAB-Token` instead.

== Frequently Asked Questions ==

= Where are snapshots stored? =

In `wp-content/uploads/wp-ai-builder-<random>/snapshots/`. The directory is denied at the web server level and its name carries a random suffix so it cannot be guessed. Uninstalling the plugin deletes it.

= Can I keep the builder read-only? =

Yes. Turn off **Deployments** under Write policy. The builder keeps its read access and reports that writes are unavailable, without you having to revoke the token.

= A deployment failed and the site looks fine. What happened? =

That is the expected outcome. Any write failure or a failed post-deployment health check rolls the whole change set back before the request returns, and the failure is recorded in **AI Builder → Activity log**.

= Rollback says "changed since deployment". =

Somebody edited that file after the deployment. The bridge refuses to destroy work it did not make. Tick **force** on the snapshots screen to restore anyway.

== Changelog ==

= 0.6.0 =
* First fully packaged release: the whole bridge now ships as one plugin instead of loose files.
* Added the cloud client (v3A) so wp-admin can call the builder as a project-scoped client, with `manage_options` enforced before any request leaves the site.
* Added **Snapshots** and **Activity log** admin screens with manual and forced rollback.
* Added a write policy: deployments, file creation and the risky-PHP guard can each be toggled without revoking the token.
* Added per-IP throttling of failed bridge authentication and `X-WPAB-Token` fallback for hosts that strip `Authorization`.
* Added PHP parse validation via the tokenizer, replacing the dependency on shelling out to `php -l`.
* Added JSON validation, per-file and total byte limits, and duplicate-file detection in preflight.
* Snapshot storage moved to a randomised, web-denied directory and is pruned to a configurable depth.
* Symlinks are now skipped when walking a scope and rejected when resolving a path.

= 0.5.0 =
* Controlled write: preflight, SHA-256 verified modify, file creation, snapshots, health checks, rollback.

= 0.4.0 =
* Manifest endpoint with per-file SHA-256 and per-scope fingerprints.

= 0.3.0 =
* Read-only project inspection: status, project, files and file endpoints.

== Upgrade Notice ==

= 0.6.0 =
Adds the wp-admin cloud client, snapshot and activity screens, and a toggleable write policy. Existing bridge tokens keep working.
