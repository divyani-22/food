import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import {
  MAX_RESPONSE_BYTES,
  TtlLru,
  allowAltMarketCall,
  countryFromRegion,
  fetchJsonFrom,
  fetchStats,
  lookupAlternativeMarket,
  matchProduct,
  parseOffSearch,
  parseOpenPrices,
  pricesCache,
  resetAltMarketRate,
  searchCache,
  summarizePrices,
} from "./lib/altMarket";

// The stub imitates the DOCUMENTED shapes of OFF search and Open Prices. It proves our parsing/flow, not the live APIs.
let server: http.Server;
let base = "";
const hits: string[] = [];
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
let active = 0;
let peak = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    active++;
    peak = Math.max(peak, active);
    res.on("close", () => active--);
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OPENFOODFACTS_BASE_URL = base;
  process.env.OPEN_PRICES_BASE_URL = base;
});
afterAll(() => {
  server.close();
  delete process.env.OPENFOODFACTS_BASE_URL;
  delete process.env.OPEN_PRICES_BASE_URL;
});
afterEach(() => {
  hits.length = 0;
  peak = 0;
  searchCache.configure({ enabled: false });
  pricesCache.configure({ enabled: false });
  handler = () => {};
});

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const oats = { code: "8901234567890", product_name: "Rolled Oats", brands: "Quaker, PepsiCo", stores: "Big Bazaar, DMart", countries_tags: ["en:india"], nutriscore_grade: "a", image_front_small_url: "https://img.example/o.jpg" };

describe("matchProduct", () => {
  const c = (code: string, name: string, brand = "") => ({ code, name, brand });
  it("accepts a close name with matching brand", () => {
    const m = matchProduct({ productName: "Rolled Oats", brand: "Quaker" }, [c("1234567", "Quaker Rolled Oats 1kg", "Quaker")]);
    expect(m?.candidate.code).toBe("1234567");
  });
  it("accepts brand inside a comma-separated brand list and ignores accents/plurals", () => {
    expect(matchProduct({ productName: "Rolled Oat", brand: "Quaker" }, [c("1234567", "Rolled Oats", "PepsiCo, Quaker")])).not.toBeNull();
    expect(matchProduct({ productName: "Muesli Crème", brand: "Alpen" }, [c("1234567", "Muesli Creme", "Alpen")])).not.toBeNull();
  });
  it("rejects a different brand even with an identical name", () => {
    expect(matchProduct({ productName: "Rolled Oats", brand: "Quaker" }, [c("1234567", "Rolled Oats", "Tesco")])).toBeNull();
    expect(matchProduct({ productName: "Rolled Oats", brand: "Quaker" }, [c("1234567", "Rolled Oats", "Quakerjack")])).toBeNull();
  });
  it("rejects loose overlaps (different product sharing one word)", () => {
    expect(matchProduct({ productName: "Oats Cookies", brand: "Quaker" }, [c("1234567", "Chocolate Oats Cereal", "Quaker")])).toBeNull();
    expect(matchProduct({ productName: "Whole Wheat Bread", brand: "" }, [c("1234567", "Whole Milk", "Amul")])).toBeNull();
  });
  it("rejects a long candidate that merely contains the query word", () => {
    expect(matchProduct({ productName: "Oats", brand: "Quaker" }, [c("1234567", "Quaker Oats Chocolate Chip Caramel Cookie Bars", "Quaker")])).toBeNull();
  });
  it("without a brand requires near-identical names and 2+ shared tokens", () => {
    expect(matchProduct({ productName: "Multigrain Atta", brand: "" }, [c("1234567", "Multigrain Atta 5kg", "Aashirvaad")])).not.toBeNull();
    expect(matchProduct({ productName: "Oats", brand: "" }, [c("1234567", "Oats", "X")])).not.toBeNull();
    expect(matchProduct({ productName: "Oats", brand: "" }, [c("1234567", "Oats Biscuit", "X")])).toBeNull();
    expect(matchProduct({ productName: "Brown Rice Pasta", brand: "" }, [c("1234567", "Brown Rice", "X")])).toBeNull();
  });
  it("skips candidates without a numeric code or name and handles empty input", () => {
    expect(matchProduct({ productName: "Rolled Oats", brand: "Quaker" }, [c("abc", "Rolled Oats", "Quaker"), c("1234567", "", "Quaker")])).toBeNull();
    expect(matchProduct({ productName: "", brand: "Quaker" }, [c("1234567", "Quaker", "Quaker")])).toBeNull();
    expect(matchProduct({ productName: "Rolled Oats" }, [])).toBeNull();
  });
  it("picks the best of several", () => {
    const m = matchProduct({ productName: "Rolled Oats", brand: "Quaker" }, [c("1111111", "Quaker Rolled Oats Honey Almond", "Quaker"), c("2222222", "Quaker Rolled Oats", "Quaker")]);
    expect(m?.candidate.code).toBe("2222222");
  });
});

