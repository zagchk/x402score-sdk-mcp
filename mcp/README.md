# x402score-mcp

MCP server exposing [x402Score](https://x402score.agenttrust.workers.dev)'s reputation data as
agent tools — check an x402-paid API endpoint's trust score before paying it,
from inside any MCP-compatible client (Claude Desktop, Claude Code, etc.).

**Not yet published/submitted anywhere.** Run it locally for now; see the main
project README for why publishing to an MCP registry is being held until the
on-chain modifier's calibration gate closes (~2026-10-19). Registry listing
content is pre-written in `REGISTRY_SUBMISSION.md`, ready to copy-paste the
moment the gate closes. Last re-verified end-to-end against live production
(real stdio MCP client, all 4 tools, confirmed on-chain fields and current
calibration data flow through correctly): 2026-10-04.

## Tools

- **`check_endpoint_score`** — score, grade, and credible interval for one endpoint by `endpointId`.
- **`search_leaderboard`** — search/browse tracked endpoints by name/domain/url/id and/or vertical.
- **`get_calibration_report`** — is the scoring formula actually predictive?
- **`submit_endpoint`** — add a new x402 endpoint to the monitoring queue.

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
