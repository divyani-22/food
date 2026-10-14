import { index, uniqueIndex, int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, float } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * User profile with personal and health details
 */
export const userProfiles = mysqlTable("user_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  age: int("age"),
  gender: mysqlEnum("gender", ["male", "female", "other"]),
  height: int("height"), // in cm
  weight: int("weight"), // in kg
  bmi: float("bmi"),
  exerciseFrequency: mysqlEnum("exercise_frequency", ["sedentary", "light", "moderate", "active", "very_active"]),
  dietType: mysqlEnum("diet_type", ["veg", "non_veg", "vegan", "keto", "other"]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, t => ({
  userIdUnique: uniqueIndex("user_profiles_user_id_unique").on(t.userId),
}));

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

/**
 * Medical conditions for users
 */
export const medicalConditions = mysqlTable("medical_conditions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  condition: text("condition").notNull(),
  diagnosedDate: timestamp("diagnosed_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  userIdIdx: index("medical_conditions_user_id_idx").on(t.userId),
}));

export type MedicalCondition = typeof medicalConditions.$inferSelect;
export type InsertMedicalCondition = typeof medicalConditions.$inferInsert;

/**
 * Medications (current and past)
 */
export const medications = mysqlTable("medications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  dosage: varchar("dosage", { length: 100 }),
  frequency: varchar("frequency", { length: 100 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isCurrent: boolean("is_current").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, t => ({
  userIdIdx: index("medications_user_id_idx").on(t.userId),
}));

export type Medication = typeof medications.$inferSelect;
export type InsertMedication = typeof medications.$inferInsert;

/**
 * Food scans performed by users
 */
export const foodScans = mysqlTable("food_scans", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productName: varchar("product_name", { length: 255 }),
  inputType: mysqlEnum("input_type", ["text", "image"]).notNull(),
  imageUrl: text("image_url"),
  imageKey: text("image_key"),
  rawIngredients: text("raw_ingredients"),
  ocrText: text("ocr_text"),
  riskScore: int("risk_score"), // 0-100
  analysisComplete: boolean("analysis_complete").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, t => ({
  userIdIdx: index("food_scans_user_id_idx").on(t.userId),
}));

export type FoodScan = typeof foodScans.$inferSelect;
export type InsertFoodScan = typeof foodScans.$inferInsert;

/**
 * Individual ingredients detected in scans
 */
export const scanIngredients = mysqlTable("scan_ingredients", {
  id: int("id").autoincrement().primaryKey(),
  scanId: int("scan_id").notNull().references(() => foodScans.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  scientificName: varchar("scientific_name", { length: 255 }),
  category: varchar("category", { length: 100 }),
  riskLevel: mysqlEnum("risk_level", ["safe", "low", "moderate", "high", "severe"]),
  shortTermEffects: text("short_term_effects"),
  longTermEffects: text("long_term_effects"),
  sideEffects: text("side_effects"),
  personalizedRisk: text("personalized_risk"),
  sources: text("sources"), // JSON array of source URLs
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  scanIdIdx: index("scan_ingredients_scan_id_idx").on(t.scanId),
}));

export type ScanIngredient = typeof scanIngredients.$inferSelect;
export type InsertScanIngredient = typeof scanIngredients.$inferInsert;

/**
 * Alternative product suggestions
 */
export const alternatives = mysqlTable("alternatives", {
  id: int("id").autoincrement().primaryKey(),
  scanId: int("scan_id").notNull().references(() => foodScans.id, { onDelete: "cascade" }),
  productName: varchar("product_name", { length: 255 }).notNull(),
  reason: text("reason").notNull(),
  scientificJustification: text("scientific_justification"),
  sources: text("sources"), // JSON array
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  scanIdIdx: index("alternatives_scan_id_idx").on(t.scanId),
}));

export type Alternative = typeof alternatives.$inferSelect;
export type InsertAlternative = typeof alternatives.$inferInsert;

/**
 * Chat messages between user and AI
 */
export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  scanId: int("scan_id").references(() => foodScans.id, { onDelete: "cascade" }), // optional, if chat is related to a specific scan
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({
  userIdIdx: index("chat_messages_user_id_idx").on(t.userId),
  scanIdIdx: index("chat_messages_scan_id_idx").on(t.scanId),
}));

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Ingredient knowledge base (cached from external APIs)
 */
export const ingredientDatabase = mysqlTable("ingredient_database", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  scientificName: varchar("scientific_name", { length: 255 }),
  category: varchar("category", { length: 100 }),
  description: text("description"),
  healthImpact: text("health_impact"),
  regulatoryStatus: text("regulatory_status"),
  fssaiData: text("fssai_data"), // JSON
  whoData: text("who_data"), // JSON
  sources: text("sources"), // JSON array
  lastUpdated: timestamp("last_updated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IngredientData = typeof ingredientDatabase.$inferSelect;
export type InsertIngredientData = typeof ingredientDatabase.$inferInsert;

/**
 * Food Expiry Tracker inventory items (EcoFridge Integration)
 */
export const foodInventory = mysqlTable("food_inventory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  quantity: varchar("quantity", { length: 100 }).default("1").notNull(),
  storageLocation: mysqlEnum("storage_location", ["fridge", "freezer", "pantry"]).default("fridge").notNull(),
  foodImageUrl: text("food_image_url"),
  barcode: varchar("barcode", { length: 64 }),
  expiryDate: timestamp("expiry_date").notNull(),
  addedDate: timestamp("added_date").defaultNow().notNull(),
  notes: text("notes"),
  status: mysqlEnum("status", ["fresh", "expiring_soon", "expired", "consumed"]).default("fresh").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, t => ({
  userIdIdx: index("food_inventory_user_id_idx").on(t.userId),
}));

export type FoodInventoryItem = typeof foodInventory.$inferSelect;
export type InsertFoodInventoryItem = typeof foodInventory.$inferInsert;
