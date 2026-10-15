import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

import { appRouter } from "./routers";
import { OffCache, offCache, getOffBaseUrl, DEFAULT_OFF_BASE_URL } from "./lib/offClient";

const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);

const productJson = (code: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status: 1,
      code,
      product: {
        code,
        product_name: "Test Biscuits",
        brands: "Acme",
        categories: "en:snacks, en:biscuits",
        ingredients_text: "Wheat flour, sugar, palm oil, salt",
        nutriscore_grade: "d",
        nova_group: 4,
        allergens: "en:gluten",
        nutriments: { "energy-kcal_100g": 480, sugars_100g: 22 },
        ...extra,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  delete process.env.OPENFOODFACTS_BASE_URL;
  offCache.configure({ enabled: true, hitTtlMs: 60_000, missTtlMs: 10_000, maxEntries: 100 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENFOODFACTS_BASE_URL;
});

describe("base URL configuration", () => {
  it("defaults to world.openfoodfacts.org", async () => {
    const fetchMock = vi.fn().mockResolvedValue(productJson("4006381333931"));
    vi.stubGlobal("fetch", fetchMock);
    await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${DEFAULT_OFF_BASE_URL}/api/v2/product/4006381333931.json`);
  });

  it("honours OPENFOODFACTS_BASE_URL for barcode and search, trimming trailing slashes", async () => {
    process.env.OPENFOODFACTS_BASE_URL = "http://127.0.0.1:9999/";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(productJson("4006381333931"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [{ code: "1", product_name: "X" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    await caller.openFoodFacts.search({ query: "biscuits" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:9999/api/v2/product/4006381333931.json");
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^http:\/\/127\.0\.0\.1:9999\/cgi\/search\.pl\?search_terms=biscuits/);
  });

  it("ignores an invalid override and falls back to the default", () => {
    process.env.OPENFOODFACTS_BASE_URL = "javascript:alert(1)";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getOffBaseUrl()).toBe(DEFAULT_OFF_BASE_URL);
    spy.mockRestore();
  });

  it("does not share cache entries between different base URLs", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => productJson("4006381333931"));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENFOODFACTS_BASE_URL = "http://mirror-a.test";
    await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    process.env.OPENFOODFACTS_BASE_URL = "http://mirror-b.test";
    await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("product mapping", () => {
  it("returns normalized fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(productJson("4006381333931")));
    const p = await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    expect(p).toMatchObject({
      barcode: "4006381333931",
      productName: "Test Biscuits",
      brand: "Acme",
      category: "snacks",
      ingredientsText: "Wheat flour, sugar, palm oil, salt",
      nutriscoreGrade: "D",
      novaGroup: 4,
      allergens: ["gluten"],
    });
    expect(p?.nutriments.energyKcal).toBe(480);
  });
});

describe("cache", () => {
  it("serves repeated successful lookups from memory", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => productJson("4006381333931"));
    vi.stubGlobal("fetch", fetchMock);
    const a = await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    const b = await caller.openFoodFacts.getByBarcode({ barcode: " 4006381333931 " });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("caches confirmed not-found (404 and status 0) results", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response("{}", { status: 404 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ status: 0, status_verbose: "product not found" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" })).resolves.toBeNull();
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "3017620422003" })).resolves.toBeNull();
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "3017620422003" })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches outages: network errors, 5xx and non-JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }))
      .mockImplementation(async () => productJson("4006381333931"));
    vi.stubGlobal("fetch", fetchMock);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
    err.mockRestore();
    expect(offCache.size).toBe(0);
    // the next call reaches OFF again and succeeds
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" })).resolves.toMatchObject({ productName: "Test Biscuits" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps serving a cached product even if OFF later goes down", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => productJson("4006381333931")).mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    await caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" });
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333931" })).resolves.toMatchObject({ productName: "Test Biscuits" });
  });

  it("does not call OFF for malformed barcodes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const b of ["12", "abc", "../etc/passwd", "1234567890123456789012"]) {
      await expect(caller.openFoodFacts.getByBarcode({ barcode: b })).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reject codes with an invalid check digit (OFF has some)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => productJson("4006381333932"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(caller.openFoodFacts.getByBarcode({ barcode: "4006381333932" })).resolves.toMatchObject({ productName: "Test Biscuits" });
  });
});

describe("OffCache unit behaviour", () => {
  const prod: any = { barcode: "1" };
  it("expires hits and misses on their own TTLs", () => {
    let t = 0;
    const c = new OffCache({ enabled: true, hitTtlMs: 1000, missTtlMs: 100, maxEntries: 10 }, () => t);
    c.set("hit", prod);
    c.set("miss", null);
    t = 50;
    expect(c.get("hit")).toBe(prod);
    expect(c.get("miss")).toBeNull();
    t = 150;
    expect(c.get("miss")).toBeUndefined();
    expect(c.get("hit")).toBe(prod);
    t = 1001;
    expect(c.get("hit")).toBeUndefined();
  });

  it("is size bounded and evicts the least recently used entry", () => {
    const c = new OffCache({ enabled: true, hitTtlMs: 1000, missTtlMs: 1000, maxEntries: 2 });
    c.set("a", prod);
    c.set("b", prod);
    c.get("a"); // a is now most recent
    c.set("c", prod);
    expect(c.size).toBe(2);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(prod);
    expect(c.get("c")).toBe(prod);
  });

  it("stores nothing when disabled", () => {
    const c = new OffCache({ enabled: false, hitTtlMs: 1000, missTtlMs: 1000, maxEntries: 2 });
    c.set("a", prod);
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });
});
