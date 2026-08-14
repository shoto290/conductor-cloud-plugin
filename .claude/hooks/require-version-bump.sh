#!/usr/bin/env bash
# Stop hook: refuses to end a turn that changed what ships without raising the version.
#
# Two consumers key off that number and neither fails loudly. Cursor caches an
# installed plugin by `.cursor-plugin/plugin.json`, so a skill or mcp.json edit
# that leaves it alone keeps every editor on the copy it already has. npm refuses
# to publish a version that already exists, so a src/ fix with a stale
# package.json is a release that never happens. Either way the change ships and
# reaches nobody — which is what commit b8ba55b was cleaning up after.
#
# Blocking is exit 2 with the reason on stderr, which Claude Code feeds back to
# the model. No jq and no node on the path here: the hook has to run in whatever
# checkout it lands in, including one that was cloned and never installed.
set -euo pipefail

INPUT=$(cat)

# A blocked stop re-runs the model, which stops again. Bail on that second pass
# so a bump the model will not make cannot spin the turn forever.
case "$INPUT" in
  *'"stop_hook_active": true'* | *'"stop_hook_active":true'*) exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

MANIFEST=".cursor-plugin/plugin.json"
MARKETPLACE=".cursor-plugin/marketplace.json"
PACKAGE="package.json"

# Paths that reach no user: prose, editor and agent config, and dev tooling.
# `scripts/` qualifies since start.sh went away — smoke.sh and bump-version.sh
# both run here and never at install time. Everything else is either in the npm
# tarball or in the clone Cursor installs, so a path added later needs a bump by
# default. Keep this in step with the Layout table in AGENTS.md.
IGNORED='^(README\.md|AGENTS\.md|LICENSE|\.gitignore|\.gitattributes|\.claude/|\.context/|\.github/|scripts/)'

BASE=''
for candidate in origin/main main; do
  if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
    BASE=$candidate
    break
  fi
done

# Uncommitted work plus everything already committed on this branch: a turn that
# forgets the bump is just as likely to have committed the change first.
changed_paths() {
  git status --porcelain=v1 2>/dev/null | sed -e 's/^...//' -e 's/.* -> //'
  if [ -n "$BASE" ]; then
    git diff --name-only "$BASE...HEAD" 2>/dev/null
  fi
}

CHANGED=$(changed_paths | grep -Ev "$IGNORED" | sed '/^$/d' | sort -u || true)
[ -n "$CHANGED" ] || exit 0

# The plugin version is the first "version" key in each file: top level in the
# manifest and package.json, under "metadata" in the marketplace entry.
read_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n 1p
}

# Pure awk rather than `sort -V`, which the BSD sort on macOS does not have.
version_gt() {
  awk -v a="$1" -v b="$2" '
    BEGIN {
      na = split(a, x, ".")
      nb = split(b, y, ".")
      n = na > nb ? na : nb
      for (i = 1; i <= n; i++) {
        if (x[i] + 0 > y[i] + 0) exit 0
        if (x[i] + 0 < y[i] + 0) exit 1
      }
      exit 1
    }'
}

block() {
  printf '%s\n\nChanged:\n%s\n' "$1" "$(printf '%s\n' "$CHANGED" | sed 's/^/  - /')" >&2
  exit 2
}

WORK=$(read_version < "$MANIFEST" 2>/dev/null || true)
[ -n "$WORK" ] || block "This turn changed what ships, but $MANIFEST declares no version. Cursor installs by version, so it needs one before anything reaches a user."

BASE_VER=''
if [ -n "$BASE" ]; then
  BASE_VER=$(git show "$BASE:$MANIFEST" 2>/dev/null | read_version || true)
fi

if [ -n "$BASE_VER" ] && ! version_gt "$WORK" "$BASE_VER"; then
  block "This turn changed what ships, but the version is still $WORK — the number already on $BASE. Cursor keeps serving the plugin it cached under it, and npm will reject a publish that reuses it, so the change reaches nobody.

Run \`scripts/bump-version.sh <major|minor|patch>\`, which raises $MANIFEST, $MARKETPLACE, $PACKAGE and the lockfile together, then commit the result alongside the change. Pick the level by semver (https://semver.org): MAJOR for a breaking change, MINOR for a backward-compatible addition, PATCH for a fix. Judge it from what this turn actually changed. A change under src/ also has to be published — see Releasing in AGENTS.md."
fi

MARKETPLACE_VER=$(read_version < "$MARKETPLACE" 2>/dev/null || true)
PACKAGE_VER=$(read_version < "$PACKAGE" 2>/dev/null || true)

if [ "$MARKETPLACE_VER" != "$WORK" ] || [ "$PACKAGE_VER" != "$WORK" ]; then
  block "The version disagrees across the files that carry it: $MANIFEST says $WORK, $MARKETPLACE says ${MARKETPLACE_VER:-none}, $PACKAGE says ${PACKAGE_VER:-none}. Cursor reads the first, the marketplace listing the second, and npm publishes the third, so a user can install one version and run another.

Fix: set all three to the same number, then use \`scripts/bump-version.sh <major|minor|patch>\` from here on — it moves them together, and the lockfile with them."
fi

exit 0
