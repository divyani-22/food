/**
 * Open Food Facts client: configurable base URL, product mapping and a small
 * bounded in-memory cache for barcode lookups.
 *
 * Error semantics (relied upon by the UI):
 *  - product exists            -> OffProduct
 *  - OFF says "no such product" -> null (HTTP 404 or status 0), cached briefly
 *  - anything else (network, timeout, 5xx, non-JSON) -> throws OffUnavailableError, never cached
 */
import { firstCategory, normalizeGrade, normalizeNova, parseAllergens } from "../logic";

export const DEFAULT_OFF_BASE_URL = "https://world.openfoodfacts.org";

export class OffUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OffUnavailableError";
  }
}

/** Resolve the OFF base URL from OPENFOODFACTS_BASE_URL (read on every call so tests and ops can change it). */
export function getOffBaseUrl(): string {
  const raw = (process.env.OPENFOODFACTS_BASE_URL ?? "").trim();
  if (!raw) return DEFAULT_OFF_BASE_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    return raw.replace(/\/+$/, "");
  } catch {
    console.error(`[OpenFoodFacts] Ignoring invalid OPENFOODFACTS_BASE_URL; using ${DEFAULT_OFF_BASE_URL}`);
    return DEFAULT_OFF_BASE_URL;
  }
}

/** Barcodes are numeric; this only guards the URL path (check digits are validated on the client). */
export function isWellFormedBarcode(code: string): boolean {
  return /^\d{4,20}$/.test(code);
}

export type OffProduct = {
  barcode: string;
  productName: string;
  brand: string;
  category: string;
  imageUrl: string | null;
  ingredientsText: string;
  nutriscoreGrade: string | null;
  novaGroup: number | null;
  ecoscoreGrade: string | null;
  allergens: string[];
  nutriments: {
    energyKcal: number | null;
    fat: number | null;
    saturatedFat: number | null;
    sugars: number | null;
    salt: number | null;
    proteins: number | null;
    fiber: number | null;
  };
};

export function mapOffProduct(p: any, fallbackBarcode: string): OffProduct {
  return {
    barcode: p.code || fallbackBarcode,
    productName: p.product_name || p.product_name_en || p.generic_name || "Unknown Product",
    brand: p.brands || p.brand_owner || "Generic",
    category: firstCategory(p.categories),
    imageUrl: p.image_front_url || p.image_url || p.image_small_url || null,
    ingredientsText: p.ingredients_text || p.ingredients_text_en || "",
    nutriscoreGrade: normalizeGrade(p.nutriscore_grade),
    novaGroup: normalizeNova(p.nova_group),
    ecoscoreGrade: normalizeGrade(p.ecoscore_grade),
    allergens: parseAllergens(p.allergens),
    nutriments: {
      energyKcal: p.nutriments?.["energy-kcal_100g"] ?? p.nutriments?.["energy-kcal"] ?? null,
      fat: p.nutriments?.fat_100g ?? p.nutriments?.fat ?? null,
      saturatedFat: p.nutriments?.["saturated-fat_100g"] ?? p.nutriments?.["saturated-fat"] ?? null,
      sugars: p.nutriments?.sugars_100g ?? p.nutriments?.sugars ?? null,
      salt: p.nutriments?.salt_100g ?? p.nutriments?.salt ?? null,
      proteins: p.nutriments?.proteins_100g ?? p.nutriments?.proteins ?? null,
      fiber: p.nutriments?.fiber_100g ?? p.nutriments?.fiber ?? null,
    },
  };
}

// ---------------------------------------------------------------- cache

export type OffCacheOptions = {
  enabled: boolean;
  /** TTL for found products. */
  hitTtlMs: number;
  /** TTL for confirmed not-found results (shorter: products get added to OFF). */
  missTtlMs: number;
  maxEntries: number;
};

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function defaultCacheOptions(): OffCacheOptions {
  return {
    // Off under vitest (NODE_ENV=test) so unrelated tests never see stale entries; off-tests enable it explicitly.
    enabled: process.env.OFF_CACHE_DISABLED !== "true" && process.env.NODE_ENV !== "test",
    hitTtlMs: envInt("OFF_CACHE_HIT_TTL_SECONDS", 6 * 60 * 60) * 1000,
    missTtlMs: envInt("OFF_CACHE_MISS_TTL_SECONDS", 5 * 60) * 1000,
    maxEntries: Math.max(1, envInt("OFF_CACHE_MAX_ENTRIES", 500)),
  };
}

type CacheEntry = { value: OffProduct | null; expiresAt: number };

export class OffCache {
  private map = new Map<string, CacheEntry>(); // insertion order == LRU order
  constructor(private opts: OffCacheOptions, private now: () => number = Date.now) {}

  configure(opts: Partial<OffCacheOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.clear();
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  /** undefined = miss, null = cached not-found, object = cached product. */
  get(key: string): OffProduct | null | undefined {
    if (!this.opts.enabled) return undefined;
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // refresh recency
    this.map.set(key, e);
    return e.value;
  }
  set(key: string, value: OffProduct | null) {
    if (!this.opts.enabled) return;
    const ttl = value === null ? this.opts.missTtlMs : this.opts.hitTtlMs;
    if (ttl <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttl });
    while (this.map.size > this.opts.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

export const offCache = new OffCache(defaultCacheOptions());

// ---------------------------------------------------------------- lookups

export async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const base = getOffBaseUrl();
  const key = `${base}|${barcode}`;
  const cached = offCache.get(key);
  if (cached !== undefined) return cached;

  let response: Response;
  try {
    response = await fetch(`${base}/api/v2/product/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": "IngreScanAI/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new OffUnavailableError("Open Food Facts request failed", err);
  }
  if (response.status === 404) {
    offCache.set(key, null);
    return null;
  }
  if (!response.ok) throw new OffUnavailableError(`Open Food Facts responded ${response.status}`);

  let data: any;
  try {
    data = await response.json();
  } catch (err) {
    throw new OffUnavailableError("Open Food Facts returned a non-JSON response", err);
  }
  if (!data || data.status === 0 || !data.product) {
    offCache.set(key, null);
    return null;
  }
  const product = mapOffProduct(data.product, barcode);
  offCache.set(key, product);
  return product;
}

export async function searchOffProducts(query: string, pageSize: number) {
  const url = `${getOffBaseUrl()}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "IngreScanAI - WebApp - 1.0 - (https://github.com/shivrajpatare/IngreScan-AI)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new OffUnavailableError("Open Food Facts search request failed", err);
  }
  if (!response.ok) throw new OffUnavailableError(`Open Food Facts responded ${response.status}`);
  const text = await response.text();
  if (!text.trim().startsWith("{")) throw new OffUnavailableError("Open Food Facts returned a non-JSON response");
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new OffUnavailableError("Open Food Facts returned invalid JSON", err);
  }
  if (!data.products || !Array.isArray(data.products)) return [];
  return data.products
    .filter((p: any) => p && typeof p === "object")
    .map((p: any) => ({
      barcode: String(p.code || p._id || ""),
      productName: p.product_name || p.product_name_en || p.generic_name || "Food Product",
      brand: p.brands || "",
      category: firstCategory(p.categories),
      imageUrl: p.image_front_small_url || p.image_front_url || p.image_url || null,
      ingredientsText: p.ingredients_text || p.ingredients_text_en || "",
      nutriscoreGrade: normalizeGrade(p.nutriscore_grade),
      novaGroup: normalizeNova(p.nova_group),
    }));
}
