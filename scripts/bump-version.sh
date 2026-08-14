#!/usr/bin/env bash
# Raises the plugin version everywhere it is written down, in one step.
#
# One number lives in three files — .cursor-plugin/plugin.json, package.json,
# and package-lock.json — and Cursor and npm each read a different one. Bumping
# them by hand is how they drifted apart before, so this script is the only
# supported way to move the version.
set -euo pipefail

cd "$(dirname "$0")/.."

LEVEL=${1:-}
case "$LEVEL" in
  major | minor | patch) ;;
  *)
    printf 'usage: scripts/bump-version.sh <major|minor|patch>\n' >&2
    exit 2
    ;;
esac

MANIFEST=".cursor-plugin/plugin.json"
PACKAGE="package.json"

# The plugin version is the first "version" key in each file, top level in both.
read_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | sed -n 1p
}

manifest_version=$(read_version "$MANIFEST")
package_version=$(read_version "$PACKAGE")

# Refuse to bump files that already disagree: npm computes the next version from
# package.json alone, so whatever it lands on would be wrong for the other.
if [ "$manifest_version" != "$package_version" ]; then
  printf 'bump-version: these files disagree before the bump:\n' >&2
  printf '  %-34s %s\n' "$MANIFEST" "$manifest_version" >&2
  printf '  %-34s %s\n' "$PACKAGE" "$package_version" >&2
  printf 'Fix: set both to the same version, then run this again.\n' >&2
  exit 1
fi

# npm owns package.json and package-lock.json. It keeps the lockfile's two
# copies of the number in step, which a sed over the file would not.
next=$(npm version "$LEVEL" --no-git-tag-version | tail -n1)
next=${next#v}

# Substitutes the matched key only, so the file keeps its own indentation.
set_version() {
  file=$1
  awk -v version="$next" '
    !bumped && /"version"[[:space:]]*:[[:space:]]*"[^"]*"/ {
      sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"" version "\"")
      bumped = 1
    }
    { print }
  ' "$file" > "$file.bump"
  mv "$file.bump" "$file"

  if [ "$(read_version "$file")" != "$next" ]; then
    printf 'bump-version: %s still reads %s, not %s.\n' "$file" "$(read_version "$file")" "$next" >&2
    exit 1
  fi
}

set_version "$MANIFEST"

printf '%s -> %s\n' "$manifest_version" "$next"
printf 'Updated %s, %s, package-lock.json. Commit them with the change.\n' \
  "$MANIFEST" "$PACKAGE"
