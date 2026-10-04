export interface ScoreInterval {
  low: number;
  high: number;
  /** Confidence level as a fraction, e.g. 0.9 for a 90% credible interval. */
  level: number;
}

export type ScoreRecommendation = "pay" | "avoid" | "uncertain";

export interface ScoreResponse {
  endpointId: string;
  score: number;
  grade: string;
  sampleSize: number;
  confidence: number;
  scoreInterval: ScoreInterval | null;
  riskFlags: string[];
  /** A derived convenience field, not an independent signal — see the Worker's
   * src/scoring/recommendation.ts for exactly what it does and doesn't account
   * for. Recomputed live from the other fields on this response; not part of
   * the signed payload. */
  recommendation: ScoreRecommendation;
  /** Days since x402Score first saw this endpoint listed — a free proxy for
   * operator/domain longevity, not a WHOIS lookup. Null for a submitted
   * endpoint pending its first probe. */
  catalogAgeDays: number | null;
  category: string | null;
  /** This endpoint's score percentile within its own category (0-100, higher is
   * better) — null if the category has too few scored peers to compare against,
   * or the hourly cache hasn't populated yet. */
  categoryPercentile: number | null;
  lastUpdated: string;
  /** See verifyScoreSignature — null on a deployment without response signing
   * configured, or a score computed before it was. */
  signature: string | null;
  signedAt: string | null;
  detailHash: string | null;
}

export type Verdict = "trusted" | "caution" | "risk";

export interface LeaderboardItem {
  id: string;
  name: string;
  url: string;
  domain: string | null;
  vertical: string;
  verdict: Verdict;
  score: number;
  grade: string;
  uptimePct: number;
  envelopeCompliancePct: number;
  priceStabilityPct: number;
  avgLatencyMs: number;
  priceUsdc: number | null;
  sampleSize: number;
  confidence: number;
  firstSeenAt: string;
  updatedAt: string;
  riskFlags: string[];
  scoreIntervalLow: number | null;
  scoreIntervalHigh: number | null;
  catalogAgeDays: number;
  categoryPercentile: number | null;
  /** Last up to 8 computed scores, chronological, oldest first. */
  trend: number[];
  updatedRelative: string;
  signature: string | null;
  signedAt: string | null;
  detailHash: string | null;
}

export interface LeaderboardResponse {
  endpoints: LeaderboardItem[];
  count: number;
  lastProbedAt: string | null;
}

export interface CalibrationDimension {
  correlation: number | null;
  meanAbsError?: number;
  meanAbsErrorMs?: number;
}

export interface CalibrationReport {
  generatedAt: string;
  sampleSize: number;
  status: string;
  dimensions: {
    uptime: CalibrationDimension;
    envelopeCompliance: CalibrationDimension;
    priceStability: CalibrationDimension;
    latency: CalibrationDimension;
  };
}

export type CalibrationResponse = CalibrationReport | { status: "no_report_yet" };

export interface SubmitResponse {
  endpointId: string;
  status: string;
}

export interface SigningKeyInfo {
  address: string;
  validFrom: string;
  /** null = still the current key. */
  validUntil: string | null;
  label: string | null;
}

/** GET /score/:endpointId?asOf=YYYY-MM-DD — a checkpoint-backed historical
 * answer, not the live score. Deliberately a different shape from
 * ScoreResponse (no `signature`/`recommendation`/`categoryPercentile` — those
 * are live-only concepts): see the main project's /transparency page for what
 * `checkpoint` proves and how to verify it independently. */
export interface HistoricalScoreResponse {
  endpointId: string;
  asOf: string;
  score: number;
  grade: string;
  sampleSize: number;
  confidence: number;
  uptimePct: number;
  envelopeCompliancePct: number;
  priceStabilityPct: number;
  avgLatencyMs: number;
  riskFlags: string[];
  updatedAt: string;
  checkpoint: {
    snapshotHash: string;
    /** null if this date's checkpoint hasn't been published to Casper yet. */
    publishedTxHash: string | null;
    publishedAt: string | null;
    verifyUrl: string;
  };
}

/** Result of X402ScoreClient.getVerifiedScore — bundles the score fetch with
 * signature verification against the correct (time-matched) signing key, so
 * callers don't have to assemble fetch + getSigningKeys + verifyScoreResponse
 * themselves for the common case. */
export interface VerifiedScoreResult {
  score: ScoreResponse;
  verified: boolean;
  /** Why `verified` is false — absent when `verified` is true.
   * "unsigned": this deployment/score has no signature to check.
   * "no_matching_key": no signing key was valid at this score's signedAt.
   * "signature_invalid": a matching key was found but verification failed. */
  reason?: "unsigned" | "no_matching_key" | "signature_invalid";
}

export class X402ScoreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "X402ScoreApiError";
  }
}
