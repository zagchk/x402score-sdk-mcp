# x402score-sdk

TypeScript client for the [x402Score](https://x402score.agenttrust.workers.dev) API — free, automated
reputation scores for x402-paid API endpoints.

**Beta** (0.x — the API client itself is stable; the pre-1.0 version reflects
scoring model maturity, not SDK code quality). The on-chain payment signal
feeding into scores (`onchainTotalPayments`, `onchainTrustFlag`, etc. — see the
main project README) was wired into live scoring on 2026-09-30 and hasn't yet
been validated against real calibration data; that gate closes ~2026-10-19
after three weekly calibration cycles. The MCP server (`mcp/` in this repo) is
deliberately held until then, since it's consumed autonomously by agents with
no human reading this caveat first — the SDK ships now because a human
integrating it can read this and make an informed call.

**Why trust the numbers**: every response can be verified two ways — a
per-response signature (`verifyScoreResponse`/`getVerifiedScore`, below) proves
a given API response really came from x402Score and wasn't altered in transit,
and a daily on-chain checkpoint (`getHistoricalScore`, below) proves the
underlying historical data wasn't quietly altered *after the fact* either.
Full explanation at [`/transparency`](https://x402score.agenttrust.workers.dev/transparency).

## Usage

```ts
import { X402ScoreClient } from "x402score-sdk";

const client = new X402ScoreClient();

const score = await client.getScore("a1b2c3d4e5f6a1b2");
// null if the endpoint hasn't been scored yet — not an error
if (score) {
  console.log(score.score, score.grade, score.scoreInterval);
}

const { endpoints, count } = await client.getLeaderboard();
const calibration = await client.getCalibration();
await client.submitEndpoint("https://api.example.com/weather");
```

### Verifying a signed response

When the deployment has response signing configured (see the main project
README), scores carry a `signature` you can verify without trusting whichever
URL or cache served it to you — only the signing key published at
`GET /.well-known/x402`:

```ts
import { X402ScoreClient, verifyScoreResponse } from "x402score-sdk";

const client = new X402ScoreClient();
const score = await client.getScore("a1b2c3d4e5f6a1b2");
const keys = await client.getSigningKeys(); // [{ address, validFrom, validUntil, label }]

if (score?.signature) {
  const key = keys.find((k) => !k.validUntil); // the current key — check validFrom/validUntil for an older score
  const ok = key && verifyScoreResponse(score, key.address);
  // ok === false for a null-signature response, a tampered field, or a signature that doesn't verify.
}
```

**What this proves, precisely:** authenticity of origin and integrity of
transit — the data really was produced by x402Score and hasn't been altered
since. It does **not** prove the score is accurate; a compromised deployment
holding the real key could still sign false data. See the main project README
and CHANGELOG for the full explanation, including the transparency log that
makes tampering detectable after the fact.

`verifyScoreResponse` recomputes `detailHash` from the response's own visible
fields before checking the signature — use the lower-level
`verifyScoreSignature` only if you're verifying a payload that didn't come
from this SDK's own response shape.

For the common case, `getVerifiedScore` bundles the fetch + key lookup +
verification above into one call, automatically picking the signing key that
was actually valid at the score's own `signedAt` (not just whichever key is
current now — a rotation could mean those differ):

```ts
const client = new X402ScoreClient();
const result = await client.getVerifiedScore("a1b2c3d4e5f6a1b2");
// null if the endpoint isn't scored yet, same as getScore.
if (result && !result.verified) {
  console.log("not verified:", result.reason); // "unsigned" | "no_matching_key" | "signature_invalid"
}
```

### Historical, checkpoint-backed score lookups

`getHistoricalScore(endpointId, date)` answers "what did this endpoint's score
say on this specific past UTC date," sourced from the daily tamper-evidence
checkpoint rather than the live `scores` table — useful for proving, after the
fact, exactly what the score said at the moment a payment decision was made:

```ts
const historical = await client.getHistoricalScore("a1b2c3d4e5f6a1b2", "2026-09-20");
// null if no checkpoint exists for that date, or this endpoint wasn't in it.
if (historical) {
  console.log(historical.score, historical.checkpoint.snapshotHash, historical.checkpoint.publishedTxHash);
}
```

See the main project's `/transparency` page for the full verification chain
(recompute the checkpoint's hash yourself, then confirm it against the Casper
on-chain record).

### Paid route

`getScoreFull` requires an x402-payment-capable `fetch` — this SDK never
handles wallets or payment-signing itself (a different kind of "signing" than
the response-signing above — this one is about who pays, not about proving
where the data came from):

```ts
import { X402ScoreClient } from "x402score-sdk";
import { withPaymentInterceptor } from "some-x402-fetch-wrapper"; // your choice

const client = new X402ScoreClient({ fetch: withPaymentInterceptor(fetch, wallet) });
const full = await client.getScoreFull("a1b2c3d4e5f6a1b2");
```

### Error handling

Every non-2xx response except `getScore`'s 404 (which returns `null` — "not
scored yet" is an expected, common case, not an error) throws
`X402ScoreApiError` with `.status` and `.body`:

```ts
import { X402ScoreApiError } from "x402score-sdk";

try {
  await client.submitEndpoint("not a url");
} catch (e) {
  if (e instanceof X402ScoreApiError) console.log(e.status, e.body);
}
```

## API surface

See [`/openapi.json`](https://x402score.agenttrust.workers.dev/openapi.json) for the
full machine-readable contract this client wraps.

## Development

```bash
npm install
npm run typecheck
```

Tests live in `test/` and run via the main project's `vitest` (from the repo root: `npm test`).
