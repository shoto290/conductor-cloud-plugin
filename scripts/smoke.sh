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

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | /bin/sh scripts/start.sh \
  | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      const reply = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find((message) => message.id === 2);

      if (!reply) {
        console.error("smoke: no response to tools/list");
        process.exit(1);
      }
      const tools = reply.result?.tools;
      if (!Array.isArray(tools) || tools.length === 0) {
        console.error("smoke: tools/list advertised no tools");
        console.error(JSON.stringify(reply));
        process.exit(1);
      }
      console.log(`smoke: server answered tools/list (${tools.length} tools)`);
    });
  '
