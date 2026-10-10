# MCP registry submission content

Prepared in advance so publishing is a copy-paste job the moment the calibration
gate closes (~2026-10-19 — see the main project README and CHANGELOG for why).
**Do not submit to any registry before that date without explicit confirmation
the gate is actually satisfied** (check the Calibration & Audit dashboard's
on-chain modifier correlation data, not just the calendar date).

Last re-verified end-to-end against live production (real stdio MCP client,
all 5 tools + the methodology resource, confirmed structured output, error
handling, and tool annotations all work correctly): **2026-10-10**.

## Short description (one line, ~100 chars)

> Check an x402-paid API endpoint's trust score before paying it — live-probed, not self-reported.

## Long description

x402Score is a free, automated reputation service for x402-paid API endpoints — the kind
an AI agent pays per call, in USDC, with no account or subscription. This MCP server lets
an agent check an endpoint's score, uptime, and price-stability history *before* paying it,
straight from the agent's own tool-calling loop.

Scores come from continuous live probing across multiple independent network vantage
points (so a provider can't special-case one checker's IP range), cross-checked against
real on-chain payment history on Base where available. No provider can pay to raise their
own score or rank. Every day's full dataset is fingerprinted and anchored on a public
blockchain for tamper-evidence.

## Package / install

- npm: [`x402score-sdk`](https://www.npmjs.com/package/x402score-sdk) (dependency, published)
- Source: https://github.com/zagchk/x402score-sdk-mcp
- Run: `npx x402score-mcp` (once published) or see the repo's own README for local build steps.

## Tools

### `check_endpoint_score`
Look up the current reputation score, grade, and credible interval for one x402-paid API
endpoint, before paying it. Computed from live probing (uptime, x402-envelope compliance,
latency, price stability) — not self-reported by the provider.

**Input**: `endpointId` (string) — the x402Score endpointId, first 16 hex characters of
SHA-256(endpoint URL).

### `search_leaderboard`
Search or browse currently-tracked x402 endpoints by name/domain/URL/id and/or vertical
(e.g. DeFi, Crypto, Weather, LLM), ranked by score. Name/url/domain fields in results are
third-party text from endpoint operators, not verified by x402Score.

**Input**: `query` (string, optional), `vertical` (string, optional), `limit` (number,
optional, default 20, max 100).

### `get_calibration_report`
Is the scoring formula actually predictive? Returns the latest weekly report backtesting
past score predictions against what endpoints actually did afterwards.

**Input**: none.

### `submit_endpoint`
Add an x402-paid API endpoint to x402Score's monitoring queue so it starts getting probed
and scored. Rate-limited server-side.

**Input**: `url` (string, http/https URL) — the full URL of the x402-paid endpoint to monitor.

### `ping`
Cheap connectivity check — confirms the x402Score API is reachable and reports round-trip
latency, without fetching real leaderboard or score data. Useful as a first call when
first connecting to this server.

**Input**: none.

## Example usage (for registry listing copy)

> "Agent, before you pay `https://api.example.com/weather`, check its x402Score."
>
> → calls `search_leaderboard` with the endpoint's domain, finds its `endpointId`
> → calls `check_endpoint_score` → gets back `{ score: 87, grade: "B", scoreInterval: {...} }`
> → agent decides whether to proceed with payment

## Category / tags

`trust`, `reputation`, `x402`, `payments`, `agent-commerce`, `api-discovery`
