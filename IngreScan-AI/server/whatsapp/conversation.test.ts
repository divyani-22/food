import { describe, expect, it } from "vitest";
import { MediaRejectedError } from "./security";
import { FakeServices, NOW, PHONE, makeHarness } from "./testkit";
import type { PantryItem } from "./types";

const EMOJI = new RegExp("\\p{Extended_Pictographic}", "u");
const D = (offsetDays: number) => {
  // Local date (Asia/Kolkata) relative to NOW (2026-10-14).
  const base = Date.UTC(2026, 9, 14) + offsetDays * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
};
const item = (id: string, name: string, days: number | null): PantryItem => ({
  id,
  name,
  kind: "produce",
  expiryDate: days === null ? null : D(days),
});

describe("flow A: produce freshness", () => {
  it("replies with an inspection report and stores an ADD state", async () => {
    const h = makeHarness();
    const [reply] = await h.photo();
    expect(reply).toContain("*INSPECTION REPORT*");
    expect(reply).toContain("Item: Banana");
    expect(reply).toContain("Confidence: 92%");
    expect(reply).toContain("Status: FRESH");
    expect(reply).toContain("Estimated shelf life: 5 days");
    expect(reply).toContain("Storage tip: Keep at room temperature.");
    expect(reply).toContain("Reply ADD to save this item to your pantry.");
    expect(h.store.states.get(PHONE)?.kind).toBe("awaiting_add");
  });

  it("ADD saves with expiry = today + shelf life in the user's timezone", async () => {
    const h = makeHarness();
    // 2026-10-14T20:00Z is already 2026-10-15 01:30 in Asia/Kolkata.
    h.clock.now = Date.UTC(2026, 9, 14, 20, 0);
    await h.photo();
    const [reply] = await h.send("add");
    const [, args] = h.services.called("addPantryItem")[0];
    expect((args as any[])[1]).toMatchObject({ name: "Banana", kind: "produce", expiryDate: "2026-10-20", source: "whatsapp_photo" });
    expect(reply).toContain("2026-10-20");
    expect(h.store.states.has(PHONE)).toBe(false);
    // second ADD has nothing to add
    expect((await h.send("ADD"))[0]).toContain("nothing to add");
  });

  it("uses the same-day UTC date for a timezone that has not rolled over", async () => {
    const h = makeHarness();
    h.store.links.get(PHONE)!.timezone = "America/Los_Angeles";
    h.clock.now = Date.UTC(2026, 9, 14, 3, 0); // 2026-10-13 20:00 in LA
    await h.photo();
    await h.send("ADD");
    expect((h.services.called("addPantryItem")[0][1] as any[])[1].expiryDate).toBe("2026-10-18");
  });

  it("ADD still works at 14 minutes but expires after 15", async () => {
    const h = makeHarness();
    await h.photo();
    h.clock.now = NOW + 14 * 60_000;
    expect((await h.send("ADD"))[0]).toContain("Saved Banana");

    const h2 = makeHarness();
    await h2.photo();
    h2.clock.now = NOW + 15 * 60_000 + 1;
    const [r] = await h2.send("ADD");
    expect(r).toContain("too old to save");
    expect(h2.services.called("addPantryItem")).toHaveLength(0);
  });

  it("does not offer ADD for spoiled produce and clears any pending add", async () => {
    const h = makeHarness();
    await h.photo();
    h.services.produce = { ...h.services.produce!, freshnessStatus: "rotten", fruit: "Tomato" };
    const [r] = await h.photo();
    expect(r).toContain("SPOILED - DO NOT EAT");
    expect(r).not.toContain("Reply ADD");
    expect(r).not.toContain("Estimated shelf life");
    expect(h.store.states.has(PHONE)).toBe(false);
  });

  it("gives retry guidance below 50% confidence and never invents a result", async () => {
    const h = makeHarness();
    h.services.produce = { ...h.services.produce!, confidence: 49.9 };
    const [r] = await h.photo();
    expect(r).toContain("could not identify");
    expect(r).not.toContain("Banana");
    expect(r).not.toContain("INSPECTION REPORT");
    expect(h.store.states.has(PHONE)).toBe(false);
  });

  it("accepts exactly 50% confidence", async () => {
    const h = makeHarness();
    h.services.produce = { ...h.services.produce!, confidence: 50 };
    expect((await h.photo())[0]).toContain("INSPECTION REPORT");
  });

  it("treats null and malformed classifier output as unusable", async () => {
    const h = makeHarness();
    h.services.produce = null;
    expect((await h.photo())[0]).toContain("could not identify");
    h.services.produce = { fruit: "Apple", confidence: 90, freshnessStatus: "weird" as any, shelfLifeDays: 3 };
    expect((await h.photo())[0]).toContain("could not identify");
    h.services.produce = { fruit: "Apple", confidence: 90, freshnessStatus: "fresh", shelfLifeDays: NaN };
    expect((await h.photo())[0]).toContain("could not identify");
  });

  it("falls back to barcode/label extraction when it is not produce", async () => {
    const h = makeHarness();
    h.services.produce = null;
    h.services.extract = { kind: "barcode", barcode: "5449000000996" };
    expect((await h.photo())[0]).toContain("PRODUCT RISK REPORT");
    expect(h.services.called("lookupBarcode")[0][1]).toEqual(["u1", "5449000000996"]);

    h.services.extract = { kind: "label_text", text: "Sugar, palm oil, E150d" };
    expect((await h.photo())[0]).toContain("PRODUCT RISK REPORT");
    expect(h.services.called("analyzeIngredientsText")).toHaveLength(1);
  });

  it("validates a barcode decoded from an image", async () => {
    const h = makeHarness();
    h.services.produce = null;
    h.services.extract = { kind: "barcode", barcode: "5449000000995" };
    expect((await h.photo())[0]).toContain("check digit");
    expect(h.services.called("lookupBarcode")).toHaveLength(0);
  });

  it("maps media problems to friendly messages and never downloads disallowed types", async () => {
    const h = makeHarness();
    const gif = await h.photo({ media: { provider: "twilio", url: "https://api.twilio.com/x", contentType: "image/gif" } });
    expect(gif[0]).toContain("JPEG, PNG or WebP");
    expect(h.services.called("downloadMedia")).toHaveLength(0);

    h.services.fail.downloadMedia = new MediaRejectedError("too_large");
    expect((await h.photo())[0]).toContain("too large");
    h.services.fail.downloadMedia = new MediaRejectedError("download_failed");
    expect((await h.photo())[0]).toContain("could not download");
    delete h.services.fail.downloadMedia;

    h.services.media = { bytes: new Uint8Array(9 * 1024 * 1024), contentType: "image/png" };
    expect((await h.photo())[0]).toContain("too large");
    h.services.media = { bytes: new Uint8Array([1]), contentType: "text/html" };
    expect((await h.photo())[0]).toContain("JPEG, PNG or WebP");
  });

  it("does not leak internals when a service throws", async () => {
    const h = makeHarness();
    h.services.fail.classifyImage = new Error("connect ECONNREFUSED 127.0.0.1:5000 at Object.<anonymous> (/srv/app.js:10)");
    const out = await h.photo();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("something went wrong");
    expect(out[0]).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|\/srv|at Object/);
  });
});

