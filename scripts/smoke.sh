#!/usr/bin/env bash
# Verifies the built server starts and answers tools/list.
#
# `npm run build` cannot catch a regression here: swapping the server class or
# registering no tools at all still type-checks cleanly, but makes tools/list
# return "Method not found" to every client.
set -euo pipefail

cd "$(dirname "$0")/.."

# Speaks the opening three messages of the protocol to the command in "$@" and
# fails unless tools/list comes back with at least one tool. $1 labels the run.
handshake() {
  label=$1
  shift
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | "$@" \
    | SMOKE_LABEL="$label" node -e '
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

handshake 'working tree' node dist/index.js

# What `npx -y conductor-cloud-plugin` downloads and runs, which is the only
# thing mcp.json points at now. The working-tree run above passes even when
# "files" or "bin" is wrong, and even when the bundle regressed to loading the
# SDK from disk — node_modules is right there. Unpacking the tarball on its own
# removes both crutches, so a package that would break on someone else's machine
# breaks here instead.
staged=$(mktemp -d)
trap 'rm -rf "$staged"' EXIT

# --silent keeps the tarball name the only thing on stdout. pack runs "prepare",
# so this builds from src rather than trusting whatever dist/ happens to hold.
tarball=$(npm pack --silent --pack-destination "$staged")
tar -xzf "$staged/$tarball" -C "$staged"

if [ -e "$staged/package/node_modules" ]; then
  echo 'smoke: tarball shipped node_modules, the check below would prove nothing' >&2
  exit 1
fi

# Resolved through "bin" rather than hardcoded: a bin entry naming a file that
# "files" leaves out is exactly the breakage that only surfaces under npx.
bin=$(cd "$staged/package" && node -p 'require("./package.json").bin["conductor-cloud-plugin"]')

if [ ! -f "$staged/package/$bin" ]; then
  echo "smoke: package.json bin names $bin, which the tarball does not contain" >&2
  exit 1
fi

handshake 'npm tarball' node "$staged/package/$bin"
