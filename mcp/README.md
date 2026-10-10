# x402score-mcp

MCP server exposing [x402Score](https://x402score.agenttrust.workers.dev)'s reputation data as
agent tools — check an x402-paid API endpoint's trust score before paying it,
from inside any MCP-compatible client (Claude Desktop, Claude Code, etc.).

**Not yet published/submitted anywhere.** Run it locally for now; see the main
project README for why publishing to an MCP registry is being held until the
on-chain modifier's calibration gate closes (~2026-10-19). Registry listing
content is pre-written in `REGISTRY_SUBMISSION.md`, ready to copy-paste the
moment the gate closes. Last re-verified end-to-end against live production
(real stdio MCP client, all 5 tools + the methodology resource, confirmed
structured output, error handling, and tool annotations all work correctly):
2026-10-10.

## Tools

- **`check_endpoint_score`** — score, grade, and credible interval for one endpoint by `endpointId`.
- **`search_leaderboard`** — search/browse tracked endpoints by name/domain/url/id and/or vertical.
- **`get_calibration_report`** — is the scoring formula actually predictive?
- **`submit_endpoint`** — add a new x402 endpoint to the monitoring queue.
- **`ping`** — cheap reachability/latency check, useful as a first call when connecting.

All tools declare `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`
annotations and a matching `outputSchema`, and all return structured errors
(`isError: true` with a clear message) instead of letting a network failure or
backend timeout kill the connection. A `x402score://methodology` resource
explains what the score, grade, credible interval, and on-chain modifier
actually mean — read once per session rather than inferred from tool
descriptions alone. Requests time out client-side after 10s so a slow or
degraded backend fails fast and visibly instead of hanging the caller.

## Install & run

```bash
cd sdk && npm install && npm run build   # build the SDK this server depends on
cd ../mcp && npm install && npm run build
npm start
```

## Use from Claude Desktop / Claude Code

Add to your MCP client config:

```json
{
  "mcpServers": {
    "x402score": {
      "command": "node",
      "args": ["/absolute/path/to/x402score/mcp/dist/server.js"]
    }
  }
}
```

Optionally set `X402SCORE_BASE_URL` in the server's `env` to point at a local
`wrangler dev` or staging deployment instead of production.

## Development

Tool logic (`src/tools.ts`) is separated from MCP protocol wiring
(`src/server.ts`) specifically so it's testable without a real MCP transport —
tests run via the main project's `vitest` (from the repo root: `npm test`).
`src/server.ts` wires those same functions into `@modelcontextprotocol/sdk`'s
`McpServer`, connected over stdio.
