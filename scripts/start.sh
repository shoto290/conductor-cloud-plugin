#!/bin/sh
# Starts the MCP server with a Node the GUI can actually find.
#
# Cursor launches plugin servers from the app, which inherits launchd's minimal
# PATH (/usr/bin:/bin:/usr/sbin:/sbin) instead of your login shell's. A bare
# `"command": "node"` therefore dies with `spawn node ENOENT` for anyone whose
# Node came from a version manager, even though the same command runs fine in a
# terminal. So resolve Node here rather than trust the inherited PATH.
#
# stdin and stdout are the JSON-RPC transport: nothing may read or write them
# before the exec. Diagnostics go to stderr, and every probe reads /dev/null.
set -eu

cd "$(dirname "$0")/.."

# Node 18 is the floor (package.json "engines"). Checking here turns an ancient
# node into one clear message instead of a syntax error from inside the SDK, and
# lets a candidate further down the list win. `-v` rather than `-p`: it prints
# during option parsing, which is ~8x cheaper than booting V8 to evaluate.
usable() {
  [ -x "$1" ] || return 1
  version=$("$1" -v </dev/null 2>/dev/null) || return 1
  version=${version#v}
  [ "${version%%.*}" -ge 18 ] 2>/dev/null
}

# Quoting each prefix and leaving the glob bare keeps paths containing spaces
# intact; an unmatched glob stays literal and falls out at the -x test.
node_bin=''
for candidate in \
  "${CONDUCTOR_NODE:-}" \
  "$(command -v node || true)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /opt/local/bin/node \
  "$HOME/.local/bin/node" \
  "$HOME/.volta/bin/node" \
  "$HOME/.local/share/mise/shims/node" \
  "$HOME/.asdf/shims/node" \
  "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
  "$HOME/Library/Application Support/fnm/node-versions"/*/installation/bin/node \
  "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node \
  /usr/local/n/versions/node/*/bin/node; do
  if usable "$candidate"; then
    node_bin=$candidate
    break
  fi
done

# Last resort: ask the login shell where its Node is, which covers prefixes the
# list above cannot know. Interactive as well as login, because zsh reads
# ~/.zshrc — where nvm and fnm install themselves — only when interactive.
# Deferred to the miss case: sourcing a real profile costs far more than every
# test above put together.
if [ -z "$node_bin" ] && [ -x "${SHELL:-}" ]; then
  # tail -1: a profile that prints a banner would otherwise return two lines.
  node_bin=$("$SHELL" -lic 'command -v node' </dev/null 2>/dev/null | tail -1)
  usable "$node_bin" || node_bin=''
fi

if [ -z "$node_bin" ]; then
  printf '%s\n' 'conductor-cloud: no Node.js 18+ found.' >&2
  printf '%s\n' 'Fix: set CONDUCTOR_NODE to the path from `command -v node`, then restart Cursor.' >&2
  exit 1
fi

if [ ! -f dist/index.js ]; then
  printf '%s\n' "conductor-cloud: dist/index.js is missing. Run 'npm install' in $(pwd), then restart Cursor." >&2
  exit 1
fi

exec "$node_bin" dist/index.js "$@"
