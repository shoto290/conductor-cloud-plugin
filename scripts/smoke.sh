#!/usr/bin/env bash
# Verifies the built server starts and answers tools/list.
#
# `npm run build` cannot catch a regression here: swapping the server class or
# registering no tools at all still type-checks cleanly, but makes tools/list
# return "Method not found" to every client.
#
# It starts through scripts/start.sh, the same entry point mcp.json uses, so a
# launcher that fails outright is caught here. It cannot prove the PATH-less
# case the launcher exists for: with a shell's full PATH, resolution stops at
# the first candidate and never reaches the fallbacks.
set -euo pipefail

cd "$(dirname "$0")/.."

# Speaks the opening three messages of the protocol to the launcher in $1 and
# fails unless tools/list comes back with at least one tool. $2 labels the run.
handshake() {
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | (cd "$1" && /bin/sh scripts/start.sh) \
    | SMOKE_LABEL="$2" node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => (raw += chunk));
      process.stdin.on("end", () => {
        const label = process.env.SMOKE_LABEL;
        const reply = raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .find((message) => message.id === 2);

        if (!reply) {
          console.error(`smoke: ${label}: no response to tools/list`);
          process.exit(1);
        }
        const tools = reply.result?.tools;
        if (!Array.isArray(tools) || tools.length === 0) {
          console.error(`smoke: ${label}: tools/list advertised no tools`);
          console.error(JSON.stringify(reply));
          process.exit(1);
        }
        console.log(`smoke: ${label} answered tools/list (${tools.length} tools)`);
      });
    '
}

handshake . 'working tree'

# The way Cursor actually installs this plugin: clone the repo, run nothing. So
# repeat the handshake against a copy with no node_modules, which fails unless
# dist/index.js is committed with its dependencies bundled in. The working-tree
# run above passes either way — node_modules is right there — which is exactly
# why it cannot catch a bundle that regressed to loading the SDK from disk.
staged=$(mktemp -d)
trap 'rm -rf "$staged"' EXIT
tar -cf - --exclude=./node_modules --exclude=./.git . | (cd "$staged" && tar -xf -)

if [ -e "$staged/node_modules" ]; then
  echo 'smoke: staging copy kept node_modules, the check below would prove nothing' >&2
  exit 1
fi

handshake "$staged" 'fresh install'
