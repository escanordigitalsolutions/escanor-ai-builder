#!/usr/bin/env bash
#
# Packages wp-ai-builder-bridge into an installable zip.
#
# The version comes from the plugin header, so the zip name can never drift
# from what WordPress will report after installing it.
#
#   ./wordpress/build-plugin-zip.sh
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/wp-ai-builder-bridge"
dist="$here/dist"

version="$(grep -m1 '^ \* Version:' "$src/wp-ai-builder-bridge.php" | sed -E 's/.*Version:[[:space:]]*//')"

if [[ -z "$version" ]]; then
	echo "Could not read Version from the plugin header." >&2
	exit 1
fi

# Fail early rather than shipping a plugin that white-screens on activation.
php_bin="${PHP_BIN:-php}"

if command -v "$php_bin" >/dev/null 2>&1; then
	while IFS= read -r file; do
		"$php_bin" -l "$file" >/dev/null
	done < <(find "$src" -name '*.php')
	echo "Lint passed."
else
	echo "No PHP binary found, skipping lint. Set PHP_BIN to enable it."
fi

mkdir -p "$dist"

zip_path="$dist/wp-ai-builder-bridge-$version.zip"
rm -f "$zip_path"

# Zip from the parent so the archive contains a wp-ai-builder-bridge/ folder,
# which is what the wp-admin uploader expects.
(
	cd "$here"
	zip -rq "$zip_path" wp-ai-builder-bridge \
		-x '*.DS_Store' \
		-x '*/.git/*' \
		-x '*/node_modules/*'
)

echo "Built $zip_path"
unzip -l "$zip_path"
