# WordPress plugin source

`wp-ai-builder-bridge` is the WordPress half of the AI Builder and is versioned
alongside the SaaS. As of **0.6.0** the whole plugin lives here — there is no
second tree and no hand-assembled zip.

```
wordpress/
  build-plugin-zip.sh          packages dist/wp-ai-builder-bridge-<version>.zip
  dist/                        build output
  wp-ai-builder-bridge/
    wp-ai-builder-bridge.php   header, constants, bootstrap, activation
    readme.txt                 WordPress-format readme and changelog
    uninstall.php              removes options, transients and snapshots
    includes/
      class-wpab-auth.php      bridge token: hashing, throttling, REST permission
      class-wpab-scopes.php    theme/plugin scopes and all path safety
      class-wpab-files.php     listing, manifest, reading
      class-wpab-writer.php    preflight, apply, snapshots, rollback, health
      class-wpab-rest.php      the /wp-json/wp-ai-builder/v1 routes
      class-wpab-admin.php     wp-admin screens
      class-wpab-cloud.php     the reverse direction (v3A)
      class-wpab-log.php       rolling activity log
```

## Building

```bash
PHP_BIN=/Applications/XAMPP/xamppfiles/bin/php ./wordpress/build-plugin-zip.sh
```

The version in the zip name is read from the plugin header, and every PHP file
is linted before packaging.

## The two directions

```
SaaS              --(Bearer bridge token)--------------->  WordPress
wp-admin browser  --(cookie + X-WP-Nonce, manage_options)->  WordPress
WordPress         --(Bearer site key + actor headers)---->  SaaS
```

The first is what `lib/wordpress/bridge.ts` speaks. The second and third are the
v3A auth flip: the site key never reaches the browser, and `manage_options` is
enforced in WordPress before any request leaves the site.

## Routes consumed by the SaaS

| Route | Used by |
| --- | --- |
| `GET /status` | `getBridgeStatus` — version, WP/PHP version, theme, capabilities |
| `GET /project` | `getBridgeProject` — scope labels and slugs |
| `GET /manifest` | `getBridgeManifest` — path + SHA-256 + per-scope fingerprint |
| `GET /files?scope=` | `listProjectFiles` |
| `GET /file?scope=&path=` | `readProjectFile` |
| `POST /preflight` | `preflightProjectChanges` |
| `POST /apply` | `applyProjectChanges` |
| `POST /rollback` | `rollbackProjectSnapshot` |
| `GET /snapshots` | `getBridgeSnapshots` |

`capabilities.controlled_write`, `write_files`, `create_files` and `preflight`
are what the deployment panel gates "Build mode ready" on. `write_files` and
`create_files` follow the admin's write policy, so switching the site to
read-only greys out deploys in the dashboard without revoking anything.

Preflight always answers `200`. "Not ready" is a report, not a transport error,
and the dashboard renders the per-file reasons out of `files[].error.message`.

## Safety model

* Token stored as SHA-256 only, compared in constant time, throttled per IP.
* Writes confined to the active theme and one admin-approved companion plugin.
* Traversal, denied directories (`vendor`, `node_modules`, `.git`, `uploads`, …),
  denied filenames (`wp-config.php`, `.env`, `.htaccess`, …) and non-allowlisted
  extensions are rejected before any file function runs; symlinks are never
  followed and are re-checked after `realpath`.
* `modify` requires the file to still hash to the SHA-256 the proposal planned
  against. `create` requires the path not to exist. Delete and rename do not exist.
* PHP is parsed with the tokenizer (never executed) and JSON is decoded before
  either is written.
* Every deployment snapshots the previous bytes first, writes through
  temp-file + rename, then fetches the front page and REST root back. A 5xx or a
  visible PHP fatal rolls the entire change set back inside the same request.
* Rollback refuses to overwrite a file edited after the deployment unless forced.

## Connecting a site

1. wp-admin → **AI Builder → Bridge** → **Generate token**. Copy it once.
2. Builder dashboard → project → WordPress connection → paste site URL + token.
3. Optional: pick a **Companion plugin** so business logic has a home outside the theme.
4. Optional: project → **Site keys** → **New key**, then wp-admin →
   **AI Builder → Cloud connection** → paste `esk_live_...` → **Connect**.

Connecting calls `POST /api/agent/session` to verify the key and cache the
project name.

## Pointing at a different builder

```php
add_filter( 'wpab_builder_url', fn() => 'https://staging.builder.example.com' );
```

HTTPS is required.

## Available to the future editor

```php
$session = WPAB_Cloud::session();                    // handshake
$result  = WPAB_Cloud::request( 'agent/session' );   // any /api/* route
```

Both return a decoded array or `WP_Error`. The browser-facing entry point is
`POST /wp-json/wp-ai-builder/v1/cloud/session`, which uses cookie auth plus the
standard `wp_rest` nonce — **not** the bridge bearer token.