describe("flow B: packaged food", () => {
  it("reports risk for a valid barcode, with additives, alerts", async () => {
    const h = makeHarness();
    h.services.report = {
      productName: "Cola",
      brand: "Fizz",
      riskScore: 71,
      highRiskAdditives: ["E150d caramel colour"],
      allergens: ["milk", "gluten"],
      personalAlerts: ["High sugar for your diabetes profile"],
      healthierAlternative: { name: "Sparkling water", riskScore: 2 },
    };
    const [r] = await h.send("5449000000996");
    expect(r).toContain("Product: Cola (Fizz)");
    expect(r).toContain("Risk score: 71/100 - HIGH");
    expect(r).toContain("- E150d caramel colour");
    expect(r).toContain("Allergens: milk, gluten");
    expect(r).toContain("*Alerts for you*");
    expect(r).toContain("Healthier option: Sparkling water - risk 2/100");
  });

  it("says when the check digit is wrong, and when the length is wrong", async () => {
    const h = makeHarness();
    expect((await h.send("5449000000995"))[0]).toContain("fails its check digit");
    expect((await h.send("123456789"))[0]).toContain("8, 12, 13 and 14");
    expect((await h.send("1234567"))[0]).toContain("does not look like a barcode");
    expect(h.services.called("lookupBarcode")).toHaveLength(0);
  });

  it("handles unknown barcodes and pasted ingredient text", async () => {
    const h = makeHarness();
    h.services.report = null;
    expect((await h.send("5449000000996"))[0]).toContain("could not find a product");
    h.services.report = null;
    const [r] = await h.send("Ingredients: water, sugar, citric acid, E211");
    expect(r).toContain("PRODUCT RISK REPORT");
    expect((h.services.called("analyzeIngredientsText")[0][1] as any[])[1]).toBe("water, sugar, citric acid, E211");
  });
});

