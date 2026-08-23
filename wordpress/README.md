# WordPress plugin source

The `wp-ai-builder-bridge` plugin is now versioned alongside the SaaS instead of
being distributed as loose zips. Only files that the SaaS repo owns live here;
the rest of the plugin still ships from its own tree until it is fully migrated.

## v3A — auth flip

`includes/class-wpab-cloud.php` turns WordPress into a *client* of the builder.

Before, the direction was one-way:

```
SaaS  --(Bearer bridge token)-->  WordPress
```

The wp-admin editor needs the reverse, so the full chain is now:

```
wp-admin browser  --(cookie + X-WP-Nonce, manage_options)-->  WordPress
WordPress         --(Bearer site key + actor headers)------->  SaaS
SaaS              --(Bearer bridge token, unchanged)-------->  WordPress
```

The site key never reaches the browser, and `manage_options` is enforced in
WordPress before any request leaves the site.

### Installing

Add to `wp-ai-builder-bridge.php`:

```php
require_once WPAB_DIR . 'includes/class-wpab-cloud.php';
```

and inside the existing `plugins_loaded` callback:

```php
WPAB_Cloud::init();
```

No other plugin file needs to change — the class registers its own submenu page
under the existing **AI Builder** menu.

### Connecting a site

1. In the builder dashboard, open the project → **Site keys** → **New key**.
2. Copy the key (`esk_live_...`). It is shown once.
3. In wp-admin: **AI Builder → Cloud connection**, paste, **Connect**.

Connecting immediately calls `POST /api/agent/session` to verify the key and
cache the project name.

### Pointing at a different builder

```php
add_filter( 'wpab_builder_url', fn() => 'https://staging.builder.example.com' );
```

HTTPS is required.

### Available to the future editor

```php
$session = WPAB_Cloud::session();                    // handshake
$result  = WPAB_Cloud::request( 'agent/session' );   // any /api/* route
```

Both return a decoded array or `WP_Error`.

The REST route `POST /wp-json/wp-ai-builder/v1/cloud/session` is the
browser-facing entry point. It uses cookie auth plus the standard `wp_rest`
nonce — **not** the bridge bearer token.
