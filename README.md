# x402Score — SDK & MCP server

Public client-side code for [x402Score](https://x402score.agenttrust.workers.dev) — free,
automated reputation scores for x402-paid API endpoints. The scoring backend itself is
closed-source (the exact weights, decay rate, and thresholds are deliberately unpublished,
to keep scores harder to game — see [`/docs`](https://x402score.agenttrust.workers.dev/docs)).
This repo is just the two things a developer or agent needs to *consume* x402Score
programmatically.

## Packages

- **[`sdk/`](./sdk)** — `x402score-sdk`, published on npm. TypeScript client for the full
  public API, plus signed-response verification. See [`sdk/README.md`](./sdk/README.md).
- **[`mcp/`](./mcp)** — `x402score-mcp`, an MCP server exposing four agent tools
  (`check_endpoint_score`, `search_leaderboard`, `get_calibration_report`,
  `submit_endpoint`), built on the SDK above. **Not yet published to any MCP registry** —
  held until the on-chain payment signal's calibration gate closes (~2026-10-19, after
  three weekly calibration cycles). See [`mcp/README.md`](./mcp/README.md).

## Status

| | Status |
|---|---|
| SDK (npm) | **Published** — `npm install x402score-sdk` |
| MCP server | Built, tested, not yet published — see `mcp/README.md` for why |

## Why trust the numbers

Every API response can be verified two ways: a per-response signature proves a given
response really came from x402Score and wasn't altered in transit, and a daily
blockchain-anchored checkpoint proves the underlying historical data wasn't quietly
altered after the fact either. Full explanation at
[`/transparency`](https://x402score.agenttrust.workers.dev/transparency).