describe("flow C: commands", () => {
  it("HELP lists commands for linked users", async () => {
    const h = makeHarness();
    const [r] = await h.send("  Help! ");
    for (const c of ["ADD", "FRIDGE", "COOK", "CLEAR", "REMIND", "TZ", "STOP", "START", "LINK"].filter((x) => x !== "LINK")) {
      expect(r).toContain(c);
    }
  });

  it("FRIDGE sorts by urgency and shows status words", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Rice", 30), item("2", "Milk", 1), item("3", "Spinach", -2), item("4", "Salt", null), item("5", "Eggs", 0)];
    const [r] = await h.send("fridge");
    const order = ["Spinach", "Eggs", "Milk", "Rice", "Salt"].map((n) => r.indexOf(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r).toContain("Spinach - expired 2 days ago - EXPIRED");
    expect(r).toContain("Eggs - today - EXPIRING SOON");
    expect(r).toContain("Milk - tomorrow - EXPIRING SOON");
    expect(r).toContain("Rice - in 30 days - FRESH");
    expect(r).toContain("Salt - no expiry date - NO DATE");
  });

  it("FRIDGE paginates and MORE continues", async () => {
    const h = makeHarness({ config: { pageSize: 2 } });
    h.services.pantry = [1, 2, 3, 4, 5].map((n) => item(String(n), `Item${n}`, n));
    const [p1] = await h.send("PANTRY");
    expect(p1).toContain("page 1/3");
    expect(p1).toContain("Item1");
    expect(p1).not.toContain("Item3");
    expect(p1).toContain("Reply MORE");
    const [p2] = await h.send("more");
    expect(p2).toContain("page 2/3");
    expect(p2).toContain("Item3");
    const [p3] = await h.send("more");
    expect(p3).toContain("page 3/3");
    expect(p3).not.toContain("Reply MORE");
    expect((await h.send("more"))[0]).toContain("no more items");
    expect((await h.send("fridge 2"))[0]).toContain("page 2/3");
  });

  it("FRIDGE does not clobber a pending ADD", async () => {
    const h = makeHarness({ config: { pageSize: 1 } });
    h.services.pantry = [item("1", "A", 1), item("2", "B", 2)];
    await h.photo();
    await h.send("fridge");
    expect(h.store.states.get(PHONE)?.kind).toBe("awaiting_add");
    expect((await h.send("add"))[0]).toContain("Saved Banana");
  });

  it("empty pantry has a helpful message", async () => {
    expect((await makeHarness().send("fridge"))[0]).toContain("pantry is empty");
  });

  it("RESCUE/COOK uses only items about to expire", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Banana", 1), item("2", "Rice", 30), item("3", "Old", -1)];
    const [r] = await h.send("cook");
    expect(r).toContain("RESCUE RECIPES");
    expect(r).toContain("Banana pancakes");
    const passed = h.services.called("rescueRecipes")[0][1] as any[];
    expect(passed[1].map((i: PantryItem) => i.name)).toEqual(["Banana"]);
  });

  it("RESCUE with nothing expiring does not call the recipe service", async () => {
    const h = makeHarness();
    h.services.pantry = [item("2", "Rice", 30)];
    expect((await h.send("RESCUE"))[0]).toContain("Nothing in your pantry");
    expect(h.services.called("rescueRecipes")).toHaveLength(0);
  });

  it("CLEAR with a single match marks it consumed", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Whole Milk", 1), item("2", "Rice", 30)];
    const [r] = await h.send("clear milk.");
    expect(r).toContain("Marked Whole Milk as used up");
    expect(h.services.called("clearPantryItem")[0][1]).toEqual(["u1", "1"]);
  });

  it("CLEAR prefers a single exact match over substrings", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Milk", 1), item("2", "Milk chocolate", 5)];
    await h.send("CLEAR milk");
    expect(h.services.called("clearPantryItem")[0][1]).toEqual(["u1", "1"]);
  });

  it("CLEAR with several matches asks for a numbered choice (awaiting_clear_choice)", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Apple juice", 9), item("2", "Apple", 2), item("3", "Pineapple", 4)];
    const [ask] = await h.send("CLEAR app");
    expect(ask).toContain("Reply with a number");
    expect(ask).toMatch(/1\. Apple\n2\. Pineapple\n3\. Apple juice/);
    expect(h.store.states.get(PHONE)?.kind).toBe("awaiting_clear_choice");
    expect((await h.send("7"))[0]).toContain("number from 1 to 3");
    expect(h.store.states.get(PHONE)?.kind).toBe("awaiting_clear_choice");
    const [done] = await h.send("2");
    expect(done).toContain("Marked Pineapple as used up");
    expect(h.services.called("clearPantryItem")[0][1]).toEqual(["u1", "3"]);
    expect(h.store.states.has(PHONE)).toBe(false);
  });

  it("CANCEL and TTL expiry end a clear choice", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Apple tart", 2), item("2", "Apple pie", 4)];
    await h.send("clear apple");
    expect((await h.send("cancel"))[0]).toContain("cancelled");
    expect(h.store.states.has(PHONE)).toBe(false);

    await h.send("clear apple");
    h.clock.now = NOW + 11 * 60_000;
    expect((await h.send("1"))[0]).toContain("choice has expired");
    expect(h.services.called("clearPantryItem")).toHaveLength(0);
  });

  it("CLEAR with no name or no match", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Apple", 2)];
    expect((await h.send("clear"))[0]).toContain("CLEAR milk");
    expect((await h.send("clear *kiwi*"))[0]).toContain("could not find");
  });

  it("STOP and START toggle reminders; STOP always works even when rate limited", async () => {
    const h = makeHarness({ rate: { capacity: 1, refillPerSec: 0 } });
    await h.send("hi");
    expect((await h.send("help"))[0]).toContain("too quickly");
    const [stop] = await h.send("STOP");
    expect(stop).toContain("turned off");
    expect(h.services.prefs.enabled).toBe(false);

    const h2 = makeHarness();
    h2.services.prefs.enabled = false;
    const [start] = await h2.send("start");
    expect(start).toContain("Reminders are on");
    expect(start).toContain("09:00");
    expect(h2.services.prefs.enabled).toBe(true);
  });

  it("REMIND validates hour and quiet hours", async () => {
    const h = makeHarness();
    expect((await h.send("REMIND 10pm"))[0]).toContain("not sent between 21:00 and 08:00");
    // 19:00 is allowed
    expect((await h.send("REMIND 19"))[0]).toContain("19:00");
    expect(h.services.prefs.hour).toBe(19);
    expect((await h.send("remind 8"))[0]).toContain("08:00");
    expect((await h.send("REMIND 25"))[0]).toContain("hour from 0 to 23");
    expect((await h.send("REMIND soon"))[0]).toContain("hour from 0 to 23");
    expect((await h.send("REMIND"))[0]).toContain("Current hour");
  });

  it("TZ validates with Intl", async () => {
    const h = makeHarness();
    expect((await h.send("TZ Asia/Kolkata"))[0]).toContain("Time zone set to");
    expect(h.services.prefs.timezone).toMatch(/Asia\/(Kolkata|Calcutta)/);
    expect((await h.send("tz Mars/Olympus"))[0]).toContain("not a valid time zone");
    expect((await h.send("TZ"))[0]).toContain("IANA");
    expect((await h.send("TZ ../../etc"))[0]).toContain("not a valid time zone");
  });

  it("unknown input points to HELP", async () => {
    const h = makeHarness();
    for (const t of ["what is this", "123456789012345678", "", "5"]) {
      const [r] = await h.send(t);
      expect(r).toMatch(/HELP|barcode/);
    }
  });

  it("locations and unsupported media get guidance", async () => {
    const h = makeHarness();
    expect((await h.send("", { kind: "location", text: undefined }))[0]).toContain("cannot use locations");
    expect((await h.send("", { kind: "unsupported", text: undefined }))[0]).toContain("photos");
  });

  it("interactive replies are treated as text commands", async () => {
    const h = makeHarness();
    await h.photo();
    expect((await h.send("ADD", { kind: "interactive" }))[0]).toContain("Saved Banana");
  });
});

