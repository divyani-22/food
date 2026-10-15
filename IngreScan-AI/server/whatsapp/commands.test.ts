import { describe, expect, it } from "vitest";
import { parseCommand, parseRemindHour } from "./commands";

const t = (s: string) => parseCommand(s).type;

describe("parseCommand", () => {
  it("is case-insensitive, trimmed and tolerant of trailing punctuation", () => {
    for (const s of ["help", "HELP", "  Help  ", "help!", "Help?", "help.", "HeLp...", "​help", "help\n"]) expect(t(s)).toBe("help");
    expect(t("?")).toBe("help");
    expect(t("hi")).toBe("help");
    expect(t("Hello!")).toBe("help");
  });

  it("LINK", () => {
    expect(parseCommand("link abcd2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("LINK  abcd-2345.")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("link ABCD 2345")).toEqual({ type: "link", code: "ABCD2345" });
    expect(parseCommand("LINK")).toEqual({ type: "link", code: null });
  });

  it("FRIDGE / PANTRY / MORE", () => {
    expect(parseCommand("fridge")).toEqual({ type: "fridge", page: 1 });
    expect(parseCommand("Pantry!")).toEqual({ type: "fridge", page: 1 });
    expect(parseCommand("fridge 3")).toEqual({ type: "fridge", page: 3 });
    expect(parseCommand("pantry page 2")).toEqual({ type: "fridge", page: 2 });
    expect(parseCommand("fridge 0")).toEqual({ type: "fridge", page: 1 });
    expect(t("more")).toBe("more");
    expect(t("next")).toBe("more");
  });

  it("RESCUE / COOK / ADD / STOP / START / CANCEL", () => {
    expect(t("rescue")).toBe("rescue");
    expect(t("Cook.")).toBe("rescue");
    expect(t("add")).toBe("add");
    expect(t("ADD!")).toBe("add");
    expect(t("save")).toBe("add");
    for (const s of ["stop", "STOP", "Unsubscribe", "stopall", "quit"]) expect(t(s)).toBe("stop");
    for (const s of ["start", "Start!", "unstop", "subscribe"]) expect(t(s)).toBe("start");
    expect(t("cancel")).toBe("cancel");
  });

  it("CLEAR keeps the item name", () => {
    expect(parseCommand("clear milk")).toEqual({ type: "clear", name: "milk" });
    expect(parseCommand("CLEAR  Whole   Milk.")).toEqual({ type: "clear", name: "Whole Milk" });
    expect(parseCommand("clear")).toEqual({ type: "clear", name: null });
  });

  it("REMIND", () => {
    expect(parseCommand("remind 8")).toEqual({ type: "remind", hour: 8, raw: "8" });
    expect(parseCommand("REMIND 0")).toMatchObject({ hour: 0 });
    expect(parseCommand("remind 23!")).toMatchObject({ hour: 23 });
    expect(parseCommand("remind 24")).toMatchObject({ hour: null });
    expect(parseCommand("remind -1")).toMatchObject({ hour: null });
    expect(parseCommand("remind 8.5")).toMatchObject({ hour: null });
    expect(parseCommand("remind")).toMatchObject({ hour: null, raw: "" });
    expect(parseCommand("remind abc")).toMatchObject({ hour: null });
    expect(parseRemindHour("7pm")).toBe(19);
    expect(parseRemindHour("12am")).toBe(0);
    expect(parseRemindHour("12pm")).toBe(12);
    expect(parseRemindHour("13pm")).toBeNull();
    expect(parseRemindHour("9:00")).toBe(9);
    expect(parseRemindHour("08")).toBe(8);
  });

  it("TZ preserves case of the zone", () => {
    expect(parseCommand("tz Asia/Kolkata")).toEqual({ type: "tz", zone: "Asia/Kolkata" });
    expect(parseCommand("TZ America/New_York.")).toEqual({ type: "tz", zone: "America/New_York" });
    expect(parseCommand("tz")).toEqual({ type: "tz", zone: null });
  });

  it("digits: choice, barcode, other", () => {
    expect(parseCommand("2")).toEqual({ type: "choice", n: 2 });
    expect(parseCommand("12")).toEqual({ type: "choice", n: 12 });
    expect(parseCommand("5449000000996")).toEqual({ type: "barcode", digits: "5449000000996" });
    expect(parseCommand("5 449000 000996")).toEqual({ type: "barcode", digits: "5449000000996" });
    expect(parseCommand("5449-0000-00996.")).toEqual({ type: "barcode", digits: "5449000000996" });
    expect(parseCommand("12345678")).toEqual({ type: "barcode", digits: "12345678" });
    expect(parseCommand("1234567")).toEqual({ type: "digits", digits: "1234567" });
    expect(parseCommand("123456789012345")).toEqual({ type: "digits", digits: "123456789012345" });
  });

  it("ingredient text", () => {
    expect(parseCommand("Ingredients: water, sugar, salt")).toEqual({ type: "ingredients", text: "water, sugar, salt" });
    expect(t("water, sugar, palm oil, E471, salt")).toBe("ingredients");
    expect(t("sugar")).toBe("unknown");
  });

  it("caps ingredient text length", () => {
    const long = "ingredients: " + "a, ".repeat(5000);
    const c = parseCommand(long);
    expect(c.type === "ingredients" && c.text.length <= 4000).toBe(true);
  });

  it("empty, punctuation-only, and messy input never throws", () => {
    expect(t("")).toBe("empty");
    expect(t("   ")).toBe("empty");
    expect(parseCommand(undefined).type).toBe("empty");
    expect(parseCommand(null).type).toBe("empty");
    expect(t("!!!")).toBe("unknown");
    expect(t("helpme please")).toBe("unknown");
    expect(t("\u0000\u0001help")).toBe("help");
    expect(t("\u{1F600}")).toBe("unknown");
    expect(t("a".repeat(100_000))).toBe("unknown");
  });
});
