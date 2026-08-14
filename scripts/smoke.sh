#!/usr/bin/env bash
# Verifies the built server starts and answers tools/list.
#
# `npm run build` cannot catch a regression here: dropping the ListTools handler
# or swapping the server class still type-checks cleanly, but makes tools/list
# return "Method not found" to every client.
set -euo pipefail

cd "$(dirname "$0")/.."

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js \
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
      if (!Array.isArray(reply.result?.tools)) {
        console.error("smoke: tools/list did not return a tool list");
        console.error(JSON.stringify(reply));
        process.exit(1);
      }
      console.log(`smoke: server answered tools/list (${reply.result.tools.length} tools)`);
    });
  '