describe("account linking", () => {
  it("unlinked users only get link guidance, never photo analysis", async () => {
    const h = makeHarness({ linked: false });
    const [r] = await h.photo();
    expect(r).toContain("Profile");
    expect(r).toContain("Connect WhatsApp");
    expect(r).toContain("LINK");
    expect(h.services.called("classifyImage")).toHaveLength(0);
    expect(h.services.called("downloadMedia")).toHaveLength(0);
    expect((await h.send("fridge"))[0]).toContain("Connect WhatsApp");
    expect((await h.send("help"))[0]).toContain("Connect WhatsApp");
    expect(h.services.called("listPantry")).toHaveLength(0);
  });

  it("LINK with a valid code links and normalises the code", async () => {
    const h = makeHarness({ linked: false });
    const [r] = await h.send("link abcd-2345");
    expect(r).toContain("account is connected, Asha");
    expect(h.services.called("linkAccount")[0][1]).toEqual(["ABCD2345", PHONE]);
  });

  it("maps failure reasons and does not call the service for malformed codes", async () => {
    const h = makeHarness({ linked: false });
    expect((await h.send("LINK"))[0]).toContain("8-character code");
    expect((await h.send("LINK 0000"))[0]).toContain("not recognised");
    expect(h.services.called("linkAccount")).toHaveLength(0);
    h.services.linkResult = { ok: false, reason: "expired" };
    expect((await h.send("LINK ABCD2345"))[0]).toContain("expired");
    h.services.linkResult = { ok: false, reason: "used" };
    expect((await h.send("LINK ABCD2345"))[0]).toContain("already used");
  });

  it("limits repeated bad attempts per phone", async () => {
    const h = makeHarness({ linked: false });
    h.services.linkResult = { ok: false, reason: "invalid" };
    for (let i = 0; i < 5; i++) await h.send("LINK ABCD2345");
    const calls = h.services.called("linkAccount").length;
    expect((await h.send("LINK ABCD2345"))[0]).toContain("Too many attempts");
    expect(h.services.called("linkAccount")).toHaveLength(calls);
    h.clock.now += 16 * 60_000;
    h.services.linkResult = { ok: true, userId: "u1" };
    expect((await h.send("LINK ABCD2345"))[0]).toContain("connected");
  });

  it("an already linked number is told how to switch accounts", async () => {
    const h = makeHarness();
    expect((await h.send("LINK ABCD2345"))[0]).toContain("already connected");
    expect(h.services.called("linkAccount")).toHaveLength(0);
  });
});

