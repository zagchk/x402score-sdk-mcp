import { describe, expect, it, vi } from "vitest";
import { X402ScoreClient } from "../src/client";
import { X402ScoreApiError } from "../src/types";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function mockFetchRawBody(status: number, rawBody: string): typeof fetch {
  return vi.fn(async () => new Response(rawBody, { status })) as unknown as typeof fetch;
}

describe("X402ScoreClient", () => {
  it("uses the production base URL by default", async () => {
    const fetchImpl = mockFetch(200, { endpointId: "abc", score: 80 });
    const client = new X402ScoreClient({ fetch: fetchImpl });
    await client.getScore("abc");
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://x402score.agenttrust.workers.dev/score/abc");
  });

  it("respects a custom baseUrl and strips a trailing slash", async () => {
    const fetchImpl = mockFetch(200, { endpointId: "abc", score: 80 });
    const client = new X402ScoreClient({ baseUrl: "http://127.0.0.1:8787/", fetch: fetchImpl });
    await client.getScore("abc");
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://127.0.0.1:8787/score/abc");
  });

  it("URL-encodes the endpointId", async () => {
    const fetchImpl = mockFetch(200, {});
    const client = new X402ScoreClient({ fetch: fetchImpl });
    await client.getScore("a/b c");
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://x402score.agenttrust.workers.dev/score/a%2Fb%20c");
  });

  it("getScore returns null on a 404 instead of throwing", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(404, { error: "not_found" }) });
    expect(await client.getScore("unknown")).toBeNull();
  });

  it("getScore returns the parsed body on success", async () => {
    const score = { endpointId: "abc", score: 91, grade: "A", sampleSize: 40, confidence: 0.8, scoreInterval: { low: 80, high: 97, level: 0.9 }, riskFlags: [], lastUpdated: "2026-09-18T00:00:00.000Z" };
    const client = new X402ScoreClient({ fetch: mockFetch(200, score) });
    expect(await client.getScore("abc")).toEqual(score);
  });

  it("getHistoricalScore builds the ?asOf= query and returns null on 404", async () => {
    const fetchImpl = mockFetch(404, { error: "not_found" });
    const client = new X402ScoreClient({ fetch: fetchImpl });
    expect(await client.getHistoricalScore("abc", "2026-09-20")).toBeNull();
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://x402score.agenttrust.workers.dev/score/abc?asOf=2026-09-20",
    );
  });

  it("getHistoricalScore returns the parsed body on success", async () => {
    const historical = {
      endpointId: "abc",
      asOf: "2026-09-20",
      score: 85,
      grade: "B",
      sampleSize: 30,
      confidence: 0.7,
      uptimePct: 98,
      envelopeCompliancePct: 100,
      priceStabilityPct: 95,
      avgLatencyMs: 150,
      riskFlags: [],
      updatedAt: "2026-09-20T12:00:00.000Z",
      checkpoint: { snapshotHash: "0xabc", publishedTxHash: null, publishedAt: null, verifyUrl: "/checkpoints/2026-09-20" },
    };
    const client = new X402ScoreClient({ fetch: mockFetch(200, historical) });
    expect(await client.getHistoricalScore("abc", "2026-09-20")).toEqual(historical);
  });

  it("throws X402ScoreApiError with status and body for a non-404 error", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(500, { error: "internal" }) });
    await expect(client.getScore("abc")).rejects.toMatchObject({
      name: "X402ScoreApiError",
      status: 500,
      body: { error: "internal" },
    });
  });

  it("throws X402ScoreApiError instead of returning null for a 200 with an unparseable body", async () => {
    const client = new X402ScoreClient({ fetch: mockFetchRawBody(200, "not json") });
    await expect(client.getScore("abc")).rejects.toMatchObject({ name: "X402ScoreApiError", status: 200 });
  });

  it("getLeaderboard calls /leaderboard.json", async () => {
    const fetchImpl = mockFetch(200, { endpoints: [], count: 0, lastProbedAt: null });
    const client = new X402ScoreClient({ fetch: fetchImpl });
    await client.getLeaderboard();
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://x402score.agenttrust.workers.dev/leaderboard.json");
  });

  it("getCalibration surfaces the no_report_yet shape as-is", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(200, { status: "no_report_yet" }) });
    expect(await client.getCalibration()).toEqual({ status: "no_report_yet" });
  });

  it("submitEndpoint POSTs JSON with the url and returns the parsed body", async () => {
    const fetchImpl = mockFetch(202, { endpointId: "abc", status: "pending_first_probe" });
    const client = new X402ScoreClient({ fetch: fetchImpl });
    const result = await client.submitEndpoint("https://example.com/api");
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://x402score.agenttrust.workers.dev/submit");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ url: "https://example.com/api" });
    expect(result).toEqual({ endpointId: "abc", status: "pending_first_probe" });
  });

  it("submitEndpoint throws on a 429 rate limit", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(429, { error: "rate_limited" }) });
    await expect(client.submitEndpoint("https://example.com/api")).rejects.toThrow(X402ScoreApiError);
  });
});