describe("parseOffSearch", () => {
  it("maps documented fields and tolerates weird/missing ones", () => {
    const out = parseOffSearch({
      products: [
        oats,
        { code: 12, product_name: "Numeric code too short" },
        { code: "9990001112223", product_name_en: "English only", stores_tags: ["big-bazaar"], countries_tags: "bad", nutriscore_grade: "z", image_front_small_url: "javascript:alert(1)", brands: 5 },
        { code: "9990001112224" },
        null,
        "str",
        { _id: "9990001112225", generic_name: "Generic", stores: ["not", "string"] },
      ],
    });
    expect(out.map((p) => p.code)).toEqual(["8901234567890", "9990001112223", "9990001112225"]);
    expect(out[0]).toMatchObject({ brand: "Quaker, PepsiCo", stores: ["Big Bazaar", "DMart"], countries: ["India"], nutriscore: "A" });
    expect(out[1]).toMatchObject({ name: "English only", stores: ["Big Bazaar"], countries: [], nutriscore: null, image: null, brand: "5" });
  });
  it("returns [] for non-object payloads", () => {
    for (const v of [null, undefined, 5, "x", [], {}, { products: "no" }]) expect(parseOffSearch(v)).toEqual([]);
  });
});

describe("parseOpenPrices + summarizePrices", () => {
  it("accepts string prices and both location spellings, drops invalid rows", () => {
    const items = parseOpenPrices({
      items: [
        { price: "129.5", currency: "inr", date: daysAgo(10), location: { osm_name: "DMart", osm_address_country_code: "IN" } },
        { price: 3, currency: "EUR", date: daysAgo(5), location: { name: "Lidl", country_code: "FR", country: "France" }, price_per: "KILOGRAM" },
        { price: -1, currency: "INR", date: daysAgo(1) },
        { price: "abc", currency: "INR", date: daysAgo(1) },
        { price: 5, currency: "RUPEES", date: daysAgo(1) },
        { price: 5, currency: "INR", date: "not-a-date" },
        { price: 5, currency: "INR", date: "2999-01-01" },
        { price: 5, currency: "INR" },
        null,
        7,
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ amount: 129.5, currency: "INR", locationName: "DMart", country: "IN" });
    expect(items[1]).toMatchObject({ currency: "EUR", locationName: "Lidl", country: "FR", pricePer: "kilogram" });
    for (const v of [null, {}, { items: "x" }, 4]) expect(parseOpenPrices(v)).toEqual([]);
  });

  it("prefers the user's country, never mixes currencies, flags stale prices", () => {
    const items = parseOpenPrices({
      items: [
        { price: 2.5, currency: "EUR", date: daysAgo(2), location: { osm_name: "Lidl", osm_address_country_code: "FR" } },
        { price: 120, currency: "INR", date: daysAgo(30), location: { osm_name: "DMart", osm_address_country_code: "IN" } },
        { price: 140, currency: "INR", date: daysAgo(40), location: { osm_name: "Reliance", osm_address_country_code: "IN" } },
        { price: 99, currency: "INR", date: daysAgo(400), location: { osm_name: "Old", osm_address_country_code: "IN" } },
      ],
    });
    const s = summarizePrices(items, { code: "1", country: { code: "IN", name: "India" }, sourceUrl: "u" })!;
    expect(s).toMatchObject({ amount: 120, currency: "INR", count: 2, min: 120, max: 140, stale: false, locationName: "DMart" });
    const world = summarizePrices(items, { code: "1", country: null, sourceUrl: "u" })!;
    expect(world).toMatchObject({ amount: 2.5, currency: "EUR", count: 1 });
    const old = summarizePrices(parseOpenPrices({ items: [{ price: 9, currency: "USD", date: daysAgo(500) }] }), { code: "1", sourceUrl: "u" })!;
    expect(old.stale).toBe(true);
    expect(summarizePrices([], { code: "1", sourceUrl: "u" })).toBeNull();
  });
});

describe("countryFromRegion", () => {
  it("maps known regions and returns null otherwise", () => {
    expect(countryFromRegion("Mumbai, India")).toEqual({ code: "IN", name: "India" });
    expect(countryFromRegion("uk")?.code).toBe("GB");
    expect(countryFromRegion("US")?.code).toBe("US");
    expect(countryFromRegion("Atlantis")).toBeNull();
    expect(countryFromRegion("")).toBeNull();
    expect(countryFromRegion(null)).toBeNull();
  });
});

describe("TtlLru", () => {
  it("expires entries, evicts least recently used, and can be disabled", () => {
    let t = 0;
    const c = new TtlLru<number>({ enabled: true, ttlMs: 100, maxEntries: 2 }, () => t);
    c.set("a", 1); c.set("b", 2);
    expect(c.get("a")).toBe(1); // refresh a
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    t = 101;
    expect(c.get("a")).toBeUndefined();
    c.configure({ enabled: false });
    c.set("x", 1);
    expect(c.get("x")).toBeUndefined();
  });
});

describe("fetchJsonFrom safety", () => {
  it("rejects bad scheme, bad path, redirects, non-ok, invalid JSON and oversized bodies", async () => {
    await expect(fetchJsonFrom("ftp://x.test", "/a")).rejects.toThrow();
    await expect(fetchJsonFrom(base, "//evil.test/a")).rejects.toThrow(/host not allowed/);
    await expect(fetchJsonFrom(base, "a")).rejects.toThrow(/bad path/);
    handler = (_q, res) => { res.writeHead(302, { location: "http://example.invalid/" }); res.end(); };
    await expect(fetchJsonFrom(base, "/r")).rejects.toThrow();
    handler = (_q, res) => json(res, {}, 500);
    await expect(fetchJsonFrom(base, "/e")).rejects.toThrow(/500/);
    handler = (_q, res) => { res.writeHead(200); res.end("<html>"); };
    await expect(fetchJsonFrom(base, "/h")).rejects.toThrow(/invalid JSON/);
    handler = (_q, res) => { res.writeHead(200); res.end("x".repeat(MAX_RESPONSE_BYTES + 10)); };
    await expect(fetchJsonFrom(base, "/big")).rejects.toThrow(/too large/);
  });
  it("runs at most 3 requests in parallel", async () => {
    handler = (_q, res) => setTimeout(() => json(res, { products: [] }), 60);
    await Promise.all(Array.from({ length: 9 }, (_, i) => fetchJsonFrom(base, `/p${i}`)));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(fetchStats.maxInFlight).toBeLessThanOrEqual(3);
  });
});

describe("lookupAlternativeMarket (against the local stub)", () => {
  const route = (opts: { search?: unknown; prices?: unknown; searchStatus?: number; pricesStatus?: number }) => {
    handler = (req, res) => {
      if (req.url!.startsWith("/cgi/search.pl")) return json(res, opts.search ?? { products: [oats] }, opts.searchStatus ?? 200);
      if (req.url!.startsWith("/api/v1/prices")) return json(res, opts.prices ?? { items: [] }, opts.pricesStatus ?? 200);
      json(res, {}, 404);
    };
  };
  const alt = { id: 7, productName: "Rolled Oats", brand: "Quaker" };

  it("returns match, stores, price with currency/date and link (country restricted search)", async () => {
    route({ prices: { items: [{ price: 120, currency: "INR", date: daysAgo(3), location: { osm_name: "Spencer's", osm_address_country_code: "IN" } }] } });
    const r = await lookupAlternativeMarket(alt, { code: "IN", name: "India" });
    expect(r.status).toBe("ok");
    expect(r.match).toMatchObject({ code: "8901234567890", nutriscore: "A", url: `${base}/product/8901234567890` });
    expect(r.availability.stores).toEqual(["Big Bazaar", "DMart", "Spencer's"]);
    expect(r.price).toMatchObject({ amount: 120, currency: "INR", count: 1, stale: false, sourceUrl: `${base}/products/8901234567890` });
    expect(r.priceStatus).toBe("ok");
    expect(hits[0]).toContain("tag_0=india");
  });
  it("no_match when nothing passes the similarity rule, and does not query prices", async () => {
    route({ search: { products: [{ ...oats, brands: "Tesco" }] } });
    const r = await lookupAlternativeMarket(alt, null);
    expect(r).toMatchObject({ status: "no_match", match: null, price: null });
    expect(hits.some((h) => h.startsWith("/api/v1/prices"))).toBe(false);
    expect(hits[0]).not.toContain("tag_0");
  });
  it("match without community prices -> ok + priceStatus none", async () => {
    route({});
    const r = await lookupAlternativeMarket(alt, null);
    expect(r).toMatchObject({ status: "ok", price: null, priceStatus: "none" });
  });
  it("search failure -> unavailable, never throws", async () => {
    route({ searchStatus: 503 });
    expect(await lookupAlternativeMarket(alt, null)).toMatchObject({ status: "unavailable", match: null });
    handler = (_q, res) => res.destroy();
    expect((await lookupAlternativeMarket(alt, null)).status).toBe("unavailable");
  });
  it("prices failure keeps the match and marks only the price as unavailable", async () => {
    route({ pricesStatus: 500 });
    const r = await lookupAlternativeMarket(alt, null);
    expect(r).toMatchObject({ status: "ok", priceStatus: "unavailable", price: null });
    expect(r.match?.code).toBe("8901234567890");
  });
  it("unreachable host -> unavailable", async () => {
    process.env.OPENFOODFACTS_BASE_URL = "http://127.0.0.1:1";
    try {
      expect((await lookupAlternativeMarket(alt, null)).status).toBe("unavailable");
    } finally {
      process.env.OPENFOODFACTS_BASE_URL = base;
    }
  });
  it("caches search and prices when enabled (second call makes no requests)", async () => {
    searchCache.configure({ enabled: true, ttlMs: 60_000, maxEntries: 10 });
    pricesCache.configure({ enabled: true, ttlMs: 60_000, maxEntries: 10 });
    route({ prices: { items: [{ price: 1, currency: "INR", date: daysAgo(1) }] } });
    await lookupAlternativeMarket(alt, null);
    const n = hits.length;
    expect(n).toBe(2);
    const r = await lookupAlternativeMarket(alt, null);
    expect(hits.length).toBe(n);
    expect(r.price?.amount).toBe(1);
  });
  it("does not cache failures", async () => {
    searchCache.configure({ enabled: true, ttlMs: 60_000, maxEntries: 10 });
    route({ searchStatus: 500 });
    await lookupAlternativeMarket(alt, null);
    route({});
    expect((await lookupAlternativeMarket(alt, null)).status).toBe("ok");
  });
});

describe("allowAltMarketCall", () => {
  it("limits per user per window", () => {
    resetAltMarketRate();
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(allowAltMarketCall(1, t)).toBe(true);
    expect(allowAltMarketCall(1, t)).toBe(false);
    expect(allowAltMarketCall(2, t)).toBe(true);
    expect(allowAltMarketCall(1, t + 61_000)).toBe(true);
  });
});
