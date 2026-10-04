import {
  CalibrationResponse,
  HistoricalScoreResponse,
  LeaderboardResponse,
  ScoreResponse,
  SigningKeyInfo,
  SubmitResponse,
  VerifiedScoreResult,
  X402ScoreApiError,
} from "./types.js";
import { verifyScoreResponse } from "./verify.js";

export interface X402ScoreClientOptions {
  /** Defaults to the production deployment. Point at a local `wrangler dev` or
   * staging URL for testing. */
  baseUrl?: string;
  /** Injectable fetch — lets callers supply an x402-payment-capable fetch (e.g.
   * from an x402 wallet/fetch wrapper) for `getScoreFull`, and lets tests supply
   * a mock. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://x402score.agenttrust.workers.dev";

/** Thin client for the free/paid x402Score JSON API — no wallet or payment
 * logic of its own. `getScoreFull` (the one paid route) requires the caller to
 * supply an x402-payment-capable `fetch` via the constructor options; this SDK
 * never handles signing or a wallet directly. */
export class X402ScoreClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: X402ScoreClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Current score for one endpoint, or `null` if it hasn't been scored yet
   * (mirrors the API's own 404 semantics — this is an expected, common case,
   * not treated as an error). */
  async getScore(endpointId: string): Promise<ScoreResponse | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/score/${encodeURIComponent(endpointId)}`);
    if (res.status === 404) return null;
    return this.parseOrThrow<ScoreResponse>(res);
  }

  /** What this endpoint's score said on a specific past UTC date, sourced from
   * that day's tamper-evidence checkpoint rather than the live `scores` table
   * — see the main project's /transparency page. `null` if no checkpoint
   * exists for that date, or the endpoint had no scored entry in it (mirrors
   * getScore's 404-to-null convention). `date` must be `YYYY-MM-DD`. */
  async getHistoricalScore(endpointId: string, date: string): Promise<HistoricalScoreResponse | null> {
    const res = await this.fetchImpl(`${this.baseUrl}/score/${encodeURIComponent(endpointId)}?asOf=${encodeURIComponent(date)}`);
    if (res.status === 404) return null;
    return this.parseOrThrow<HistoricalScoreResponse>(res);
  }

  /** Every currently-listed endpoint with its score. With ~1,000 endpoints
   * tracked, this is a real payload (hundreds of KB) — cache it on your side
   * rather than calling this per user request. */
  async getLeaderboard(): Promise<LeaderboardResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/leaderboard.json`);
    return this.parseOrThrow<LeaderboardResponse>(res);
  }

  /** The latest weekly calibration report — is the scoring formula actually
   * predictive? `{ status: "no_report_yet" }` before the first one lands. */
  async getCalibration(): Promise<CalibrationResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/calibration`);
    return this.parseOrThrow<CalibrationResponse>(res);
  }

  /** Adds an endpoint to the monitoring queue. Rate-limited server-side to
   * 5/hour per IP — a 429 throws X402ScoreApiError, same as any other non-2xx. */
  async submitEndpoint(url: string): Promise<SubmitResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return this.parseOrThrow<SubmitResponse>(res);
  }

  /** The full audit breakdown + recent raw probes for one endpoint — requires
   * an x402 payment ($0.005 USDC on Base mainnet). Pass an x402-payment-capable
   * `fetch` via the constructor's `fetch` option; a plain fetch will only ever
   * see the 402 challenge, never the real response. */
  async getScoreFull(endpointId: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/score/${encodeURIComponent(endpointId)}/full`);
    return this.parseOrThrow<unknown>(res);
  }

  /** Every signing key this deployment has ever used (see verifyScoreSignature) —
   * current and retired, `validUntil: null` meaning still current. Look up the
   * key that was valid at a specific score's `signedAt` rather than assuming
   * the first/only entry, since a rotation could have happened since. */
  async getSigningKeys(): Promise<SigningKeyInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/.well-known/x402`);
    const body = await this.parseOrThrow<{ signingKeys?: SigningKeyInfo[] }>(res);
    return body.signingKeys ?? [];
  }

  /** Fetches a score and verifies its signature in one call, automatically
   * picking the signing key that was valid at the score's own `signedAt`
   * (a rotation could mean the current key isn't the right one to check
   * against) — the fetch + getSigningKeys + verifyScoreResponse sequence
   * callers would otherwise assemble by hand for the common case of "give me
   * a score I can actually trust, not just one I have to separately verify."
   * Returns `null` if the endpoint isn't scored yet, same as getScore. */
  async getVerifiedScore(endpointId: string): Promise<VerifiedScoreResult | null> {
    const score = await this.getScore(endpointId);
    if (!score) return null;

    if (!score.signature || !score.signedAt) {
      return { score, verified: false, reason: "unsigned" };
    }

    const signedAtMs = new Date(score.signedAt).getTime();
    const keys = await this.getSigningKeys();
    const matchingKey = keys.find((k) => {
      const validFromMs = new Date(k.validFrom).getTime();
      const validUntilMs = k.validUntil ? new Date(k.validUntil).getTime() : null;
      return signedAtMs >= validFromMs && (validUntilMs === null || signedAtMs < validUntilMs);
    });
    if (!matchingKey) {
      return { score, verified: false, reason: "no_matching_key" };
    }

    const verified = verifyScoreResponse(score, matchingKey.address);
    return verified ? { score, verified: true } : { score, verified: false, reason: "signature_invalid" };
  }

  private async parseOrThrow<T>(res: Response): Promise<T> {
    let body: unknown = null;
    let parseFailed = false;
    try {
      body = await res.json();
    } catch {
      parseFailed = true;
    }
    if (!res.ok) {
      throw new X402ScoreApiError(`x402Score API request failed with status ${res.status}`, res.status, body);
    }
    if (parseFailed) {
      // A 2xx with an unparseable body is a broken response, not a "no data"
      // case — throwing here surfaces it instead of silently handing the
      // caller a `null` typed as T, which would otherwise fail confusingly
      // deep in their own code (e.g. `.score` on `null`).
      throw new X402ScoreApiError(`x402Score API returned a ${res.status} response with an unparseable body`, res.status, null);
    }
    return body as T;
  }
}
