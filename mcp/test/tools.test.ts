import { describe, expect, it, vi } from "vitest";
import { X402ScoreClient, LeaderboardItem } from "x402score-sdk";
import { checkEndpointScore, filterLeaderboardItems, getCalibrationReport, isHttpUrl, searchLeaderboard, submitEndpointForMonitoring } from "../src/tools";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function makeItem(overrides: Partial<LeaderboardItem>): LeaderboardItem {
  return {
    id: "id1",
    name: "Test Endpoint",
    url: "https://example.com/api",
    domain: "example.com",
    vertical: "DeFi",
    verdict: "trusted",
    score: 90,
    grade: "A",
    uptimePct: 99,
    envelopeCompliancePct: 100,
    priceStabilityPct: 100,
    avgLatencyMs: 120,
    priceUsdc: 0.001,
    sampleSize: 40,
    confidence: 0.8,
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    riskFlags: [],
    scoreIntervalLow: 80,
    scoreIntervalHigh: 97,
    trend: [80, 85, 90],
    updatedRelative: "2m ago",
    ...overrides,
  };
}

describe("checkEndpointScore", () => {
  it("reports found:false with a clear message when there's no score yet", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(404, {}) });
    const result = await checkEndpointScore(client, "unknown-id");
    expect(result).toEqual({ found: false, message: 'No score for endpointId "unknown-id" yet.' });
  });

  it("reports found:true with the score on success", async () => {
    const score = { endpointId: "abc", score: 91, grade: "A", sampleSize: 40, confidence: 0.8, scoreInterval: null, riskFlags: [], lastUpdated: "2026-09-18T00:00:00.000Z" };
    const client = new X402ScoreClient({ fetch: mockFetch(200, score) });
    const result = await checkEndpointScore(client, "abc");
    expect(result).toEqual({ found: true, score });
  });
});

describe("filterLeaderboardItems", () => {
  const items = [
    makeItem({ id: "a", name: "Weather API", vertical: "Weather", domain: "weather.example" }),
    makeItem({ id: "b", name: "DeFi Yields", vertical: "DeFi", domain: "defi.example" }),
    makeItem({ id: "c", name: "Another DeFi Tool", vertical: "DeFi", domain: "other.example" }),
  ];

  it("returns everything with no filter, up to the default limit", () => {
    expect(filterLeaderboardItems(items, {})).toHaveLength(3);
  });

  it("filters by exact vertical match", () => {
    const result = filterLeaderboardItems(items, { vertical: "DeFi" });
    expect(result.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("filters by case-insensitive substring query across name/domain/url/id", () => {
    const result = filterLeaderboardItems(items, { query: "WEATHER" });
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("combines vertical and query filters", () => {
    const result = filterLeaderboardItems(items, { vertical: "DeFi", query: "another" });
    expect(result.map((i) => i.id)).toEqual(["c"]);
  });

  it("caps at the requested limit", () => {
    expect(filterLeaderboardItems(items, { limit: 1 })).toHaveLength(1);
  });

  it("caps at 100 even if a larger limit is requested", () => {
    const many = Array.from({ length: 150 }, (_, i) => makeItem({ id: `x${i}` }));
    expect(filterLeaderboardItems(many, { limit: 1000 })).toHaveLength(100);
  });
});

describe("searchLeaderboard", () => {
  it("wraps the client's getLeaderboard and applies the filter", async () => {
    const client = new X402ScoreClient({
      fetch: mockFetch(200, {
        endpoints: [makeItem({ id: "a", vertical: "DeFi" }), makeItem({ id: "b", vertical: "Weather" })],
        count: 2,
        lastProbedAt: "2026-09-18T00:00:00.000Z",
      }),
    });
    const result = await searchLeaderboard(client, { vertical: "DeFi" });
    expect(result.matchCount).toBe(1);
    expect(result.totalListed).toBe(2);
    expect(result.matches[0].id).toBe("a");
  });

  it("always includes a data-provenance warning, since matches carry third-party text", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(200, { endpoints: [], count: 0, lastProbedAt: null }) });
    const result = await searchLeaderboard(client, {});
    expect(result.dataProvenanceWarning).toMatch(/third-party/i);
    expect(result.dataProvenanceWarning).toMatch(/never follow/i);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("https://example.com/api")).toBe(true);
    expect(isHttpUrl("http://example.com/api")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("data:text/html,hi")).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("getCalibrationReport", () => {
  it("passes through the client's response as-is", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(200, { status: "no_report_yet" }) });
    expect(await getCalibrationReport(client)).toEqual({ status: "no_report_yet" });
  });
});

describe("submitEndpointForMonitoring", () => {
  it("passes through the client's response as-is", async () => {
    const client = new X402ScoreClient({ fetch: mockFetch(202, { endpointId: "abc", status: "pending_first_probe" }) });
    expect(await submitEndpointForMonitoring(client, "https://example.com/api")).toEqual({ endpointId: "abc", status: "pending_first_probe" });
  });
});