describe("robustness", () => {
  it("duplicate webhook delivery is processed once", async () => {
    const h = makeHarness();
    const first = await h.photo({ id: "SMDUP" });
    const second = await h.photo({ id: "SMDUP" });
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(h.services.called("classifyImage")).toHaveLength(1);
  });

  it("rate limits bursts and recovers", async () => {
    const h = makeHarness({ rate: { capacity: 3, refillPerSec: 1 / 6 } });
    for (let i = 0; i < 3; i++) await h.send("help");
    expect((await h.send("help"))[0]).toContain("too quickly");
    h.clock.now += 7_000;
    expect((await h.send("help"))[0]).toContain("FoodIQ commands");
  });

  it("duplicates do not consume rate-limit tokens", async () => {
    const h = makeHarness({ rate: { capacity: 1, refillPerSec: 0 } });
    await h.send("help", { id: "SMX" });
    expect(await h.send("help", { id: "SMX" })).toEqual([]);
  });

  it("never throws when the store fails", async () => {
    const h = makeHarness();
    h.store.seenMessage = async () => {
      throw new Error("db down: password=hunter2");
    };
    const out = await h.send("help");
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("hunter2");
  });

  it("touches lastInboundAt for linked users", async () => {
    const h = makeHarness();
    await h.send("help");
    expect(h.store.links.get(PHONE)!.lastInboundAt).toBe(NOW);
  });

  it("escapes markdown in user-supplied pantry names", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "*bold* _it_ ~x~ `c`", 1)];
    const [r] = await h.send("fridge");
    expect(r).not.toMatch(/[_~`]/);
    expect(r.match(/\*/g)!.length).toBe(2); // only the title's bold markers
  });

  it("default output of every flow is emoji-free; useEmoji adds markers", async () => {
    const h = makeHarness();
    h.services.pantry = [item("1", "Milk", 1), item("2", "Eggs", -1), item("3", "Rice", 20)];
    const outs: string[] = [];
    outs.push(...(await h.photo()), ...(await h.send("add")), ...(await h.send("fridge")), ...(await h.send("cook")));
    outs.push(...(await h.send("5449000000996")), ...(await h.send("help")), ...(await h.send("stop")), ...(await h.send("???")));
    h.services.produce = { ...h.services.produce!, freshnessStatus: "rotten" };
    outs.push(...(await h.photo()));
    for (const o of outs) expect(o).not.toMatch(EMOJI);

    const e = makeHarness({ config: { useEmoji: true } });
    e.services.pantry = [item("1", "Milk", 1)];
    expect((await e.photo())[0]).toMatch(EMOJI);
    expect((await e.send("fridge"))[0]).toMatch(EMOJI);
  });

  it("a FakeServices instance is the only I/O boundary", () => {
    expect(new FakeServices().called("anything")).toEqual([]);
  });
});
