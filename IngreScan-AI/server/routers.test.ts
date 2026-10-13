import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getFoodScan: vi.fn(),
  getScanIngredients: vi.fn(async () => [{ name: "SECRET-INGREDIENT" }]),
  getAlternatives: vi.fn(async () => []),
  getUserProfile: vi.fn(async () => null),
  getMedicalConditions: vi.fn(async () => []),
  getMedications: vi.fn(async () => []),
  addChatMessage: vi.fn(),
  getChatHistory: vi.fn(async () => []),
  deleteScanIngredients: vi.fn(),
  addScanIngredient: vi.fn(),
  updateFoodScan: vi.fn(),
  updateMedication: vi.fn(),
  addInventoryItem: vi.fn(async () => 7),
  getUserInventory: vi.fn(async () => []),
  updateInventoryItem: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(async (k: string) => ({ key: k, url: "/uploads/x" })) }));

import { appRouter } from "./routers";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";

const caller = appRouter.createCaller({
  user: { id: 5, openId: "o", role: "user" },
  req: {} as any,
  res: {} as any,
} as any);

beforeEach(() => vi.clearAllMocks());

describe("authorization on scan-scoped procedures", () => {
  beforeEach(() => (db.getFoodScan as any).mockResolvedValue(undefined)); // scan belongs to someone else

  it("chat.sendMessage rejects foreign scans and does not persist or leak", async () => {
    await expect(caller.chat.sendMessage({ message: "hi", scanId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.addChatMessage).not.toHaveBeenCalled();
    expect(db.getScanIngredients).not.toHaveBeenCalled();
    expect(invokeLLM).not.toHaveBeenCalled();
  });
  it("analysis.analyzeIngredients rejects foreign scans", async () => {
    await expect(caller.analysis.analyzeIngredients({ scanId: 99, ingredients: "sugar" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.addScanIngredient).not.toHaveBeenCalled();
    expect(invokeLLM).not.toHaveBeenCalled();
  });
  it("scanner.processOCR rejects foreign scans", async () => {
    await expect(caller.scanner.processOCR({ scanId: 99, imageUrl: "https://x/y.png" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(invokeLLM).not.toHaveBeenCalled();
  });
});

describe("analysis.analyzeIngredients", () => {
  beforeEach(() => (db.getFoodScan as any).mockResolvedValue({ id: 1, userId: 5 }));

  it("tolerates fenced JSON, bad entries and out-of-range score", async () => {
    (invokeLLM as any).mockResolvedValue({
      choices: [{ message: { content: '```json\n{"ingredients":[{"name":"Sugar","riskLevel":"high"},{"riskLevel":"low"}],"overallRiskScore":250,"summary":"s"}\n```' } }],
    });
    await caller.analysis.analyzeIngredients({ scanId: 1, ingredients: "sugar" });
    expect(db.deleteScanIngredients).toHaveBeenCalledWith(1);
    expect(db.addScanIngredient).toHaveBeenCalledTimes(1);
    expect(db.updateFoodScan).toHaveBeenCalledWith(1, 5, { riskScore: 100, analysisComplete: true });
  });
  it("fails cleanly (and keeps old data) on garbage LLM output", async () => {
    (invokeLLM as any).mockResolvedValue({ choices: [{ message: { content: "sorry" } }] });
    await expect(caller.analysis.analyzeIngredients({ scanId: 1, ingredients: "sugar" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(db.deleteScanIngredients).not.toHaveBeenCalled();
  });
  it("rejects empty ingredients", async () => {
    await expect(caller.analysis.analyzeIngredients({ scanId: 1, ingredients: "  " })).rejects.toThrow();
  });
});

describe("input validation", () => {
  it("medication partial update does not inject isCurrent default", async () => {
    await caller.profile.updateMedication({ id: 1, updates: { dosage: "5mg" } });
    expect(db.updateMedication).toHaveBeenCalledWith(1, 5, { dosage: "5mg" });
  });
  it("inventory.add rejects invalid and out-of-range dates, accepts valid", async () => {
    await expect(caller.inventory.add({ title: "Milk", expiryDate: "not-a-date" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.inventory.add({ title: "Milk", expiryDate: "2099-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.inventory.add({ title: "Milk", expiryDate: "2026-12-01" })).resolves.toMatchObject({ id: 7 });
  });
  it("uploadImage sanitises file name and rejects non-images", async () => {
    await caller.scanner.uploadImage({ fileName: "../../evil.png", fileData: Buffer.from("abc").toString("base64"), mimeType: "image/png" });
    expect((storagePut as any).mock.calls[0][0]).toMatch(/^scans\/5\/\d+-evil\.png$/);
    await expect(caller.scanner.uploadImage({ fileName: "a.exe", fileData: "AAAA", mimeType: "application/x-msdownload" })).rejects.toThrow();
  });
});
