import { sql } from "drizzle-orm";
import { index, uniqueIndex, integer, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

/**
 * SQLite mirror of drizzle/schema.ts (embedded zero-config database).
 *
 * RULE: every change to schema.ts must be made here too (and both migration folders regenerated).
 * server/schema.parity.test.ts fails when the two files drift apart.
 *
 * Type mapping: int -> integer, varchar/text -> text, mysqlEnum -> text with enum constraint,
 * timestamp -> integer {mode: "timestamp"} (unix seconds, like MySQL TIMESTAMP), boolean -> integer {mode: "boolean"},
 * float -> real. MySQL "ON UPDATE CURRENT_TIMESTAMP" is emulated with $onUpdate (drizzle update()) and
 * explicitly in server/db.ts for upserts.
 */
const nowSeconds = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: text("email", { length: 320 }),
  loginMethod: text("loginMethod", { length: 64 }),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(nowSeconds).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).default(nowSeconds).notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const userProfiles = sqliteTable("user_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  age: integer("age"),
  gender: text("gender", { enum: ["male", "female", "other"] }),
  height: integer("height"), // in cm
  weight: integer("weight"), // in kg
  bmi: real("bmi"),
  exerciseFrequency: text("exercise_frequency", { enum: ["sedentary", "light", "moderate", "active", "very_active"] }),
  dietType: text("diet_type", { enum: ["veg", "non_veg", "vegan", "keto", "other"] }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
}, t => ({
  userIdUnique: uniqueIndex("user_profiles_user_id_unique").on(t.userId),
}));

export const medicalConditions = sqliteTable("medical_conditions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  condition: text("condition").notNull(),
  diagnosedDate: integer("diagnosed_date", { mode: "timestamp" }),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  userIdIdx: index("medical_conditions_user_id_idx").on(t.userId),
}));

export const medications = sqliteTable("medications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name", { length: 255 }).notNull(),
  dosage: text("dosage", { length: 100 }),
  frequency: text("frequency", { length: 100 }),
  startDate: integer("start_date", { mode: "timestamp" }),
  endDate: integer("end_date", { mode: "timestamp" }),
  isCurrent: integer("is_current", { mode: "boolean" }).default(true).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
}, t => ({
  userIdIdx: index("medications_user_id_idx").on(t.userId),
}));

export const foodScans = sqliteTable("food_scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  productName: text("product_name", { length: 255 }),
  inputType: text("input_type", { enum: ["text", "image"] }).notNull(),
  imageUrl: text("image_url"),
  imageKey: text("image_key"),
  rawIngredients: text("raw_ingredients"),
  ocrText: text("ocr_text"),
  riskScore: integer("risk_score"), // 0-100
  analysisComplete: integer("analysis_complete", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
}, t => ({
  userIdIdx: index("food_scans_user_id_idx").on(t.userId),
}));

export const scanIngredients = sqliteTable("scan_ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scanId: integer("scan_id").notNull().references(() => foodScans.id, { onDelete: "cascade" }),
  name: text("name", { length: 255 }).notNull(),
  scientificName: text("scientific_name", { length: 255 }),
  category: text("category", { length: 100 }),
  riskLevel: text("risk_level", { enum: ["safe", "low", "moderate", "high", "severe"] }),
  shortTermEffects: text("short_term_effects"),
  longTermEffects: text("long_term_effects"),
  sideEffects: text("side_effects"),
  personalizedRisk: text("personalized_risk"),
  sources: text("sources"), // JSON array of source URLs
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  scanIdIdx: index("scan_ingredients_scan_id_idx").on(t.scanId),
}));

export const alternatives = sqliteTable("alternatives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scanId: integer("scan_id").notNull().references(() => foodScans.id, { onDelete: "cascade" }),
  productName: text("product_name", { length: 255 }).notNull(),
  reason: text("reason").notNull(),
  scientificJustification: text("scientific_justification"),
  sources: text("sources"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  scanIdIdx: index("alternatives_scan_id_idx").on(t.scanId),
}));

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  scanId: integer("scan_id").references(() => foodScans.id, { onDelete: "cascade" }), // optional
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  userIdIdx: index("chat_messages_user_id_idx").on(t.userId),
  scanIdIdx: index("chat_messages_scan_id_idx").on(t.scanId),
}));

export const ingredientDatabase = sqliteTable("ingredient_database", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 255 }).notNull().unique(),
  scientificName: text("scientific_name", { length: 255 }),
  category: text("category", { length: 100 }),
  description: text("description"),
  healthImpact: text("health_impact"),
  regulatoryStatus: text("regulatory_status"),
  fssaiData: text("fssai_data"), // JSON
  whoData: text("who_data"), // JSON
  sources: text("sources"), // JSON array
  lastUpdated: integer("last_updated", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
});

export const foodInventory = sqliteTable("food_inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title", { length: 255 }).notNull(),
  category: text("category", { length: 100 }).notNull(),
  quantity: text("quantity", { length: 100 }).default("1").notNull(),
  storageLocation: text("storage_location", { enum: ["fridge", "freezer", "pantry"] }).default("fridge").notNull(),
  foodImageUrl: text("food_image_url"),
  barcode: text("barcode", { length: 64 }),
  expiryDate: integer("expiry_date", { mode: "timestamp" }).notNull(),
  addedDate: integer("added_date", { mode: "timestamp" }).default(nowSeconds).notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["fresh", "expiring_soon", "expired", "consumed"] }).default("fresh").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(nowSeconds).$onUpdate(() => new Date()).notNull(),
}, t => ({
  userIdIdx: index("food_inventory_user_id_idx").on(t.userId),
}));

export const produceScans = sqliteTable("produce_scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  fruitType: text("fruit_type", { length: 64 }).notNull(),
  fruitName: text("fruit_name", { length: 100 }).notNull(),
  freshness: text("freshness", { enum: ["fresh", "normal", "rotten"] }).notNull(),
  freshnessLabel: text("freshness_label", { length: 64 }).notNull(),
  pFresh: real("p_fresh").notNull(),
  confidence: real("confidence").notNull(),
  imageUrl: text("image_url", { length: 512 }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  userIdx: index("produce_scans_user_id_idx").on(t.userId, t.createdAt),
}));

export const produceInventory = sqliteTable("produce_inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name", { length: 100 }).notNull(),
  fruitType: text("fruit_type", { length: 64 }).notNull(),
  freshness: text("freshness", { enum: ["fresh", "normal", "rotten"] }).notNull(),
  pFresh: real("p_fresh").notNull(),
  confidence: real("confidence").notNull(),
  imageUrl: text("image_url", { length: 512 }),
  expiryDate: text("expiry_date", { length: 10 }).notNull(), // YYYY-MM-DD
  storageTip: text("storage_tip"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(nowSeconds).notNull(),
}, t => ({
  userIdx: index("produce_inventory_user_id_idx").on(t.userId),
}));
