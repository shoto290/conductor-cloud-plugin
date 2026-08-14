#!/usr/bin/env bash
# Verifies the built server starts and answers tools/list.
#
# `npm run build` cannot catch a regression here: swapping the server class or
# registering no tools at all still type-checks cleanly, but makes tools/list
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
      const tools = reply.result?.tools;
      if (!Array.isArray(tools) || tools.length === 0) {
        console.error("smoke: tools/list advertised no tools");
        console.error(JSON.stringify(reply));
        process.exit(1);
      }
      console.log(`smoke: server answered tools/list (${tools.length} tools)`);
    });
  '
